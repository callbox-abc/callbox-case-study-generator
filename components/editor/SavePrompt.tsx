"use client";

import { useEffect, useRef } from "react";
import { BORDER_STRONG, CARD_BG, MUTED, TEXT, YELLOW, YELLOW_INK } from "@/components/editor/theme";

// "Save before exit?" / "Save before switching?": three choices, Save is the default.
export function SavePrompt({ kind, name, onChoose }: { kind: "exit" | "switch"; name: string; onChoose: (c: "save" | "discard" | "cancel") => void }) {
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
