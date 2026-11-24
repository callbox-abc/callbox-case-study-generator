"use client";

// The dark contact footer at the bottom of the case study page (printed in the PDF).

import { MUTED, TEXT, YELLOW } from "@/components/editor/theme";

const FOOTER_CALL_COLS = [
  [
    { country: "North America", number: "+1 888 810 7464" },
    { country: "Colombia", number: "+57 601 508 4456" },
    { country: "Europe", number: "+44 (207) 442 5066" },
  ],
  [
    { country: "Singapore", number: "+65 6817 8656" },
    { country: "Australia", number: "+61 (02) 9037 2248" },
    { country: "Hong Kong", number: "+852 3678 6708" },
    { country: "New Zealand", number: "+64 9914 3122" },
  ],
];

export function SheetFooter() {
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
