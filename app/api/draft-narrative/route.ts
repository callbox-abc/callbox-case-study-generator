import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { normalizeRevamp } from "@/lib/revamp";
import { NARRATIVE_SHAPE, mergeNarrative, narrativeInput } from "@/lib/narrative";

// Drafts the EMPTY narrative fields of a case study from the sheet's own data (CallboxOne
// numbers, seniority mix, channel mix, quarters, funnel, plus any writer text already there).
// The number guard and the "only empty fields" rule live in lib/narrative.ts.

export const maxDuration = 60;

const SYSTEM_INSTRUCTION = [
  "You write first drafts of B2B case studies for Callbox, a B2B lead generation company.",
  "You receive a JSON object with the campaign's data and any text a writer already entered. Draft the fields of the output shape.",
  "",
  "GROUNDING RULES (strict):",
  "- Use only facts present in the input. Every number you write must appear in the input, or be a percentage or ratio computed from two input numbers.",
  "- The client's company name, industry, size and location are NOT known unless they appear in existingText. Never invent them. Refer to the audience instead (e.g. senior IT leaders), based on the appointment seniority mix.",
  "- Never explain why a result happened (for example why a quarter peaked) unless existingText states the reason. Describe what the numbers show, not causes.",
  "- Never invent quotes, people, testimonials, deal values, revenue, or outcomes after the first meeting.",
  "- If funnel stages after the first meeting have null values, do not claim opportunities or revenue. You may recommend logging them.",
  "- Channel rows with appointments null mean that channel's appointments are not tracked; do not say it produced zero unless the value is 0.",
  "- Partial periods (isPartial true) are still running; do not compare them as full quarters.",
  "",
  "STYLE:",
  "- US English. Plain, specific, confident. Short sentences. No em dashes. No hype words (revolutionary, game-changing, unlock, leverage, seamless).",
  "- headline: result-led, at most 12 words, no client name. headlineHighlight: an exact substring of the headline (the result phrase).",
  "- dek: 1-2 sentences. situation.body: 1-2 short paragraphs. pullStat: one sentence with the most striking number.",
  "- howItRan.steps: 3-4 steps describing how the program ran, grounded in the channels and audience (title + 1-2 sentence body).",
  "- whatChanged.outcomes: 3 outcomes, each one sentence with a number from the input.",
  "- whereNext.recommendations: 2-3 Callbox recommendations that follow from the data (title + 1-2 sentences).",
  "- quarterNotes: one short factual note per quarter label (e.g. 'Peak quarter.' or 'Part quarter, still running.').",
  "",
  "Return ONLY valid JSON matching the shape. Use empty strings or empty arrays for anything you cannot ground in the input.",
].join("\n");

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not set on the server." }, { status: 500 });

  let body: { sheet?: unknown; sourceText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const sheet = normalizeRevamp(body.sheet);
  const hasData =
    sheet.heroStats.length > 0 || sheet.channels.rows.length > 0 || sheet.progression.quarters.length > 0;
  if (!hasData && !String(body.sourceText || "").trim()) {
    return NextResponse.json(
      { error: "There's no data to draft from yet. Import from CallboxOne or upload a draft first." },
      { status: 400 }
    );
  }

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    });
    const source = String(body.sourceText || "").slice(0, 12000).trim();
    const prompt =
      `Output shape:\n${NARRATIVE_SHAPE}\n\n` +
      `INPUT DATA:\n${JSON.stringify(narrativeInput(sheet))}\n\n` +
      (source ? `WRITER'S SOURCE DOCUMENT (facts here may also be used):\n${source}\n` : "");

    const raw = (await model.generateContent(prompt)).response.text();
    let draft: any = null;
    for (const attempt of [raw, raw.replace(/```json|```/g, "").trim()]) {
      try {
        draft = JSON.parse(attempt);
        break;
      } catch {
        // try next
      }
    }
    if (!draft || typeof draft !== "object") {
      return NextResponse.json({ error: "The AI did not return a usable draft. Try again." }, { status: 502 });
    }

    const { next, drafted, droppedSentences } = mergeNarrative(sheet, draft);
    return NextResponse.json({ sheet: next, drafted, droppedSentences });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Drafting failed." }, { status: 502 });
  }
}
