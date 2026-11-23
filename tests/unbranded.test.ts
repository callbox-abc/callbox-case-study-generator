// Unbranded case studies (lib/unbranded.ts): the campaign's numbers only, no real client details in
// the sheet, the AI's input, the CMS payload or the copied text. The client below is fictional, shaped
// like a real draft whose "B2B Company..." headline still carried the name, the HQ, the company
// size, the campaign code and a contact title naming the client's product line.

import { describe, expect, it } from "vitest";
import { mergeNarrative, narrativeInput, pendingFields } from "@/lib/narrative";
import { isSectionVisible, revampPlainText, sectionNumbers, toAcfPayload } from "@/lib/revamp";
import {
  exportable,
  findIdentityLeaks,
  identityTerms,
  stripClientDetails,
  unbrandedCampaignPatch,
  unbrandedView,
  withoutCampaignCode,
} from "@/lib/unbranded";
import { removeFindings } from "@/lib/truthCheck";
import { sheet } from "./fixtures";

const OV_METHOD =
  "Figures are drawn from the CallboxOne campaign record for OV24071 since July 2024; the campaign was still running when they were pulled.";

const ov = (overrides: Record<string, unknown> = {}) =>
  sheet({
    unbranded: true,
    clientName: "Orvia Displays Australia Pty Ltd",
    solutionLines: "Signage & kiosk solutions",
    country: "Australia",
    facts: [
      { label: "Industry", value: "Information technology and services" },
      { label: "Headquarters", value: "Northmead NSW, Australia" },
      { label: "Company size", value: "10,000+ employees" },
      { label: "Client since", value: "June 2024" },
      { label: "Program growth", value: "2 seats" },
      { label: "Period measured", value: "July 2024 to present (ongoing), 29 months so far" },
      { label: "Market", value: "Philippines" },
      { label: "Channels worked", value: "Voice, LinkedIn, Email" },
    ],
    primaryContact: {
      role: "Regional Marketing Lead Asia (Signage & kiosk solutions)",
      eyebrow: "Callbox works with",
      intro: "The buyer came inbound via a search ad.",
    },
    whatChanged: { outcomes: ["503 appointments so far."], quote: { text: "Great partner.", name: "Jane Doe", title: "Marketing Lead" } },
    methodologyNote: OV_METHOD,
    internal: { leadSource: "Paid search", extraFacts: [{ label: "List sources", value: "4 webinar audiences" }, { label: "Program growth", value: "2 seats" }] },
    ...overrides,
  });

const OV_SOURCE = {
  client: { name: "Orvia Displays Australia", domain: "orvia.com", location: "Northmead, Australia" },
  campaign: { campaignName: "OV24071", clientName: "Orvia Displays Australia" },
  stored: { hubspot: { company: { name: "Orvia Displays Australia Pty Ltd", domain: "orvia.com" }, facts: [{ label: "Headquarters", value: "Northmead NSW, Australia" }] } },
};

describe("stripClientDetails", () => {
  it("removes every client detail and keeps the campaign's", () => {
    const d = stripClientDetails(ov());
    expect([d.clientName, d.solutionLines, d.country]).toEqual(["", "", ""]);
    expect(d.facts.map((f) => f.label)).toEqual(["Period measured", "Market", "Channels worked"]);
    expect(d.primaryContact.role).toBe("");
    expect(d.primaryContact.intro).toBe("");
    expect(d.whatChanged.quote).toEqual({ text: "", name: "", title: "" });
    expect(d.whatChanged.outcomes).toEqual(["503 appointments so far."]);
    expect(d.internal).toEqual({ leadSource: "", extraFacts: [{ label: "List sources", value: "4 webinar audiences" }] });
    expect(d.methodologyNote).not.toContain("OV24071");
    expect(d.heroStats).toEqual(ov().heroStats);
  });

  it("does not change the sheet passed in", () => {
    const r = ov();
    stripClientDetails(r);
    expect(r.clientName).toBe("Orvia Displays Australia Pty Ltd");
  });

  it("keeps facts the writer added under other labels (the identity check reads them)", () => {
    const d = stripClientDetails(ov({ facts: [{ label: "Sector", value: "IT" }] }));
    expect(d.facts).toEqual([{ label: "Sector", value: "IT" }]);
  });
});

