"use client";

import { useState, useRef, useEffect } from "react";
import { Headset, TrendingUp, Building2, Settings, Megaphone, Target, Upload, FileText, X } from "lucide-react";
import { extractFromFile } from "@/lib/extract";
import {
  CaseStudy,
  EMPTY_CASE,
  FIELD_LABELS,
  HERO_ROW_1,
  HERO_ROW_2,
  mergeMapped,
  buildPlainText,
  copyText,
} from "@/lib/types";
import EditableField from "@/components/EditableField";

// Palette lifted directly from Callbox's corporate case study PDF template.
const BG = "#101114";
const HERO_GRAD = "linear-gradient(120deg, #0a0b0d 0%, #0d1526 55%, #182c4d 100%)";
const SHEET_BG = "#1b1c21";
const CARD_BG = "#232429";
const YELLOW = "#f5b914";
const YELLOW_INK = "#17181c";
const TEAL = "#34d399";
const TEXT = "#f5f5f7";
const MUTED = "#a4a4ae";
const MUTED_LIGHT = "#c7c8d3";
const BORDER = "rgba(255,255,255,0.08)";
const BORDER_STRONG = "rgba(255,255,255,0.14)";

// Document width @ 96dpi (the CSS px reference browsers use for sizing) — the
// sheet renders at this fixed width both on screen and when printed, flowing
// continuously as one long page instead of being split into fixed-height pages.
const A4_W = 794;
const PAGE_PAD_X = 48;
const PAGE_PAD_Y = 40;
const BLOCK_GAP = 20;

type Stage = "upload" | "mapping" | "edit";

const SOLUTION_ICONS = [Headset, TrendingUp, Building2, Settings, Megaphone, Target];

