"use client";

// Status banners under the toolbar: AI drafting, the CMS draft, notices and mapping errors.
// All carry .app-toolbar, so they stay out of the PDF.

import { BORDER_STRONG, CARD_BG, MUTED, MUTED_LIGHT, TEXT, YELLOW, btnGhost } from "@/components/editor/theme";

export function AiBanner({
  aiState,
  aiMsg,
  aiDrafted,
  onMarkReviewed,
}: {
  aiState: "idle" | "drafting" | "done" | "error";
  aiMsg: string;
  aiDrafted: string[];
  onMarkReviewed: () => void;
}) {
  if (aiState === "idle") return null;
  return (
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
          <button onClick={onMarkReviewed} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>
            Mark as reviewed
          </button>
        )}
      </div>
      {aiState === "done" && aiDrafted.length > 0 && (
        <div style={{ marginTop: 6, color: MUTED }}>AI-written: {aiDrafted.join(" · ")}</div>
      )}
    </div>
  );
}

export function CmsBanner({ cmsState, cmsMsg, cmsLink }: { cmsState: "idle" | "sending" | "done" | "error"; cmsMsg: string; cmsLink: string }) {
  if (cmsState === "idle") return null;
  return (
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
  );
}

export function NoticeBanner({ notice }: { notice: string }) {
  if (!notice) return null;
  return (
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
  );
}

export function MapErrorBanner({ mapError }: { mapError: string }) {
  if (!mapError) return null;
  return (
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
  );
}
