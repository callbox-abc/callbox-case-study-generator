"use client";

// Editor-wide CSS: what the PDF hides or shows (print), field hover states, and skeletons.
export function EditorStyles() {
  return (
    <style>{`
        @media print {
          html, body { background: #FFFFFF !important; }
          .print-only { display: block !important; }
          .app-toolbar, .edit-hint, .no-print, .page-gap { display: none !important; }
          .app-shell { background: #FFFFFF !important; padding: 0 !important; }
          input, textarea { border: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* No @page rule is declared here. The only @page rule in the app is injected into a
             <style id="dynamic-page-size"> tag appended to <body> by applyDynamicPageSize()
             right before window.print() is called, sized to the exact measured content height.
             Declaring a second @page rule here (even as a "safety net") would reintroduce the
             two-competing-@page-rules bug this fix specifically avoids. */
          html, body { height: auto !important; overflow: visible !important; }
          /* .app-root has an unconditional inline minHeight:100vh (for the on-screen editor layout).
             Chrome's print engine resolves vh units against the paper's default page box rather
             than our dynamically-injected @page size, so that 100vh silently forces blank space
             below the content even after the page is sized to fit it exactly. Zero it in print. */
          .app-root { min-height: 0 !important; }
          .pdf-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; overflow: visible !important; height: auto !important; }
          .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
          /* An unbranded sheet that still names the client never prints (see app/page.tsx). */
          .print-blocked { display: none !important; }
          .print-blocked-note { display: block !important; }
        }
        .print-only, .print-blocked-note { display: none; }
        .ef { border-radius: 4px; transition: background 0.1s; }
        .ef:hover { background: rgba(255,202,9,0.14); }
        .ef:focus-within { background: rgba(255,202,9,0.22); }
        .ef-dark:hover { background: rgba(255,255,255,0.08); }
        .ef-dark:focus-within { background: rgba(255,255,255,0.12); }
        .ef input::placeholder, .ef textarea::placeholder { color: rgba(107,107,107,0.75); }
        .ef-dark input::placeholder, .ef-dark textarea::placeholder { color: rgba(217,214,207,0.5); }
        @media print { .ef input::placeholder, .ef textarea::placeholder { color: transparent; } }
        .sk { background: linear-gradient(90deg, rgba(35,31,32,0.06) 25%, rgba(35,31,32,0.13) 45%, rgba(35,31,32,0.06) 65%); background-size: 400% 100%; animation: skShimmer 1.4s ease-in-out infinite; }
        .sk-dark { background: linear-gradient(90deg, rgba(255,255,255,0.07) 25%, rgba(255,255,255,0.16) 45%, rgba(255,255,255,0.07) 65%); background-size: 400% 100%; }
        @keyframes skShimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
        @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
        /* Indeterminate progress bar (Verifying truth data while the AI is still writing). */
        .progress-track { position: relative; height: 4px; border-radius: 999px; overflow: hidden; background: rgba(245,185,20,0.15); }
        .progress-track > span { position: absolute; top: 0; bottom: 0; width: 35%; border-radius: 999px; background: #f5b914; animation: progressSlide 1.2s ease-in-out infinite; }
        @keyframes progressSlide { 0% { left: -35%; } 100% { left: 100%; } }
        @media (prefers-reduced-motion: reduce) { .progress-track > span { animation: none; left: 0; width: 60%; } }
        .not-printed { position: relative; }
        .not-printed > * { opacity: 0.45; }
        .not-printed:hover { outline: 1px dashed rgba(107,107,107,0.6); outline-offset: 2px; border-radius: 6px; }
        .not-printed:hover::after { content: "Not in PDF"; position: absolute; top: -9px; right: 6px; z-index: 5; pointer-events: none; font: 600 9px/1 var(--font-mono), ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; background: #231F20; color: #FFFFFF; padding: 3px 6px; border-radius: 4px; }
        .editable-field { transition: background 0.1s; border-radius: 4px; }
        .editable-field:hover { background: rgba(245,185,20,0.08); }
        .editable-field:focus-within { background: rgba(245,185,20,0.12); }
        .editable-field-dark:hover { background: rgba(0,0,0,0.06); }
        .editable-field-dark:focus-within { background: rgba(0,0,0,0.1); }
      `}</style>
  );
}
