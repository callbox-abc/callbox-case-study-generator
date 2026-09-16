import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Persists the FINAL, user-approved field values for a mapped case study as a few-shot
// example for future /api/map calls. This is NOT model fine-tuning or retraining — Gemini's
// weights never change. It is few-shot prompting: storing real corrected examples so future
// requests can include 2-3 of them as in-context examples, which is the correct way to
// improve a hosted model's extraction accuracy over time.
const MAX_SOURCE_LENGTH = 20000;

export async function POST(req: NextRequest) {
  let body: { sourceText?: string; mappedOutput?: unknown; wasCorrected?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const sourceText = (body.sourceText || "").trim();
  const mappedOutput = body.mappedOutput;
  const wasCorrected = Boolean(body.wasCorrected);

  // Nothing meaningful to learn from — skip silently rather than erroring the download flow.
  if (!sourceText || !mappedOutput || typeof mappedOutput !== "object") {
    return NextResponse.json({ skipped: true });
  }

  const supabase = createClient();
  if (!supabase) {
    // The mapping example library is a best-effort improvement, not a blocking dependency —
    // never fail the user's PDF download because Supabase env vars are unavailable.
    return NextResponse.json({ skipped: true });
  }

  const { error } = await supabase.from("mapping_examples").insert({
    source_text: sourceText.slice(0, MAX_SOURCE_LENGTH),
    mapped_output: mappedOutput,
    was_corrected: wasCorrected,
  });

  if (error) {
    console.log("[v0] Failed to save mapping example:", error.message);
    return NextResponse.json({ skipped: true });
  }

  return NextResponse.json({ saved: true });
}
