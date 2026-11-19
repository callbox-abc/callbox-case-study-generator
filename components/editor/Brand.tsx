"use client";

// Small brand pieces: the logo, the mapping loader, and the developer keynote.

import { BORDER, MUTED, MUTED_LIGHT, SHEET_BG, YELLOW } from "@/components/editor/theme";

// Developer keynote on the start screen and under the sheet. The .app-toolbar/.no-print classes keep
// it out of the PDF, and it is not part of the sheet data, so it never reaches the CMS. Build date and
// commit are set at build time (next.config.js).
export function DevKeynote({ marginTop = 28 }: { marginTop?: number }) {
  const date = process.env.NEXT_PUBLIC_APP_BUILD_DATE || "";
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT || "local";
  return (
    <div
      className="app-toolbar no-print"
      style={{
        maxWidth: 900,
        margin: `${marginTop}px auto 0`,
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

export function Wordmark({ size = 20 }: { size?: number; light?: boolean }) {
  return (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/callbox-logo.svg" alt="Callbox" style={{ height: size * 1.7, display: "block" }} />
  );
  }

export function Loader() {
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
