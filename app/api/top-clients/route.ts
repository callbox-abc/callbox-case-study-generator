import { NextResponse } from "next/server";
import { readSnapshot } from "@/lib/topClients";

// The import panel's "Most active clients": reads the weekly snapshot only. It never calls
// CallboxOne or HubSpot; the snapshot is built by the cron job (app/api/cron/top-clients).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readSnapshot());
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not read the clients snapshot." }, { status: 500 });
  }
}
