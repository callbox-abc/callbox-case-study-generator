// Shared by the weekly job's cron routes (app/api/cron/top-clients and .../resume).
import { NextRequest, NextResponse } from "next/server";
import { runStep } from "@/lib/topClients";

// Only Vercel Schedules (and the job itself) carry the secret: "Authorization: Bearer <CRON_SECRET>".
export const cronAuthorized = (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
};

// Starts the next step in its own function run. The request is sent and then let go: the next
// step keeps running on its own, and the resume cron catches a chain that broke.
async function startNext(req: NextRequest, cycle: string) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = host ? `https://${host}` : req.nextUrl.origin;
  await fetch(`${base}/api/cron/top-clients?cycle=${encodeURIComponent(cycle)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

export async function stepAndContinue(req: NextRequest, cycle: string) {
  const result = await runStep(cycle);
  if (!result.done) await startNext(req, cycle);
  return NextResponse.json({ cycle, ...result });
}
