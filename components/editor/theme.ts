// App chrome palette (start screen, toolbar, banners), lifted from Callbox's corporate case study
// PDF template. The sheet itself uses the brand tokens in components/revamp/RevampSheet.tsx.
export const BG = "#101114";
export const SHEET_BG = "#1b1c21";
export const CARD_BG = "#232429";
export const YELLOW = "#f5b914";
export const YELLOW_INK = "#17181c";
export const TEXT = "#f5f5f7";
export const MUTED = "#a4a4ae";
export const MUTED_LIGHT = "#c7c8d3";
export const BORDER = "rgba(255,255,255,0.08)";
export const BORDER_STRONG = "rgba(255,255,255,0.14)";

// Document width @ 96dpi (the CSS px reference browsers use for sizing) — the
// sheet renders at this fixed width both on screen and when printed, flowing
// continuously as one long page instead of being split into fixed-height pages.
export const A4_W = 794;

export const btnPrimary: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 6,
  border: "none",
  background: YELLOW,
  color: YELLOW_INK,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

export const btnGhost: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 6,
  border: "1px solid " + BORDER_STRONG,
  background: "transparent",
  color: TEXT,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};
