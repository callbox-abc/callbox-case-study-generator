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
  "USE THE INSIGHTS:",
  "- input.insights holds pre-computed, data-backed findings (top channel share, director-level-and-above share, peak vs low quarter, first meetings held, untracked channels, unlogged funnel stages). Build the story around the 2-3 sharpest ones. Prefer a specific comparison (\"LinkedIn produced 87 of 111 appointments\") over a total.",
  "",
  "STYLE:",
  "- US English. Plain, specific, confident. Short sentences. No em dashes.",
  "- Banned words and phrases: high-quality, top-tier, significant portion, successfully, effectively, seamless, robust, utilize, leverage, unlock, game-changing, revolutionary, delve. Use the specific number instead of a vague claim.",
  "- Sentence case for every heading and item title (\"Three channels, one audience\", not \"Three Channels, One Audience\").",
  "- Headings must say something specific. Never use the section's own name as its heading (not \"The situation\", \"Where the pipeline came from\", \"How it ran\", \"The progression\", \"What changed\", \"Where it goes next\").",
  "- Do not repeat yourself: each number appears at most twice across the whole draft, and each section adds something the others don't. Do not start more than one sentence with \"Callbox\".",
  "- headline: result-led, at most 12 words, no client name. headlineHighlight: an exact substring of the headline (the result phrase).",
  "- dek: 1-2 sentences that add a second insight; never restate the headline.",
  "- situation: the context before results. Who the buyers were (from the seniority mix) and what reaching them took (channels, period). No result totals here. pullStat: one sentence with the most striking comparison.",
  "- channels: heading and intro about which channel carried the program and how the others compared. Takeaways: 2 short points, each with a different number.",
  "- howItRan.steps: 3-4 steps describing how the program ran, grounded in the channels and audience (title + 1-2 sentence body). No quality claims.",
  "- rolesHeading/rolesIntro: who actually said yes, using the director-level-and-above share and the largest group.",
  "- progression.body: the shape over time (launch, low point, peak, partial period) using the quarter insights. Do not explain causes.",
  "- whatChanged.outcomes: 3 outcomes, each one sentence with a different number from the input.",
  "- whereNext.recommendations: 2-3 Callbox recommendations that follow from the data (title + 1-2 sentences), e.g. logging unlogged funnel stages or tracking appointments for untracked channels.",
  "- quarterNotes: one short note per quarter that describes its position (launch quarter, low point, peak, held up, still running). Do not restate the count; it is already shown.",
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