describe("withoutCampaignCode", () => {
  it("drops the code from the import's methodology note, ongoing or ended", () => {
    expect(withoutCampaignCode(OV_METHOD)).toBe(
      "Figures are drawn from the CallboxOne campaign record since July 2024; the campaign was still running when they were pulled."
    );
    expect(withoutCampaignCode("Figures are drawn from the CallboxOne campaign record for ACME25071-AU between July 2025 and June 2026.")).toBe(
      "Figures are drawn from the CallboxOne campaign record between July 2025 and June 2026."
    );
  });
});

describe("unbrandedCampaignPatch", () => {
  it("keeps only campaign facts and drops the campaign code", () => {
    const p = unbrandedCampaignPatch({
      facts: [
        { label: "Period measured", value: "29 months" },
        { label: "Industry", value: "IT" },
        { label: "Lists worked", value: "11 lists, 19,597 prospect records" },
      ],
      methodologyNote: OV_METHOD,
      heroStats: [{ value: "503", label: "Appointments" }],
    });
    expect(p.facts.map((f) => f.label)).toEqual(["Period measured", "Lists worked"]);
    expect(p.methodologyNote).not.toContain("OV24071");
    expect(p.heroStats).toEqual([{ value: "503", label: "Appointments" }]);
  });
});

describe("what leaves the editor", () => {
  it("the AI's input has no client detail and says the case study is unbranded", () => {
    const input = JSON.stringify(narrativeInput(ov()));
    for (const w of ["Orvia", "Northmead", "10,000", "June 2024", "2 seats", "Signage", "search ad", "Paid search", "Jane"]) {
      expect(input).not.toContain(w);
    }
    expect(narrativeInput(ov()).unbranded).toBe(true);
    expect(input).toContain("Philippines");
  });

  it("a branded sheet's AI input is unchanged", () => {
    const input = narrativeInput(sheet());
    expect(input.unbranded).toBeUndefined();
    expect(input.existingText.clientName).toBe("Netrix Global");
  });

  it("the CMS payload and the copied text have no client detail", () => {
    const acf = JSON.stringify(toAcfPayload(ov()));
    const text = revampPlainText(ov());
    for (const out of [acf, text]) {
      for (const w of ["Orvia", "Northmead", "10,000", "Signage", "Regional Marketing Lead", "Jane"]) expect(out).not.toContain(w);
    }
    expect(JSON.parse(acf).client_name).toBe("");
  });

  it("exportable leaves a branded sheet as it is", () => {
    const r = sheet();
    expect(exportable(r)).toBe(r);
  });
});

describe("the sheet", () => {
  it("never shows the primary contact section, so the rest are renumbered", () => {
    const r = ov({ situation: { heading: "Reaching B2B buyers" }, howItRan: { steps: [{ title: "Voice", body: "Calls." }] } });
    expect(isSectionVisible(r, "primaryContact")).toBe(false);
    expect(sectionNumbers(r)).toEqual({ situation: 1, channels: 2, howItRan: 3, progression: 4, funnel: 5, whatChanged: 6 });
    expect(sectionNumbers({ ...r, unbranded: false }).primaryContact).toBe(3); // the same sheet, branded
  });

  it("the AI never drafts the contact section of an unbranded sheet", () => {
    const r = ov();
    expect([...pendingFields(r)].some((k) => k.startsWith("primaryContact"))).toBe(false);
    const { next } = mergeNarrative(r, { primaryContact: { heading: "The buyer", intro: "A marketing lead." } });
    expect(next.primaryContact.heading).toBe("");
  });
});

