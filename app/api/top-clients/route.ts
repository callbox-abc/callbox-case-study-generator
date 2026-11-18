import { NextRequest, NextResponse } from "next/server";
import { CallboxOneConfigError } from "@/lib/callboxone";
import { getBatch, getFinal, getPlan } from "@/lib/topClients";

// Today's most active clients, in cached steps the browser drives (each fits the time limit):
//   ?step=plan            -> { cycle, nextRefresh, candidates, batches }
//   ?step=batch&i=<n>     -> { index, size, checked, rows }
//   ?step=final           -> TopClientsPayload
// Everything is cached per day and resets at 08:00 PH. Read-only.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const step = req.nextUrl.searchParams.get("step") || "final";
  try {
    if (step === "plan") return NextResponse.json(await getPlan());
    if (step === "batch") {
      const i = Number(req.nextUrl.searchParams.get("i"));
      if (!Number.isInteger(i) || i < 0 || i > 200) return NextResponse.json({ error: "Invalid batch." }, { status: 400 });
      return NextResponse.json(await getBatch(i));
    }
    if (step === "final") return NextResponse.json(await getFinal());
    return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  } catch (err: any) {
    const status = err instanceof CallboxOneConfigError ? 500 : 502;
    return NextResponse.json({ error: err?.message || "Could not load today's clients." }, { status });
  }
}
