"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowRight, Database, Download, FilePlus, FileText, Upload } from "lucide-react";
import { extractFromFile } from "@/lib/extract";
import { copyText } from "@/lib/types";
import { RevampCaseStudy, EMPTY_REVAMP, normalizeRevamp, revampPlainText } from "@/lib/revamp";
import { applyDrafted, pendingFields } from "@/lib/narrative";
import { modelLabel } from "@/lib/aiModels";
import RevampSheet, { C as SHEET } from "@/components/revamp/RevampSheet";
import DataImport, { type ImportSource } from "@/components/revamp/DataImport";
import type { RecentClient } from "@/lib/recentClients";
import { readTemplateDocx } from "@/lib/templateParse";
import { TEMPLATE_FILE } from "@/lib/templateSchema";

// Palette lifted directly from Callbox's corporate case study PDF template.
const BG = "#101114";
const SHEET_BG = "#1b1c21";
const CARD_BG = "#232429";
const YELLOW = "#f5b914";
const YELLOW_INK = "#17181c";
const TEXT = "#f5f5f7";
const MUTED = "#a4a4ae";
const MUTED_LIGHT = "#c7c8d3";
const BORDER = "rgba(255,255,255,0.08)";
const BORDER_STRONG = "rgba(255,255,255,0.14)";

// Document width @ 96dpi (the CSS px reference browsers use for sizing) — the
// sheet renders at this fixed width both on screen and when printed, flowing
// continuously as one long page instead of being split into fixed-height pages.
const A4_W = 794;

type Stage = "upload" | "mapping" | "edit";