describe("identity check", () => {
  const terms = identityTerms(OV_SOURCE, stripClientDetails(ov()));

  it("collects the words that name the client", () => {
    const t = terms.map((x) => x.term);
    expect(t).toEqual(expect.arrayContaining(["orvia", "displays", "australia", "OV24071", "OV", "northmead", "nsw"]));
    // Legal forms and words any case study uses are never terms.
    for (const w of ["pty", "ltd", "callbox", "com"]) expect(t).not.toContain(w);
  });

  it("finds the client in any text on the sheet, facts and methodology included", () => {
    const r = stripClientDetails(
      ov({
        dek: "Orvia booked 503 appointments. The program ran in the Philippines.",
        facts: [{ label: "Sector", value: "Digital displays" }, { label: "Market", value: "Philippines" }],
        methodologyNote: "Figures for OV24071.",
      })
    );
    const f = findIdentityLeaks(r, identityTerms(OV_SOURCE, r));
    expect(f.map((x) => [x.path, x.terms])).toEqual([
      ["dek", ["Orvia"]],
      ["facts.0.value", ["displays"]],
      ["methodologyNote", ["OV24071"]],
    ]);
    expect(f[0].sentence).toBe("Orvia booked 503 appointments.");
  });

  it("two-letter code letters match only as a capitalized word", () => {
    const r = stripClientDetails(ov({ dek: "Overall, calls were logged by the team." }));
    expect(findIdentityLeaks(r, terms)).toEqual([]);
  });

  it("never flags the campaign's own market, even when the client is named after it", () => {
    const src = { client: { name: "Philippines Telecom Group" }, campaign: null, stored: null };
    const r = stripClientDetails(ov({ dek: "The program reached buyers in the Philippines." }));
    expect(identityTerms(src, r).map((x) => x.term)).toEqual(["telecom"]);
    expect(findIdentityLeaks(r, identityTerms(src, r))).toEqual([]);
  });

  it("a removed finding takes only its sentence out", () => {
    const r = stripClientDetails(ov({ dek: "Orvia booked 503 appointments. The program ran in the Philippines." }));
    const next = removeFindings(r, findIdentityLeaks(r, terms));
    expect(next.dek).toBe("The program ran in the Philippines.");
  });

  it("an HQ country is a phrase: 'United States' is flagged, 'states' alone is not", () => {
    const src = { client: null, campaign: null, stored: { hubspot: { facts: [{ label: "Headquarters", value: "Austin, Texas, United States" }] } } };
    const r = stripClientDetails(ov({ dek: "The data states 64 appointments. The client is in the United States." }));
    const t = identityTerms(src, r);
    expect(t.map((x) => x.term)).toEqual(["austin", "texas", "united states"]);
    expect(findIdentityLeaks(r, t).map((f) => f.terms)).toEqual([["United States"]]);
  });

  it("an HQ country that is also the campaign's market is not a client detail", () => {
    const src = { client: null, campaign: null, stored: { hubspot: { facts: [{ label: "Headquarters", value: "Makati, Philippines" }] } } };
    expect(identityTerms(src, stripClientDetails(ov())).map((x) => x.term)).toEqual(["makati"]);
  });

  it("no import, no terms", () => {
    expect(identityTerms(null, ov())).toEqual([]);
  });
});

describe("unbrandedView", () => {
  it("shows an unbranded session the client's unbranded sheet and CMS draft", () => {
    const entry = { sheet: { a: 1 }, cmsDraft: { id: 1 }, unbrandedSheet: { b: 2 }, unbrandedCmsDraft: null };
    expect(unbrandedView(entry)).toMatchObject({ sheet: { b: 2 }, cmsDraft: null });
    expect(unbrandedView({ sheet: { a: 1 }, cmsDraft: { id: 1 } })).toMatchObject({ sheet: null, cmsDraft: null });
  });
});
