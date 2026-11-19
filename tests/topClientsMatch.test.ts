// The weekly "most active clients" job links a campaign to a HubSpot company only when certain;
// uncertain facts are left for the team to fill rather than guessed.

import { describe, expect, it } from "vitest";
import type { ClientCandidate } from "@/lib/hubspot";
import { chooseCompany, pickKey } from "@/lib/topClients";

const co = (companyId: string, name: string, location: string, deals: number): ClientCandidate => ({
  companyId,
  name,
  domain: "",
  location,
  deals,
  firstDeal: null,
});

describe("chooseCompany", () => {
  it("links the only company with deals", () => {
    const netrix = co("1822151669", "Netrix Global", "Bannockburn, Illinois, United States", 20);
    expect(chooseCompany([netrix], "Netrix")).toEqual({ company: netrix, ambiguous: false, name: "Netrix Global" });
  });

  it("links nothing when nothing matches", () => {
    expect(chooseCompany([], "Internal Campaign")).toEqual({ company: null, ambiguous: false, name: "Internal Campaign" });
  });

  it("does not guess between a client's offices with the same name (Brazil and Korea)", () => {
    // The search lists the most deals first: Brazil would have been taken for the Korea campaign.
    const found = [co("1", "Company 1", "São Paulo, Brazil", 12), co("2", "Company 1", "Seoul, South Korea", 4)];
    expect(chooseCompany(found, "Company 1")).toEqual({ company: null, ambiguous: true, name: "Company 1" });
  });

  it("links the one named exactly like the client among several", () => {
    const global = co("10", "LG Electronics", "Seoul, South Korea", 3);
    const au = co("11", "LG Electronics Australia", "Sydney, Australia", 6);
    expect(chooseCompany([au, global], "LG Electronics").company).toBe(global);
    expect(chooseCompany([au, global], "lg electronics.").company).toBe(global); // case and punctuation don't matter
  });

  it("links nothing when several match and none is named exactly like the client", () => {
    const found = [co("11", "LG Electronics Australia", "Sydney, Australia", 6), co("10", "LG Electronics", "Seoul, South Korea", 3)];
    expect(chooseCompany(found, "LGEA")).toEqual({ company: null, ambiguous: true, name: "LGEA" });
  });
});

describe("pickKey (one card per company, or per campaign when none is linked)", () => {
  it("keeps several campaigns on one HubSpot record as one card", () => {
    const netrix = co("1822151669", "Netrix Global", "", 20);
    expect(pickKey({ clientAccountId: 1 }, netrix)).toBe(pickKey({ clientAccountId: 2 }, netrix));
  });

  it("keeps campaigns with no linked company apart, since campaign ids are unique", () => {
    expect(pickKey({ clientAccountId: 1 }, null)).not.toBe(pickKey({ clientAccountId: 2 }, null));
  });
});
