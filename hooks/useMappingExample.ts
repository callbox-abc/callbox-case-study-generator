// Tracks the raw source text and the model's first-pass output for the current session, so
// that when the user finishes (Download PDF / Start over) we can save the FINAL, user-approved
// field values as a few-shot example for future /api/map calls. This is few-shot prompting —
// real corrected examples included as in-context examples on later requests — never model
// fine-tuning or retraining; Gemini's weights are never touched.

import { useRef, useState } from "react";
import type { RevampCaseStudy } from "@/lib/revamp";

export function useMappingExample() {
  const [sourceText, setSourceText] = useState("");
  const [originalMapped, setOriginalMapped] = useState<RevampCaseStudy | null>(null);
  const savedExampleRef = useRef(false);

  // Best-effort, fire-and-forget: saves the FINAL field values (after any manual edits) as a
  // few-shot example. Only meaningful for documents that actually went through the mapper —
  // a blank/manual start has no source text and nothing to compare corrections against.
  // Guarded to run at most once per session so re-printing or re-opening "Start over" doesn't
  // create duplicate rows.
  const saveMappingExample = (cs: RevampCaseStudy, aiUsed: boolean) => {
    // Sessions with AI-drafted text are not saved: the mapper must only learn verbatim mapping.
    if (!sourceText || !originalMapped || savedExampleRef.current || aiUsed) return;
    savedExampleRef.current = true;
    const wasCorrected = JSON.stringify(cs) !== JSON.stringify(originalMapped);
    fetch("/api/save-example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText, mappedOutput: cs, wasCorrected }),
    }).catch(() => {});
  };

  return { sourceText, setSourceText, originalMapped, setOriginalMapped, savedExampleRef, saveMappingExample };
}
