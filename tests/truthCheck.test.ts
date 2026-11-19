// "Verifying truth data": numbers in the sheet's text are checked against the data, and CallboxOne
// (the data) wins. The fixture's Email row says "117,570 emails delivered", as CallboxOne does for
// Netrix; a draft claimed 1,622.

import { describe, expect, it } from "vitest";
import { allowedNumbers, mergeNarrative } from "@/lib/narrative";
import { findUnbackedNumbers, findingKey, removeFindings } from "@/lib/truthCheck";
import { sheet } from "./fixtures";

describe("findUnbackedNumbers", () => {
  it("flags a draft's number that CallboxOne doesn't have (Netrix: 1,622 vs 117,570)", () => {
    const f = findUnbackedNumbers(sheet({ dek: "Callbox delivered 1,622 emails. LinkedIn set 87 of the 111 appointments." }));
    expect(f).toEqual([{ path: "dek", label: "Dek", sentence: "Callbox delivered 1,622 emails.", numbers: ["1,622"] }]);
  });

  it("passes numbers the data backs", () => {
    const r = sheet({
      dek: "Email delivered 117,570 messages across 4 channels.",
      subDek: "Email set 24 of 111 appointments, 22% of the total. LinkedIn drove 78% of tracked appointments.",
      situation: { body: ["The peak quarter produced 1.8 times the lowest."] },
    });
    expect(findUnbackedNumbers(r)).toEqual([]);
  });

  it("uses the guard's rules: a percentage needs its source numbers", () => {
    const f = findUnbackedNumbers(sheet({ dek: "Email drove 22% of appointments." }));
    expect(f.map((x) => x.numbers)).toEqual([["22%"]]);
  });

  it("names where each sentence is", () => {
    const r = sheet({
      situation: { body: ["Fine paragraph.", "Netrix ran 3 SDRs and 2,000 calls a week."] },
      whereNext: { recommendations: [{ title: "Grow email", body: "Send 6,500 more emails." }] },
    });
    expect(findUnbackedNumbers(r).map((x) => [x.path, x.label, x.numbers])).toEqual([
      ["situation.body.1", "Situation text, paragraph 2", ["2,000"]],
      ["whereNext.recommendations.0.body", "Recommendation 1", ["6,500"]],
    ]);
  });

  it("treats the data itself (facts, rows) as the truth, not as text to check", () => {
    const r = sheet({ facts: [{ label: "Team size", value: "40 people" }], dek: "A 40-person IT team ran the program." });
    expect(findUnbackedNumbers(r)).toEqual([]);
  });

  it("finds nothing on a sheet without text", () => {
    expect(findUnbackedNumbers(sheet())).toEqual([]);
  });
});

describe("removeFindings", () => {
  const removeAll = (r: ReturnType<typeof sheet>) => removeFindings(r, findUnbackedNumbers(r));

  it("removes only the flagged sentence", () => {
    const r = sheet({ dek: "Callbox delivered 1,622 emails. LinkedIn set 87 of the 111 appointments." });
    expect(removeAll(r).dek).toBe("LinkedIn set 87 of the 111 appointments.");
  });

  it("empties a field made only of flagged sentences, and does not change the sheet passed in", () => {
    const r = sheet({ dek: "Callbox delivered 1,622 emails." });
    expect(removeAll(r).dek).toBe("");
    expect(r.dek).toBe("Callbox delivered 1,622 emails.");
  });

  it("drops emptied paragraphs and outcomes, even several in one go", () => {
    const r = sheet({
      situation: { body: ["Netrix sent 1,622 emails.", "Kept paragraph.", "And 3,300 calls."] },
      whatChanged: { outcomes: ["Pipeline grew to 950 contacts.", "LinkedIn set 87 appointments."] },
    });
    const next = removeAll(r);
    expect(next.situation.body).toEqual(["Kept paragraph."]);
    expect(next.whatChanged.outcomes).toEqual(["LinkedIn set 87 appointments."]);
  });

  it("drops an item only when its title and text are both empty", () => {
    const r = sheet({
      whereNext: {
        recommendations: [
          { title: "Grow email", body: "Send 6,500 more emails." },
          { title: "Add 9,000 contacts", body: "Widen the list to 9,000." },
        ],
      },
    });
    expect(removeAll(r).whereNext.recommendations).toEqual([{ title: "Grow email", body: "" }]);
  });

  it("keeps a period whose note was emptied", () => {
    const r = sheet();
    r.progression.quarters[1].note = "Best quarter after 3,000 dials.";
    const next = removeAll(r);
    expect(next.progression.quarters).toHaveLength(r.progression.quarters.length);
    expect(next.progression.quarters[1].note).toBe("");
  });

  it("clears the highlight of an emptied headline", () => {
    const r = sheet({ headline: "Provider Sends 1,622 Emails", headlineHighlight: "1,622 Emails" });
    const next = removeAll(r);
    expect(next.headline).toBe("");
    expect(next.headlineHighlight).toBe("");
  });

  it("keys a finding by field and sentence", () => {
    const [f] = findUnbackedNumbers(sheet({ dek: "Callbox delivered 1,622 emails." }));
    expect(findingKey(f)).toBe("dek|Callbox delivered 1,622 emails.");
  });
});

describe("the AI guard only trusts the data", () => {
  it("does not take numbers from the sheet's own text", () => {
    const r = sheet({ dek: "Netrix has a 540-person IT team." });
    expect(allowedNumbers(r).base.has("540")).toBe(false);
  });

  it("drops an AI sentence repeating a number that is only in the writer's text", () => {
    const r = sheet({ dek: "Callbox delivered 1,622 emails." });
    const { next } = mergeNarrative(r, { subDek: "After 1,622 emails, LinkedIn set 87 appointments." });
    expect(next.subDek).toBe("");
  });
});
