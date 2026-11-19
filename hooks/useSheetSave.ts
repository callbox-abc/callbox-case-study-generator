// Saving the sheet of a pulled client to its shared entry ("Recently imported clients"), whether it
// has unsaved changes, and the "Save before exit?" / "Save {client} first?" prompt.
//
// Saving is deliberate: the Save button, Mark as reviewed, Send to CMS, or the save prompt on exit /
// client switch. An accidental edit never overwrites the copy a colleague reviewed. (The raw import
// is still saved right after a pull, by the import panel.)

import { useState, type MutableRefObject } from "react";
import type { RevampCaseStudy } from "@/lib/revamp";
import type { ImportSource } from "@/components/revamp/DataImport";

export type SaveChoice = "save" | "discard" | "cancel";
export type SaveAsk = { kind: "exit" | "switch"; name: string; resolve: (c: SaveChoice) => void };

export const saveFingerprint = (sheet: RevampCaseStudy, reviewed: boolean) => JSON.stringify(sheet) + (reviewed ? "|r" : "");

export function useSheetSave({
  csRef,
  importSourceRef,
  reviewedRef,
  lastSavedRef,
  aiDraftedRef,
}: {
  csRef: MutableRefObject<RevampCaseStudy>;
  // The saved import (shared "Recently imported clients") the sheet's data came from, if any.
  importSourceRef: MutableRefObject<ImportSource | null>;
  // Whether the AI text on the sheet was marked as reviewed (saved with the sheet).
  reviewedRef: MutableRefObject<boolean>;
  lastSavedRef: MutableRefObject<string>;
  aiDraftedRef: MutableRefObject<string[]>;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const saveSheetNow = async (): Promise<boolean> => {
    const src = importSourceRef.current;
    if (!src) return true;
    const fingerprint = saveFingerprint(csRef.current, reviewedRef.current);
    if (fingerprint === lastSavedRef.current) return true;
    setSaveState("saving");
    try {
      const r = await fetch("/api/recent-clients?step=sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: src.key,
          sheet: csRef.current,
          reviewed: reviewedRef.current,
          aiDrafted: reviewedRef.current ? [] : aiDraftedRef.current,
          client: src.client,
          campaign: src.campaign,
          stored: src.stored,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      lastSavedRef.current = fingerprint;
      setSaveState("idle");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  };
  // Unsaved: the sheet belongs to a pulled client and differs from what was last saved (a fresh
  // pull, AI text, edits, or a review). Blank, template and document sheets never count.
  const isDirty = () => Boolean(importSourceRef.current) && saveFingerprint(csRef.current, reviewedRef.current) !== lastSavedRef.current;

  // The save prompt (exit or client switch), answered through a promise.
  const [saveAsk, setSaveAsk] = useState<SaveAsk | null>(null);
  const askToSave = (kind: "exit" | "switch") =>
    new Promise<SaveChoice>((resolve) => {
      const src = importSourceRef.current;
      const name = csRef.current.clientName.trim() || src?.client?.name || src?.campaign?.campaignName || "this client";
      setSaveAsk({ kind, name, resolve });
    });
  const answerSave = (c: SaveChoice) => {
    saveAsk?.resolve(c);
    setSaveAsk(null);
  };

  return { saveState, setSaveState, saveSheetNow, isDirty, saveAsk, askToSave, answerSave };
}
