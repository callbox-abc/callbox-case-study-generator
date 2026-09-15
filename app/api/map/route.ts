import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// This route runs ONLY on the server (Vercel serverless function).
// GEMINI_API_KEY is read from process.env — it is never sent to the browser.
// The browser only ever talks to THIS route, never to Gemini directly.

const SYSTEM_INSTRUCTION =
  "You are extracting structured fields from a raw B2B case study document " +
  "(Callbox Inc, a B2B lead generation company) so they can populate a fixed template that mirrors " +
  "Callbox's corporate case study PDF layout. " +
  "\"clientSnapshot\" is the short descriptive paragraph that introduces who the client is (usually under a " +
  "'Client Snapshot' heading) — distinct from the short metadata fields like industry/program/duration. " +
  "Use the document's own wording as much as possible — light cleanup only, never invent facts " +
  "that are not present in the source. If a field is genuinely absent from the source, return an " +
  "empty string or empty array for it rather than guessing or fabricating a plausible-sounding value. " +
  "Return ONLY valid JSON with no preamble, no markdown code fences, and no trailing commentary.";

const RESPONSE_SHAPE = `{
  "title": string,
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

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt =
      `Map the document text below into this exact JSON shape:\n${RESPONSE_SHAPE}\n\n` +
      `DOCUMENT TEXT:\n${truncated}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Gemini occasionally wraps JSON in fences even when asked not to — strip and retry once.
      const cleaned = raw.replace(/```json|```/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return NextResponse.json(
          { error: "Model did not return valid JSON. Try again, or paste content manually." },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ data: parsed });
  } catch (err: any) {
    const message = err?.message || "Unknown error calling Gemini.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
