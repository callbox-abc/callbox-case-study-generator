import { NextRequest, NextResponse } from "next/server";
import { attachDraft, listRecent, saveRecent } from "@/lib/recentClients";

// Recently imported clients, shared by everyone using the app (Supabase app_cache).
//   GET                        -> { recent: RecentClient[] }
//   POST  { client, campaign, hubspot, callboxone }   -> { key }   after a live import
//   POST ?step=draft { key, id, editLink }            -> { ok }    after "Send to CMS"
export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
    if (req.nextUrl.searchParams.get("step") === "draft") {
      await attachDraft(String(body?.key || ""), Number(body?.id), String(body?.editLink || ""));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ key: await saveRecent({ campaign: body?.campaign, company: body?.client, hubspot: body?.hubspot, callboxone: body?.callboxone }) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not save the import." }, { status: 500 });
  }
}
