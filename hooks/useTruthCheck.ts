// "Verifying truth data": once CallboxOne numbers are plotted on the sheet (a live or saved import,
// or a saved client that has them), the numbers in the sheet's text are checked against the data
// (lib/truthCheck.ts). CallboxOne is the source of truth. The result is live: a sentence leaves the
// list once it is removed, kept, or edited so its numbers match.

import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { pendingFields } from "@/lib/narrative";
import type { RevampCaseStudy } from "@/lib/revamp";
import { findUnbackedNumbers, findingKey, removeFindings, type TextFinding } from "@/lib/truthCheck";

export function useTruthCheck({
  cs,
  csRef,
  setCs,
  requestAutoDraft,
}: {
  cs: RevampCaseStudy;
  csRef: MutableRefObject<RevampCaseStudy>;
  setCs: Dispatch<SetStateAction<RevampCaseStudy>>;
  requestAutoDraft: () => void;
}) {
  const [active, setActive] = useState(false);
  // Sentences the writer kept: numbers that aren't campaign results ("a 40-person IT team").
  const [kept, setKept] = useState<Set<string>>(new Set());
  const all = active ? findUnbackedNumbers(cs) : [];
  const findings = all.filter((f) => !kept.has(findingKey(f)));
  const keptCount = all.length - findings.length; // kept sentences still in the text

  const start = () => {
    setKept(new Set());
    setActive(true);
  };
  const reset = () => {
    setKept(new Set());
    setActive(false);
  };
  const keep = (f: TextFinding) => setKept((prev) => new Set(prev).add(findingKey(f)));
  const remove = (fs: TextFinding[]) => {
    const before = pendingFields(csRef.current).size;
    const next = removeFindings(csRef.current, fs);
    setCs((prev) => removeFindings(prev, fs));
    // A field left empty is redrafted by the AI, from the data only.
    if (pendingFields(next).size > before) requestAutoDraft();
  };

  return { active, findings, keptCount, start, reset, keep, remove };
}
