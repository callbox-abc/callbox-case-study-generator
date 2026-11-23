// "Fill empty fields with AI": fills only EMPTY narrative fields from the sheet's own data.
// The server drops any sentence whose numbers are not in the data (lib/narrative.ts).
// It runs automatically after a document is mapped or CallboxOne data is imported, and the
// fields being drafted show skeletons until the result arrives.

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { normalizeRevamp, type RevampCaseStudy } from "@/lib/revamp";
import { applyDrafted, pendingFields } from "@/lib/narrative";
import { modelLabel } from "@/lib/aiModels";
import { exportable } from "@/lib/unbranded";

export type AiState = "idle" | "drafting" | "done" | "error";

export function useAiDraft({
  csRef,
  setCs,
  sourceTextRef,
  reviewedRef,
}: {
  csRef: MutableRefObject<RevampCaseStudy>;
  setCs: Dispatch<SetStateAction<RevampCaseStudy>>;
  sourceTextRef: MutableRefObject<string>;
  reviewedRef: MutableRefObject<boolean>;
}) {
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiMsg, setAiMsg] = useState("");
  const [aiDrafted, setAiDrafted] = useState<string[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Latest values for async work (state captured in a closure would be stale).
  const draftingRef = useRef(false);
  const rerunRef = useRef(false);
  const aiUsedRef = useRef(false);
  const [autoDraftTick, setAutoDraftTick] = useState(0);
  const requestAutoDraft = () => setAutoDraftTick((t) => t + 1);
  const aiDraftedRef = useRef(aiDrafted);
  aiDraftedRef.current = aiDrafted;

  const draftWithAi = async (auto = false) => {
    if (draftingRef.current) {
      rerunRef.current = true; // a draft is already running: draft once more when it finishes
      return;
    }
    const keys = pendingFields(csRef.current);
    if (keys.size === 0) {
      if (!auto) {
        setAiState("done");
        setAiDrafted([]);
        setAiMsg("Nothing to draft: every field the data supports already has text.");
      }
      return;
    }
    draftingRef.current = true;
    setPending(keys);
    setAiState("drafting");
    setAiMsg(`Drafting ${keys.size} empty field${keys.size === 1 ? "" : "s"} with AI from the data… (usually 1 to 2 minutes)`);
    try {
      const res = await fetch("/api/draft-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An unbranded sheet leaves the browser without client details (the route strips it too).
        body: JSON.stringify({ sheet: exportable(csRef.current), sourceText: sourceTextRef.current }),
      });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          res.status === 504 || /an error occurred/i.test(text)
            ? "The AI took too long to answer. Use “Fill empty fields with AI” to try again."
            : `Server error (HTTP ${res.status}).`
        );
      }
      // An automatic run with nothing to draft from (e.g. a blank sheet) is not an error.
      if (auto && res.status === 400) {
        setAiState("idle");
        return;
      }
      if (!res.ok) throw new Error(json.error || "Drafting failed.");
      // Apply only to fields that are still empty, so edits made meanwhile are kept.
      setCs((prev) => applyDrafted(prev, normalizeRevamp(json.sheet), keys));
      const drafted: string[] = json.drafted || [];
      if (drafted.length) {
        aiUsedRef.current = true;
        reviewedRef.current = false; // new AI text needs a review
      }
      setAiDrafted((prev) => Array.from(new Set([...prev, ...drafted])));
      const dropped = Number(json.droppedSentences) || 0;
      // Show what the checks removed and why, so an empty heading or item is explainable.
      const details: { text: string; reason: string }[] = Array.isArray(json.droppedDetails) ? json.droppedDetails : [];
      const shown = details.slice(0, 4).map((d) => `“${d.text}” (${d.reason})`).join("; ");
      setAiMsg(
        (drafted.length
          ? `AI drafted ${drafted.length} field${drafted.length === 1 ? "" : "s"}${json.model ? ` with ${modelLabel(json.model)}` : ""}${
              json.fallbackReason ? " (the main model was unavailable, so the faster fallback wrote them)" : ""
            }. Review them before downloading or sending to the CMS.`
          : dropped
            ? "Nothing the AI wrote for the empty fields passed the checks."
            : "The AI had nothing it could ground in the data for the empty fields.") +
          (drafted.includes("Role pressures")
            ? " The role pressures are inferred from the role and the data, not said by the client: confirm them with the CSM before publishing."
            : "") +
          (dropped
            ? ` The checks removed ${dropped} sentence${dropped === 1 ? "" : "s"}${shown ? `: ${shown}` : ""}${details.length > 4 ? "; and more" : ""}.`
            : "")
      );
      setAiState("done");
    } catch (e: any) {
      setAiMsg(e?.message || "Drafting failed.");
      setAiState("error");
    } finally {
      setPending(new Set());
      draftingRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        requestAutoDraft();
      }
    }
  };

  // Runs after render, so csRef already holds the freshly mapped/imported data.
  useEffect(() => {
    if (autoDraftTick > 0) draftWithAi(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraftTick]);

  const resetAi = () => {
    setAiState("idle");
    setAiDrafted([]);
    setPending(new Set());
    aiUsedRef.current = false;
    sourceTextRef.current = "";
  };

  return {
    aiState, setAiState, aiMsg, setAiMsg, aiDrafted, setAiDrafted, aiDraftedRef, pending, aiUsedRef,
    draftWithAi, requestAutoDraft, resetAi,
  };
}
