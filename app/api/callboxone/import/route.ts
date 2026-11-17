import { NextRequest, NextResponse } from "next/server";
import {
  CallboxOneConfigError,
  buildPatch,
  quarterWindows,
  startFromCampaignCode,
  totalsFromReport,
  withCallboxOne,
} from "@/lib/callboxone";

// Pulls a campaign's numbers from CallboxOne and returns the data sections of the sheet
// (hero stats, period/channel facts, channel rows, quarters, funnel). Read-only.
// One get_report_stats call per quarter plus one progression call; each report response is
// large (~800KB) but stays server-side and only the campaign KPIs are kept.

export const maxDuration = 60;
const MAX_WINDOWS = 12; // 3 years of quarters

export async function POST(req: NextRequest) {
  let body: { clientId?: number; clientAccountId?: number; campaignName?: string; clientName?: string; start?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const clientId = Number(body.clientId);
  const clientAccountId = Number(body.clientAccountId);
  const campaignName = String(body.campaignName || "");
  if (!clientId || !clientAccountId || !campaignName) {
    return NextResponse.json({ error: "Pick a campaign first." }, { status: 400 });
  }

  // Start month: explicit override (YYYY-MM) or decoded from the campaign code.
  const override = /^\d{4}-\d{2}$/.test(body.start || "") ? new Date(`${body.start}-01T00:00:00Z`) : null;
  const start = override || startFromCampaignCode(campaignName);
  if (!start) {
    return NextResponse.json({ error: `Couldn't read a start month from "${campaignName}". Enter it as YYYY-MM.` }, { status: 400 });
  }

  const windows = quarterWindows(start).slice(-MAX_WINDOWS);
  if (!windows.length) return NextResponse.json({ error: "Campaign start is in the future." }, { status: 400 });

  try {
    const result = await withCallboxOne(async (call) => {
      const perWindow = [];
      for (const w of windows) {
        const report = await call("get_report_stats", { clientId, clientAccountId, from: w.from, to: w.to });
        perWindow.push(totalsFromReport(report, clientAccountId));
      }
      const progression = await call("get_opportunity_progression", {
        clientId,
        from: windows[0].from,
        to: windows[windows.length - 1].to,
      });
      return buildPatch({ clientId, clientAccountId, campaignName, clientName: String(body.clientName || "") }, windows, perWindow, progression);
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err instanceof CallboxOneConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "CallboxOne import failed." }, { status });
  }
}
