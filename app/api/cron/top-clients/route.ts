import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized, stepAndContinue } from "@/lib/cronJob";
import { claimJob, currentCycle } from "@/lib/topClients";

// Weekly "most active clients" job (vercel.json crons):
//   Mondays 00:00 UTC (08:00 PH)       GET            starts this week's job (once: the job row is the lock)
//   Mondays every 10 min, 00:00-02:59  GET /resume     continues the job only if its chain stalled
// Each step runs up to ~4 minutes, saves its progress, then starts the next step (POST).
// Access: only with "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends it); see proxy.ts.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const cycle = currentCycle();
  try {
    if (!(await claimJob(cycle))) return NextResponse.json({ cycle, skipped: "Already ran this week." });
    return await stepAndContinue(req, cycle);
  } catch (err: any) {
    return NextResponse.json({ cycle, error: err?.message || "Job step failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const cycle = req.nextUrl.searchParams.get("cycle") || "";
  // Only this week's job continues; a stray request for an old week does nothing.
  if (cycle !== currentCycle()) return NextResponse.json({ cycle, skipped: "Not this week's job." });
  try {
    return await stepAndContinue(req, cycle);
  } catch (err: any) {
    return NextResponse.json({ cycle, error: err?.message || "Job step failed." }, { status: 500 });
  }
}
