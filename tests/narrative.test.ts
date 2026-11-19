// House style helpers and the merge of an AI draft into the sheet.

import { describe, expect, it } from "vitest";
import {
  applyDrafted,
  dropVague,
  matchItemCount,
  mergeNarrative,
  namesClient,
  pendingFields,
  plainWords,
  sentenceCase,
  titleCase,
  type Drops,
  type NarrativeDraft,
} from "@/lib/narrative";
import { sheet } from "./fixtures";

const drops = (): Drops => ({ n: 0, items: [] });

describe("plainWords", () => {
  it("says records were worked, not engaged", () => {
    expect(plainWords("Callbox successfully engaged 2,400 records.")).toBe("Callbox worked 2,400 records.");
    expect(plainWords("Reaching 2,400 prospect records took a quarter.")).toBe("Working 2,400 prospect records took a quarter.");
  });

  it("says appointments were set, not held", () => {
    expect(plainWords("Meetings held with IT leaders grew.")).toBe("Appointments with IT leaders grew.");
  });

  it("swaps filler verbs for plain ones", () => {
    expect(plainWords("The team utilized LinkedIn, leveraging email.")).toBe("The team used LinkedIn, using email.");
  });
});

describe("dropVague", () => {
  it("drops unsupported quality claims", () => {
    const d = drops();
    expect(dropVague("The program delivered high-quality leads. LinkedIn set 87.", d)).toBe("LinkedIn set 87.");
    expect(d.items?.[0].reason).toBe("unsupported quality claim");
  });

  it("drops share words used instead of the number, keeps them next to it", () => {
    const d = drops();
    expect(dropVague("The majority of appointments came from LinkedIn.", d)).toBe("");
    expect(d.items?.[0].reason).toBe("share word without the number");
    expect(dropVague("The majority of appointments, 87 of 111, came from LinkedIn.", drops())).toBe(
      "The majority of appointments, 87 of 111, came from LinkedIn."
    );
  });
});

describe("titleCase (headlines)", () => {
  it("matches the approved headline style", () => {
    expect(titleCase("how a US-based SaaS company built a qualified pipeline across north america in 9 months")).toBe(
      "How a US-Based SaaS Company Built a Qualified Pipeline Across North America in 9 Months"
    );
  });

  it("capitalizes a small word when it is first or last", () => {
    expect(titleCase("the pipeline we built on")).toBe("The Pipeline We Built On");
  });
});

describe("sentenceCase (section headings)", () => {
  it("lowercases ordinary words but keeps acronyms, mixed case, months and kept names", () => {
    expect(sentenceCase("Multi-Channel Engagement With LinkedIn In March", new Set())).toBe(
      "Multi-channel engagement with LinkedIn in March"
    );
    expect(sentenceCase("How Netrix Built IT Pipeline With Callbox", new Set(["netrix"]))).toBe(
      "How Netrix built IT pipeline with Callbox"
    );
  });
});

describe("namesClient", () => {
  it("catches the client's distinctive name", () => {
    expect(namesClient("Netrix Books 111 Appointments", "Netrix Global")).toBe(true);
  });

  it("ignores generic words in the client's name", () => {
    expect(namesClient("Global IT Provider Builds Pipeline", "Netrix Global")).toBe(false);
  });
});

describe("matchItemCount", () => {
  it("fixes the count to the items actually kept", () => {
    expect(matchItemCount("Callbox recommends three actions for the next phase.", 2)).toBe(
      "Callbox recommends two actions for the next phase."
    );
    expect(matchItemCount("Three priorities stand out.", 2)).toBe("Two priorities stand out.");
    expect(matchItemCount("It took several steps.", 1)).toBe("It took one step.");
  });

  it("leaves text alone when there are no items", () => {
    expect(matchItemCount("Callbox recommends three actions.", 0)).toBe("Callbox recommends three actions.");
  });
});