export default function Page() {
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
  const [copied, setCopied] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfPageRef = useRef<HTMLDivElement>(null);

  // Tracks the raw source text and the model's first-pass output for the current session, so
  // that when the user finishes (Download PDF / Start over) we can save the FINAL, user-approved
  // field values as a few-shot example for future /api/map calls. This is few-shot prompting —
  // real corrected examples included as in-context examples on later requests — never model
  // fine-tuning or retraining; Gemini's weights are never touched.
  const [sourceText, setSourceText] = useState("");
  const [originalMapped, setOriginalMapped] = useState<RevampCaseStudy | null>(null);
  const savedExampleRef = useRef(false);

  // "Send to CMS as draft": maps the current case study into the revamp layout and creates
  // (or updates) one WordPress draft. The page id is kept so repeat sends update the same draft.
  const [cmsState, setCmsState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [cmsMsg, setCmsMsg] = useState("");
  const [cmsLink, setCmsLink] = useState("");
  const cmsPageIdRef = useRef<number | null>(null);
  // The saved import (shared "Recently imported clients") the sheet's data came from, if any.
  const importSourceRef = useRef<ImportSource | null>(null);
  // Whether the AI text on the sheet was marked as reviewed (saved with the sheet).
  const reviewedRef = useRef(false);
  const lastSavedRef = useRef("");
  const [showImport, setShowImport] = useState(false);

  // "Fill empty fields with AI": fills only EMPTY narrative fields from the sheet's own data.
  // The server drops any sentence whose numbers are not in the data (lib/narrative.ts).
  // It runs automatically after a document is mapped or CallboxOne data is imported, and the
  // fields being drafted show skeletons until the result arrives.
  const [aiState, setAiState] = useState<"idle" | "drafting" | "done" | "error">("idle");
  const [aiMsg, setAiMsg] = useState("");
  const [aiDrafted, setAiDrafted] = useState<string[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Latest values for async work (state captured in a closure would be stale).
  const csRef = useRef(cs);
  csRef.current = cs;
  const sourceTextRef = useRef("");
  const draftingRef = useRef(false);
  const rerunRef = useRef(false);
  const aiUsedRef = useRef(false);
  const [autoDraftTick, setAutoDraftTick] = useState(0);
  const requestAutoDraft = () => setAutoDraftTick((t) => t + 1);

  // The AI usually drafts on its own after an import or a mapped document, so its button only shows
  // once the sheet has data to draft from (the drafting route's own test: hero stats, channel rows
  // or periods, or a source document) and a field is still empty: to redraft a cleared field, retry
  // after a timeout, or draft a template or hand-filled sheet.
  const hasDraftData =
    cs.heroStats.length > 0 || cs.channels.rows.length > 0 || cs.progression.quarters.length > 0 || Boolean(sourceText.trim());
  const canDraft = aiState === "drafting" || (hasDraftData && pendingFields(cs).size > 0);

  // Saving the sheet of a pulled client to its shared entry is deliberate: the Save button, Mark as
  // reviewed, Send to CMS, or the save prompt on exit / client switch. An accidental edit never
  // overwrites the copy a colleague reviewed. (The raw import is still saved right after a pull.)
  const aiDraftedRef = useRef(aiDrafted);
  aiDraftedRef.current = aiDrafted;
  const saveFingerprint = (sheet: RevampCaseStudy, reviewed: boolean) => JSON.stringify(sheet) + (reviewed ? "|r" : "");
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
  const dirty = stage === "edit" && Boolean(importSourceRef.current) && saveFingerprint(cs, reviewedRef.current) !== lastSavedRef.current;

  // The save prompt (exit or client switch), answered through a promise.
  type SaveChoice = "save" | "discard" | "cancel";
  const [saveAsk, setSaveAsk] = useState<{ kind: "exit" | "switch"; name: string; resolve: (c: SaveChoice) => void } | null>(null);
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

  // Leaving the editor (Start over or the browser's Back button) asks first when there are unsaved
  // changes. Back is kept inside the app: it acts like Start over instead of leaving the page.
  const skipPopRef = useRef(false);
  const exitToStart = () => {
    if (typeof window !== "undefined" && window.history.state?.csg === "edit") {
      skipPopRef.current = true;
      window.history.back(); // drop the history entry the editor added
    }
    importSourceRef.current = null; // the sheet is left behind: nothing to warn about any more
    lastSavedRef.current = "";
    setSaveState("idle");
    saveMappingExample();
    setStage("upload");
  };
  const requestExit = async () => {
    if (isDirty()) {
      const choice = await askToSave("exit");
      if (choice === "cancel") return;
      if (choice === "save" && !(await saveSheetNow())) return; // save failed: stay (the Save button shows it)
    }
    exitToStart();
  };
  const requestExitRef = useRef(requestExit);
  requestExitRef.current = requestExit;
  useEffect(() => {
    if (stage !== "edit") return;
    if (window.history.state?.csg !== "edit") window.history.pushState({ csg: "edit" }, "");
    const onPop = () => {
      if (skipPopRef.current) {
        skipPopRef.current = false;
        return;
      }
      window.history.pushState({ csg: "edit" }, ""); // stay until the user decides
      void requestExitRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stage]);
  // Closing or reloading the tab: browsers only allow their own generic "Leave site?" warning.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (isDirty()) {
      const choice = await askToSave("switch");
      if (choice === "cancel") return false;
      if (choice === "save" && !(await saveSheetNow())) return false;
    }
    resetAi();
    setCs(EMPTY_REVAMP);
    setNotice("");
    importSourceRef.current = null;
    reviewedRef.current = false;
    lastSavedRef.current = "";
    cmsPageIdRef.current = null; // a new client gets its own CMS draft
    setCmsState("idle");
    setCmsMsg("");
    setCmsLink("");
    setSaveState("idle");
    return "switched";
  };

  // Restores a saved sheet as is. Unreviewed AI fields get their banner back; the AI only fills
  // fields that are still empty.
  const loadSaved = (r: RecentClient) => {
    const saved = r.sheet;
    if (!saved) return;
    const sheet = normalizeRevamp(saved.data);
    importSourceRef.current = { key: r.key, client: r.company, campaign: r.campaign, stored: r.stored };
    reviewedRef.current = saved.reviewed;
    lastSavedRef.current = saveFingerprint(sheet, saved.reviewed);
    setCs(sheet);
    if (!saved.reviewed && saved.aiDrafted.length) {
      aiUsedRef.current = true;
      setAiDrafted(saved.aiDrafted);
      setAiMsg("Saved draft: its AI-written fields haven't been marked as reviewed yet. Review them before downloading or sending to the CMS.");
      setAiState("done");
    } else {
      setAiDrafted([]);
      setAiState("idle");
    }
    if (pendingFields(sheet).size > 0) requestAutoDraft();
  };

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
        body: JSON.stringify({ sheet: csRef.current, sourceText: sourceTextRef.current }),
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

  // The browser/print document title must come from the document's own "PDF Title" field
  // (a distinct metadata field in the source, separate from the on-page case study headline
  // shown in the hero). Fall back to the on-page title, then the app name, if it's empty.
  useEffect(() => {
    document.title = cs.pdfTitle || cs.headline || "Callbox Case Study Generator";
  }, [cs.pdfTitle, cs.headline]);

  const runMapping = async (text: string) => {
    setStage("mapping");
    setMapError("");
    resetAi();
    setSourceText(text);
    sourceTextRef.current = text;
    setOriginalMapped(null);
    savedExampleRef.current = false;
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
      setOriginalMapped(merged);
      setStage("edit");
      requestAutoDraft();
    } catch (e) {
      setMapError("Could not reach the mapping service. You can fill in fields manually below.");
      setStage("edit");
    }
  };

  // Best-effort, fire-and-forget: saves the FINAL field values (after any manual edits) as a
  // few-shot example. Only meaningful for documents that actually went through the mapper —
  // a blank/manual start has no source text and nothing to compare corrections against.
  // Guarded to run at most once per session so re-printing or re-opening "Start over" doesn't
  // create duplicate rows.
  const saveMappingExample = () => {
    // Sessions with AI-drafted text are not saved: the mapper must only learn verbatim mapping.
    if (!sourceText || !originalMapped || savedExampleRef.current || aiUsedRef.current) return;
    savedExampleRef.current = true;
    const wasCorrected = JSON.stringify(cs) !== JSON.stringify(originalMapped);
    fetch("/api/save-example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText, mappedOutput: cs, wasCorrected }),
    }).catch(() => {});
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

  const resetAi = () => {
    setAiState("idle");
    setAiDrafted([]);
    setPending(new Set());
    aiUsedRef.current = false;
    sourceTextRef.current = "";
  };

  const startBlank = () => {
    importSourceRef.current = null;
    reviewedRef.current = false;
    lastSavedRef.current = "";
    setNotice("");
    resetAi();
    setCs(EMPTY_REVAMP);
    setSourceText("");
    setOriginalMapped(null);
    savedExampleRef.current = false;
    setStage("edit");
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // Chrome's print engine has no true auto-height @page: "size: auto" silently falls back to
  // the physical Letter/A4 size chosen in the print dialog and paginates against it. So we
  // measure the actual rendered content and inject a @page rule that matches it exactly.
  //
  // The real bug behind the persistent trailing gap: several "+ Add ..." editor controls (e.g.
  // "+ Add highlight") sit as the LAST element of their section, right before the Footer, and
  // carry the .no-print class. Measuring via the "beforeprint" event is NOT reliable — it does
  // not guarantee the browser has already recalculated @media print layout (verified directly:
  // .no-print elements still read getComputedStyle(el).display === "inline-block" inside a
  // beforeprint listener, even with an rAF delay). So instead we force-hide every .no-print
  // element with inline styles synchronously in the click handler, measure, then restore —
  // this guarantees the measurement reflects reality rather than hoping a stylesheet has been
  // applied by then.
  //
  // There is exactly ONE @page rule anywhere in the app (injected below, into <body>, on click).
  // No separate fixed-height "safety net" @page rule exists — two competing @page rules
  // resolving via document order was the original bug; we don't reintroduce that pattern here.
  const applyDynamicPageSize = () => {
    const node = pdfPageRef.current;
    const styleId = "dynamic-page-size";
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
    }
    document.body.appendChild(styleTag);
    if (!node) {
      styleTag.textContent = "";
      return;
    }

    // Measure the PRINT layout: hide edit-only elements AND show print-only ones (e.g. the
    // highlighted H1 replaces the editable headline in print). Missing either makes the measured
    // height wrong, and the overflow lands on a second, almost empty page.
    const noPrintEls = Array.from(document.querySelectorAll<HTMLElement>(".no-print"));
    const printOnlyEls = Array.from(document.querySelectorAll<HTMLElement>(".print-only"));
    const originalDisplay = noPrintEls.map((el) => el.style.display);
    const originalPrintOnly = printOnlyEls.map((el) => el.style.display);
    noPrintEls.forEach((el) => {
      el.style.display = "none";
    });
    printOnlyEls.forEach((el) => {
      el.style.display = "block";
    });

    const rect = node.getBoundingClientRect();

    noPrintEls.forEach((el, i) => {
      el.style.display = originalDisplay[i];
    });
    printOnlyEls.forEach((el, i) => {
      el.style.display = originalPrintOnly[i];
    });

    // Firefox's print engine doesn't reliably honor @page size given in px — it can snap the
    // page box to a nearby standard size. Physical units (in) are handled consistently by
    // both engines, so convert using the CSS reference pixel ratio (96px = 1in).
    const PX_PER_IN = 96;
    // +0.02in only covers sub-pixel/rounding slack.
    const widthIn = (Math.ceil(rect.width) / PX_PER_IN).toFixed(3);
    const heightIn = (Math.ceil(rect.height) / PX_PER_IN + 0.02).toFixed(3);
    styleTag.textContent = `@media print { @page { size: ${widthIn}in ${heightIn}in; margin: 0; } }`;
  };

  const sendToCms = async () => {
    setCmsState("sending");
    try {
      setCmsMsg("Creating the WordPress draft…");
      const draftRes = await fetch("/api/cms/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revamp: cs, pageId: cmsPageIdRef.current }),
      });
      const draftJson = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftJson.error || "Could not create the draft.");

      cmsPageIdRef.current = draftJson.id;
      void saveSheetNow(); // what went to the CMS is what the shared copy should hold
      // Show the draft next to the client in "Recently imported clients", so nobody makes a second one.
      if (importSourceRef.current) {
        fetch("/api/recent-clients?step=draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: importSourceRef.current.key, id: draftJson.id, editLink: draftJson.editLink }),
        }).catch(() => {});
      }
      setCmsLink(draftJson.editLink);
      const missing: string[] = draftJson.missingAcfKeys || [];
      const parent = draftJson.parent || {};
      const where =
        parent.status === "set"
          ? ` Placed under “${parent.title}”.`
          : parent.status === "notFound"
            ? " No parent page was set: the success stories page wasn't found, so set the parent in WordPress."
            : "";
      setCmsMsg(
        (missing.length
          ? `Draft #${draftJson.id} saved, but these fields were not stored: ${missing.join(", ")}.`
          : `Draft #${draftJson.id} saved. Review it in WordPress before publishing.`) + where
      );
      setCmsState("done");
      saveMappingExample();
    } catch (e: any) {
      setCmsMsg(e?.message || "Something went wrong.");
      setCmsState("error");
    }
  };

  const printNow = () => {
    saveMappingExample();
    applyDynamicPageSize();
    window.print();
  };

  const inpS: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid " + BORDER_STRONG,
    background: "#191a1e",
    color: TEXT,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
  };
  const btnPrimary: React.CSSProperties = {
    padding: "12px 24px",
    borderRadius: 6,
    border: "none",
    background: YELLOW,
    color: YELLOW_INK,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  };
  // Start screen option tiles, largest first: live data, document, blank sheet, template.
  const tile: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    boxSizing: "border-box",
    textAlign: "left",
    borderRadius: 12,
    cursor: "pointer",
    font: "inherit",
  };
  const tileGhost: React.CSSProperties = {
    ...tile,
    alignItems: "flex-start",
    padding: "22px 20px",
    minHeight: 120,
    border: "1px solid " + BORDER_STRONG,
    background: SHEET_BG,
    color: TEXT,
  };
  const tileIcon: React.CSSProperties = {
    width: 48,
    height: 48,
    flex: "0 0 auto",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.06)",
    color: TEXT,
  };
  const btnGhost: React.CSSProperties = {
    padding: "10px 20px",
    borderRadius: 6,
    border: "1px solid " + BORDER_STRONG,
    background: "transparent",
    color: TEXT,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  };

  if (stage === "upload") {
    return (
      <div style={{ minHeight: "100vh", background: BG, color: TEXT }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Wordmark size={26} />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: "22px 0 8px", letterSpacing: -0.3 }}>
              Case Study Generator
            </h1>
            <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.6 }}>
              Build a Callbox case study from live client data, a draft document, or a blank sheet.
            </p>
          </div>

          {/* 1. Primary: live client data */}
          <button
            onClick={() => {
              startBlank();
              setShowImport(true);
            }}
            style={{ ...tile, padding: "26px 24px", border: "none", background: YELLOW, color: YELLOW_INK }}
          >
            <span style={{ ...tileIcon, background: "rgba(23,24,28,0.12)" }}>
              <Database size={24} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 19, fontWeight: 800 }}>Start from HubSpot + CallboxOne</span>
              <span style={{ display: "block", fontSize: 13.5, lineHeight: 1.5, marginTop: 4, opacity: 0.8 }}>
                Pick one of this week&apos;s most active clients or search any client. Numbers come from CallboxOne, client
                facts from HubSpot, and the AI drafts the text.
              </span>
            </span>
            <ArrowRight size={22} style={{ flex: "0 0 auto" }} />
          </button>

          {/* 2. Drop a document */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            style={{
              ...tile,
              marginTop: 14,
              padding: "26px 24px",
              border: "2px dashed " + (dragOver ? YELLOW : BORDER_STRONG),
              background: dragOver ? "rgba(245,185,20,0.06)" : SHEET_BG,
              color: TEXT,
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <span style={{ ...tileIcon, background: "rgba(245,185,20,0.12)", color: YELLOW }}>
              <Upload size={24} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>Drop a document</span>
              <span style={{ display: "block", fontSize: 13.5, lineHeight: 1.5, marginTop: 4, color: MUTED }}>
                A .docx or .pdf draft, or a filled Case Study Template. Drop it here or click to browse.
              </span>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.pdf"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {mapError && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.35)",
                color: "#fca5a5",
                fontSize: 13,
              }}
            >
              {mapError}
            </div>
          )}

          {/* 3. Blank sheet   4. Template */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 14 }}>
            <button onClick={startBlank} style={tileGhost}>
              <span style={{ ...tileIcon, width: 44, height: 44 }}>
                <FilePlus size={21} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 16, fontWeight: 700 }}>Start with a blank case study</span>
                <span style={{ display: "block", fontSize: 13, lineHeight: 1.5, marginTop: 4, color: MUTED }}>
                  Fill in every field yourself in the editor.
                </span>
              </span>
            </button>
            <a href={`/${TEMPLATE_FILE}`} download style={{ ...tileGhost, textDecoration: "none" }}>
              <span style={{ ...tileIcon, width: 44, height: 44 }}>
                <Download size={21} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 16, fontWeight: 700 }}>Download Case Study Template</span>
                <span style={{ display: "block", fontSize: 13, lineHeight: 1.5, marginTop: 4, color: MUTED }}>
                  A Word file with every field labeled. Fill it in, then drop it above: each box goes straight into its
                  field, word for word.
                </span>
              </span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "mapping") {
    return (
      <div style={{ minHeight: "100vh", background: BG, color: TEXT }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "90px 20px", textAlign: "center" }}>
          <Wordmark size={22} />
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "26px 0 6px" }}>Reading your document…</h2>
          <p style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Mapping content to the case study template.</p>
          <Loader />
        </div>
      </div>
    );
  }

  return (
    <div className="app-root" style={{ minHeight: "100vh", background: BG, color: TEXT }}>
      <style>{`
        @media print {
          html, body { background: #FFFFFF !important; }
          .print-only { display: block !important; }
          .app-toolbar, .edit-hint, .no-print, .page-gap { display: none !important; }
          .app-shell { background: #FFFFFF !important; padding: 0 !important; }
          input, textarea { border: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* No @page rule is declared here. The only @page rule in the app is injected into a
             <style id="dynamic-page-size"> tag appended to <body> by applyDynamicPageSize()
             right before window.print() is called, sized to the exact measured content height.
             Declaring a second @page rule here (even as a "safety net") would reintroduce the
             two-competing-@page-rules bug this fix specifically avoids. */
          html, body { height: auto !important; overflow: visible !important; }
          /* .app-root has an unconditional inline minHeight:100vh (for the on-screen editor layout).
             Chrome's print engine resolves vh units against the paper's default page box rather
             than our dynamically-injected @page size, so that 100vh silently forces blank space
             below the content even after the page is sized to fit it exactly. Zero it in print. */
          .app-root { min-height: 0 !important; }
          .pdf-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; overflow: visible !important; height: auto !important; }
          .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
        }
        .print-only { display: none; }
        .ef { border-radius: 4px; transition: background 0.1s; }
        .ef:hover { background: rgba(255,202,9,0.14); }
        .ef:focus-within { background: rgba(255,202,9,0.22); }
        .ef-dark:hover { background: rgba(255,255,255,0.08); }
        .ef-dark:focus-within { background: rgba(255,255,255,0.12); }
        .ef input::placeholder, .ef textarea::placeholder { color: rgba(107,107,107,0.75); }
        .ef-dark input::placeholder, .ef-dark textarea::placeholder { color: rgba(217,214,207,0.5); }
        @media print { .ef input::placeholder, .ef textarea::placeholder { color: transparent; } }
        .sk { background: linear-gradient(90deg, rgba(35,31,32,0.06) 25%, rgba(35,31,32,0.13) 45%, rgba(35,31,32,0.06) 65%); background-size: 400% 100%; animation: skShimmer 1.4s ease-in-out infinite; }
        .sk-dark { background: linear-gradient(90deg, rgba(255,255,255,0.07) 25%, rgba(255,255,255,0.16) 45%, rgba(255,255,255,0.07) 65%); background-size: 400% 100%; }
        @keyframes skShimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
        @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
        .not-printed { position: relative; }
        .not-printed > * { opacity: 0.45; }
        .not-printed:hover { outline: 1px dashed rgba(107,107,107,0.6); outline-offset: 2px; border-radius: 6px; }
        .not-printed:hover::after { content: "Not in PDF"; position: absolute; top: -9px; right: 6px; z-index: 5; pointer-events: none; font: 600 9px/1 var(--font-mono), ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; background: #231F20; color: #FFFFFF; padding: 3px 6px; border-radius: 4px; }
        .editable-field { transition: background 0.1s; border-radius: 4px; }
        .editable-field:hover { background: rgba(245,185,20,0.08); }
        .editable-field:focus-within { background: rgba(245,185,20,0.12); }
        .editable-field-dark:hover { background: rgba(0,0,0,0.06); }
        .editable-field-dark:focus-within { background: rgba(0,0,0,0.1); }
      `}</style>

      <div
        className="app-toolbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#0d0e11",
          borderBottom: "1px solid " + BORDER,
          color: TEXT,
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={() => void requestExit()}
            style={{ ...btnGhost, padding: "7px 14px", fontSize: 12 }}
          >
            ← Start over
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={15} style={{ color: YELLOW }} />
            <b style={{ fontSize: 14 }}>Case Study Editor</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {importSourceRef.current && (
            <button
              onClick={() => void saveSheetNow()}
              disabled={(!dirty && saveState !== "error") || saveState === "saving"}
              title="Saves this sheet to the client's shared copy, the one everyone loads from Recently imported clients"
              style={{
                ...btnGhost,
                padding: "8px 16px",
                fontSize: 12,
                opacity: dirty || saveState === "error" ? 1 : 0.6,
                ...(dirty ? { borderColor: YELLOW, color: YELLOW } : {}),
                ...(saveState === "error" ? { borderColor: "#7f1d1d", color: "#fca5a5" } : {}),
              }}
            >
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed, retry" : dirty ? "Save" : "Saved"}
            </button>
          )}
          <button onClick={() => copyText(revampPlainText(cs), setCopied, "cpAll")} style={{ ...btnGhost, padding: "8px 16px", fontSize: 12 }}>
            {copied === "cpAll" ? "✓ Copied" : "Copy text"}
          </button>
          <button onClick={() => setShowImport((v) => !v)} style={{ ...btnGhost, padding: "8px 16px", fontSize: 12 }}>
            {showImport ? "Hide import" : "Import data"}
          </button>
          {canDraft && (
            <button
              onClick={() => draftWithAi(false)}
              disabled={aiState === "drafting"}
              title="Fills only the empty text fields, from the sheet's own data. Clear a field to have it redrafted."
              style={{ ...btnGhost, padding: "8px 16px", fontSize: 12, opacity: aiState === "drafting" ? 0.6 : 1 }}
            >
              {aiState === "drafting" ? "Drafting…" : "Fill empty fields with AI"}
            </button>
          )}
          <button
            onClick={sendToCms}
            disabled={cmsState === "sending"}
            style={{ ...btnGhost, padding: "8px 16px", fontSize: 12, opacity: cmsState === "sending" ? 0.6 : 1 }}
          >
            {cmsState === "sending" ? "Sending…" : cmsPageIdRef.current ? "Update CMS draft" : "Send to CMS as draft"}
          </button>
          <button onClick={printNow} style={{ ...btnPrimary, padding: "8px 20px", fontSize: 12 }}>
            Download PDF
          </button>
        </div>
      </div>

      {showImport && (
        <DataImport
          up={up}
          sheet={cs}
          onClose={() => setShowImport(false)}
          onImported={requestAutoDraft}
          onSource={(src) => {
            importSourceRef.current = src;
            reviewedRef.current = false;
          }}
          onLoadSaved={loadSaved}
          prepareSwitch={prepareSwitch}
        />
      )}

      {saveAsk && <SavePrompt kind={saveAsk.kind} name={saveAsk.name} onChoose={answerSave} />}

      {aiState !== "idle" && (
        <div
          className="app-toolbar"
          role="status"
          style={{
            maxWidth: 1100,
            margin: "10px auto 0",
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid " + (aiState === "error" ? "#7f1d1d" : YELLOW),
            background: CARD_BG,
            color: aiState === "error" ? "#fca5a5" : MUTED_LIGHT,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <span>{aiMsg}</span>
            {aiState === "done" && (
              <button
                onClick={() => {
                  setAiState("idle");
                  setAiDrafted([]);
                  reviewedRef.current = true; // saved with the sheet, so the next person sees it reviewed
                  void saveSheetNow();
                }}
                style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}
              >
                Mark as reviewed
              </button>
            )}
          </div>
          {aiState === "done" && aiDrafted.length > 0 && (
            <div style={{ marginTop: 6, color: MUTED }}>AI-written: {aiDrafted.join(" · ")}</div>
          )}
        </div>
      )}

      {cmsState !== "idle" && (
        <div
          className="app-toolbar"
          role="status"
          style={{
            maxWidth: 1100,
            margin: "10px auto 0",
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid " + (cmsState === "error" ? "#7f1d1d" : BORDER_STRONG),
            background: CARD_BG,
            color: cmsState === "error" ? "#fca5a5" : MUTED_LIGHT,
            fontSize: 13,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span>{cmsMsg}</span>
          {cmsState === "done" && cmsLink && (
            <a href={cmsLink} target="_blank" rel="noopener noreferrer" style={{ color: YELLOW, fontWeight: 600 }}>
              Open in WordPress →
            </a>
          )}
        </div>
      )}

      {notice && (
        <div
          className="app-toolbar"
          role="status"
          style={{
            maxWidth: 900,
            margin: "12px auto 0",
            padding: "10px 16px",
            borderRadius: 8,
            background: "rgba(245,185,20,0.08)",
            border: "1px solid rgba(245,185,20,0.35)",
            color: TEXT,
            fontSize: 13,
          }}
        >
          {notice}
        </div>
      )}

      {mapError && (
        <div
          className="app-toolbar"
          style={{
            maxWidth: 900,
            margin: "12px auto 0",
            padding: "10px 16px",
            borderRadius: 8,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#fca5a5",
            fontSize: 13,
          }}
        >
          {mapError}
        </div>
      )}

      <div
        className="edit-hint"
        style={{ maxWidth: 900, margin: "10px auto 0", padding: "0 16px", fontSize: 12, color: MUTED, textAlign: "center" }}
      >
        Click any text to edit it. Dashed sections are empty and stay out of the PDF and the CMS page until filled. &quot;Download PDF&quot; prints exactly what you see, minus the edit controls.
      </div>

      <div className="app-shell" style={{ padding: "24px 16px 80px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: A4_W }}>
          <div
            ref={pdfPageRef}
            className="pdf-page"
            style={{
              width: A4_W,
              maxWidth: "100%",
              background: SHEET.white,
              boxShadow: "0 4px 40px rgba(0,0,0,0.5)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <RevampSheet r={cs} up={up} pending={pending} />
            <Footer />
          </div>
          {/* Inside the sheet's column (.app-shell is a flex row), outside .pdf-page. */}
          <DevKeynote />
        </div>
      </div>
    </div>
  );
}

// "Save before exit?" / "Save before switching?": three choices, Save is the default.
function SavePrompt({ kind, name, onChoose }: { kind: "exit" | "switch"; name: string; onChoose: (c: "save" | "discard" | "cancel") => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onChoose("cancel");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChoose]);
  const ghost: React.CSSProperties = {
    padding: "9px 16px",
    borderRadius: 6,
    border: "1px solid " + BORDER_STRONG,
    background: "transparent",
    color: TEXT,
    fontSize: 13,
    cursor: "pointer",
  };
  return (
    <div
      className="app-toolbar"
      role="presentation"
      onClick={() => onChoose("cancel")}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-prompt-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, padding: 22, borderRadius: 12, border: "1px solid " + BORDER_STRONG, background: CARD_BG, color: TEXT, boxShadow: "0 12px 48px rgba(0,0,0,0.5)" }}
      >
        <b id="save-prompt-title" style={{ fontSize: 16 }}>
          {kind === "exit" ? "Save before exit?" : `Save ${name} first?`}
        </b>
        <p style={{ color: MUTED, fontSize: 13, lineHeight: 1.55, margin: "10px 0 18px" }}>
          {kind === "exit"
            ? `Your changes to ${name} aren't saved yet.`
            : `You're loading another client, and your changes to ${name} aren't saved yet.`}{" "}
          Saving updates the shared copy everyone loads from Recently imported clients.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={() => onChoose("cancel")} style={ghost}>
            Cancel
          </button>
          <button onClick={() => onChoose("discard")} style={ghost}>
            {kind === "exit" ? "Exit without saving" : "Don't save"}
          </button>
          <button
            ref={primary}
            onClick={() => onChoose("save")}
            style={{ ...ghost, border: "1px solid " + YELLOW, background: YELLOW, color: YELLOW_INK, fontWeight: 700 }}
          >
            {kind === "exit" ? "Save and exit" : "Save and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Developer keynote under the sheet: editor only. The .app-toolbar/.no-print classes keep it out of
// the PDF, and it is not part of the sheet data, so it never reaches the CMS. Build date and commit
// are set at build time (next.config.js).
function DevKeynote() {
  const date = process.env.NEXT_PUBLIC_APP_BUILD_DATE || "";
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT || "local";
  return (
    <div
      className="app-toolbar no-print"
      style={{
        maxWidth: 900,
        margin: "28px auto 0",
        padding: "16px 20px 0",
        borderTop: "1px solid " + BORDER,
        textAlign: "center",
        fontSize: 12,
        lineHeight: 1.7,
        color: MUTED,
      }}
    >
      <div>
        <b style={{ color: MUTED_LIGHT }}>Case Study Generator</b> · built and maintained by{" "}
        <b style={{ color: MUTED_LIGHT }}>James Daniel Esmatao</b>, Web Developer &amp; Technical SEO Specialist
      </div>
      <div>Found a problem or have an idea? Message James.</div>
      <div>
        Version {date ? date.replace(/-/g, ".") : "dev"} ({commit})
      </div>
    </div>
  );
}

function Wordmark({ size = 20 }: { size?: number; light?: boolean }) {
  return (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/callbox-logo.svg" alt="Callbox" style={{ height: size * 1.7, display: "block" }} />
  );
  }

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: "26px 0" }}>
      <div style={{ width: 240, padding: "18px 16px", borderRadius: 10, background: SHEET_BG, border: "1px solid " + BORDER, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: MUTED, marginBottom: 12 }}>
          Mapping fields
        </div>
        {[75, 90, 55].map((w, i) => (
          <div key={i} style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", marginBottom: 7, overflow: "hidden" }}>
            <div style={{ height: "100%", width: w + "%", borderRadius: 4, background: YELLOW, animation: "ldA 1.8s ease " + i * 0.2 + "s infinite" }} />
          </div>
        ))}
      </div>
      <style>{`@keyframes ldA{0%,100%{opacity:.35;transform:scaleX(.95)}50%{opacity:1;transform:scaleX(1)}}`}</style>
    </div>
  );
}

const FOOTER_CALL_COLS = [
  [
    { country: "North America", number: "+1 888 810 7464" },
    { country: "Colombia", number: "+57 601 508 4456" },
    { country: "Europe", number: "+44 (207) 442 5066" },
  ],
  [
    { country: "Singapore", number: "+65 3159 1112" },
    { country: "Australia", number: "+61 (02) 9037 2248" },
    { country: "Hong Kong", number: "+852 3678 6708" },
    { country: "New Zealand", number: "+64 9914 3122" },
  ],
];

function Footer() {
  return (
    <div style={{ background: "#0a0b0d", padding: "26px 48px", position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 32, paddingRight: 100 }}>
        {FOOTER_CALL_COLS.map((col, ci) => (
          <div key={ci}>
            {ci === 0 && (
              <div style={{ fontSize: 11, fontWeight: 800, color: YELLOW, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                Call
              </div>
            )}
            {ci > 0 && <div style={{ height: 17 }} />}
            {col.map((row) => (
              <div key={row.country} style={{ display: "flex", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, minWidth: 78 }}>{row.country}</span>
                <a
                  href={"tel:" + row.number.replace(/[^\d+]/g, "")}
                  style={{ fontSize: 10.5, color: TEXT, textDecoration: "none" }}
                >
                  {row.number}
                </a>
              </div>
            ))}
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: YELLOW, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
            Email
          </div>
          <a href="mailto:info@callboxinc.com" style={{ display: "block", fontSize: 10.5, color: TEXT, textDecoration: "none", marginBottom: 4 }}>
            info@callboxinc.com
          </a>
          <a href="mailto:sales@callboxinc.com" style={{ display: "block", fontSize: 10.5, color: TEXT, textDecoration: "none" }}>
            sales@callboxinc.com
          </a>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/callbox-logo.svg"
        alt="Callbox"
        style={{ position: "absolute", bottom: 26, right: 48, height: 26 }}
      />
    </div>
  );
}

