import { NextRequest, NextResponse } from "next/server";
import { currentCycle, isStalled } from "@/lib/topClients";
import { cronAuthorized, stepAndContinue } from "@/lib/cronJob";

// Mondays every 10 minutes, 00:00-02:59 UTC (vercel.json): continues this week's job only if its
// chain stalled (no step for 10 minutes). Never starts a new job, so CallboxOne is still only
// asked once a week.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const cycle = currentCycle();
  try {
    if (!(await isStalled(cycle))) return NextResponse.json({ cycle, skipped: "Nothing to resume." });
    return await stepAndContinue(req, cycle);
  } catch (err: any) {
    return NextResponse.json({ cycle, error: err?.message || "Resume failed." }, { status: 500 });
  }
}
