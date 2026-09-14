// Client-side text extraction from uploaded .docx / .pdf files.
// Runs entirely in the browser — the file itself is never uploaded to our server;
// only the extracted plain text is sent to /api/map for field mapping.
//
// pdf.js is loaded via a dynamic import() of its CDN-hosted ES module build
// rather than bundled through npm. Reason: pdfjs-dist 4.x ships ONLY .mjs
// (ES module) output — there is no UMD/.min.js build anymore — and bundling
// that through webpack/Terser in a Next.js production build is a known
// failure mode ("import/export cannot be used outside of module code").
// Importing the CDN's .mjs directly at runtime avoids the bundler entirely.

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let _pdfJsPromise: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (_pdfJsPromise) return _pdfJsPromise;
  _pdfJsPromise = (async () => {
    // @ts-ignore - webpackIgnore prevents Next.js from trying to bundle this remote URL
    const lib = await import(/* webpackIgnore: true */ `${PDFJS_BASE}/pdf.min.mjs`);
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    return lib;
  })();
  return _pdfJsPromise;
}

export async function extractFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || "";
  }

  if (name.endsWith(".pdf")) {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => it.str).join(" ") + "\n";
    }
    return text;
  }

  throw new Error("Unsupported file type. Please upload a .docx or .pdf file.");
}
