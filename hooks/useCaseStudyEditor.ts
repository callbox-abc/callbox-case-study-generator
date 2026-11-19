// All editor state and actions for app/page.tsx: which screen shows, the sheet, and the actions
// that span several concerns (starting, loading, switching and leaving a client). The concerns
// themselves live in their own hooks:
//   useAiDraft         AI drafting of empty fields, review banner
//   useSheetSave       saving a pulled client's sheet, unsaved changes, the save prompt
//   useCmsDraft        Send to CMS as draft
//   useMappingExample  few-shot example from a mapped document
//   useLeaveGuard      Back button and tab close while there are unsaved changes
//   usePrintTitle      tab title and the saved PDF's file name
// The refs below are shared between them: async work reads the latest values through them.

import { useRef, useState } from "react";
import { extractFromFile } from "@/lib/extract";
import { EMPTY_REVAMP, normalizeRevamp, type RevampCaseStudy } from "@/lib/revamp";
import { pendingFields } from "@/lib/narrative";
import { codeLetters, sheetMatchesClient } from "@/lib/clientMatch";
import { applyDynamicPageSize } from "@/lib/printPage";
import { readTemplateDocx } from "@/lib/templateParse";
import type { RecentClient } from "@/lib/recentClients";
import type { ImportSource } from "@/components/revamp/DataImport";
import { useAiDraft } from "@/hooks/useAiDraft";
import { useCmsDraft } from "@/hooks/useCmsDraft";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import { useMappingExample } from "@/hooks/useMappingExample";
import { usePrintTitle } from "@/hooks/usePrintTitle";
import { saveFingerprint, useSheetSave } from "@/hooks/useSheetSave";

export type Stage = "upload" | "mapping" | "edit";

