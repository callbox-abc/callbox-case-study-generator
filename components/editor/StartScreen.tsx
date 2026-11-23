"use client";

// The screens before the editor: the start screen (five ways in) and "Reading your document…".

import { useRef, useState } from "react";
import { ArrowRight, Database, Download, EyeOff, FilePlus, Upload } from "lucide-react";
import { TEMPLATE_FILE } from "@/lib/templateSchema";
import { DevKeynote, Loader, Wordmark } from "@/components/editor/Brand";
import { BG, BORDER_STRONG, MUTED, SHEET_BG, TEXT, YELLOW, YELLOW_INK } from "@/components/editor/theme";

// Start screen option tiles, largest first: live data, unbranded, document, blank sheet, template.
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

export function StartScreen({
  mapError,
  onStartImport,
  onStartUnbranded,
  onStartBlank,
  onFile,
}: {
  mapError: string;
  onStartImport: () => void;
  onStartUnbranded: () => void;
  onStartBlank: () => void;
  onFile: (file: File | undefined) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

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
          onClick={onStartImport}
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

        {/* 2. Unbranded: the campaign's numbers only, no client details (lib/unbranded.ts) */}
        <button
          onClick={onStartUnbranded}
          style={{ ...tile, marginTop: 14, padding: "24px 24px", border: "1px solid rgba(245,185,20,0.55)", background: SHEET_BG, color: TEXT }}
        >
          <span style={{ ...tileIcon, background: "rgba(245,185,20,0.12)", color: YELLOW }}>
            <EyeOff size={23} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>Start an unbranded case study</span>
            <span style={{ display: "block", fontSize: 13.5, lineHeight: 1.5, marginTop: 4, color: MUTED }}>
              Campaign numbers only. Pick a client to pull its CallboxOne numbers: its name, industry, HQ, size, client since,
              program growth and primary contact never reach the sheet, the AI, the PDF or the CMS.
            </span>
          </span>
          <ArrowRight size={22} style={{ flex: "0 0 auto", color: YELLOW }} />
        </button>

        {/* 3. Drop a document */}
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
            onChange={(e) => onFile(e.target.files?.[0])}
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

        {/* 4. Blank sheet   5. Template */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 14 }}>
          <button onClick={onStartBlank} style={tileGhost}>
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

        <DevKeynote marginTop={48} />
      </div>
    </div>
  );
}

export function MappingScreen() {
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
