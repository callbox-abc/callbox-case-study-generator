// Facts derived from HubSpot: seats and services from deal names, solution line, job titles.

import { describe, expect, it } from "vitest";
import { seniorityOf } from "@/lib/callboxone";
import { groundSolutionLines, headquarters, normalizeCountry, normalizeJobTitle, relationshipFrom, seatsInDealName } from "@/lib/hubspot";

describe("seatsInDealName", () => {
  it("reads an explicit seat count", () => {
    expect(seatsInDealName("Netrix - 6 Seats Renewal")).toBe(6);
    expect(seatsInDealName("Netrix 1 seat pilot")).toBe(1);
  });

  it("reads an ordinal seat", () => {
    expect(seatsInDealName("7th Additional Seat")).toBe(7);
    expect(seatsInDealName("2nd seat renewal")).toBe(2);
    expect(seatsInDealName("3rd Addtl. Seat")).toBe(3);
  });

  it("ignores numbers that say nothing about seats", () => {
    expect(seatsInDealName("3 months extension")).toBeNull();
    expect(seatsInDealName("Addtl Seat")).toBeNull();
  });
});

describe("relationshipFrom", () => {
  const d = (name: string, iso: string) => ({ name, closed: new Date(iso) });

  it("derives client since, seat growth and services from won deals in any order", () => {
    const r = relationshipFrom([
      d("Netrix AEO add-on", "2026-01-15T00:00:00Z"),
      d("Netrix - 3 Seats", "2025-02-10T00:00:00Z"),
      d("Netrix 4 seats renewal", "2026-06-01T00:00:00Z"),
      d("Netrix - 5 Seats + SEO", "2025-08-01T00:00:00Z"),
    ]);
    expect(r).not.toBeNull();
    expect(r!.clientSince).toBe("February 2025");
    expect(r!.firstWon).toBe("2025-02");
    expect(r!.seats).toEqual({ first: 3, peak: 5, latest: 4 });
    expect(r!.services).toEqual(["SEO/AEO"]);
    expect(r!.wonDeals).toBe(4);
    expect(r!.months).toBe(17);
  });

  it("reports no seats when no deal names a seat count", () => {
    expect(relationshipFrom([d("Inbound marketing retainer", "2025-03-01T00:00:00Z")])!.seats).toBeNull();
  });

  it("returns null without deals", () => {
    expect(relationshipFrom([])).toBeNull();
  });
});

describe("groundSolutionLines", () => {
  const desc = "Netrix is an IT consultancy delivering cybersecurity, managed services and cloud solutions.";

  it("keeps the first line grounded in the description, without puffery", () => {
    expect(groundSolutionLines(["Award-winning Cybersecurity", "Managed services"], desc)).toBe("Cybersecurity");
  });

  it("accepts a word that shares a stem with the description", () => {
    expect(groundSolutionLines(["Consulting"], desc)).toBe("Consulting");
  });

  it("keeps acronyms as written", () => {
    expect(groundSolutionLines(["IT consulting"], desc)).toBe("IT consulting");
  });

  it("rejects lines the description does not support, and generic words alone", () => {
    expect(groundSolutionLines(["Blockchain"], desc)).toBe("");
    expect(groundSolutionLines(["Solutions"], desc)).toBe("");
  });

  it("can return more than one line when asked", () => {
    expect(groundSolutionLines(["Cybersecurity", "Cloud", "Payroll"], desc, 3)).toBe("Cybersecurity, cloud");
  });
});

describe("normalizeJobTitle", () => {
  it("expands abbreviations", () => {
    expect(normalizeJobTitle("Sr. Dir. of Mktg")).toBe("Senior Director of Marketing");
    expect(normalizeJobTitle("  IT   Ops Mgr ")).toBe("IT Operations Manager");
  });
});

describe("normalizeCountry", () => {
  it("maps codes and aliases to full names", () => {
    expect(normalizeCountry("US")).toBe("United States");
    expect(normalizeCountry("u.s.a.")).toBe("United States");
    expect(normalizeCountry("uk")).toBe("United Kingdom");
    expect(normalizeCountry("Mexico")).toBe("Mexico");
    expect(normalizeCountry(null)).toBe("");
  });
});

describe("seniorityOf (appointment job titles)", () => {
  it("groups titles by seniority", () => {
    expect(seniorityOf("Chief Information Officer")).toBe("lvlCsuite");
    expect(seniorityOf("CIO")).toBe("lvlCsuite");
    expect(seniorityOf("President")).toBe("lvlCsuite");
    expect(seniorityOf("Vice President of IT")).toBe("lvlVp");
    expect(seniorityOf("Head of IT")).toBe("lvlDirector");
    expect(seniorityOf("Senior Director of Marketing")).toBe("lvlDirector");
    expect(seniorityOf("IT Manager")).toBe("lvlManager");
    expect(seniorityOf("Network Engineer")).toBe("lvlSpecialist");
    expect(seniorityOf("Receptionist")).toBe("lvlOther");
  });

  it("does not read 'Office of the CEO' as a CEO", () => {
    expect(seniorityOf("Office of the CEO Assistant")).toBe("lvlOther");
  });
});

// HubSpot records often repeat a place across city, state and country (seen on live records:
// "..., Australia, Australia" and "Singapore, Singapore, Singapore").
describe("headquarters", () => {
  it("writes each part once", () => {
    expect(headquarters({ city: "Sydney", state: "NSW, Australia", country: "Australia" })).toBe("Sydney, NSW, Australia");
    expect(headquarters({ city: "Singapore", state: "Singapore", country: "SG" })).toBe("Singapore");
  });

  it("spells out US states and country codes", () => {
    expect(headquarters({ city: "Austin", state: "TX", country: "USA" })).toBe("Austin, Texas, United States");
    expect(headquarters({ city: "Seoul", country: "KR" })).toBe("Seoul, South Korea");
  });

  it("is empty when nothing is on record", () => {
    expect(headquarters({})).toBe("");
  });
});
