import { NextRequest, NextResponse } from "next/server";
import { HubSpotConfigError, clientProfile, searchClients } from "@/lib/hubspot";

// "Import client from HubSpot" (Callbox's own portal). Read-only.
//
//   { step: "search", q }          -> { clients: ClientCandidate[] }
//   { step: "client", companyId }  -> ClientProfile (derived facts only; no deal names or amounts)

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
      default:
        return bad("Unknown HubSpot step.");
    }
  } catch (err: any) {
    const status = err instanceof HubSpotConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "HubSpot request failed." }, { status });
  }
}
