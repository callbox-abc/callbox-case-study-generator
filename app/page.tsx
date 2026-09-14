"use client";

import { useState, useRef } from "react";
import { extractFromFile } from "@/lib/extract";
import { CaseStudy, EMPTY_CASE, FIELD_LABELS, mergeMapped, buildPlainText, copyText } from "@/lib/types";
import EditableField from "@/components/EditableField";

const NAVY = "#161a2e";
const NAVY_SOFT = "#232842";
const PAPER = "#ffffff";
const INK = "#1a1a2e";
const MUTED = "#6b6f8a";
const ACCENT = "#e8493a";
const LINE = "#e6e7ee";
const SNAP_BG = "#f4f5fa";

type Stage = "upload" | "mapping" | "edit";

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
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid " + LINE,
    background: "#fff",
    color: INK,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
  };
  const btnPrimary: React.CSSProperties = {
    padding: "11px 24px",
    borderRadius: 8,
    border: "none",
    background: NAVY,
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  };
  const btnGhost: React.CSSProperties = {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid " + LINE,
    background: "transparent",
    color: INK,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  };

  if (stage === "upload") {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7fb", fontFamily: "'Inter', system-ui, sans-serif", color: INK }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "60px 20px" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: ACCENT, marginBottom: 10 }}>CALLBOX</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>Case Study Generator</h1>
            <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>
              Upload a draft document and we'll map it into a client-ready case study.
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
              borderRadius: 14,
              border: "2px dashed " + (dragOver ? NAVY : LINE),
              background: dragOver ? "#eef0f7" : "#fff",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Drop a .docx or .pdf here, or click to browse</div>
            <div style={{ fontSize: 12, color: MUTED }}>We'll extract the content and map it to the template</div>
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
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 13,
              }}
            >
              {mapError}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: LINE }} />
            <span style={{ fontSize: 12, color: MUTED }}>or</span>
            <div style={{ flex: 1, height: 1, background: LINE }} />
          </div>

          <div style={{ marginBottom: 16 }}>
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
      <div style={{ minHeight: "100vh", background: "#f7f7fb", fontFamily: "'Inter', system-ui, sans-serif", color: INK }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "80px 20px", textAlign: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Reading your document…</h2>
          <p style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Mapping content to the case study fields.</p>
          <Loader />
        </div>
      </div>
    );
  }

  const snapshotRows = Object.keys(FIELD_LABELS);

  return (
    <div style={{ minHeight: "100vh", background: "#eef0f5", fontFamily: "'Inter', system-ui, sans-serif", color: INK }}>
      <style>{`
        @media print {
          .app-toolbar, .edit-hint, .no-print { display: none !important; }
          .app-shell { background: #fff !important; padding: 0 !important; }
          .print-sheet { box-shadow: none !important; margin: 0 !important; width: 100% !important; }
          input, textarea { border: none !important; }
          @page { size: A4; margin: 0; }
        }
        .editable-field { transition: background 0.1s; border-radius: 4px; }
        .editable-field:hover { background: rgba(232,73,58,0.06); }
        .editable-field:focus-within { background: rgba(232,73,58,0.08); }
      `}</style>

      <div
        className="app-toolbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: NAVY,
          color: "#fff",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setStage("upload")}
            style={{ ...btnGhost, borderColor: "rgba(255,255,255,0.25)", color: "#fff", padding: "7px 14px", fontSize: 12 }}
          >
            ← Start over
          </button>
          <b style={{ fontSize: 14 }}>💼 Case Study Editor</b>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => copyText(buildPlainText(cs), setCopied, "cpAll")}
            style={{ ...btnGhost, borderColor: "rgba(255,255,255,0.25)", color: "#fff", padding: "8px 16px", fontSize: 12 }}
          >
            {copied === "cpAll" ? "✓ Copied" : "📋 Copy text"}
          </button>
          <button onClick={printNow} style={{ ...btnPrimary, background: ACCENT, padding: "8px 20px", fontSize: 12 }}>
            ⬇ Download PDF
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
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          {mapError}
        </div>
      )}

      <div className="edit-hint" style={{ maxWidth: 900, margin: "10px auto 0", padding: "0 16px", fontSize: 12, color: "#6b6f8a", textAlign: "center" }}>
        Click any text below to edit it directly. Use "Download PDF" to save — the printed text stays selectable and copy-pasteable.
      </div>

      <div className="app-shell" style={{ padding: "24px 16px 80px", display: "flex", justifyContent: "center" }}>
        <div
          className="print-sheet"
          style={{ width: "100%", maxWidth: 850, background: PAPER, boxShadow: "0 4px 30px rgba(22,26,46,0.12)", borderRadius: 4, overflow: "hidden" }}
        >
          <div style={{ background: NAVY, color: "#fff", padding: "34px 44px 30px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#8b8fb0", marginBottom: 10 }}>CASE STUDY</div>
            <div className="editable-field">
              <EditableField
                value={cs.title}
                onChange={(v) => setField("title", v)}
                placeholder="Case study title (e.g. ABM Lead Generation for Colombian Healthcare Tech Company)"
                multiline
                style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.25, color: "#fff" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap" }}>
            <div style={{ width: 260, background: SNAP_BG, padding: "26px 22px", borderRight: "1px solid " + LINE, flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: ACCENT, marginBottom: 14 }}>CLIENT SNAPSHOT</div>
              {snapshotRows.map((k) => (
                <div key={k} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: MUTED, textTransform: "uppercase", marginBottom: 3 }}>
                    {FIELD_LABELS[k]}
                  </div>
                  <div className="editable-field">
                    <EditableField
                      value={(cs as any)[k]}
                      onChange={(v) => setField(k as keyof CaseStudy, v)}
                      placeholder="—"
                      multiline
                      style={{ fontSize: 12.5, lineHeight: 1.5, color: INK }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: 300, padding: "28px 32px" }}>
              <Section title="Key Highlights">
                {cs.keyHighlights.map((h, i) => (
                  <BulletRow key={i}>
                    <EditableField
                      value={h}
                      onChange={(v) => setArrField("keyHighlights", i, v)}
                      placeholder="A key result or highlight…"
                      multiline
                      style={{ fontSize: 13.5, lineHeight: 1.6 }}
                    />
                  </BulletRow>
                ))}
                <AddLink onClick={addHighlight} label="+ Add highlight" />
              </Section>

              <Section title="The Challenge">
                <div className="editable-field">
                  <EditableField
                    value={cs.challenge}
                    onChange={(v) => setField("challenge", v)}
                    placeholder="Describe the client's situation and challenge before Callbox got involved…"
                    multiline
                    style={{ fontSize: 13.5, lineHeight: 1.7 }}
                  />
                </div>
              </Section>

              <Section title="Program Goals">
                {cs.programGoals.map((g, i) => (
                  <NumberedRow key={i} n={i + 1}>
                    <EditableField
                      value={g}
                      onChange={(v) => setArrField("programGoals", i, v)}
                      placeholder="A program goal…"
                      multiline
                      style={{ fontSize: 13.5, lineHeight: 1.6 }}
                    />
                  </NumberedRow>
                ))}
                <AddLink onClick={addGoal} label="+ Add goal" />
              </Section>

              <Section title="The Solution">
                <div className="editable-field" style={{ marginBottom: 14 }}>
                  <EditableField
                    value={cs.solutionIntro}
                    onChange={(v) => setField("solutionIntro", v)}
                    placeholder="How Callbox approached the solution…"
                    multiline
                    style={{ fontSize: 13.5, lineHeight: 1.7 }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {cs.solutionServices.map((s, i) => (
                    <div key={i} style={{ padding: "12px 14px", background: SNAP_BG, borderRadius: 8, border: "1px solid " + LINE }}>
                      <div className="editable-field">
                        <EditableField
                          value={s.title}
                          onChange={(v) => setSolutionField(i, "title", v)}
                          placeholder="Service name"
                          style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 3 }}
                        />
                      </div>
                      <div className="editable-field">
                        <EditableField
                          value={s.desc}
                          onChange={(v) => setSolutionField(i, "desc", v)}
                          placeholder="Short description…"
                          multiline
                          style={{ fontSize: 12, lineHeight: 1.5, color: MUTED }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="How It Ran">
                {cs.howItRan.map((p, pi) => (
                  <div key={pi} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: NAVY,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 700,
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
                            style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}
                          />
                        </div>
                        {p.steps.map((s, si) => (
                          <div key={si} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                            <span style={{ color: MUTED, fontSize: 13 }}>•</span>
                            <div className="editable-field" style={{ flex: 1 }}>
                              <EditableField
                                value={s}
                                onChange={(v) => setPhaseStep(pi, si, v)}
                                placeholder="Step detail…"
                                multiline
                                style={{ fontSize: 13, lineHeight: 1.6 }}
                              />
                            </div>
                          </div>
                        ))}
                        <AddLink onClick={() => addPhaseStep(pi)} label="+ Add step" small />
                      </div>
                    </div>
                  </div>
                ))}
                <AddLink onClick={addPhase} label="+ Add phase" />
              </Section>
            </div>
          </div>

          <div style={{ background: NAVY_SOFT, padding: "26px 32px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
            {cs.metrics.map((m, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div className="editable-field">
                  <EditableField
                    value={m.value}
                    onChange={(v) => setMetricField(i, "value", v)}
                    placeholder="0"
                    style={{ fontSize: 26, fontWeight: 800, color: "#fff", textAlign: "center" }}
                  />
                </div>
                <div className="editable-field">
                  <EditableField
                    value={m.label}
                    onChange={(v) => setMetricField(i, "label", v)}
                    placeholder="Metric label"
                    multiline
                    style={{ fontSize: 11, color: "#b8bcd6", textAlign: "center" }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: NAVY, color: "#8b8fb0", padding: "16px 32px", fontSize: 10.5, textAlign: "center", letterSpacing: 0.3 }}>
            Callbox Inc. · info@callboxinc.com · callboxinc.com
          </div>
        </div>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: "26px 0" }}>
      <div style={{ width: 240, padding: "18px 16px", borderRadius: 10, background: "rgba(22,26,46,0.04)", border: "1px solid rgba(22,26,46,0.08)", margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: MUTED, marginBottom: 12 }}>Mapping fields</div>
        {[75, 90, 55].map((w, i) => (
          <div key={i} style={{ height: 6, borderRadius: 4, background: "rgba(22,26,46,0.08)", marginBottom: 7, overflow: "hidden" }}>
            <div style={{ height: "100%", width: w + "%", borderRadius: 4, background: "rgba(22,26,46,0.18)", animation: "ldA 1.8s ease " + i * 0.2 + "s infinite" }} />
          </div>
        ))}
      </div>
      <style>{`@keyframes ldA{0%,100%{opacity:.4;transform:scaleX(.95)}50%{opacity:1;transform:scaleX(1)}}`}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.8, color: "#e8493a", textTransform: "uppercase", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function BulletRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
      <span style={{ color: "#e8493a", fontSize: 13, marginTop: 2 }}>●</span>
      <div className="editable-field" style={{ flex: 1 }}>
        {children}
      </div>
    </div>
  );
}
function NumberedRow({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
      <span style={{ color: "#161a2e", fontSize: 13, fontWeight: 700, minWidth: 16 }}>{n}.</span>
      <div className="editable-field" style={{ flex: 1 }}>
        {children}
      </div>
    </div>
  );
}
function AddLink({ onClick, label, small }: { onClick: () => void; label: string; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="no-print"
      style={{ border: "none", background: "transparent", color: "#e8493a", fontSize: small ? 11.5 : 12.5, fontWeight: 600, cursor: "pointer", padding: "4px 0", marginTop: 2 }}
    >
      {label}
    </button>
  );
}
