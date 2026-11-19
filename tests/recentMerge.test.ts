// Merging the two entries an old key scheme made for one campaign (before and after HubSpot matched).

import { describe, expect, it } from "vitest";
import type { ClientCandidate } from "@/lib/hubspot";
import type { RecentClient, SavedSheet } from "@/lib/recentClients";
import { mergeRecentEntries, withCompany } from "@/lib/recentMerge";
import { sheet } from "./fixtures";

const company: ClientCandidate = {
  companyId: "1822151669",
  name: "Netrix Global",
  domain: "netrixllc.com",
  location: "Bannockburn, Illinois, United States",
  deals: 20,
  firstDeal: "2025-02",
};

const campaign = {
  clientId: 1,
  clientAccountId: 12345,
  campaignName: "NETRIX25071",
  clientName: "1Q26 Callbox - AI Readiness Accelerator",
  teamLeader: null,
  start: "2025-07",
  timezone: "America/Chicago",
};

const saved = (clientName: string, reviewed: boolean, savedAt: string): SavedSheet => ({
  data: sheet({ clientName }),
  reviewed,
  aiDrafted: [],
  savedAt,
});

function entry(over: Partial<RecentClient>): RecentClient {
  return {
    key: "recent:12345:x",
    name: "1Q26 Callbox - AI Readiness Accelerator",
    domain: "",
    campaign,
    company: null,
    stored: { hubspot: null, callboxone: null },
    importedAt: "2026-11-18T01:00:00Z",
    imports: 1,
    cmsDraft: null,
    sheet: null,
    ...over,
  };
}

describe("mergeRecentEntries", () => {
  it("takes the client details from the entry HubSpot matched", () => {
    const before = entry({ importedAt: "2026-11-19T01:00:00Z" }); // newer, but no company
    const after = entry({ company, name: "Netrix Global", domain: "netrixllc.com" });
    const m = mergeRecentEntries("recent:12345", [before, after]);
    expect(m.key).toBe("recent:12345");
    expect(m.name).toBe("Netrix Global");
    expect(m.domain).toBe("netrixllc.com");
    expect(m.company?.companyId).toBe("1822151669");
    expect(m.importedAt).toBe("2026-11-19T01:00:00Z");
    expect(m.imports).toBe(2);
  });

  it("keeps the newest CMS draft link", () => {
    const m = mergeRecentEntries("recent:12345", [
      entry({ cmsDraft: { id: 1, editLink: "old", at: "2026-11-18T00:00:00Z" } }),
      entry({ cmsDraft: { id: 2, editLink: "new", at: "2026-11-19T00:00:00Z" } }),
    ]);
    expect(m.cmsDraft?.id).toBe(2);
  });

  it("never keeps a sheet that names another client, even if it is reviewed and newer", () => {
    const m = mergeRecentEntries("recent:12345", [
      entry({ company, name: "Netrix Global", sheet: saved("Netrix Global", false, "2026-11-18T00:00:00Z") }),
      entry({ sheet: saved("Logitech", true, "2026-11-19T00:00:00Z") }),
    ]);
    expect(m.sheet?.data.clientName).toBe("Netrix Global");
  });

  it("prefers a reviewed sheet over a newer draft", () => {
    const m = mergeRecentEntries("recent:12345", [
      entry({ company, name: "Netrix Global", sheet: saved("Netrix Global", true, "2026-11-18T00:00:00Z") }),
      entry({ sheet: saved("Netrix Global", false, "2026-11-19T00:00:00Z") }),
    ]);
    expect(m.sheet?.reviewed).toBe(true);
  });

  it("refuses to merge nothing", () => {
    expect(() => mergeRecentEntries("recent:1", [])).toThrow();
  });
});

describe("withCompany", () => {
  it("adds the HubSpot company to an entry saved without one", () => {
    const e = withCompany(entry({}), company);
    expect(e.company?.companyId).toBe("1822151669");
    expect(e.name).toBe("Netrix Global");
    expect(e.domain).toBe("netrixllc.com");
  });

  it("never replaces a company the entry already has", () => {
    const other = { ...company, companyId: "1", name: "Someone Else" };
    const e = withCompany(entry({ company, name: "Netrix Global" }), other);
    expect(e.company?.companyId).toBe("1822151669");
    expect(e.name).toBe("Netrix Global");
  });
});
