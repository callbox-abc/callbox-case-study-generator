// The progression chart only compares whole quarters. A campaign that starts mid-quarter has a
// short launch period (e.g. Aug–Sep): it must not be the peak, the low point, or the base of an
// "up from" note or an "x times" insight.

import { describe, expect, it } from "vitest";
import { buildPatch, quarterWindows, sanitizeTotals } from "@/lib/callboxone";
import { allowedNumbers, narrativeInput } from "@/lib/narrative";
import { comparablePeriods, normalizeRevamp } from "@/lib/revamp";

const campaign = { clientId: 1, clientAccountId: 2, campaignName: "ACME25081", clientName: "Acme" };
const totals = (sql: number) => sanitizeTotals({ sql, voiceCalls: 500, sqlCalling: sql });

// Windows from a start month to a day, with the given appointments per window.
function progression(start: [number, number], today: [number, number, number], sql: number[]) {
  const windows = quarterWindows(new Date(Date.UTC(start[0], start[1] - 1, 1)), new Date(Date.UTC(today[0], today[1] - 1, today[2])));
  expect(windows).toHaveLength(sql.length);
  return buildPatch(campaign, windows, sql.map(totals), {}).patch.progression;
}

describe("buildPatch with a mid-quarter launch (Aug 2025)", () => {
  // Aug–Sep 2025: 6 (two months), Q4 2025: 25, Q1 2026: 30, Q2 2026: 20.
  const p = progression([2025, 8], [2026, 6, 30], [6, 25, 30, 20]);

  it("labels the launch period by its months", () => {
    expect(p.quarters.map((q) => q.label)).toEqual(["Aug–Sep 2025", "Q4 2025", "Q1 2026", "Q2 2026"]);
  });

  it("compares whole quarters only in the notes", () => {
    expect(p.quarters.map((q) => q.note)).toEqual([
      "Launch months, not a full quarter.",
      "First full quarter.", // not "Up from Aug–Sep 2025"
      "Peak quarter.",
      "Low point.", // 20 is the lowest whole quarter; the launch's 6 covers only two months
    ]);
  });

  it("never marks the launch period as the peak, even when it has the most appointments", () => {
    const q = progression([2025, 8], [2026, 3, 31], [40, 35, 30]).quarters;
    expect(q.map((x) => x.isPeak)).toEqual([false, true, false]);
  });

  it("keeps the short period out of the AI's peak vs low insight", () => {
    const sheet = normalizeRevamp({ progression: p });
    const insight = narrativeInput(sheet).insights.quarters as Record<string, unknown>;
    expect(insight).toMatchObject({ peakQuarter: "Q1 2026", peakCount: 30, lowQuarter: "Q2 2026", lowCount: 20, peakVsLowTimes: 1.5, fullQuarters: 3 });
    // 30 / 6 = 5 times would be the inflated claim; it is not pre-approved for the drafter.
    expect(allowedNumbers(sheet).baseRatio.has("5")).toBe(false);
  });
});

describe("buildPatch with a launch on a quarter's first month (unchanged)", () => {
  it("keeps the usual notes", () => {
    const p = progression([2025, 7], [2026, 3, 31], [10, 25, 18]);
    expect(p.quarters.map((q) => q.label)).toEqual(["Q3 2025", "Q4 2025", "Q1 2026"]);
    expect(p.quarters.map((q) => q.note)).toEqual(["Launch quarter.", "Peak quarter.", "Down from Q4 2025."]);
    expect(p.quarters.map((q) => q.isPeak)).toEqual([false, true, false]);
  });
});

describe("comparablePeriods", () => {
  const period = (label: string, count: number | null, isPartial = false) => ({ label, count, isPartial });

  it("leaves month-labeled periods out of a series of quarters", () => {
    const got = comparablePeriods([period("Aug–Sep 2025", 6), period("Q4 2025", 25), period("Q1 2026", 30), period("Oct–Nov 2026", 9, true)]);
    expect(got.map((p) => p.label)).toEqual(["Q4 2025", "Q1 2026"]);
  });

  it("compares a writer's own monthly series as is", () => {
    const got = comparablePeriods([period("Jan 2026", 4), period("Feb 2026", 7), period("Mar 2026", null)]);
    expect(got.map((p) => p.label)).toEqual(["Jan 2026", "Feb 2026"]);
  });
});
