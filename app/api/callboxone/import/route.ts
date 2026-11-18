import { NextRequest, NextResponse } from "next/server";
import {
  CallboxOneConfigError,
  buildPatch,
  quarterWindows,
  sanitizeTotals,
  sanitizeWindow,
  listSummary,
  sanitizeListSummary,
  startFromCampaignCode,
  totalsFromReport,
  withCallboxOne,
} from "@/lib/callboxone";

// Step-by-step CallboxOne import. Each get_report_stats call takes ~15-20s and returns ~1MB,
// so running every quarter in one request exceeded Vercel's function time limit. The browser
// now drives the steps (plan -> one request per quarter + progression -> build), and each
// request stays well under the limit. Read-only throughout.
//
//   { step: "plan", campaignName, start? }                       -> { windows }
//   { step: "window", clientId, clientAccountId, from, to }      -> { totals }
//   { step: "progression", clientId, from, to }                  -> { progression: { counts } }
//   { step: "build", campaign, windows, perWindow, progression } -> ImportResult

export const maxDuration = 60;
const MAX_WINDOWS = 12; // 3 years of quarters
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Request body must be JSON.");
  }

  try {
    switch (body?.step) {
      case "plan": {
        const campaignName = String(body.campaignName || "");
        const ym = (v: unknown) => (/^\d{4}-\d{2}$/.test(String(v || "")) ? new Date(`${v}-01T00:00:00Z`) : null);
        // Start month: the writer's override, else the campaign code, else HubSpot's first closed deal.
        const override = ym(body.start);
        const fromCode = startFromCampaignCode(campaignName);
        const start = override || fromCode || ym(body.fallbackStart);
        if (!start) return bad(`Couldn't read a start month from "${campaignName}". Enter it as YYYY-MM.`);
        const windows = quarterWindows(start).slice(-MAX_WINDOWS);
        if (!windows.length) return bad("Campaign start is in the future.");
        return NextResponse.json({ windows, startSource: override ? "override" : fromCode ? "code" : "hubspot" });
      }

      case "window": {
        const clientId = Number(body.clientId);
        const clientAccountId = Number(body.clientAccountId);
        if (!clientId || !clientAccountId || !DATE.test(body.from) || !DATE.test(body.to)) return bad("Invalid window request.");
        const report = await withCallboxOne((call) =>
          call("get_report_stats", { clientId, clientAccountId, from: body.from, to: body.to })
        );
        return NextResponse.json({ totals: totalsFromReport(report, clientAccountId) });
      }

      case "lists": {
        // Counts and list groups only; list names (often data-vendor names) are never returned.
        const clientId = Number(body.clientId);
        const clientAccountId = Number(body.clientAccountId);
        if (!clientId) return bad("Invalid lists request.");
        const res = await withCallboxOne((call) => call("list_client_lists", { clientId }));
        return NextResponse.json({ lists: listSummary(res, clientAccountId) });
      }

      case "progression": {
        const clientId = Number(body.clientId);
        if (!clientId || !DATE.test(body.from) || !DATE.test(body.to)) return bad("Invalid progression request.");
        const res = await withCallboxOne((call) =>
          call("get_opportunity_progression", { clientId, from: body.from, to: body.to })
        );
        return NextResponse.json({ progression: { counts: res?.counts || {} } });
      }

      case "build": {
        const windows = Array.isArray(body.windows) ? body.windows.map(sanitizeWindow) : [];
        const perWindow = Array.isArray(body.perWindow) ? body.perWindow.map(sanitizeTotals) : [];
        if (!windows.length || windows.length > MAX_WINDOWS || windows.some((w: unknown) => !w) || perWindow.length !== windows.length) {
          return bad("Invalid build request.");
        }
        const c = body.campaign || {};
        const campaign = {
          clientId: Number(c.clientId) || 0,
          clientAccountId: Number(c.clientAccountId) || 0,
          campaignName: String(c.campaignName || "").slice(0, 80),
          clientName: String(c.clientName || "").slice(0, 200),
        };
        return NextResponse.json(
          buildPatch(campaign, windows, perWindow, body.progression || {}, {
            lists: sanitizeListSummary(body.lists),
            timezone: typeof c.timezone === "string" ? c.timezone.slice(0, 60) : "",
          })
        );
      }

      default:
        return bad("Unknown import step.");
    }
  } catch (err: any) {
    const status = err instanceof CallboxOneConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "CallboxOne import failed." }, { status });
  }
}
