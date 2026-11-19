// The filled Word template is read word for word, with no AI.

import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { parseTemplateHtml } from "@/lib/templateParse";
import { TEMPLATE_TITLE, TEMPLATE_VERSION } from "@/lib/templateSchema";

const cell = (...paras: string[]) => `<td>${paras.map((p) => `<p>${p}</p>`).join("")}</td>`;
const row = (...cells: string[]) => `<tr>${cells.join("")}</tr>`;
const doc = (...tables: string[]) =>
  `<h1>${TEMPLATE_TITLE}</h1><p>${TEMPLATE_VERSION}</p>` + tables.map((t) => `<table>${t}</table>`).join("");

describe("parseTemplateHtml", () => {
  it("ignores documents that are not the template", () => {
    expect(parseTemplateHtml("<p>Some other draft</p>")).toBeNull();
  });

  it("reads text, paragraph and list fields into the sheet", () => {
    const html = doc(
      row(cell("Client name"), cell("Netrix Global")) +
        row(cell("Headline (H1)"), cell("IT Provider Builds Qualified Pipeline Across North America")) +
        row(cell("Situation text"), cell("First paragraph.", "Second paragraph.")) +
        row(cell("Contact role"), cell("Senior Director of Marketing")),
      row(cell("Channel rows")) +
        row(cell("Channel"), cell("Activity"), cell("Appointments")) +
        row(cell("LinkedIn"), cell("2,400 connection requests"), cell("87")) +
        row(cell("Calls"), cell("5,000 dials"), cell(""))
    );
    const r = parseTemplateHtml(html)!;
    expect(r.filled).toBe(5);
    expect(r.sheet.clientName).toBe("Netrix Global");
    expect(r.sheet.headline).toBe("IT Provider Builds Qualified Pipeline Across North America");
    expect(r.sheet.situation.body).toEqual(["First paragraph.", "Second paragraph."]);
    expect(r.sheet.primaryContact.role).toBe("Senior Director of Marketing");
    expect(r.sheet.primaryContact.eyebrow).toBe("Callbox works with");
    expect(r.sheet.channels.rows).toEqual([
      { name: "LinkedIn", activity: "2,400 connection requests", appointments: 87 },
      { name: "Calls", activity: "5,000 dials", appointments: null },
    ]);
  });

  it("decodes HTML entities word for word", () => {
    const r = parseTemplateHtml(doc(row(cell("Client name"), cell("Smith &amp; Sons &#39;Ltd&#39;"))))!;
    expect(r.sheet.clientName).toBe("Smith & Sons 'Ltd'");
  });

  it("does not count pre-filled labels as filled", () => {
    const html = doc(
      row(cell("Facts")) +
        row(cell("Label"), cell("Value")) +
        row(cell("Industry"), cell(""))
    );
    expect(parseTemplateHtml(html)!.filled).toBe(0);
  });

  it("marks the peak and the ongoing period in the progression table", () => {
    const html = doc(
      row(cell("Periods")) +
        row(cell("Period"), cell("Appointments"), cell("Note")) +
        row(cell("Q3 2025"), cell("20"), cell("")) +
        row(cell("Q4 2025"), cell("35"), cell("")) +
        row(cell("Oct–Nov 2026"), cell("40"), cell("ongoing"))
    );
    const r = parseTemplateHtml(html)!;
    expect(r.sheet.progression.quarters).toHaveLength(3);
    const q = Object.fromEntries(r.sheet.progression.quarters.map((x) => [x.label, x]));
    // The ongoing period has the most appointments so far, but only full periods can be the peak.
    expect(q["Q4 2025"].isPeak).toBe(true);
    expect(q["Q3 2025"].isPeak).toBe(false);
    expect(q["Oct–Nov 2026"].isPartial).toBe(true);
    expect(q["Oct–Nov 2026"].isPeak).toBe(false);
  });

  it("never makes a short launch period the peak in a series of quarters", () => {
    const html = doc(
      row(cell("Periods")) +
        row(cell("Period"), cell("Appointments"), cell("Note")) +
        row(cell("Aug–Sep 2025"), cell("40"), cell("")) +
        row(cell("Q4 2025"), cell("35"), cell("")) +
        row(cell("Q1 2026"), cell("30"), cell(""))
    );
    const q = parseTemplateHtml(html)!.sheet.progression.quarters;
    expect(q.map((x) => x.isPeak)).toEqual([false, true, false]);
  });
});

describe("the shipped template file", () => {
  it("is recognized as the template and reads as empty", async () => {
    const buffer = readFileSync(new URL("../public/callbox-case-study-template.docx", import.meta.url));
    const { value } = await mammoth.convertToHtml({ buffer });
    const r = parseTemplateHtml(value);
    expect(r).not.toBeNull();
    expect(r!.filled).toBe(0);
    expect(r!.sheet.headline).toBe("");
  });
});
