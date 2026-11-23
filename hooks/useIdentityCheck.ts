// "Client details check" on an unbranded case study: the sheet's text is checked against the words
// that name the client (its HubSpot name, website, HQ, the CallboxOne client name and campaign
// code; lib/unbranded.ts). The import and the AI never put those on an unbranded sheet, so a hit
// comes from typed or pasted text. Until each one is removed or kept (a word that only looks like
// the client's, e.g. a client named after a common word), the PDF and the CMS draft are blocked.
// Live, like the truth check: a sentence leaves the list once it no longer names the client.

import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { pendingFields } from "@/lib/narrative";
import type { RevampCaseStudy } from "@/lib/revamp";
import { removeFindings } from "@/lib/truthCheck";
import { findIdentityLeaks, identityFindingKey, identityTerms, type IdentityFinding } from "@/lib/unbranded";
import type { ImportSource } from "@/components/revamp/DataImport";

export function useIdentityCheck({
  cs,
  csRef,
  setCs,
  importSourceRef,
  requestAutoDraft,
}: {
  cs: RevampCaseStudy;
  csRef: MutableRefObject<RevampCaseStudy>;
  setCs: Dispatch<SetStateAction<RevampCaseStudy>>;
  importSourceRef: MutableRefObject<ImportSource | null>;
  requestAutoDraft: () => void;
}) {
  // Sentences the writer kept: the word only looks like the client's.
  const [kept, setKept] = useState<Set<string>>(new Set());
  const terms = cs.unbranded ? identityTerms(importSourceRef.current, cs) : [];
  const all = findIdentityLeaks(cs, terms);
  const findings = all.filter((f) => !kept.has(identityFindingKey(f)));

  const reset = () => setKept(new Set());
  const keep = (f: IdentityFinding) => setKept((prev) => new Set(prev).add(identityFindingKey(f)));
  const remove = (fs: IdentityFinding[]) => {
    const before = pendingFields(csRef.current).size;
    const next = removeFindings(csRef.current, fs);
    setCs((prev) => removeFindings(prev, fs));
    // A text field left empty is redrafted by the AI, which never sees the client's details.
    if (pendingFields(next).size > before) requestAutoDraft();
  };

  return {
    // Shown once the sheet belongs to a client: a blank unbranded sheet has nothing to check against.
    active: terms.length > 0,
    findings,
    keptCount: all.length - findings.length,
    reset,
    keep,
    remove,
  };
}
