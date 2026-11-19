// Saved sheets must belong to the client they are stored under, and each campaign has one entry.

import { describe, expect, it } from "vitest";
import { codeLetters, sheetMatchesClient } from "@/lib/clientMatch";
import { canonicalRecentKey, isLegacyRecentKey, recentKey } from "@/lib/recentKey";

describe("sheetMatchesClient", () => {
  it("refuses a sheet that names another client (Logitech header saved over Derevo)", () => {
    expect(sheetMatchesClient("Logitech", ["Derevo", "derevo.com.mx", "DEREVO"])).toBe(false);
  });

  it("accepts the client's own sheet across HubSpot, CallboxOne and campaign-code names", () => {
    expect(sheetMatchesClient("Netrix Global", ["Netrix LLC", "1Q26 Callbox - AI Readiness Accelerator", "NETRIX"])).toBe(true);
  });

  it("matches on a shared prefix, so a longer or shorter name still counts", () => {
    expect(sheetMatchesClient("LG Electronics Australia", ["LG Electronics"])).toBe(true);
    expect(sheetMatchesClient("Netrix", ["NETRG Netrixglobal"])).toBe(true);
  });

  it("does not match on generic words alone", () => {
    expect(sheetMatchesClient("Acme Global Solutions", ["Derevo Global Solutions"])).toBe(false);
  });

  it("accepts when there is nothing to compare", () => {
    expect(sheetMatchesClient("", ["Derevo"])).toBe(true);
    expect(sheetMatchesClient("Derevo", [null, undefined, ""])).toBe(true);
    expect(sheetMatchesClient("Global Solutions Inc", ["Derevo"])).toBe(true);
  });
});

describe("codeLetters", () => {
  it("reads the letters at the start of a campaign code", () => {
    expect(codeLetters("NETRIX25071")).toBe("NETRIX");
    expect(codeLetters("IBMH26081-Indonesia")).toBe("IBMH");
    expect(codeLetters(null)).toBe("");
    expect(codeLetters("25071")).toBe("");
  });
});

describe("recent entry keys", () => {
  it("keys an entry by campaign, whether or not HubSpot matched it", () => {
    expect(recentKey(12345, "999")).toBe("recent:12345");
    expect(recentKey(12345, null)).toBe("recent:12345");
  });

  it("keys a HubSpot-only import by company", () => {
    expect(recentKey(null, "999")).toBe("recent:-:999");
    expect(recentKey(null, null)).toBe("recent:-:-");
  });

  it("recognizes the old campaign + company keys and maps them to the campaign key", () => {
    expect(isLegacyRecentKey("recent:12345:999")).toBe(true);
    expect(isLegacyRecentKey("recent:12345:")).toBe(true);
    expect(isLegacyRecentKey("recent:12345")).toBe(false);
    expect(isLegacyRecentKey("recent:-:999")).toBe(false);
    expect(canonicalRecentKey("recent:12345:999")).toBe("recent:12345");
    expect(canonicalRecentKey("recent:-:999")).toBe("recent:-:999");
  });
});
