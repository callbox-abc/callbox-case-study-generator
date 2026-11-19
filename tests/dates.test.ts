// Campaign start months, quarter windows and the weekly job cycle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFullQuarter, quarterWindows, startFromCampaignCode } from "@/lib/callboxone";
import { currentCycle, jobCycle, nextRefresh } from "@/lib/topClients";

const month = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : null);

describe("startFromCampaignCode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T04:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("reads YYMM + one sequence digit", () => {
    expect(month(startFromCampaignCode("NETRIX25071"))).toBe("2025-07");
  });

  it("reads YYMM + two sequence digits", () => {
    expect(month(startFromCampaignCode("ALPA260716"))).toBe("2026-07");
  });

  it("ignores a region suffix", () => {
    expect(month(startFromCampaignCode("IBMH26081-Indonesia"))).toBe("2026-08");
    expect(month(startFromCampaignCode("ACME25031-New Zealand"))).toBe("2025-03");
  });

  it("returns null for a month in the future", () => {
    expect(startFromCampaignCode("ACME27011")).toBeNull();
  });

  it("returns null when there is no plausible date", () => {
    expect(startFromCampaignCode("NETRIX")).toBeNull();
    expect(startFromCampaignCode("ACME25131")).toBeNull(); // month 13
    expect(startFromCampaignCode("ACME14051")).toBeNull(); // before 2015
    expect(startFromCampaignCode("")).toBeNull();
  });
});

describe("quarterWindows", () => {
  it("runs calendar quarters from the start month to today, the last one partial", () => {
    const w = quarterWindows(new Date(Date.UTC(2025, 6, 1)), new Date(Date.UTC(2026, 10, 19)));
    expect(w.map((x) => x.label)).toEqual(["Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026", "Oct–Nov 2026"]);
    expect(w[0]).toEqual({ label: "Q3 2025", from: "2025-07-01", to: "2025-09-30", partial: false });
    expect(w.at(-1)).toEqual({ label: "Oct–Nov 2026", from: "2026-10-01", to: "2026-11-19", partial: true });
  });

  it("labels a partial quarter in its first month by that month alone", () => {
    const w = quarterWindows(new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 15)));
    expect(w).toEqual([{ label: "Oct 2026", from: "2026-10-01", to: "2026-10-15", partial: true }]);
  });

  it("labels a mid-quarter launch by its months, not as a full quarter", () => {
    const w = quarterWindows(new Date(Date.UTC(2025, 7, 1)), new Date(Date.UTC(2026, 2, 31)));
    expect(w).toEqual([
      { label: "Aug–Sep 2025", from: "2025-08-01", to: "2025-09-30", partial: false },
      { label: "Q4 2025", from: "2025-10-01", to: "2025-12-31", partial: false },
      { label: "Q1 2026", from: "2026-01-01", to: "2026-03-31", partial: false },
    ]);
    const lastMonth = quarterWindows(new Date(Date.UTC(2025, 8, 1)), new Date(Date.UTC(2025, 11, 31)));
    expect(lastMonth[0].label).toBe("Sep 2025");
  });
});

describe("isFullQuarter", () => {
  it("is true only for a whole, finished calendar quarter", () => {
    expect(isFullQuarter({ label: "Q4 2025", from: "2025-10-01", to: "2025-12-31", partial: false })).toBe(true);
    expect(isFullQuarter({ label: "Q1 2024", from: "2024-01-01", to: "2024-03-31", partial: false })).toBe(true);
    expect(isFullQuarter({ label: "Aug–Sep 2025", from: "2025-08-01", to: "2025-09-30", partial: false })).toBe(false);
    expect(isFullQuarter({ label: "Oct–Nov 2026", from: "2026-10-01", to: "2026-11-19", partial: true })).toBe(false);
  });

  it("reads the dates, not the label", () => {
    expect(isFullQuarter({ label: "Q3 2025", from: "2025-08-01", to: "2025-09-30", partial: false })).toBe(false);
  });
});

describe("weekly job cycle (Mondays 08:00 PH = 00:00 UTC)", () => {
  it("belongs to the Monday of the current UTC week", () => {
    expect(currentCycle(new Date("2026-11-19T05:00:00Z"))).toBe("2026-11-16"); // Thursday
    expect(currentCycle(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23"); // Monday 08:00 PH
    expect(currentCycle(new Date("2026-11-22T23:59:00Z"))).toBe("2026-11-16"); // Sunday night UTC
  });

  it("counts a schedule run up to 30 minutes early as the new week", () => {
    expect(jobCycle(new Date("2026-11-22T23:45:00Z"))).toBe("2026-11-23");
    expect(jobCycle(new Date("2026-11-22T23:15:00Z"))).toBe("2026-11-16");
  });

  it("refreshes next Monday at 00:00 UTC", () => {
    expect(nextRefresh(new Date("2026-11-19T05:00:00Z")).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });
});
