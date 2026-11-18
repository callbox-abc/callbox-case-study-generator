import { NextResponse } from "next/server";
import { CallboxOneConfigError } from "@/lib/callboxone";
import { getTopClients } from "@/lib/topClients";

// Today's 5 most active clients (cached per day, reset at 08:00 PH). Read-only.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getTopClients());
  } catch (err: any) {
    const status = err instanceof CallboxOneConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "Could not load today's clients." }, { status });
  }
}
