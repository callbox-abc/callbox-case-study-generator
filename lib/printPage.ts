// Chrome's print engine has no true auto-height @page: "size: auto" silently falls back to
// the physical Letter/A4 size chosen in the print dialog and paginates against it. So we
// measure the actual rendered content and inject a @page rule that matches it exactly.
//
// The real bug behind the persistent trailing gap: several "+ Add ..." editor controls (e.g.
// "+ Add highlight") sit as the LAST element of their section, right before the Footer, and
// carry the .no-print class. Measuring via the "beforeprint" event is NOT reliable — it does
// not guarantee the browser has already recalculated @media print layout (verified directly:
// .no-print elements still read getComputedStyle(el).display === "inline-block" inside a
// beforeprint listener, even with an rAF delay). So instead we force-hide every .no-print
// element with inline styles synchronously in the click handler, measure, then restore —
// this guarantees the measurement reflects reality rather than hoping a stylesheet has been
// applied by then.
//
// There is exactly ONE @page rule anywhere in the app (injected below, into <body>, on click).
// No separate fixed-height "safety net" @page rule exists — two competing @page rules
// resolving via document order was the original bug; we don't reintroduce that pattern here.
export function applyDynamicPageSize(node: HTMLElement | null) {
  const styleId = "dynamic-page-size";
  let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = styleId;
  }
  document.body.appendChild(styleTag);
  if (!node) {
    styleTag.textContent = "";
    return;
  }

  // Measure the PRINT layout: hide edit-only elements AND show print-only ones (e.g. the
  // highlighted H1 replaces the editable headline in print). Missing either makes the measured
  // height wrong, and the overflow lands on a second, almost empty page.
  const noPrintEls = Array.from(document.querySelectorAll<HTMLElement>(".no-print"));
  const printOnlyEls = Array.from(document.querySelectorAll<HTMLElement>(".print-only"));
  const originalDisplay = noPrintEls.map((el) => el.style.display);
  const originalPrintOnly = printOnlyEls.map((el) => el.style.display);
  noPrintEls.forEach((el) => {
    el.style.display = "none";
  });
  printOnlyEls.forEach((el) => {
    el.style.display = "block";
  });

  const rect = node.getBoundingClientRect();

  noPrintEls.forEach((el, i) => {
    el.style.display = originalDisplay[i];
  });
  printOnlyEls.forEach((el, i) => {
    el.style.display = originalPrintOnly[i];
  });

  // Firefox's print engine doesn't reliably honor @page size given in px — it can snap the
  // page box to a nearby standard size. Physical units (in) are handled consistently by
  // both engines, so convert using the CSS reference pixel ratio (96px = 1in).
  const PX_PER_IN = 96;
  // +0.02in only covers sub-pixel/rounding slack.
  const widthIn = (Math.ceil(rect.width) / PX_PER_IN).toFixed(3);
  const heightIn = (Math.ceil(rect.height) / PX_PER_IN + 0.02).toFixed(3);
  styleTag.textContent = `@media print { @page { size: ${widthIn}in ${heightIn}in; margin: 0; } }`;
}
