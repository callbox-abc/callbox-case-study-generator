import { NextRequest, NextResponse } from "next/server";
import { attachDraft, getRecent, listRecent, saveRecent, saveSheet } from "@/lib/recentClients";

// Recently imported clients, shared by everyone using the app (Supabase app_cache).
//   GET                        -> { recent: RecentClient[] }
//   GET ?key=<key>             -> { entry: RecentClient | null }   one client, even if not in the list
//   POST  { client, campaign, hubspot, callboxone, unbranded? }   -> { key }   after a live import
//   POST ?step=draft { key, id, editLink, unbranded? }            -> { ok }    after "Send to CMS"
//   POST ?step=sheet { key, sheet, reviewed, aiDrafted, client, campaign, stored } -> { ok }
//                                                       the sheet being worked on (Save)
// `unbranded`: the client's unbranded case study, saved apart from its branded one (sheet.unbranded
// picks the slot for a sheet).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key");
    if (key) return NextResponse.json({ entry: await getRecent(key) });
    return NextResponse.json({ recent: await listRecent() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not read recent clients." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    if (req.nextUrl.searchParams.get("step") === "sheet") {
      await saveSheet(body);
      return NextResponse.json({ ok: true });
    }
    if (req.nextUrl.searchParams.get("step") === "draft") {
      await attachDraft(String(body?.key || ""), Number(body?.id), String(body?.editLink || ""), body?.unbranded === true);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({
      key: await saveRecent({ campaign: body?.campaign, company: body?.client, hubspot: body?.hubspot, callboxone: body?.callboxone, unbranded: body?.unbranded === true }),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not save the import." }, { status: 500 });
  }
}
