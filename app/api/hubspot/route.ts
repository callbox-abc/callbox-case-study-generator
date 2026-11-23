import { NextRequest, NextResponse } from "next/server";
import { HubSpotConfigError, activeClients, clientProfile, searchClients, type ClientCandidate } from "@/lib/hubspot";

// "Import client from HubSpot" (Callbox's own portal). Read-only.
//
//   { step: "search", q }          -> { clients: ClientCandidate[] }
//   { step: "client", companyId }  -> ClientProfile (derived facts only; no deal names or amounts)
//   { step: "active", refresh? }   -> { clients: ClientCandidate[], refreshedAt }  the search box's
//                                     dropdown: Lead Status "Active Client" (lib/hubspot.ts)

// The active clients list takes about 10 HubSpot calls and changes slowly: kept for an hour per
// server instance. `refresh: true` reloads it.
const ACTIVE_TTL_MS = 60 * 60 * 1000;
let activeCache: { at: number; clients: ClientCandidate[] } | null = null;
let activeLoading: Promise<{ at: number; clients: ClientCandidate[] }> | null = null;
async function cachedActiveClients(refresh: boolean) {
  if (!refresh && activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) return activeCache;
  activeLoading ??= activeClients()
    .then((clients) => (activeCache = { at: Date.now(), clients }))
    .finally(() => (activeLoading = null));
  return activeLoading;
}

export const maxDuration = 30;

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
      case "search": {
        const q = String(body.q || "").trim().slice(0, 100);
        if (q.length < 2) return NextResponse.json({ clients: [] });
        return NextResponse.json({ clients: await searchClients(q) });
      }
      case "client": {
        const companyId = String(body.companyId || "");
        if (!/^\d{1,20}$/.test(companyId)) return bad("Invalid company id.");
        return NextResponse.json(await clientProfile(companyId));
      }
      case "active": {
        const { at, clients } = await cachedActiveClients(body.refresh === true);
        return NextResponse.json({ clients, refreshedAt: new Date(at).toISOString() });
      }
      default:
        return bad("Unknown HubSpot step.");
    }
  } catch (err: any) {
    const status = err instanceof HubSpotConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "HubSpot request failed." }, { status });
  }
}
