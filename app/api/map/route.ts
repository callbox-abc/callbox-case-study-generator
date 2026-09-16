import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";

// This route runs ONLY on the server (Vercel serverless function).
// GEMINI_API_KEY is read from process.env — it is never sent to the browser.
// The browser only ever talks to THIS route, never to Gemini directly.

const SYSTEM_INSTRUCTION =
  "You are a MAPPING tool, not a writer or editor. You take a raw B2B case study document " +
  "(Callbox Inc, a B2B lead generation company) and place its existing text into the fields of a fixed " +
  "JSON template. You do not compose, rewrite, rephrase, summarize, correct, or improve any wording. " +
  "Every string value you output MUST be copied VERBATIM from the source document — same words, same " +
  "punctuation, same phrasing — with the ONLY allowed change being to drop text that belongs to a " +
  "different field (e.g. removing a heading label like 'Client Snapshot:' when it is not part of the " +
  "sentence, or splitting a bulleted list into array items exactly as bulleted). Never paraphrase, never " +
  "shorten, never merge or reorder sentences, never fix spelling/grammar, and never add words that are not " +
  "in the source. " +
  "\"clientSnapshot\" is the short descriptive paragraph that introduces who the client is (usually under a " +
  "'Client Snapshot' heading) — distinct from the short metadata fields like industry/program/duration. " +
  "\"pdfTitle\" is the value of a distinct 'PDF TITLE' labeled field/row in the source document (often found " +
  "in a metadata table alongside rows like 'Website', 'Page Title (H1)', 'SEO Title', 'Meta Description') — " +
  "it is NOT the same as \"title\", which is the on-page case study headline. If there is no 'PDF TITLE' " +
  "labeled field in the source, return an empty string for pdfTitle rather than reusing \"title\". " +
  "Never invent facts that are not present in the source. If a field is genuinely absent from the source, " +
  "return an empty string or empty array for it rather than guessing, fabricating, or writing a plausible-" +
  "sounding value. " +
  "Return ONLY valid JSON with no preamble, no markdown code fences, and no trailing commentary.";

const RESPONSE_SHAPE = `{
  "title": string,
  "pdfTitle": string,
  "industry": string,
  "targetIndustries": string,
  "program": string,
  "targetLocation": string,
  "duration": string,
  "targetProspects": string,
  "businessSize": string,
  "clientLocation": string,
  "clientSnapshot": string,
  "keyHighlights": string[],
  "challenge": string,
  "programGoals": string[],
  "solutionIntro": string,
  "solutionServices": [{"title": string, "desc": string}],
  "howItRan": [{"phase": string, "steps": string[]}],
  "metrics": [{"value": string, "label": string}]
}`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GEMINI_API_KEY is not set on the server. Add it in your Vercel project's Settings -> Environment Variables and redeploy.",
      },
      { status: 500 }
    );
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "No document text provided." }, { status: 400 });
  }

  // Guard against runaway input — keep the prompt to a sane size for extraction.
  const truncated = text.slice(0, 20000);

  // Some browsers (notably Firefox) can produce PDF/DOCX text extractions with stray control
  // characters or unusual whitespace runs that occasionally trip Gemini's safety filters or
  // cause it to preface its output with commentary even when told not to. Strip the worst
  // offenders before sending the text along.
  const sanitized = sanitizeExtractedText(truncated);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const safetySettings = [
      HarmCategory.HARM_CATEGORY_HARASSMENT,
      HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
      },
      safetySettings,
    });

    const prompt =
      `Map the document text below into this exact JSON shape:\n${RESPONSE_SHAPE}\n\n` +
      `DOCUMENT TEXT:\n${sanitized}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let parsed = tryParseJson(raw);

    if (!parsed) {
      console.log("[v0] First mapping attempt did not yield valid JSON, asking model to repair it");
      // Self-repair pass: hand the malformed output back to the model and ask it to fix it,
      // rather than failing outright.
      try {
        const repairResult = await model.generateContent(
          `Your previous response was supposed to be ONLY valid JSON matching this shape:\n${RESPONSE_SHAPE}\n\n` +
            `but it was not valid JSON. Here is what you returned:\n${raw}\n\n` +
            `Return ONLY the corrected, valid JSON now — no markdown fences, no commentary.`
        );
        parsed = tryParseJson(repairResult.response.text());
      } catch (repairErr) {
        console.log("[v0] Repair pass failed:", (repairErr as any)?.message);
      }
    }

    if (!parsed) {
      return NextResponse.json(
        { error: "Model did not return valid JSON. Try again, or paste content manually." },
        { status: 502 }
      );
    }

    return NextResponse.json({ data: parsed });
  } catch (err: any) {
    const message = err?.message || "Unknown error calling Gemini.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function sanitizeExtractedText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- stripping stray control chars from PDF/DOCX extraction
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\u0000/g, "")
    .trim();
}

function tryParseJson(raw: string): any | null {
  const attempts = [raw, raw.replace(/```json|```/g, "").trim()];

  // Some responses include leading/trailing commentary around the JSON object —
  // fall back to slicing out the outermost { ... } block.
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next
    }
  }
  return null;
}
