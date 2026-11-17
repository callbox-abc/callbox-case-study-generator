import { NextRequest, NextResponse } from "next/server";
import { CallboxOneConfigError, startFromCampaignCode, withCallboxOne } from "@/lib/callboxone";

// Campaign search for "Import from CallboxOne". Matches campaign code or client/campaign name.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ campaigns: [] });

  try {
    const { data, identity } = await withCallboxOne(async (call) => {
      let res = await call("list_campaigns", { q, limit: 25 });
      // list_campaigns matches code/company/client; search_campaign_by_name also matches campaign_name.
      if (!res?.campaigns?.length) res = await call("search_campaign_by_name", { campaignName: q, limit: 25 });
      return { data: res, identity: res?.identity ?? (await call("get_identity", {}))?.identity ?? null };
    });
    const campaigns = (data?.campaigns || []).map((c: any) => {
      const start = startFromCampaignCode(c.campaignName);
      return {
        clientId: c.clientId,
        clientAccountId: c.clientAccountId,
        campaignName: c.campaignName,
        clientName: c.clientName,
        teamLeader: c.teamLeader || null,
        timezone: c.timezone || null,
        start: start ? start.toISOString().slice(0, 7) : null,
      };
    });
    return NextResponse.json({
      campaigns,
      identity: identity ? { userName: identity.userName ?? null, globalClientScope: Boolean(identity.globalClientScope) } : null,
    });
  } catch (err: any) {
    const status = err instanceof CallboxOneConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "CallboxOne search failed." }, { status });
  }
}
