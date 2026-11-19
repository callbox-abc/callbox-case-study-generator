// The sheet's data model: cleaning model output, facts, section visibility and the ACF payload.

import { describe, expect, it } from "vitest";
import { applyImportedFacts, MAX_FACTS, mergeFacts, normalizeRevamp, sectionNumbers, toAcfPayload } from "@/lib/revamp";
import { sheet } from "./fixtures";

describe("normalizeRevamp", () => {
  it("turns anything into a complete, safe sheet", () => {
    for (const input of [null, undefined, "text", 42, {}]) {
      const r = normalizeRevamp(input);
      expect(r.headline).toBe("");
      expect(r.heroStats).toEqual([]);
      expect(r.channels.rows).toEqual([]);
      expect(r.primaryContact.pressures).toEqual([]);
      expect(r.gate.enabled).toBe(true);
    }
  });

  it("drops rows without the data that makes them meaningful", () => {
    const r = normalizeRevamp({
      heroStats: [{ value: "", label: "Empty" }, { value: "111", label: "Appointments" }],
      howItRan: { roles: [{ role: "C-suite", count: null }, { role: "VP", count: 4 }] },
      progression: { quarters: [{ label: "Q1 2026", count: null }, { label: "Q2 2026", count: 0 }] },
      facts: [{ label: "Industry", value: "" }],
    });
    expect(r.heroStats).toEqual([{ value: "111", label: "Appointments" }]);
    expect(r.howItRan.roles).toEqual([{ role: "VP", count: 4 }]);
    expect(r.progression.quarters.map((q) => q.label)).toEqual(["Q2 2026"]);
    expect(r.facts).toEqual([]);
  });

  it("caps list lengths to what the layout shows", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ value: String(i + 1), label: `L${i}` }));
    const r = normalizeRevamp({ heroStats: many(6), facts: many(10).map((x) => ({ label: x.label, value: x.value })) });
    expect(r.heroStats).toHaveLength(4);
    expect(r.facts).toHaveLength(8);
  });

  it("strips a section label the source used as a heading prefix", () => {
    const r = normalizeRevamp({ situation: { heading: "The Situation: Pipeline had stalled" } });
    expect(r.situation.heading).toBe("Pipeline had stalled");
  });

  it("trims a trailing colon from item titles", () => {
    const r = normalizeRevamp({ howItRan: { steps: [{ title: "Build the list:", body: "Callbox built it." }] } });
    expect(r.howItRan.steps[0].title).toBe("Build the list");
  });
});

describe("toAcfPayload", () => {
  it("sends 'not logged' as null for channels and funnel, but keeps a real 0 for a period", () => {
    const r = sheet({
      channels: { rows: [{ name: "Calls", activity: "5,000 dials", appointments: 0 }] },
      funnel: { stages: [{ name: "Opportunity created", value: 0 }] },
      progression: { quarters: [{ label: "Q1 2026", count: 0 }] },
    });
    const acf = toAcfPayload(r);
    expect(acf.channels.rows[0].appointments).toBeNull();
    expect(acf.funnel.stages[0].value).toBeNull();
    expect(acf.progression.quarters[0].count).toBe(0);
  });

  it("leaves zero hero stats out", () => {
    const r = sheet({
      heroStats: [
        { value: "0", label: "Opportunities" },
        { value: "0%", label: "Show rate" },
        { value: "111", label: "Appointments" },
      ],
    });
    expect(toAcfPayload(r).hero_stats).toEqual([{ value: "111", label: "Appointments" }]);
  });

  it("uses the ACF field names and never sends drafter-only data", () => {
    const r = sheet({ internal: { leadSource: "found Callbox through search", extraFacts: [{ label: "List sources", value: "Client" }] } });
    const acf = toAcfPayload(r) as Record<string, unknown>;
    expect(acf.client_name).toBe("Netrix Global");
    expect(acf).toHaveProperty("primary_contact");
    expect(acf).not.toHaveProperty("internal");
    expect(acf).not.toHaveProperty("pdfTitle");
    expect(JSON.stringify(acf)).not.toContain("found Callbox through search");
  });
});

describe("mergeFacts", () => {
  it("orders imported facts and keeps the writer's facts after them", () => {
    const m = mergeFacts(
      [{ label: "Award", value: "Best MSP 2025" }, { label: "Industry", value: "Old" }],
      [{ label: "Headquarters", value: "Bannockburn, Illinois" }, { label: "industry", value: "IT services" }]
    );
    expect(m.facts.map((f) => f.label)).toEqual(["industry", "Headquarters", "Award"]);
    expect(m.facts[0].value).toBe("IT services");
  });

  it("never drops the writer's facts to make room", () => {
    const writer = Array.from({ length: MAX_FACTS - 1 }, (_, i) => ({ label: `Writer ${i}`, value: "x" }));
    const m = mergeFacts(writer, [
      { label: "Industry", value: "IT" },
      { label: "Headquarters", value: "US" },
      { label: "Market", value: "North America" },
    ]);
    expect(m.facts).toHaveLength(MAX_FACTS);
    expect(m.facts.filter((f) => f.label.startsWith("Writer"))).toHaveLength(MAX_FACTS - 1);
    expect(m.dropped).toEqual(["Headquarters", "Market"]);
  });

  it("keeps facts that don't fit for the drafter", () => {
    const r = sheet({ facts: Array.from({ length: MAX_FACTS }, (_, i) => ({ label: `Writer ${i}`, value: "x" })) });
    const dropped = applyImportedFacts(r, [{ label: "List sources", value: "Client-provided lists" }]);
    expect(dropped).toEqual(["List sources"]);
    expect(r.internal.extraFacts).toEqual([{ label: "List sources", value: "Client-provided lists" }]);
  });
});

describe("sectionNumbers", () => {
  it("hides empty sections and numbers the rest in order", () => {
    const r = sheet({
      situation: { heading: "Senior meetings were hard to book" },
      howItRan: { steps: [{ title: "Build the list", body: "Callbox built it." }] },
    });
    // No outcomes or recommendations yet; the funnel has 3 logged stages.
    expect(sectionNumbers(r)).toEqual({
      situation: 1,
      channels: 2,
      primaryContact: 3,
      howItRan: 4,
      progression: 5,
      funnel: 6,
    });
  });

  it("hides the funnel with fewer than 3 logged stages", () => {
    const r = sheet({ funnel: { stages: [{ name: "Set", value: 111 }, { name: "Held", value: 52 }, { name: "Opp", value: 0 }] } });
    expect(sectionNumbers(r).funnel).toBeUndefined();
  });

  it("hides the primary contact section without a role", () => {
    expect(sectionNumbers(sheet({ primaryContact: { role: "" } })).primaryContact).toBeUndefined();
  });
});
