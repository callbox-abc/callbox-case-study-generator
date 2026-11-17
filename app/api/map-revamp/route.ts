import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { REVAMP_RESPONSE_SHAPE, normalizeRevamp } from "@/lib/revamp";

// Maps a case study into the "Case Study: Revamp" structure. Same rules as /api/map: the model
// places existing text into fields, it does not write. Server-only; GEMINI_API_KEY never reaches
// the browser.

const SYSTEM_INSTRUCTION =
  "You are a MAPPING tool, not a writer. You take a Callbox B2B case study (raw source text plus the " +
  "editor's corrected fields) and place its existing text into a fixed JSON template for a new page layout. " +
  "Copy wording VERBATIM from the inputs. Never paraphrase, summarize, merge, reorder, correct, or add words. " +
  "Where the editor's corrected fields and the raw source disagree, the corrected fields win. " +
  "Field guidance: headline = the on-page case study title. headlineHighlight = an exact substring of the " +
  "headline that carries the result, or empty. dek = the client snapshot paragraph. situation.body = the " +
  "challenge paragraph(s). howItRan.steps = the solution services and program phases as title/body pairs. " +
  "heroStats = the result metrics, at most 4. facts = every metadata label/value pair in the inputs (for example " +
  "Program, Period measured, Market, Client HQ, Target buyers, Target industries, Channels worked, Platform), " +
  "keeping each label exactly as written in the inputs and keeping all of them, up to 8. " +
  "whatChanged.outcomes = the key highlights. " +
  "NUMBERS: only fill a number field (appointments, count, value) when that exact number appears in the inputs " +
  "for that exact item; otherwise use null. Never estimate, total, or derive numbers. Leave channels.rows, " +
  "howItRan.roles, progression.quarters and funnel.stages as empty arrays unless the inputs contain that " +
  "breakdown explicitly. " +
  "If a field is absent, return an empty string or empty array. Never invent facts, names, quotes or causes. " +
  "Return ONLY valid JSON.";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set on the server." }, { status: 500 });
  }

  let body: { sourceText?: string; edited?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const sourceText = String(body.sourceText || "").slice(0, 20000).trim();
  const edited = body.edited && typeof body.edited === "object" ? JSON.stringify(body.edited).slice(0, 20000) : "";
  if (!sourceText && !edited) {
    return NextResponse.json({ error: "Nothing to map." }, { status: 400 });
  }

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: "application/json" },
      safetySettings: [
        HarmCategory.HARM_CATEGORY_HARASSMENT,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE })),
    });

    const prompt =
      `Map the inputs into this exact JSON shape:\n${REVAMP_RESPONSE_SHAPE}\n\n` +
      (edited ? `EDITOR'S CORRECTED FIELDS (authoritative):\n${edited}\n\n` : "") +
      (sourceText ? `RAW SOURCE TEXT:\n${sourceText}` : "");

    const raw = (await model.generateContent(prompt)).response.text();
    const parsed = tryParseJson(raw);
    if (!parsed) {
      return NextResponse.json({ error: "Model did not return valid JSON. Try again." }, { status: 502 });
    }
    return NextResponse.json({ data: normalizeRevamp(parsed) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error calling Gemini." }, { status: 502 });
  }
}

function tryParseJson(raw: string): any | null {
  const attempts = [raw, raw.replace(/```json|```/g, "").trim()];
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a !== -1 && b > a) attempts.push(raw.slice(a, b + 1));
  for (const t of attempts) {
    try {
      return JSON.parse(t);
    } catch {
      // try next
    }
  }
  return null;
}
