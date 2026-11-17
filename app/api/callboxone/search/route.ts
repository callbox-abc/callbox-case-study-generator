import { NextRequest, NextResponse } from "next/server";
import { CallboxOneConfigError, startFromCampaignCode, withCallboxOne } from "@/lib/callboxone";

// Campaign search for "Import from CallboxOne". Matches campaign code or client/campaign name.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ campaigns: [] });

  try {
    const data = await withCallboxOne((call) => call("list_campaigns", { q, limit: 25 }));
    const campaigns = (data?.campaigns || []).map((c: any) => {
      const start = startFromCampaignCode(c.campaignName);
      return {
        clientId: c.clientId,
        clientAccountId: c.clientAccountId,
        campaignName: c.campaignName,
        clientName: c.clientName,
        teamLeader: c.teamLeader || null,
        start: start ? start.toISOString().slice(0, 7) : null,
      };
    });
    return NextResponse.json({ campaigns });
  } catch (err: any) {
    const status = err instanceof CallboxOneConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "CallboxOne search failed." }, { status });
  }
}
