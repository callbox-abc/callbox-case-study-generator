"use client";

// The sticky toolbar above the sheet.

import { useState } from "react";
import { FileText } from "lucide-react";
import { copyText } from "@/lib/types";
import { revampPlainText, type RevampCaseStudy } from "@/lib/revamp";
import { BORDER, TEXT, YELLOW, btnGhost, btnPrimary } from "@/components/editor/theme";

export function EditorToolbar({
  cs,
  onStartOver,
  hasImportSource,
  dirty,
  saveState,
  onSave,
  showImport,
  onToggleImport,
  canDraft,
  aiState,
  onDraft,
  cmsState,
  hasCmsDraft,
  onSendToCms,
  onPrint,
}: {
  cs: RevampCaseStudy;
  onStartOver: () => void;
  hasImportSource: boolean;
  dirty: boolean;
  saveState: "idle" | "saving" | "error";
  onSave: () => void;
  showImport: boolean;
  onToggleImport: () => void;
  canDraft: boolean;
  aiState: "idle" | "drafting" | "done" | "error";
  onDraft: () => void;
  cmsState: "idle" | "sending" | "done" | "error";
  hasCmsDraft: boolean;
  onSendToCms: () => void;
  onPrint: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
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
          onClick={onStartOver}
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
        {hasImportSource && (
          <button
            onClick={onSave}
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
        <button onClick={onToggleImport} style={{ ...btnGhost, padding: "8px 16px", fontSize: 12 }}>
          {showImport ? "Hide import" : "Import data"}
        </button>
        {canDraft && (
          <button
            onClick={onDraft}
            disabled={aiState === "drafting"}
            title="Fills only the empty text fields, from the sheet's own data. Clear a field to have it redrafted."
            style={{ ...btnGhost, padding: "8px 16px", fontSize: 12, opacity: aiState === "drafting" ? 0.6 : 1 }}
          >
            {aiState === "drafting" ? "Drafting…" : "Fill empty fields with AI"}
          </button>
        )}
        <button
          onClick={onSendToCms}
          disabled={cmsState === "sending"}
          style={{ ...btnGhost, padding: "8px 16px", fontSize: 12, opacity: cmsState === "sending" ? 0.6 : 1 }}
        >
          {cmsState === "sending" ? "Sending…" : hasCmsDraft ? "Update CMS draft" : "Send to CMS as draft"}
        </button>
        <button onClick={onPrint} style={{ ...btnPrimary, padding: "8px 20px", fontSize: 12 }}>
          Download PDF
        </button>
      </div>
    </div>
  );
}