export function useCaseStudyEditor() {
  const [stage, setStage] = useState<Stage>("upload");
  const [cs, setCs] = useState<RevampCaseStudy>(EMPTY_REVAMP);
  // Immutable update helper for the sheet: clone, mutate the clone, commit.
  const up = (fn: (d: RevampCaseStudy) => void) =>
    setCs((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const [mapError, setMapError] = useState("");
  // Neutral notice on the editor (e.g. "read 19 fields from the template").
  const [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false);
  const pdfPageRef = useRef<HTMLDivElement>(null);

  // Shared refs. Latest values for async work (state captured in a closure would be stale).
  const csRef = useRef(cs);
  csRef.current = cs;
  // The saved import (shared "Recently imported clients") the sheet's data came from, if any.
  const importSourceRef = useRef<ImportSource | null>(null);
  // Whether the AI text on the sheet was marked as reviewed (saved with the sheet).
  const reviewedRef = useRef(false);
  const lastSavedRef = useRef("");
  const sourceTextRef = useRef("");

  const ai = useAiDraft({ csRef, setCs, sourceTextRef, reviewedRef });
  const mapping = useMappingExample();
  const saveMappingExample = () => mapping.saveMappingExample(cs, ai.aiUsedRef.current);
  const save = useSheetSave({ csRef, importSourceRef, reviewedRef, lastSavedRef, aiDraftedRef: ai.aiDraftedRef });
  const cms = useCmsDraft({ cs, importSourceRef, saveSheetNow: save.saveSheetNow, saveMappingExample });
  const leave = useLeaveGuard({ stage, requestExit, isDirty: save.isDirty });
  const pdfName = usePrintTitle(cs);

  // The AI usually drafts on its own after an import or a mapped document, so its button only shows
  // once the sheet has data to draft from (the drafting route's own test: hero stats, channel rows
  // or periods, or a source document) and a field is still empty: to redraft a cleared field, retry
  // after a timeout, or draft a template or hand-filled sheet.
  const hasDraftData =
    cs.heroStats.length > 0 || cs.channels.rows.length > 0 || cs.progression.quarters.length > 0 || Boolean(mapping.sourceText.trim());
  const canDraft = ai.aiState === "drafting" || (hasDraftData && pendingFields(cs).size > 0);
  const dirty = stage === "edit" && Boolean(importSourceRef.current) && saveFingerprint(cs, reviewedRef.current) !== lastSavedRef.current;

  /* ------------------------------- one case study ------------------------------- */

  // Everything that belongs to one case study. Cleared on Start over and when a new sheet starts
  // (blank, template, document or client), so the next case study never inherits the last one's
  // sheet and tab title, notice, error, AI banner or CMS draft id (with that id, "Update CMS
  // draft" would overwrite the previous client's WordPress draft).
  const clearCaseStudy = () => {
    importSourceRef.current = null; // the sheet is left behind: nothing to warn about any more
    reviewedRef.current = false;
    lastSavedRef.current = "";
    save.setSaveState("idle");
    setNotice("");
    setMapError("");
    ai.resetAi();
    cms.resetCms();
    setCs(EMPTY_REVAMP);
    mapping.setSourceText("");
    mapping.setOriginalMapped(null);
    mapping.savedExampleRef.current = false;
  };

  /* ------------------------------- leaving the editor ------------------------------- */

  const exitToStart = () => {
    leave.dropEditorEntry();
    saveMappingExample(); // before clearing: it reads this session's sheet and whether the AI was used
    clearCaseStudy();
    setStage("upload");
  };
  // A function declaration, so useLeaveGuard above can take it (it keeps the latest one in a ref).
  async function requestExit() {
    if (save.isDirty()) {
      const choice = await save.askToSave("exit");
      if (choice === "cancel") return;
      if (choice === "save" && !(await save.saveSheetNow())) return; // save failed: stay (the Save button shows it)
    }
    exitToStart();
  }

  /* ------------------------------- loading a client ------------------------------- */

  // Before another client is loaded into the sheet: offer to save the current one, then start that
  // client from a clean sheet (importing only fills empty fields, so the old client's name, country
  // and text would otherwise stay mixed in).
  const prepareSwitch = async (next: { clientAccountId?: number | null; companyId?: string | null }): Promise<"same" | "switched" | false> => {
    const cur = importSourceRef.current;
    if (!cur) return "same";
    const same =
      (next.clientAccountId && cur.campaign?.clientAccountId === next.clientAccountId) ||
      (next.companyId && cur.client?.companyId === next.companyId);
    if (same) return "same";
    if (save.isDirty()) {
      const choice = await save.askToSave("switch");
      if (choice === "cancel") return false;
      if (choice === "save" && !(await save.saveSheetNow())) return false;
    }
    ai.resetAi();
    setCs(EMPTY_REVAMP);
    setNotice("");
    importSourceRef.current = null;
    reviewedRef.current = false;
    lastSavedRef.current = "";
    cms.resetCms(); // a new client gets its own CMS draft
    save.setSaveState("idle");
    return "switched";
  };

  // Restores a saved sheet as is. Unreviewed AI fields get their banner back; the AI only fills
  // fields that are still empty.
  // Returns false when the saved sheet can't be used (the import panel then loads the saved data).
  const loadSaved = (r: RecentClient): boolean => {
    const saved = r.sheet;
    if (!saved) return false;
    const sheet = normalizeRevamp(saved.data);
    // A sheet that names another client was saved while an old bug merged two clients: ignore it.
    // Loading the client's own data instead, then Save, replaces the bad copy.
    if (!sheetMatchesClient(sheet.clientName, [r.name, r.company?.name, r.campaign?.clientName, codeLetters(r.campaign?.campaignName)])) {
      setNotice(
        `${r.name}'s saved sheet names ${sheet.clientName}, so it was ignored and ${r.name}'s own data was loaded instead. Click Save to replace the bad copy.`
      );
      return false;
    }
    importSourceRef.current = { key: r.key, client: r.company, campaign: r.campaign, stored: r.stored };
    reviewedRef.current = saved.reviewed;
    lastSavedRef.current = saveFingerprint(sheet, saved.reviewed);
    setCs(sheet);
    if (!saved.reviewed && saved.aiDrafted.length) {
      ai.aiUsedRef.current = true;
      ai.setAiDrafted(saved.aiDrafted);
      ai.setAiMsg("Saved draft: its AI-written fields haven't been marked as reviewed yet. Review them before downloading or sending to the CMS.");
      ai.setAiState("done");
    } else {
      ai.setAiDrafted([]);
      ai.setAiState("idle");
    }
    if (pendingFields(sheet).size > 0) ai.requestAutoDraft();
    return true;
  };

  // A live import or saved data was applied: the sheet now belongs to that client.
  const onSource = (src: ImportSource) => {
    importSourceRef.current = src;
    reviewedRef.current = false;
  };

  /* ------------------------------- starting a sheet ------------------------------- */

  const runMapping = async (text: string) => {
    setStage("mapping");
    clearCaseStudy();
    mapping.setSourceText(text);
    sourceTextRef.current = text; // after clearCaseStudy, which empties it
    try {
      const res = await fetch("/api/map-revamp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMapError(json.error || "Mapping failed. You can fill in fields manually below.");
        setStage("edit");
        return;
      }
      const merged = normalizeRevamp(json.data);
      setCs(merged);
      mapping.setOriginalMapped(merged);
      setStage("edit");
      ai.requestAutoDraft();
    } catch (e) {
      setMapError("Could not reach the mapping service. You can fill in fields manually below.");
      setStage("edit");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setMapError("");
    try {
      // The downloadable template is read field by field, word for word, with no AI mapping.
      // The import panel opens next; the AI drafts empty text after the numbers are imported.
      const tpl = await readTemplateDocx(file);
      if (tpl) {
        startBlank();
        setCs(tpl.sheet);
        setNotice(
          tpl.filled
            ? `Read ${tpl.filled} filled field${tpl.filled === 1 ? "" : "s"} from the template, word for word. Import HubSpot + CallboxOne data below for the numbers; the AI then drafts what's still empty.`
            : "The template was empty. Import HubSpot + CallboxOne data below, or fill in the sheet here."
        );
        setShowImport(true);
        return;
      }
      const text = await extractFromFile(file);
      if (!text.trim()) {
        setMapError("Couldn't find readable text in that file. Try the Case Study Template below instead.");
        return;
      }
      await runMapping(text);
    } catch (e: any) {
      setMapError(e?.message || "Could not read that file. You can download the Case Study Template below and fill it in instead.");
    }
  };

  const startBlank = () => {
    clearCaseStudy();
    setStage("edit");
  };

  const startFromImport = () => {
    startBlank();
    setShowImport(true);
  };

  /* ------------------------------- editor actions ------------------------------- */

  const markReviewed = () => {
    ai.setAiState("idle");
    ai.setAiDrafted([]);
    reviewedRef.current = true; // saved with the sheet, so the next person sees it reviewed
    void save.saveSheetNow();
  };

  const printNow = () => {
    saveMappingExample();
    applyDynamicPageSize(pdfPageRef.current);
    document.title = pdfName; // set here too, not only on beforeprint: the button path never depends on event timing
    window.print();
  };

  return {
    stage,
    cs,
    up,
    mapError,
    notice,
    showImport,
    setShowImport,
    pdfPageRef,
    hasImportSource: Boolean(importSourceRef.current),
    dirty,
    saveState: save.saveState,
    saveSheetNow: save.saveSheetNow,
    saveAsk: save.saveAsk,
    answerSave: save.answerSave,
    aiState: ai.aiState,
    aiMsg: ai.aiMsg,
    aiDrafted: ai.aiDrafted,
    pending: ai.pending,
    canDraft,
    draftWithAi: ai.draftWithAi,
    requestAutoDraft: ai.requestAutoDraft,
    markReviewed,
    cmsState: cms.cmsState,
    cmsMsg: cms.cmsMsg,
    cmsLink: cms.cmsLink,
    hasCmsDraft: Boolean(cms.cmsPageIdRef.current),
    sendToCms: cms.sendToCms,
    requestExit,
    startBlank,
    startFromImport,
    handleFile,
    loadSaved,
    prepareSwitch,
    onSource,
    printNow,
  };
}
