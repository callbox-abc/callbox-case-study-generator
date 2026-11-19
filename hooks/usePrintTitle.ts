// The browser tab title, and the saved PDF's file name (browsers name the file after the title).

import { useEffect } from "react";
import { pdfFileName, type RevampCaseStudy } from "@/lib/revamp";

export function usePrintTitle(cs: RevampCaseStudy): string {
  // The browser/print document title must come from the document's own "PDF Title" field
  // (a distinct metadata field in the source, separate from the on-page case study headline
  // shown in the hero). Fall back to the on-page title, then the app name, if it's empty.
  const screenTitle = cs.pdfTitle || cs.headline || "Callbox Case Study Generator";
  useEffect(() => {
    document.title = screenTitle;
  }, [screenTitle]);

  // Saving as PDF names the file after the page title, so while printing (Download PDF or Ctrl+P)
  // the title is the file name, "CS_Case-Study-Name"; the tab gets its normal title back after.
  const pdfName = pdfFileName(cs);
  useEffect(() => {
    const before = () => { document.title = pdfName; };
    const after = () => { document.title = screenTitle; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [pdfName, screenTitle]);

  return pdfName;
}
