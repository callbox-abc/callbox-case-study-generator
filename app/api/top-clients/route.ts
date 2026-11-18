import { NextRequest, NextResponse } from "next/server";
import { CallboxOneConfigError } from "@/lib/callboxone";
import { getBatch, getFinal, getPlan, sanitizeRows } from "@/lib/topClients";

// Today's most active clients, in cached steps the browser drives (each answers within 60s):
//   GET  ?step=plan          -> { cycle, nextRefresh, candidates, batches }
//   GET  ?step=batch&i=<n>   -> { index, size, checked, partial, rows }
//   POST ?step=final  { rows, measured, complete }  -> TopClientsPayload
// Everything is cached per day and resets at 08:00 PH. Read-only towards CallboxOne and HubSpot.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const fail = (err: any) =>
  NextResponse.json(
    { error: err?.message || "Could not load today's clients." },
    { status: err instanceof CallboxOneConfigError ? 500 : 502 }
  );

export async function GET(req: NextRequest) {
  const step = req.nextUrl.searchParams.get("step");
  try {
    if (step === "plan") return NextResponse.json(await getPlan());
    if (step === "batch") {
      const i = Number(req.nextUrl.searchParams.get("i"));
      if (!Number.isInteger(i) || i < 0 || i > 200) return NextResponse.json({ error: "Invalid batch." }, { status: 400 });
      return NextResponse.json(await getBatch(i));
    }
    return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("step") !== "final") return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const measured = typeof body?.measured === "number" && body.measured >= 0 ? body.measured : 0;
    return NextResponse.json(await getFinal(sanitizeRows(body?.rows), measured, body?.complete === true));
  } catch (err) {
    return fail(err);
  }
}
