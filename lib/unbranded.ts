// Unbranded case studies: the campaign's numbers only, with no real client details anywhere (the
// sheet, the AI's input, the PDF, the CMS draft, the saved copy).
//
// Shown: appointments (total, by channel, by quarter), channel activity, event registrations, lists
// and records worked (counts), the seniority mix of who said yes, the funnel, the target market,
// the period, and Callbox's recommendations.
// Never shown: the client's name, logo, industry, headquarters, size, client since, program growth,
// the primary contact (role, lead source), its offering (solution lines), a quote, the campaign code.
//
// The rules live here so the import, the editor, the AI route and the CMS export apply the same
// ones. Shared by the browser, the server and tests (no server code).

import type { RevampCaseStudy } from "@/lib/revamp";

/* ------------------------------- facts ------------------------------- */

const key = (l: string) => l.trim().toLowerCase();

// Facts about the client (HubSpot). Never on an unbranded case study. ("CRM in use" is AI context,
// never shown, but it is still the client's.)
export const CLIENT_FACT_LABELS = ["industry", "headquarters", "company size", "client since", "program growth", "crm in use"];
// Facts about the campaign (CallboxOne). The only imported facts an unbranded case study keeps.
export const CAMPAIGN_FACT_LABELS = ["period measured", "market", "channels worked", "lists worked", "list sources"];

export const isClientFact = (label: string) => CLIENT_FACT_LABELS.includes(key(label));
export const isCampaignFact = (label: string) => CAMPAIGN_FACT_LABELS.includes(key(label));

/* --------------------------- campaign code --------------------------- */

// The import's methodology note names the campaign code ("...campaign record for ACME25071
// since July 2025"), and the code's letters are the client's name. Unbranded: the code goes.
export function withoutCampaignCode(note: string): string {
  return note.replace(/\b(campaign record) for \S+ (since|between)\b/gi, "$1 $2");
}

/* ------------------------------- strip ------------------------------- */

// The sheet with every client detail removed. Facts the writer added under other labels stay (the
// identity check below still reads them). The sheet passed in is not changed.
export function stripClientDetails(r: RevampCaseStudy): RevampCaseStudy {
  const d: RevampCaseStudy = structuredClone(r);
  d.clientName = "";
  d.country = ""; // the masthead's country is the client's HQ country; the market is a fact
  d.solutionLines = "";
  d.facts = d.facts.filter((f) => !isClientFact(f.label));
  d.primaryContact = { heading: "", intro: "", eyebrow: "", role: "", context: "", pressures: [], partnerReasons: [] };
  d.whatChanged.quote = { text: "", name: "", title: "" };
  d.methodologyNote = withoutCampaignCode(d.methodologyNote);
  d.internal = { leadSource: "", extraFacts: (d.internal?.extraFacts ?? []).filter((f) => !isClientFact(f.label)) };
  return d;
}

// What leaves the editor (CMS, copied text, AI input): an unbranded sheet always goes out stripped.
export const exportable = (r: RevampCaseStudy): RevampCaseStudy => (r.unbranded ? stripClientDetails(r) : r);

// The CallboxOne patch an unbranded import applies: campaign facts only, no campaign code.
export function unbrandedCampaignPatch<P extends { facts: RevampCaseStudy["facts"]; methodologyNote: string }>(p: P): P {
  return { ...p, facts: p.facts.filter((f) => isCampaignFact(f.label)), methodologyNote: withoutCampaignCode(p.methodologyNote) };
}

/* ------------------------------ saved copies ------------------------------ */

// A client's saved entry (lib/recentClients.ts) as an unbranded session sees it: its unbranded
// sheet and CMS draft in the usual slots, so the import panel and the editor need no second path.
export function unbrandedView<T extends { sheet?: unknown; cmsDraft: unknown; unbrandedSheet?: unknown; unbrandedCmsDraft?: unknown }>(r: T): T {
  return { ...r, sheet: r.unbrandedSheet ?? null, cmsDraft: r.unbrandedCmsDraft ?? null };
}

/* ------------------------------ identity check ------------------------------ */

// Words that name the client: its HubSpot name, domain and HQ, the CallboxOne client name and the
// campaign code. Checked against everything on an unbranded sheet: the AI never gets them, so a
// hit comes from typed or pasted text.
export type IdentityTerm = { term: string; kind: string; caseSensitive?: boolean };

// Never terms on their own: legal forms and words any case study uses. Also used by the headline
// check (lib/narrative.ts namesClient), so "Software" in "Smart Software" can still describe the
// client's type in a headline.
export const COMMON = new Set([
  "inc", "llc", "ltd", "pty", "plc", "gmbh", "corp", "corporation", "co", "group", "global", "holdings", "company",
  "companies", "solutions", "technologies", "technology", "tech", "systems", "services", "service", "international",
  "the", "and", "for", "callbox", "b2b", "marketing", "sales", "lead", "leads", "generation", "digital", "media",
  "data", "consulting", "partners", "partner", "network", "networks", "software", "cloud", "business", "enterprise",
  "management", "www", "com", "net", "org", "http", "https", "accelerator", "program", "campaign",
]);

const words = (t: string | null | undefined) => String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

type Source = {
  client?: { name?: string; domain?: string; location?: string } | null;
  campaign?: { campaignName?: string; clientName?: string } | null;
  stored?: { hubspot?: any } | null;
} | null;

