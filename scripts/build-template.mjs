// Builds public/callbox-case-study-template.docx from lib/templateSchema.ts.
// Run after changing the schema:  npm run template
// (Node 24 runs the .ts schema directly; no build step needed.)

import { writeFileSync } from "node:fs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeightRule,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { TEMPLATE_FILE, TEMPLATE_SECTIONS, TEMPLATE_TITLE, TEMPLATE_VERSION } from "../lib/templateSchema.ts";

const INK = "0E0E0E";
const MUTED = "6B6B6B";
const YELLOW = "FFCA09";
const LABEL_BG = "F2F2F2";
const HEAD_BG = "FAFAFA";
const LINE = "D0D0D0";
const FONT = "Arial";
const WIDTH = 9936; // US Letter (12240) minus 0.8" margins (2 x 1152)
const LABEL_W = 3000;

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
const margins = { top: 100, bottom: 100, left: 140, right: 140 };

const run = (text, opts = {}) => new TextRun({ text, font: FONT, ...opts });
const labelParas = (label, guide) => [
  new Paragraph({ spacing: { after: guide ? 40 : 0 }, children: [run(label, { bold: true, size: 20, color: INK })] }),
  ...(guide ? [new Paragraph({ spacing: { after: 0 }, children: [run(guide, { size: 16, color: MUTED })] })] : []),
];

function fieldsTable(fields) {
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: [LABEL_W, WIDTH - LABEL_W],
    rows: fields.map(
      (f) =>
        new TableRow({
          cantSplit: true,
          height: { value: f.kind === "paras" ? 1400 : 620, rule: HeightRule.ATLEAST },
          children: [
            new TableCell({
              width: { size: LABEL_W, type: WidthType.DXA },
              shading: { fill: LABEL_BG, type: ShadingType.CLEAR, color: "auto" },
              borders,
              margins,
              verticalAlign: VerticalAlign.TOP,
              children: labelParas(f.label, f.guide),
            }),
            new TableCell({
              width: { size: WIDTH - LABEL_W, type: WidthType.DXA },
              borders,
              margins,
              children: [new Paragraph({ children: [run("", { size: 21 })] })],
            }),
          ],
        })
    ),
  });
}

function listTable(f) {
  const cols = f.columns;
  const cell = (text, w, opts = {}) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders,
      margins,
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
      children: [new Paragraph({ children: [run(text, { size: opts.size ?? 21, bold: opts.bold, color: opts.color ?? INK })] })],
    });
  const rows = [
    // Row 1: the list label (the reader finds the list by this text).
    new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: WIDTH, type: WidthType.DXA },
          columnSpan: cols.length,
          shading: { fill: LABEL_BG, type: ShadingType.CLEAR, color: "auto" },
          borders,
          margins,
          children: labelParas(f.label, f.guide),
        }),
      ],
    }),
    // Row 2: column headers.
    new TableRow({ tableHeader: true, children: cols.map((c) => cell(c.label, c.width, { fill: HEAD_BG, bold: true, size: 17, color: MUTED })) }),
    // Answer rows (some pre-filled).
    ...Array.from({ length: f.rows }, (_, i) =>
      new TableRow({
        cantSplit: true,
        height: { value: 460, rule: HeightRule.ATLEAST },
        children: cols.map((c) => cell(f.prefill?.[i]?.[c.key] ?? "", c.width)),
      })
    ),
  ];
  return new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: cols.map((c) => c.width), rows });
}

const spacer = () => new Paragraph({ spacing: { after: 160 }, children: [] });

const body = [
  new Paragraph({ style: "Title", children: [run(TEMPLATE_TITLE)] }),
  new Paragraph({
    spacing: { after: 200 },
    children: [run(`${TEMPLATE_VERSION} · Keep the grey labels as they are and type only in the white boxes.`, { size: 18, color: MUTED })],
  }),
  new Paragraph({ style: "Heading1", children: [run("How to use it")] }),
  ...[
    "Fill in what you know and leave the rest empty. Nothing here is required.",
    "Leave the numbers to the generator if you like: it imports client facts from HubSpot and campaign numbers from CallboxOne, and the AI drafts the empty text.",
    "Don't rename or delete the grey labels. You can add rows to a table (press Tab in its last cell).",
    "Upload the filled file on the case study generator's start screen. Every box goes straight into its field, word for word.",
  ].map((t) => new Paragraph({ numbering: { reference: "steps", level: 0 }, spacing: { after: 60 }, children: [run(t, { size: 20 })] })),
];

for (const section of TEMPLATE_SECTIONS) {
  body.push(new Paragraph({ style: "Heading1", children: [run(section.title)] }));
  if (section.intro) body.push(new Paragraph({ spacing: { after: 120 }, children: [run(section.intro, { size: 18, color: MUTED })] }));
  // Consecutive single fields share one table; each list is its own table.
  let group = [];
  const flush = () => {
    if (group.length) body.push(fieldsTable(group), spacer());
    group = [];
  };
  for (const f of section.fields) {
    if (f.kind === "list") {
      flush();
      body.push(listTable(f), spacer());
    } else {
      group.push(f);
    }
  }
  flush();
}

const doc = new Document({
  creator: "Callbox",
  title: TEMPLATE_TITLE,
  description: `${TEMPLATE_TITLE} (${TEMPLATE_VERSION})`,
  styles: {
    default: { document: { run: { font: FONT, size: 21, color: INK } } },
    paragraphStyles: [
      {
        id: "Title",
        name: "Title",
        basedOn: "Normal",
        next: "Normal",
        run: { font: FONT, size: 44, bold: true, color: INK },
        paragraph: { spacing: { before: 0, after: 80 }, keepNext: true },
      },
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONT, size: 28, bold: true, color: INK },
        paragraph: {
          spacing: { before: 320, after: 140 },
          keepNext: true,
          outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: YELLOW, space: 4 } },
        },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "steps",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1152, bottom: 1152, left: 1152, right: 1152 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({ children: [run(`${TEMPLATE_TITLE} · ${TEMPLATE_VERSION} · Upload it on the case study generator's start screen.`, { size: 16, color: MUTED })] })],
        }),
      },
      children: body,
    },
  ],
});

const out = new URL(`../public/${TEMPLATE_FILE}`, import.meta.url);
writeFileSync(out, await Packer.toBuffer(doc));
console.log("wrote", out.pathname);
