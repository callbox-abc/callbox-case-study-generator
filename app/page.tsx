"use client";

import { useState, useRef, useLayoutEffect } from "react";
import { ChevronUp, Headset, TrendingUp, Building2, Settings, Megaphone, Target, Upload, FileText } from "lucide-react";
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

// A4 @ 96dpi (the CSS px reference browsers use for @page sizing) — every printed
// page is exactly this box. Pagination is computed in JS against these dimensions
// instead of relying on the browser's own print break heuristics, which proved
// unreliable for this dark, full-bleed grid/flex layout.
const A4_W = 794;
const A4_H = 1123;
const PAGE_PAD_X = 48;
const PAGE_PAD_Y = 40;
const CONTENT_W = A4_W - PAGE_PAD_X * 2;
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
  const addPhase = () => setCs((p) => ({ ...p, howItRan: [...p.howItRan, { phase: "", steps: [""] }] }));
  const addGoal = () => setCs((p) => ({ ...p, programGoals: [...p.programGoals, ""] }));
  const addHighlight = () => setCs((p) => ({ ...p, keyHighlights: [...p.keyHighlights, ""] }));

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

  const printNow = () => window.print();

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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", background: YELLOW }}>
      {cs.metrics.map((m, i) => (
        <div
          key={i}
          style={{
            textAlign: "center",
            padding: "30px 18px",
            borderRight: i < cs.metrics.length - 1 ? "1px solid rgba(0,0,0,0.12)" : "none",
          }}
        >
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
          <div className="editable-field">
            <EditableField
              value={p.phase}
              onChange={(v) => setPhaseField(pi, v)}
              placeholder="Phase name"
              style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 8 }}
            />
          </div>
          {p.steps.map((s, si) => (
            <div key={si} style={{ display: "flex", gap: 5, marginBottom: 4 }}>
              <span style={{ color: MUTED_LIGHT, fontSize: 13.5, flexShrink: 0 }}>{si + 1}.</span>
              <div className="editable-field" style={{ flex: 1 }}>
                <EditableField
                  value={s}
                  onChange={(v) => setPhaseStep(pi, si, v)}
                  placeholder="Step detail…"
                  multiline
                  style={{ fontSize: 13.5, lineHeight: 1.6, color: MUTED_LIGHT }}
                />
              </div>
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
      <div className="editable-field">
        <EditableField
          value={h}
          onChange={(v) => setArrField("keyHighlights", i, v)}
          placeholder="A key result or highlight…"
          multiline
          style={{ fontSize: 14, lineHeight: 1.65, color: MUTED_LIGHT }}
        />
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
        <SectionLabel title="The Solution" />
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

  flowBlocks.push({ id: "footer", node: <Footer /> });

  const { pages, heroRef, statsRef, blockRefsMap, heroH, statsH } = usePagedLayout(cs, flowBlocks, stage);

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
    <div style={{ minHeight: "100vh", background: BG, color: TEXT }}>
      <style>{`
        @media print {
          html, body { background: ${BG} !important; }
          .app-toolbar, .edit-hint, .no-print, .page-gap { display: none !important; }
          .app-shell { background: ${BG} !important; padding: 0 !important; }
          input, textarea { border: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* Pages are pre-sized to exactly A4 in JS (usePagedLayout), so each .pdf-page
             maps to exactly one printed page — no reliance on the browser's own
             (unreliable) print break heuristics inside this dark, full-bleed layout. */
          @page { size: A4; margin: 0; }
          .pdf-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; break-after: page; page-break-after: always; }
          .pdf-page:last-child { break-after: auto; page-break-after: auto; }
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
          {pages.map((blockIds, pageIndex) => {
            const isFirst = pageIndex === 0;
            return (
              <div
                key={pageIndex}
                className="pdf-page"
                style={{
                  width: A4_W,
                  minHeight: A4_H,
                  maxWidth: "100%",
                  background: SHEET_BG,
                  boxShadow: "0 4px 40px rgba(0,0,0,0.5)",
                  borderRadius: 6,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {isFirst && heroNode}
                {isFirst && statsNode}

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    minHeight: isFirst ? Math.max(A4_H - heroH - statsH, 0) : A4_H,
                    padding: isFirst ? `24px ${PAGE_PAD_X}px ${PAGE_PAD_Y}px` : `${PAGE_PAD_Y}px ${PAGE_PAD_X}px`,
                    boxSizing: "border-box",
                  }}
                >
                  {blockIds.map((id) => {
                    const b = flowBlocks.find((fb) => fb.id === id);
                    if (!b) return null;
                    const isFooter = id === "footer";
                    return (
                      <div
                        key={id}
                        className="avoid-break"
                        style={
                          isFooter
                            ? {
                                marginTop: "auto",
                                marginLeft: -PAGE_PAD_X,
                                marginRight: -PAGE_PAD_X,
                                marginBottom: -PAGE_PAD_Y,
                              }
                            : { marginBottom: BLOCK_GAP }
                        }
                      >
                        {b.node}
                      </div>
                    );
                  })}
                </div>

                {/* Repeats on every page — screen preview and print alike */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/callbox-caret.svg"
                  alt=""
                  aria-hidden="true"
                  style={{ position: "absolute", bottom: 18, right: 18, width: 20, height: 20 }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Off-screen measurement pass — mirrors the exact blocks/widths used above so
          usePagedLayout can read real rendered heights before committing to page breaks. */}
      <div aria-hidden="true" style={{ position: "absolute", top: 0, left: -99999, visibility: "hidden", pointerEvents: "none" }}>
        <div ref={heroRef} style={{ width: A4_W }}>
          {heroNode}
        </div>
        <div ref={statsRef} style={{ width: A4_W }}>
          {statsNode}
        </div>
        <div style={{ width: CONTENT_W }}>
          {flowBlocks.map((b) => (
            <div
              key={b.id}
              ref={(el) => {
                if (el) blockRefsMap.current.set(b.id, el);
              }}
            >
              {b.node}
            </div>
          ))}
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
    { country: "USA", number: "+1 888.810.7464" },
    { country: "UK", number: "+44 207.442.5066" },
    { country: "AUSTRALIA", number: "+61 2 9037 2248" },
    { country: "COLOMBIA", number: "+57 601 508 4456" },
  ],
  [
    { country: "NEW ZEALAND", number: "+1 888.810.7464" },
    { country: "SINGAPORE", number: "+44 207.442.5066" },
    { country: "MALAYSIA", number: "+61 2 9037 2248" },
    { country: "HONG KONG", number: "+57 601 508 4456" },
  ],
];

function Footer() {
  return (
    <div style={{ background: "#0a0b0d", padding: "26px 48px", position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
        {FOOTER_CALL_COLS.map((col, ci) => (
          <div key={ci}>
            {ci === 0 && (
              <div style={{ fontSize: 11, fontWeight: 800, color: TEXT, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                Call
              </div>
            )}
            {ci > 0 && <div style={{ height: 17 }} />}
            {col.map((row) => (
              <div key={row.country} style={{ display: "flex", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, minWidth: 78 }}>{row.country}</span>
                <span style={{ fontSize: 10.5, color: TEXT }}>{row.number}</span>
              </div>
            ))}
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: TEXT, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
            Email
          </div>
          <div style={{ fontSize: 10.5, color: TEXT, marginBottom: 4 }}>info@callboxinc.com</div>
          <div style={{ fontSize: 10.5, color: TEXT }}>sales@callboxinc.com</div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 24,
          bottom: 20,
          width: 34,
          height: 34,
          borderRadius: 6,
          background: YELLOW,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ChevronUp size={18} style={{ color: YELLOW_INK }} />
      </div>
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

// Packs measured flow blocks into fixed A4 pages. Hero + stats are always the
// top of page 1; remaining blocks fill left-to-right budget per page, never
// splitting a block (a section header is glued to its first item/card grid).
function usePagedLayout(cs: CaseStudy, flowBlocks: { id: string; node: React.ReactNode }[], stage: string) {
  const heroRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const blockRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  // Seed with every block already mounted on page 1 so the first layout
  // effect measures real DOM heights instead of an empty page (which would
  // otherwise lock in a bogus "everything fits on one page" result, since
  // this effect never re-runs after that).
  const [pages, setPages] = useState<string[][]>(() => [flowBlocks.map((b) => b.id)]);
  const [heroH, setHeroH] = useState(0);
  const [statsH, setStatsH] = useState(0);

  useLayoutEffect(() => {
    const measuredHeroH = heroRef.current?.getBoundingClientRect().height ?? 0;
    const measuredStatsH = statsRef.current?.getBoundingClientRect().height ?? 0;
    const CONTINUATION_BUDGET = A4_H - PAGE_PAD_Y * 2;

    const result: string[][] = [[]];
    let pageIdx = 0;
    let budget = A4_H - measuredHeroH - measuredStatsH - 24 - PAGE_PAD_Y;

    for (const b of flowBlocks) {
      const el = blockRefsMap.current.get(b.id);
      const h = (el?.getBoundingClientRect().height ?? 0) + BLOCK_GAP;
      if (h > budget && result[pageIdx].length > 0) {
        pageIdx++;
        result[pageIdx] = [];
        budget = CONTINUATION_BUDGET;
      }
      result[pageIdx].push(b.id);
      budget -= h;
    }

    setHeroH(measuredHeroH);
    setStatsH(measuredStatsH);
    setPages(result);
    // `stage` is included because the offscreen measurement DOM (heroRef,
    // statsRef, blockRefsMap) only exists once the editor view is mounted —
    // on first mount (stage === "upload") those refs are all empty, so this
    // effect must re-run the instant stage flips to "editor".
  }, [cs, flowBlocks.length, stage]);

  return { pages, heroRef, statsRef, blockRefsMap, heroH, statsH };
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