export default function Page() {
  const [stage, setStage] = useState<Stage>("upload");
  const [cs, setCs] = useState<CaseStudy>(EMPTY_CASE);
  const [mapError, setMapError] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfPageRef = useRef<HTMLDivElement>(null);

  const setField = (k: keyof CaseStudy, v: any) => setCs((p) => ({ ...p, [k]: v }));
  const setArrField = (k: "keyHighlights" | "programGoals", i: number, v: string) =>
    setCs((p) => ({ ...p, [k]: p[k].map((x, idx) => (idx === i ? v : x)) }));
  const setSolutionField = (i: number, k: "title" | "desc", v: string) =>
    setCs((p) => ({
      ...p,
      solutionServices: p.solutionServices.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)),
    }));
  const setPhaseField = (i: number, v: string) =>
    setCs((p) => ({ ...p, howItRan: p.howItRan.map((ph, idx) => (idx === i ? { ...ph, phase: v } : ph)) }));
  const setPhaseStep = (pi: number, si: number, v: string) =>
    setCs((p) => ({
      ...p,
      howItRan: p.howItRan.map((ph, idx) =>
        idx === pi ? { ...ph, steps: ph.steps.map((s, sidx) => (sidx === si ? v : s)) } : ph
      ),
    }));
  const addPhaseStep = (pi: number) =>
    setCs((p) => ({
      ...p,
      howItRan: p.howItRan.map((ph, idx) => (idx === pi ? { ...ph, steps: [...ph.steps, ""] } : ph)),
    }));
  const setMetricField = (i: number, k: "value" | "label", v: string) =>
    setCs((p) => ({ ...p, metrics: p.metrics.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)) }));
  const addMetric = () => setCs((p) => ({ ...p, metrics: [...p.metrics, { value: "", label: "" }] }));
  const removeMetric = (i: number) => setCs((p) => ({ ...p, metrics: p.metrics.filter((_, idx) => idx !== i) }));
  const addPhase = () => setCs((p) => ({ ...p, howItRan: [...p.howItRan, { phase: "", steps: [""] }] }));
  const addGoal = () => setCs((p) => ({ ...p, programGoals: [...p.programGoals, ""] }));
  const addHighlight = () => setCs((p) => ({ ...p, keyHighlights: [...p.keyHighlights, ""] }));
  const removeGoal = (i: number) => setCs((p) => ({ ...p, programGoals: p.programGoals.filter((_, idx) => idx !== i) }));
  const removeHighlight = (i: number) =>
    setCs((p) => ({ ...p, keyHighlights: p.keyHighlights.filter((_, idx) => idx !== i) }));
  const removePhase = (pi: number) => setCs((p) => ({ ...p, howItRan: p.howItRan.filter((_, idx) => idx !== pi) }));
  const removePhaseStep = (pi: number, si: number) =>
    setCs((p) => ({
      ...p,
      howItRan: p.howItRan.map((ph, idx) => (idx === pi ? { ...ph, steps: ph.steps.filter((_, sidx) => sidx !== si) } : ph)),
    }));

  const runMapping = async (text: string) => {
    setStage("mapping");
    setMapError("");
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMapError(json.error || "Mapping failed. You can fill in fields manually below.");
        setStage("edit");
        return;
      }
      setCs(mergeMapped(json.data));
      setStage("edit");
    } catch (e) {
      setMapError("Could not reach the mapping service. You can fill in fields manually below.");
      setStage("edit");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setMapError("");
    try {
      const text = await extractFromFile(file);
      if (!text.trim()) {
        setMapError("Couldn't find readable text in that file. Try pasting the content instead.");
        return;
      }
      await runMapping(text);
    } catch (e: any) {
      setMapError(e?.message || "Could not read that file. You can paste the content manually below instead.");
    }
  };

  const startBlank = () => {
    setCs(EMPTY_CASE);
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

    const noPrintEls = Array.from(document.querySelectorAll<HTMLElement>(".no-print"));
    const originalDisplay = noPrintEls.map((el) => el.style.display);
    noPrintEls.forEach((el) => {
      el.style.display = "none";
    });

    const rect = node.getBoundingClientRect();

    noPrintEls.forEach((el, i) => {
      el.style.display = originalDisplay[i];
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

  const printNow = () => {
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

  // --- A4 pagination -------------------------------------------------
  // Blocks are atomic units (a section header glued to its first item, or one
  // grouped card grid) that are measured once and packed into fixed A4 pages
  // in JS. This guarantees a section title never lands alone at the bottom of
  // a page, card grids stay whole, and every page gets identical padding —
  // things the browser's native print pagination could not reliably do for
  // this dark, full-bleed layout. Hooks below must run on every render
  // regardless of `stage`, so this lives above the early upload/mapping returns.
  const heroNode = (
    <div style={{ background: HERO_GRAD, color: "#fff", padding: "40px 48px 36px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <span
          style={{
            display: "inline-block",
            background: YELLOW,
            color: YELLOW_INK,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            padding: "6px 14px",
            borderRadius: 4,
          }}
        >
          Case Study
        </span>
        <Wordmark size={20} light />
      </div>

      <div className="editable-field">
        <EditableField
          value={cs.title}
          onChange={(v) => setField("title", v)}
          placeholder="Case study title (e.g. Lead Generation for Security PaaS Firm – Denver)"
          multiline
          style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.25, color: "#fff", maxWidth: 640 }}
        />
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.14)", margin: "26px 0 22px" }} />

      <HeroGrid cs={cs} keys={HERO_ROW_1} setField={setField} />

      <div style={{ height: 1, background: "rgba(255,255,255,0.14)", margin: "22px 0" }} />

      <HeroGrid cs={cs} keys={HERO_ROW_2} setField={setField} />
    </div>
  );

  const statsNode = (
    <div style={{ background: YELLOW, padding: "26px 18px 20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
        {cs.metrics.map((m, i) => (
          <div
            key={i}
            className="metric-card"
            style={{
              position: "relative",
              textAlign: "center",
              padding: "12px 22px",
              flex: "1 1 150px",
              maxWidth: 220,
            }}
          >
            <button
              onClick={() => removeMetric(i)}
              className="no-print"
              aria-label="Remove metric"
              style={{
                position: "absolute",
                top: 2,
                right: 4,
                border: "none",
                background: "transparent",
                color: "rgba(0,0,0,0.45)",
                cursor: "pointer",
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
            <div className="editable-field-dark">
              <EditableField
                value={m.value}
                onChange={(v) => setMetricField(i, "value", v)}
                placeholder="0"
                style={{ fontSize: 32, fontWeight: 800, color: YELLOW_INK, textAlign: "center" }}
              />
            </div>
            <div className="editable-field-dark">
              <EditableField
                value={m.label}
                onChange={(v) => setMetricField(i, "label", v)}
                placeholder="Metric label"
                multiline
                style={{ fontSize: 13, fontWeight: 600, color: YELLOW_INK, textAlign: "center" }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="no-print" style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <button
          onClick={addMetric}
          style={{
            border: "1px dashed rgba(0,0,0,0.35)",
            background: "transparent",
            color: YELLOW_INK,
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Add metric
        </button>
      </div>
    </div>
  );

  const goalRow = (g: string, i: number) => (
    <div
      key={i}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        background: CARD_BG,
        borderRadius: 8,
        padding: "14px 18px",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: YELLOW,
          color: YELLOW_INK,
          fontSize: 12,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {i + 1}
      </div>
      <div className="editable-field" style={{ flex: 1 }}>
        <EditableField
          value={g}
          onChange={(v) => setArrField("programGoals", i, v)}
          placeholder="A program goal…"
          multiline
          style={{ fontSize: 14, lineHeight: 1.65, color: MUTED_LIGHT }}
        />
      </div>
      <button
        onClick={() => removeGoal(i)}
        className="no-print"
        aria-label="Remove goal"
        style={{ border: "none", background: "transparent", color: MUTED, cursor: "pointer", padding: 2, flexShrink: 0, marginTop: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );

  const phaseBlock = (p: CaseStudy["howItRan"][number], pi: number, showDivider: boolean) => (
    <div key={pi}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 0" }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: YELLOW,
            color: YELLOW_INK,
            fontSize: 12,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {pi + 1}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div className="editable-field" style={{ flex: 1 }}>
              <EditableField
                value={p.phase}
                onChange={(v) => setPhaseField(pi, v)}
                placeholder="Phase name"
                style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 8 }}
              />
            </div>
            <button
              onClick={() => removePhase(pi)}
              className="no-print"
              aria-label="Remove phase"
              style={{ border: "none", background: "transparent", color: MUTED, cursor: "pointer", padding: 2, flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
          {p.steps.map((s, si) => (
            <div key={si} style={{ display: "flex", gap: 5, marginBottom: 4, alignItems: "flex-start" }}>
              <span style={{ color: MUTED_LIGHT, fontSize: 13.5, lineHeight: 1.6, flexShrink: 0 }}>{si + 1}.</span>
              <div className="editable-field" style={{ flex: 1 }}>
                <EditableField
                  value={s}
                  onChange={(v) => setPhaseStep(pi, si, v)}
                  placeholder="Step detail…"
                  multiline
                  style={{ fontSize: 13.5, lineHeight: 1.6, color: MUTED_LIGHT }}
                />
              </div>
              <button
                onClick={() => removePhaseStep(pi, si)}
                className="no-print"
                aria-label="Remove step"
                style={{ border: "none", background: "transparent", color: MUTED, cursor: "pointer", padding: 2, flexShrink: 0 }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <AddLink onClick={() => addPhaseStep(pi)} label="+ Add step" small />
        </div>
      </div>
      {showDivider && <div style={{ height: 1, background: BORDER, margin: "4px 0" }} />}
    </div>
  );

  const highlightCard = (h: string, i: number) => (
    <div
      key={i}
      style={{
        background: CARD_BG,
        borderLeft: "4px solid " + YELLOW,
        borderRadius: "0 8px 8px 0",
        padding: "16px 20px",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <div className="editable-field" style={{ flex: 1 }}>
          <EditableField
            value={h}
            onChange={(v) => setArrField("keyHighlights", i, v)}
            placeholder="A key result or highlight…"
            multiline
            style={{ fontSize: 14, lineHeight: 1.65, color: MUTED_LIGHT }}
          />
        </div>
        <button
          onClick={() => removeHighlight(i)}
          className="no-print"
          aria-label="Remove highlight"
          style={{ border: "none", background: "transparent", color: MUTED, cursor: "pointer", padding: 2, flexShrink: 0 }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );

  type FlowBlock = { id: string; node: React.ReactNode };
  const flowBlocks: FlowBlock[] = [];

  flowBlocks.push({
    id: "snapshot",
    node: (
      <div>
        <SectionLabel title="The Client" />
        <div className="editable-field print-flow-text">
          <EditableField
            value={cs.clientSnapshot}
            onChange={(v) => setField("clientSnapshot", v)}
            placeholder="A short paragraph introducing who the client is…"
            multiline
            style={{ fontSize: 14.5, lineHeight: 1.75, color: MUTED_LIGHT }}
          />
        </div>
      </div>
    ),
  });

  flowBlocks.push({
    id: "challenge",
    node: (
      <div>
        <SectionLabel title="The Challenge" />
        <div className="editable-field print-flow-text">
          <EditableField
            value={cs.challenge}
            onChange={(v) => setField("challenge", v)}
            placeholder="Describe the client's situation and challenge before Callbox got involved…"
            multiline
            style={{ fontSize: 14.5, lineHeight: 1.75, color: MUTED_LIGHT }}
          />
        </div>
      </div>
    ),
  });

  flowBlocks.push({
    id: "solution",
    node: (
      <div>
        <SectionLabel title="The Callbox Solution" />
        <div className="editable-field print-flow-text" style={{ marginBottom: 18 }}>
          <EditableField
            value={cs.solutionIntro}
            onChange={(v) => setField("solutionIntro", v)}
            placeholder="How Callbox approached the solution…"
            multiline
            style={{ fontSize: 14.5, lineHeight: 1.75, color: MUTED_LIGHT }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {cs.solutionServices.map((s, i) => {
            const Icon = SOLUTION_ICONS[i % SOLUTION_ICONS.length];
            return (
              <div key={i} style={{ padding: "20px 20px", background: CARD_BG, borderRadius: 10, border: "1px solid " + BORDER }}>
                <Icon size={26} style={{ color: TEAL, marginBottom: 12, display: "block" }} />
                <div className="editable-field">
                  <EditableField
                    value={s.title}
                    onChange={(v) => setSolutionField(i, "title", v)}
                    placeholder="Service name"
                    multiline
                    style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: TEXT, marginBottom: 5 }}
                  />
                </div>
                <div className="editable-field">
                  <EditableField
                    value={s.desc}
                    onChange={(v) => setSolutionField(i, "desc", v)}
                    placeholder="Short description…"
                    multiline
                    style={{ fontSize: 13, lineHeight: 1.6, color: MUTED }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
  });

  if (cs.programGoals.length === 0) {
    flowBlocks.push({
      id: "goals-header",
      node: (
        <div>
          <SectionLabel title="Program Goals" />
          <AddLink onClick={addGoal} label="+ Add goal" />
        </div>
      ),
    });
  } else {
    cs.programGoals.forEach((g, i) => {
      flowBlocks.push({
        id: "goal-" + i,
        node: (
          <div>
            {i === 0 && <SectionLabel title="Program Goals" />}
            {goalRow(g, i)}
            {i === cs.programGoals.length - 1 && <AddLink onClick={addGoal} label="+ Add goal" />}
          </div>
        ),
      });
    });
  }

  if (cs.howItRan.length === 0) {
    flowBlocks.push({
      id: "how-header",
      node: (
        <div>
          <SectionLabel title="How It Ran" />
          <AddLink onClick={addPhase} label="+ Add phase" />
        </div>
      ),
    });
  } else {
    cs.howItRan.forEach((p, pi) => {
      flowBlocks.push({
        id: "how-" + pi,
        node: (
          <div>
            {pi === 0 && <SectionLabel title="How It Ran" />}
            {phaseBlock(p, pi, pi < cs.howItRan.length - 1)}
            {pi === cs.howItRan.length - 1 && <AddLink onClick={addPhase} label="+ Add phase" />}
          </div>
        ),
      });
    });
  }

  if (cs.keyHighlights.length === 0) {
    flowBlocks.push({
      id: "highlights-header",
      node: (
        <div>
          <SectionLabel title="Key Highlights" />
          <AddLink onClick={addHighlight} label="+ Add highlight" />
        </div>
      ),
    });
  } else {
    cs.keyHighlights.forEach((h, i) => {
      flowBlocks.push({
        id: "highlight-" + i,
        node: (
          <div>
            {i === 0 && <SectionLabel title="Key Highlights" />}
            {highlightCard(h, i)}
            {i === cs.keyHighlights.length - 1 && <AddLink onClick={addHighlight} label="+ Add highlight" />}
          </div>
        ),
      });
    });
  }

  if (stage === "upload") {
    return (
      <div style={{ minHeight: "100vh", background: BG, color: TEXT }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "72px 20px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <Wordmark size={26} />
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: "22px 0 8px", letterSpacing: -0.3 }}>
              Case Study Generator
            </h1>
            <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.6 }}>
              Upload a draft document and we&apos;ll map it into Callbox&apos;s corporate case study format.
            </p>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              padding: "48px 24px",
              borderRadius: 12,
              border: "2px dashed " + (dragOver ? YELLOW : BORDER_STRONG),
              background: dragOver ? "rgba(245,185,20,0.06)" : SHEET_BG,
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "rgba(245,185,20,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 14px",
              }}
            >
              <Upload size={22} style={{ color: YELLOW }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Drop a .docx or .pdf here, or click to browse
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>We&apos;ll extract the content and map it to the template</div>
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

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0" }}>
            <div style={{ flex: 1, height: 1, background: BORDER }} />
            <span style={{ fontSize: 12, color: MUTED }}>or</span>
            <div style={{ flex: 1, height: 1, background: BORDER }} />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, color: MUTED }}>
              Paste content directly
            </label>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste raw case study text here if you'd rather not upload a file…"
              style={{ ...inpS, minHeight: 120, resize: "vertical", lineHeight: 1.6, marginBottom: 10 }}
            />
            <button
              style={{ ...btnPrimary, opacity: pastedText.trim() ? 1 : 0.5, width: "100%" }}
              disabled={!pastedText.trim()}
              onClick={() => runMapping(pastedText)}
            >
              Map pasted content
            </button>
          </div>

          <div style={{ textAlign: "center" }}>
            <button style={btnGhost} onClick={startBlank}>
              Start with a blank case study
            </button>
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
          html, body { background: ${BG} !important; }
          .app-toolbar, .edit-hint, .no-print, .page-gap { display: none !important; }
          .app-shell { background: ${BG} !important; padding: 0 !important; }
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
            onClick={() => setStage("upload")}
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
          <button onClick={() => copyText(buildPlainText(cs), setCopied, "cpAll")} style={{ ...btnGhost, padding: "8px 16px", fontSize: 12 }}>
            {copied === "cpAll" ? "✓ Copied" : "Copy text"}
          </button>
          <button onClick={printNow} style={{ ...btnPrimary, padding: "8px 20px", fontSize: 12 }}>
            Download PDF
          </button>
        </div>
      </div>

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
        Click any text below to edit it directly. Use &quot;Download PDF&quot; to save — the layout matches Callbox&apos;s corporate case study template.
      </div>

      <div className="app-shell" style={{ padding: "24px 16px 80px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: A4_W }}>
          <div
            ref={pdfPageRef}
            className="pdf-page"
            style={{
              width: A4_W,
              maxWidth: "100%",
              background: SHEET_BG,
              boxShadow: "0 4px 40px rgba(0,0,0,0.5)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {heroNode}
            {statsNode}

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: `24px ${PAGE_PAD_X}px ${PAGE_PAD_Y}px`,
                boxSizing: "border-box",
              }}
            >
              {flowBlocks.map((b) => (
                <div key={b.id} className="avoid-break" style={{ marginBottom: BLOCK_GAP }}>
                  {b.node}
                </div>
              ))}
            </div>

            <Footer />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroGrid({
  cs,
  keys,
  setField,
}: {
  cs: CaseStudy;
  keys: (keyof CaseStudy)[];
  setField: (k: keyof CaseStudy, v: any) => void;
}) {
  return (
    <div className="avoid-break" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
      {keys.map((k) => (
        <div key={k}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: MUTED_LIGHT, textTransform: "uppercase", marginBottom: 5 }}>
            {FIELD_LABELS[k as string]}
          </div>
          <div className="editable-field">
            <EditableField
              value={(cs as any)[k]}
              onChange={(v) => setField(k, v)}
              placeholder="—"
              multiline
              style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fff" }}
            />
          </div>
        </div>
      ))}
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

function SectionLabel({ title }: { title: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11.5,
        fontWeight: 800,
        letterSpacing: 0.8,
        color: YELLOW,
        textTransform: "uppercase",
        background: "#26272d",
        padding: "6px 14px",
        borderRadius: 4,
        marginBottom: 14,
      }}
    >
      {title}
    </span>
  );
}

function AddLink({ onClick, label, small }: { onClick: () => void; label: string; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="no-print"
      style={{
        border: "none",
        background: "transparent",
        color: YELLOW,
        fontSize: small ? 11.5 : 12.5,
        fontWeight: 700,
        cursor: "pointer",
        padding: "4px 0",
        marginTop: 2,
      }}
    >
      {label}
    </button>
  );
}
