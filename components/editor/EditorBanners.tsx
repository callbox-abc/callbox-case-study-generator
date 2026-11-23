"use client";

// Status banners under the toolbar: AI drafting, the CMS draft, notices and mapping errors.
// All carry .app-toolbar, so they stay out of the PDF.

import type { TextFinding } from "@/lib/truthCheck";
import type { IdentityFinding } from "@/lib/unbranded";
import { BORDER_STRONG, CARD_BG, MUTED, MUTED_LIGHT, TEXT, YELLOW, btnGhost } from "@/components/editor/theme";

// "Verifying truth data": sentences whose numbers aren't in the CallboxOne data (the source of
// truth), each with Remove (the AI redrafts an emptied field from the data) or Keep (a number that
// isn't a campaign result). Shown once CallboxOne numbers are on the sheet.
// While the AI is still writing the empty fields (`checking`), the text isn't final yet: the banner
// says "Verifying truth data…" with a progress bar, then "Truth data verified:" once it is.
export function TruthBanner({
  active,
  checking,
  findings,
  keptCount,
  onRemove,
  onKeep,
  onDismiss,
}: {
  active: boolean;
  checking: boolean;
  findings: TextFinding[];
  keptCount: number;
  onRemove: (fs: TextFinding[]) => void;
  onKeep: (f: TextFinding) => void;
  onDismiss: () => void;
}) {
  if (!active) return null;
  const n = findings.length;
  const small: React.CSSProperties = { ...btnGhost, padding: "4px 10px", fontSize: 12 };
  const found = `${n} sentence${n === 1 ? "" : "s"} in the text ${n === 1 ? "has" : "have"} numbers that aren't in the CallboxOne data, the source of truth.`;
  const message = checking
    ? (n ? `${found} ` : "") +
      "The AI is still writing the empty fields; their numbers are checked against the CallboxOne data as they arrive."
    : n
      ? `${found} Remove ${n === 1 ? "it" : "them"} (the AI redrafts an emptied field from the data), or keep a number that isn't a campaign result.`
      : `every number in the text matches the CallboxOne data${
          keptCount ? `, apart from ${keptCount} sentence${keptCount === 1 ? "" : "s"} kept on purpose` : ""
        }.`;
  return (
    <div
      className="app-toolbar"
      role="status"
      aria-busy={checking}
      style={{
        maxWidth: 1100,
        margin: "10px auto 0",
        padding: "10px 16px",
        borderRadius: 8,
        border: "1px solid " + (n || checking ? YELLOW : BORDER_STRONG),
        background: CARD_BG,
        color: MUTED_LIGHT,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <span>
          <b style={{ color: TEXT }}>{checking ? "Verifying truth data…" : "Truth data verified:"}</b> {message}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          {n > 1 && (
            <button onClick={() => onRemove(findings)} style={small}>
              Remove all
            </button>
          )}
          {(n > 0 || !checking) && (
            <button onClick={onDismiss} style={small}>
              {n ? "Keep all" : "Dismiss"}
            </button>
          )}
        </span>
      </div>
      {checking && (
        <div className="progress-track" role="progressbar" aria-label="Verifying truth data" style={{ marginTop: 8 }}>
          <span />
        </div>
      )}
      {n > 0 && (
        <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {findings.map((f) => (
            <li key={f.path + "|" + f.sentence} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 360px", minWidth: 0 }}>
                <span style={{ color: MUTED }}>{f.label}:</span> “{f.sentence}”{" "}
                <span style={{ color: YELLOW }}>(not in CallboxOne: {f.numbers.join(", ")})</span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onRemove([f])} style={small}>
                  Remove
                </button>
                <button onClick={() => onKeep(f)} style={small}>
                  Keep
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// "Client details check" on an unbranded case study: sentences that name the client (its name,
// website, HQ or campaign code), each with Remove (the AI redrafts an emptied field, without the
// client's details) or Keep (the word only looks like the client's). Download PDF and Send to CMS
// stay blocked while any is left.
export function IdentityBanner({
  active,
  findings,
  keptCount,
  onRemove,
  onKeep,
}: {
  active: boolean;
  findings: IdentityFinding[];
  keptCount: number;
  onRemove: (fs: IdentityFinding[]) => void;
  onKeep: (f: IdentityFinding) => void;
}) {
  if (!active) return null;
  const n = findings.length;
  const small: React.CSSProperties = { ...btnGhost, padding: "4px 10px", fontSize: 12 };
  const message = n
    ? `${n} sentence${n === 1 ? "" : "s"} on this unbranded case study ${n === 1 ? "names" : "name"} the client or its details. Remove ${n === 1 ? "it" : "them"} before downloading the PDF or sending to the CMS, or keep a word that only looks like the client's.`
    : `nothing on the sheet names the client${keptCount ? `, apart from ${keptCount} sentence${keptCount === 1 ? "" : "s"} kept on purpose` : ""}.`;
  return (
    <div
      className="app-toolbar"
      role="status"
      style={{
        maxWidth: 1100,
        margin: "10px auto 0",
        padding: "10px 16px",
        borderRadius: 8,
        border: "1px solid " + (n ? "#7f1d1d" : BORDER_STRONG),
        background: CARD_BG,
        color: MUTED_LIGHT,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <span>
          <b style={{ color: TEXT }}>Client details check:</b> {message}
        </span>
        {n > 1 && (
          <button onClick={() => onRemove(findings)} style={small}>
            Remove all
          </button>
        )}
      </div>
      {n > 0 && (
        <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {findings.map((f) => (
            <li key={f.path + "|" + f.sentence} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 360px", minWidth: 0 }}>
                <span style={{ color: MUTED }}>{f.label}:</span> “{f.sentence}”{" "}
                <span style={{ color: "#fca5a5" }}>(names the client: {f.terms.join(", ")})</span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onRemove([f])} style={small}>
                  Remove
                </button>
                <button onClick={() => onKeep(f)} style={small}>
                  Keep
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
