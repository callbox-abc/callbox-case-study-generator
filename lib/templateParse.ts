// Reads a filled "Callbox Case Study Template" (.docx) straight into a sheet, with no AI:
// every answer box goes into its field word for word. Fields are found by their label text
// (lib/templateSchema.ts), so the reader and the downloadable file always agree.
//
// Works on mammoth's HTML output (tables keep their cells, unlike its plain-text output).
// The HTML parsing is plain string matching, so it runs the same in the browser and in Node.

import { normalizeRevamp, type RevampCaseStudy } from "@/lib/revamp";
import { TEMPLATE_SECTIONS, TEMPLATE_TITLE, TEMPLATE_VERSION, type ListField, type TemplateField } from "@/lib/templateSchema";

const decode = (t: string) =>
  t
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// A cell's text blocks (paragraphs, list items, headings), empty ones dropped.
const blocks = (cellHtml: string) =>
  [...cellHtml.matchAll(/<(p|li|h[1-6])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => decode(m[2])).filter(Boolean);

type Row = string[][]; // cells -> text blocks
const tables = (html: string): Row[][] =>
  [...html.matchAll(/<table(?:\s[^>]*)?>([\s\S]*?)<\/table>/gi)].map((t) =>
    [...t[1].matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<t[dh](?:\s[^>]*)?>([\s\S]*?)<\/t[dh]>/gi)].map((c) => blocks(c[1]))
    )
  );

export const isTemplateHtml = (html: string) => decode(html).includes(TEMPLATE_TITLE) && decode(html).includes(TEMPLATE_VERSION);

const ALL_FIELDS: TemplateField[] = TEMPLATE_SECTIONS.flatMap((s) => s.fields);
const byLabel = new Map(ALL_FIELDS.map((f) => [f.label.toLowerCase(), f]));

const setPath = (o: any, path: string, v: unknown) => {
  const parts = path.split(".");
  const last = parts.pop() as string;
  let x = o;
  for (const k of parts) x = x[k] ??= {};
  x[last] = v;
};

const toNumber = (t: string): number | null => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(t || "");
  return m ? Number(m[0].replace(/,/g, "")) : null;
};

// Returns the items, and whether the writer typed anything (pre-filled labels alone don't count).
function readList(f: ListField, rows: Row[]): { items: unknown[]; typed: boolean } {
  const items: Record<string, unknown>[] = [];
  let typed = false;
  // rows[0] = list label, rows[1] = column headers, then answers.
  rows.slice(2).forEach((row, r) => {
    const cells = f.columns.map((_, i) => (row[i] ?? []).join(" ").trim());
    if (cells.every((c) => !c)) return;
    if (f.columns.some((c, i) => cells[i] && cells[i] !== (f.prefill?.[r]?.[c.key] ?? ""))) typed = true;
    const item: Record<string, unknown> = {};
    f.columns.forEach((c, i) => (item[c.key] = c.numeric ? toNumber(cells[i]) : cells[i]));
    items.push(item);
  });
  if (f.flat) return { items: items.map((x) => x[f.columns[0].key]).filter(Boolean), typed };
  if (f.path === "progression.quarters") {
    // Peak = the highest full period; a period noted as ongoing is partial.
    const partial = (q: any) => /ongoing|so far|partial|still running/i.test(`${q.label} ${q.note}`);
    const peak = Math.max(0, ...items.filter((q) => !partial(q)).map((q: any) => q.count ?? 0));
    for (const q of items as any[]) {
      q.isPartial = partial(q);
      q.isPeak = !q.isPartial && peak > 0 && q.count === peak;
    }
  }
  return { items, typed };
}

// Returns the sheet and how many fields were filled, or null when the file isn't the template.
export function parseTemplateHtml(html: string): { sheet: RevampCaseStudy; filled: number } | null {
  if (!isTemplateHtml(html)) return null;
  const out: any = {};
  let filled = 0;
  for (const rows of tables(html)) {
    if (!rows.length) continue;
    // A list table starts with one merged cell holding the list's label.
    const first = rows[0];
    const listField = first.length === 1 ? byLabel.get((first[0][0] ?? "").toLowerCase()) : undefined;
    if (listField?.kind === "list") {
      const { items, typed } = readList(listField, rows);
      if (items.length) setPath(out, listField.path, items);
      if (typed) filled += 1;
      continue;
    }
    // Otherwise each row is: label cell | answer cell.
    for (const row of rows) {
      if (row.length < 2) continue;
      const f = byLabel.get((row[0][0] ?? "").toLowerCase());
      if (!f || f.kind === "list") continue;
      const answer = row.slice(1).flat();
      if (!answer.length) continue;
      setPath(out, f.path, f.kind === "paras" ? answer : answer.join(" "));
      filled += 1;
    }
  }
  if (out.primaryContact?.role && !out.primaryContact?.eyebrow) out.primaryContact.eyebrow = "Callbox works with";
  return { sheet: normalizeRevamp(out), filled };
}

// Browser: reads a .docx and parses it when it's the template; null otherwise.
export async function readTemplateDocx(file: File): Promise<{ sheet: RevampCaseStudy; filled: number } | null> {
  if (!file.name.toLowerCase().endsWith(".docx")) return null;
  const mammoth = await import("mammoth/mammoth.browser");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return parseTemplateHtml(value || "");
}
