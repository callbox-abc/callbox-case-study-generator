import { NextRequest, NextResponse } from "next/server";
import { normalizeRevamp, toAcfPayload } from "@/lib/revamp";

// Creates (or updates) a WordPress DRAFT page using the "Case Study: Revamp" template and fills
// its ACF fields over the WP REST API. Never publishes: status is always "draft", and an existing
// page is only updated while it is still a draft.
//
// Env (Vercel, server-only):
//   MAINSITE_URL     WordPress backend base URL (https://cms.callboxinc.com), no trailing slash needed
//   MAIN_CLIENT_USERNAME  WordPress username that owns the Application Password
//   MAIN_CLIENT_PASSWORD  Application Password for that user
//   WP_REVAMP_TEMPLATE (optional) template file path, default "template-case-study-revamp.php"
//   WP_CASE_STUDY_PARENT_ID (optional) parent page id for case studies. Without it, the parent is
//     looked up: the page titled PARENT_TITLE, else the page with slug "case-studies".

const PARENT_TITLE = "Callbox Lead Generation Success Stories";
let parentCache: { id: number; title: string } | null = null;

const decode = (t: string) =>
  t.replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&amp;/g, "&").replace(/&#038;/g, "&").trim();

// Every case study draft goes under the success stories hub page.
async function findParent(base: string, headers: Record<string, string>): Promise<{ id: number; title: string } | null> {
  const fromEnv = Number(process.env.WP_CASE_STUDY_PARENT_ID);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return { id: fromEnv, title: `page ${fromEnv}` };
  if (parentCache) return parentCache;
  const pick = async (query: string, match: (p: any) => boolean) => {
    const res = await fetch(`${base}/wp-json/wp/v2/pages?${query}&_fields=id,title,slug&per_page=20`, { headers });
    if (!res.ok) return null;
    const list = await res.json().catch(() => []);
    const hit = Array.isArray(list) ? list.find(match) : null;
    return hit ? { id: Number(hit.id), title: decode(String(hit.title?.rendered || "")) } : null;
  };
  parentCache =
    (await pick(`search=${encodeURIComponent(PARENT_TITLE)}`, (p) => decode(String(p?.title?.rendered || "")).toLowerCase() === PARENT_TITLE.toLowerCase())) ??
    (await pick("slug=case-studies", (p) => p?.slug === "case-studies"));
  return parentCache;
}

export async function POST(req: NextRequest) {
  const base = (process.env.MAINSITE_URL || "").replace(/\/+$/, "");
  const user = process.env.MAIN_CLIENT_USERNAME || "";
  const pass = process.env.MAIN_CLIENT_PASSWORD || "";
  if (!base || !user || !pass) {
    return NextResponse.json(
      { error: "WordPress is not configured. Set MAINSITE_URL, MAIN_CLIENT_USERNAME and MAIN_CLIENT_PASSWORD in Vercel and redeploy." },
      { status: 500 }
    );
  }

  let body: { revamp?: unknown; pageId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const revamp = normalizeRevamp(body.revamp);
  if (!revamp.headline) {
    return NextResponse.json({ error: "A headline is required before sending to the CMS." }, { status: 400 });
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
  };
  const pageId = Number.isInteger(body.pageId) && (body.pageId as number) > 0 ? (body.pageId as number) : null;

  // Only ever touch a page that is still a draft.
  let existingParent = 0;
  if (pageId) {
    const check = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}?context=edit&_fields=id,status,parent`, { headers });
    if (!check.ok) {
      return NextResponse.json({ error: `Could not load page ${pageId} (HTTP ${check.status}).` }, { status: 502 });
    }
    const existing = await check.json();
    if (existing.status !== "draft") {
      return NextResponse.json(
        { error: `Page ${pageId} is "${existing.status}", not a draft. Edit it in wp-admin instead.` },
        { status: 409 }
      );
    }
    existingParent = Number(existing.parent) || 0;
  }

  const payload: Record<string, unknown> = {
    title: revamp.headline,
    status: "draft",
    template: process.env.WP_REVAMP_TEMPLATE || "template-case-study-revamp.php",
    acf: toAcfPayload(revamp),
  };
  // New drafts, and drafts that still have no parent, go under the success stories page. A parent
  // an editor picked by hand in wp-admin is left alone.
  const parent = existingParent ? null : await findParent(base, headers).catch(() => null);
  if (parent) payload.parent = parent.id;

  const url = pageId ? `${base}/wp-json/wp/v2/pages/${pageId}` : `${base}/wp-json/wp/v2/pages`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(
      { error: json?.message || `WordPress returned HTTP ${res.status}.`, code: json?.code },
      { status: 502 }
    );
  }

  // Report fields WordPress did not store, so a mapping mismatch is visible immediately.
  const sentKeys = Object.keys(payload.acf as object);
  const storedKeys = json?.acf && typeof json.acf === "object" ? Object.keys(json.acf) : [];
  const missing = sentKeys.filter((k) => !storedKeys.includes(k));

  return NextResponse.json({
    id: json.id,
    status: json.status,
    template: json.template,
    editLink: `${base}/wp-admin/post.php?post=${json.id}&action=edit`,
    missingAcfKeys: missing,
    // "set": placed under the hub page now; "kept": the draft already had a parent; "notFound":
    // no hub page was found, so the draft has no parent.
    parent: existingParent
      ? { status: "kept", id: existingParent }
      : parent
        ? { status: "set", id: parent.id, title: parent.title }
        : { status: "notFound" },
  });
}
