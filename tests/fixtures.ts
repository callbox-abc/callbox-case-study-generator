// A Netrix-shaped sheet with realistic numbers, used across the tests.
//   Channels: LinkedIn 87 + Email 24 = 111 tracked appointments, Calls untracked.
//   Roles: 20 C-suite + 50 Director + 30 Manager = 100 with a title (70 director-level and above).
//   Quarters: 20, 35 (peak), 30, then 6 in the current, partial period.
//   Funnel: 111 set, 52 first meetings held, 12 opportunities.

import { normalizeRevamp, type RevampCaseStudy } from "@/lib/revamp";

export function sheet(overrides: Record<string, unknown> = {}): RevampCaseStudy {
  return normalizeRevamp({
    clientName: "Netrix Global",
    solutionLines: "Cybersecurity",
    country: "United States",
    heroStats: [
      { value: "111", label: "Sales-qualified appointments" },
      { value: "18", label: "Months" },
    ],
    facts: [{ label: "Industry", value: "IT services" }],
    channels: {
      rows: [
        { name: "LinkedIn", activity: "2,400 connection requests", appointments: 87 },
        { name: "Email", activity: "117,570 emails delivered", appointments: 24 },
        { name: "Calls", activity: "5,000 dials", appointments: null },
      ],
    },
    primaryContact: { role: "Senior Director of Marketing", eyebrow: "Callbox works with" },
    howItRan: {
      roles: [
        { role: "C-suite", count: 20 },
        { role: "Director / Head", count: 50 },
        { role: "Manager / Lead", count: 30 },
      ],
    },
    progression: {
      quarters: [
        { label: "Q3 2025", count: 20 },
        { label: "Q4 2025", count: 35, isPeak: true },
        { label: "Q1 2026", count: 30 },
        { label: "Oct–Nov 2026", count: 6, isPartial: true },
      ],
    },
    funnel: {
      stages: [
        { name: "Appointments set", value: 111 },
        { name: "First appointment transpired", value: 52 },
        { name: "Opportunity created", value: 12 },
      ],
    },
    ...overrides,
  });
}