describe("mergeNarrative", () => {
  it("fills empty fields and never replaces the writer's text", () => {
    const r = sheet({ dek: "The writer's dek." });
    const { next, drafted } = mergeNarrative(r, { dek: "An AI dek.", subDek: "Over 18 months, LinkedIn set 87 appointments." });
    expect(next.dek).toBe("The writer's dek.");
    expect(next.subDek).toBe("Over 18 months, LinkedIn set 87 appointments.");
    expect(drafted).toContain("Sub-dek");
    expect(drafted).not.toContain("Dek");
  });

  it("does not change the sheet it was given", () => {
    const r = sheet();
    mergeNarrative(r, { dek: "LinkedIn set 87 appointments." });
    expect(r.dek).toBe("");
  });

  it("drops sentences with numbers that are not in the data, and counts them", () => {
    const { next, droppedSentences } = mergeNarrative(sheet(), {
      dek: "LinkedIn set 87 appointments. Email added 95 more.",
    });
    expect(next.dek).toBe("LinkedIn set 87 appointments.");
    expect(droppedSentences).toBe(1);
  });

  it("rejects a headline that names the client and uses the backup", () => {
    const { next, droppedDetails } = mergeNarrative(sheet(), {
      headline: "Netrix Global Books 111 Qualified Appointments",
      headlineBackup: "US-Based Cybersecurity Provider Builds Qualified Pipeline With LinkedIn and Email",
    });
    expect(next.headline).toBe("US-Based Cybersecurity Provider Builds Qualified Pipeline With LinkedIn and Email");
    expect(droppedDetails.map((d) => d.reason)).toContain("names the client");
  });

  it("rejects a headline that credits every appointment to one channel", () => {
    // LinkedIn set 87; the 111 total includes Email's 24.
    const { next, droppedDetails } = mergeNarrative(sheet(), {
      headline: "IT Provider Books 111 Appointments Through LinkedIn",
      headlineBackup: "IT Provider Builds Qualified Pipeline Across North America",
    });
    expect(next.headline).toBe("IT Provider Builds Qualified Pipeline Across North America");
    expect(droppedDetails.map((d) => d.reason)).toContain("credits all appointments to LinkedIn");
  });

  it("leaves the headline empty when both candidates fail", () => {
    const { next } = mergeNarrative(sheet(), {
      headline: "Netrix Books 111 Appointments",
      headlineBackup: "Netrix Builds Pipeline",
    });
    expect(next.headline).toBe("");
  });

  it("swaps a generic section heading for the specific backup", () => {
    const { next } = mergeNarrative(sheet(), {
      situation: { heading: "Overview", body: ["LinkedIn set 87 appointments."] },
      headingBackups: { situation: "Senior IT Meetings Were Hard to Book" },
    });
    expect(next.situation.heading).toBe("Senior IT meetings were hard to book");
  });

  it("drafts nothing in the primary contact section without a role", () => {
    const r = sheet({ primaryContact: { role: "" } });
    const draft: NarrativeDraft = {
      primaryContact: { heading: "A marketing leader with a target", intro: "The buyer owned pipeline." },
    };
    const { next, drafted } = mergeNarrative(r, draft);
    expect(next.primaryContact.heading).toBe("");
    expect(next.primaryContact.intro).toBe("");
    expect(drafted.some((d) => d.startsWith("Contact"))).toBe(false);
  });

  it("drafts the primary contact section once a role is on the sheet", () => {
    const { next } = mergeNarrative(sheet(), {
      primaryContact: { heading: "A marketing leader with a pipeline target", intro: "The buyer owned pipeline." },
    });
    expect(next.primaryContact.heading).toBe("A marketing leader with a pipeline target");
    expect(next.primaryContact.intro).toBe("The buyer owned pipeline.");
  });

  it("drops a recommendation that fails the checks and fixes the intro's count", () => {
    const { next } = mergeNarrative(sheet(), {
      whereNext: {
        heading: "Where the program can grow",
        intro: "Callbox recommends three moves.",
        recommendations: [
          { title: "Follow up first meetings", body: "59 appointments have no confirmed first meeting." },
          { title: "Widen the email list", body: "Email set 24 appointments." },
          { title: "Add budget", body: "This would add $500,000 in pipeline." },
        ],
      },
    });
    expect(next.whereNext.recommendations.map((x) => x.title)).toEqual(["Follow up first meetings", "Widen the email list"]);
    expect(next.whereNext.intro).toBe("Callbox recommends two moves.");
    expect(next.whereNext.footnote).toMatch(/Callbox recommendation/);
  });

  it("trims quarter notes that only restate the count", () => {
    const { next, drafted } = mergeNarrative(sheet(), {
      progression: {
        quarterNotes: [
          { label: "Q4 2025", note: "Peak quarter, with 35 appointments" },
          { label: "Q1 2026", note: "35 appointments." },
        ],
      },
    });
    const note = (label: string) => next.progression.quarters.find((q) => q.label === label)?.note;
    expect(note("Q4 2025")).toBe("Peak quarter");
    expect(note("Q1 2026")).toBe("");
    expect(drafted).toContain("Quarter notes");
  });
});

describe("pendingFields and applyDrafted", () => {
  it("only lists fields the AI is allowed to draft", () => {
    const withRole = pendingFields(sheet());
    expect(withRole.has("headline")).toBe(true);
    expect(withRole.has("primaryContact.heading")).toBe(true);

    const noRole = pendingFields(sheet({ primaryContact: { role: "" } }));
    expect(noRole.has("primaryContact.heading")).toBe(false);

    const noFunnel = pendingFields(sheet({ funnel: { stages: [] } }));
    expect(noFunnel.has("funnel.heading")).toBe(false);
  });

  it("never overwrites a field the writer filled while the AI was drafting", () => {
    const before = sheet();
    const keys = pendingFields(before);
    const drafted = sheet({ headline: "AI Headline", dek: "AI dek." });
    const current = sheet({ headline: "The Writer's Headline" }); // typed during the draft
    const next = applyDrafted(current, drafted, keys);
    expect(next.headline).toBe("The Writer's Headline");
    expect(next.dek).toBe("AI dek.");
  });
});
