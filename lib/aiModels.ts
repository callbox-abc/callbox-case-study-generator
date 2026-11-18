// Which Gemini model drafts the narrative, with a fallback.
//
// Drafting is the quality-critical step (about 40 house-style and grounding rules), and since
// finished sheets are saved it runs about once per client, so it uses Gemini 3.1 Pro Preview.
// A preview model can be rate-limited, changed or retired, so Gemini 2.5 Flash takes over when
// it fails, times out or returns something unusable. Document mapping and the solution line stay
// on Flash (copying and short extraction).
//
// Env (optional): GEMINI_DRAFT_MODEL overrides the first choice without a code change.

export const FALLBACK_MODEL = "gemini-2.5-flash";
export const DEFAULT_DRAFT_MODEL = "gemini-3.1-pro-preview";

export function draftModels(): string[] {
  const primary = process.env.GEMINI_DRAFT_MODEL?.trim() || DEFAULT_DRAFT_MODEL;
  return primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
}

// Gemini 3 models are meant to run at their default temperature (lower values can degrade them);
// older models keep the settings this app was tuned with.
export const isGemini3 = (model: string) => /^gemini-3/i.test(model);

// Readable name for the review banner: "gemini-3.1-pro-preview" -> "Gemini 3.1 Pro Preview".
export const modelLabel = (model: string) =>
  model
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

// Tries each model in order; returns the first result, and what failed before it.
export async function firstThatWorks<T>(
  models: string[],
  run: (model: string) => Promise<T>
): Promise<{ value: T; model: string; failed: { model: string; error: string }[] }> {
  const failed: { model: string; error: string }[] = [];
  for (const model of models) {
    try {
      return { value: await run(model), model, failed };
    } catch (e: any) {
      failed.push({ model, error: String(e?.message || e).slice(0, 300) });
    }
  }
  const err = new Error(failed.map((f) => `${f.model}: ${f.error}`).join(" | ") || "No model available.");
  throw err;
}