export function identityTerms(src: Source, r: RevampCaseStudy): IdentityTerm[] {
  if (!src) return [];
  const hs = src.stored?.hubspot;
  // Words the campaign's own data uses (market, channels, period) are never client terms, e.g. a
  // client named after the country its campaign targets.
  const allowed = new Set([
    ...r.facts.filter((f) => isCampaignFact(f.label)).flatMap((f) => words(f.value)),
    ...r.channels.rows.flatMap((x) => words(x.name)),
  ]);
  const out = new Map<string, IdentityTerm>();
  const add = (term: string, kind: string, caseSensitive = false) => {
    const k = caseSensitive ? term : term.toLowerCase();
    if (!out.has(k)) out.set(k, { term, kind, ...(caseSensitive ? { caseSensitive } : {}) });
  };
  const fromWords = (text: string | null | undefined, kind: string) => {
    for (const w of words(text)) if (w.length >= 3 && !/\d/.test(w) && !COMMON.has(w) && !allowed.has(w)) add(w, kind);
  };

  fromWords(src.client?.name, "client name");
  fromWords(hs?.company?.name, "client name");
  fromWords(src.campaign?.clientName, "CallboxOne client name");
  for (const d of [src.client?.domain, hs?.company?.domain]) {
    const label = String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0];
    if (label && label.length >= 3 && !COMMON.has(label) && !allowed.has(label)) add(label, "client website");
  }
  const code = String(src.campaign?.campaignName || "").trim();
  if (code) {
    add(code, "campaign code");
    const letters = /^[A-Za-z]+/.exec(code)?.[0] ?? "";
    // Two letters ("AB") are a word only in capitals; longer code letters ("ACME") match in any case.
    if (letters.length === 2) add(letters.toUpperCase(), "campaign code", true);
    else if (letters.length > 2 && !COMMON.has(letters.toLowerCase()) && !allowed.has(letters.toLowerCase())) add(letters.toLowerCase(), "campaign code");
  }
  // HQ, e.g. "Austin, Texas, United States": each part as written ("United States" as a phrase, so
  // "states" alone is never a term), plus the distinctive words of a longer part ("Springfield NSW").
  const hq = Array.isArray(hs?.facts) ? hs.facts.find((f: any) => key(String(f?.label || "")) === "headquarters")?.value : "";
  for (const part of [String(hq || ""), String(src.client?.location || "")].flatMap((t) => t.split(","))) {
    const ws = words(part).filter((w) => !/\d/.test(w));
    if (!ws.length || ws.every((w) => allowed.has(w) || COMMON.has(w))) continue;
    if (ws.join(" ").length >= 3) add(ws.join(" "), "headquarters");
    if (ws.length > 1) for (const w of ws) if (w.length >= 3 && !GEO_COMMON.has(w) && !COMMON.has(w) && !allowed.has(w)) add(w, "headquarters");
  }
  return [...out.values()];
}

// Words of place names that mean nothing alone ("United States", "New South Wales").
const GEO_COMMON = new Set([
  "united", "states", "kingdom", "new", "north", "south", "east", "west", "republic", "city", "county", "province",
  "region", "state", "saint", "san", "santa", "los", "las", "del", "de", "la", "el", "of",
]);

export type IdentityFinding = {
  path: string; // e.g. "dek", "facts.2.value", "howItRan.steps.0.body"
  label: string;
  sentence: string;
  terms: string[]; // the client terms found, as written in the text
};

// Readable names for the writer.
const FIELD_NAMES: Record<string, string> = {
  pdfTitle: "PDF title", clientName: "Client", country: "Country", solutionLines: "Solution lines",
  headline: "Headline", headlineHighlight: "Headline highlight", dek: "Dek", subDek: "Sub-dek",
  heroStats: "Hero stat", facts: "Fact", situation: "Situation", channels: "Channels",
  primaryContact: "Primary contact", howItRan: "How it ran", progression: "Progression", funnel: "Funnel",
  whatChanged: "What changed", whereNext: "Where it goes next", methodologyNote: "Methodology note",
};
function fieldLabel(path: string): string {
  const [top, ...rest] = path.split(".");
  const n = rest.find((p) => /^\d+$/.test(p));
  return (FIELD_NAMES[top] || top) + (n !== undefined ? ` ${Number(n) + 1}` : "") + (rest.length && !/^\d+$/.test(rest.at(-1)!) ? ` (${rest.at(-1)})` : "");
}

// Every piece of text on the sheet, wherever it is, except the import context the editor never
// shows or sends (internal, gate).
function allText(r: RevampCaseStudy): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (v.trim()) out.push({ path, text: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  // The highlight is part of the headline: a hit in it would only repeat the headline's.
  const { internal: _i, gate: _g, headlineHighlight: _h, ...shown } = r;
  walk(shown, "");
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sentences on the sheet that name the client or its details.
export function findIdentityLeaks(r: RevampCaseStudy, terms: IdentityTerm[]): IdentityFinding[] {
  if (!terms.length) return [];
  // A phrase term ("united states") matches across any run of spaces.
  const res = terms.map((t) => ({
    t,
    re: new RegExp(`(?<![A-Za-z0-9])${escape(t.term).replace(/ /g, "\\s+")}(?![A-Za-z0-9])`, t.caseSensitive ? "g" : "gi"),
  }));
  const out: IdentityFinding[] = [];
  for (const f of allText(r)) {
    for (const sentence of f.text.trim().split(/(?<=[.!?])\s+/)) {
      const found = new Set<string>();
      for (const { re } of res) for (const m of sentence.matchAll(re)) found.add(m[0]);
      if (found.size) out.push({ path: f.path, label: fieldLabel(f.path), sentence, terms: [...found] });
    }
  }
  return out;
}

export const identityFindingKey = (f: IdentityFinding) => `${f.path}|${f.sentence}`;
