// Server-only client for Callbox's own HubSpot portal (client deals, company and contact records).
// Env: HUBSPOT_TOKEN (Service Key with crm.objects.deals.read, crm.objects.companies.read and
// crm.objects.contacts.read).
//
// Read-only, and deliberately narrow:
//  - only the request paths in ALLOWED can be called;
//  - deal amounts are never requested, and deal names never leave the server: the browser only
//    receives facts derived from them (client since, seat growth, services added);
//  - contacts: only job title, original source and lead status are requested. Names, emails and
//    phones are never requested, so they cannot leak.

export class HubSpotConfigError extends Error {}

const API = "https://api.hubapi.com";

const ALLOWED: [string, RegExp][] = [
  ["POST", /^\/crm\/v3\/objects\/companies\/search$/],
  ["GET", /^\/crm\/v3\/objects\/companies\/\d+$/],
  ["POST", /^\/crm\/v3\/objects\/companies\/batch\/read$/],
  ["POST", /^\/crm\/v3\/objects\/contacts\/search$/],
  ["POST", /^\/crm\/v4\/associations\/contacts\/companies\/batch\/read$/],
  ["GET", /^\/crm\/v4\/objects\/companies\/\d+\/associations\/deals$/],
  ["POST", /^\/crm\/v3\/objects\/deals\/batch\/read$/],
  ["POST", /^\/crm\/v4\/associations\/deals\/contacts\/batch\/read$/],
  ["POST", /^\/crm\/v3\/objects\/contacts\/batch\/read$/],
];

// crm_being_used: Callbox's own field for the client's CRM (e.g. "Salesforce", "HubSpot"). hs_v2_date_entered_customer:
// when the record's lifecycle stage became Customer, a cross-check for "Client since".
// Never requested (James, 2026-11-23): competitors, strategic partners, revenue, owners, phone,
// address, funnel_report_link (an apps-01 URL with a login key in it).
const COMPANY_PROPS = [
  "name", "domain", "city", "state", "country", "industry", "numberofemployees", "description",
  "crm_being_used", "hs_v2_date_entered_customer",
];
// No "amount" or any other money field: the generator has no use for them.
const DEAL_PROPS = ["dealname", "closedate", "hs_is_closed_won"];
// No name, email or phone: the case study describes the buyer by role only.
const CONTACT_PROPS = ["jobtitle", "hs_analytics_source"];

async function hs(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<any> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new HubSpotConfigError("HubSpot is not configured. Set HUBSPOT_TOKEN in Vercel and redeploy.");
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) throw new Error(`HubSpot request not allowed: ${method} ${path}`);

  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  // HubSpot rate-limits (CRM search: about 5 requests a second). A 429 is retried after the wait it
  // asks for (Retry-After), else a growing pause, instead of being treated as "no result".
  let res: Response;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (res.status !== 429 || attempt >= 4) break;
    const wait = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 1200 * attempt));
  }
  if (res.status === 401) throw new HubSpotConfigError("HubSpot rejected the key. Check HUBSPOT_TOKEN in Vercel.");
  if (res.status === 403) {
    throw new HubSpotConfigError("The HubSpot key is missing a scope. It needs crm.objects.deals.read and crm.objects.companies.read.");
  }
  if (res.status === 429) throw new Error("HubSpot rate limit reached. Try again in a few seconds.");
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} failed (HTTP ${res.status}): ${String(json?.message || "").slice(0, 200)}`);
  return json;
}

/* --------------------------------- search --------------------------------- */

export type ClientCandidate = {
  companyId: string;
  name: string;
  domain: string;
  location: string;
  deals: number;
  firstDeal: string | null; // YYYY-MM
};

// Companies matching the name that have at least one deal: client records, not the many
// prospect-database duplicates that share the same name or domain.
export async function searchClients(q: string): Promise<ClientCandidate[]> {
  const res = await hs("POST", "/crm/v3/objects/companies/search", {}, {
    query: q,
    filterGroups: [{ filters: [{ propertyName: "num_associated_deals", operator: "GT", value: "0" }] }],
    properties: [...COMPANY_PROPS, "num_associated_deals", "first_deal_created_date"],
    sorts: [{ propertyName: "num_associated_deals", direction: "DESCENDING" }],
    limit: 10,
  });
  return (res?.results || []).map((c: any) => {
    const p = c?.properties || {};
    return {
      companyId: String(c.id),
      name: String(p.name || "").trim() || "(no name)",
      domain: String(p.domain || ""),
      location: headquarters(p),
      deals: Number(p.num_associated_deals) || 0,
      firstDeal: typeof p.first_deal_created_date === "string" ? p.first_deal_created_date.slice(0, 7) : null,
    };
  });
}

/* ------------------------------ active clients ------------------------------ */

// The search box's dropdown: client companies with a contact whose Lead Status is "Active Client".
// Only records that hold deals count (the client record, not the duplicates that share its name or
// domain). Ordered by the most recently updated Active Client contact. Only contact IDs are read.
export const ACTIVE_CLIENT_STATUS = "Active Client";
const MAX_ACTIVE_CONTACTS = 2000;

export async function activeClients(): Promise<ClientCandidate[]> {
  const contactIds: string[] = [];
  let after: string | undefined;
  do {
    const res = await hs("POST", "/crm/v3/objects/contacts/search", {}, {
      filterGroups: [{ filters: [{ propertyName: "hs_lead_status", operator: "EQ", value: ACTIVE_CLIENT_STATUS }] }],
      properties: ["hs_lead_status"],
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    for (const c of res?.results || []) if (/^\d+$/.test(String(c?.id))) contactIds.push(String(c.id));
    after = res?.paging?.next?.after;
  } while (after && contactIds.length < MAX_ACTIVE_CONTACTS);

  // Companies in the order their Active Client contacts were last updated.
  const companyIds: string[] = [];
  for (let i = 0; i < contactIds.length; i += 100) {
    const res = await hs("POST", "/crm/v4/associations/contacts/companies/batch/read", {}, {
      inputs: contactIds.slice(i, i + 100).map((id) => ({ id })),
    });
    const byContact = new Map<string, string[]>(
      (res?.results || []).map((r: any) => [String(r?.from?.id), (r?.to || []).map((t: any) => String(t?.toObjectId)).filter((x: string) => /^\d+$/.test(x))])
    );
    for (const id of contactIds.slice(i, i + 100)) for (const c of byContact.get(id) || []) if (!companyIds.includes(c)) companyIds.push(c);
  }

  const byId = new Map<string, ClientCandidate>();
  for (let i = 0; i < companyIds.length; i += 100) {
    const res = await hs("POST", "/crm/v3/objects/companies/batch/read", {}, {
      inputs: companyIds.slice(i, i + 100).map((id) => ({ id })),
      properties: ["name", "domain", "city", "state", "country", "num_associated_deals", "first_deal_created_date"],
    });
    for (const c of res?.results || []) {
      const p = c?.properties || {};
      const deals = Number(p.num_associated_deals) || 0;
      if (deals <= 0) continue;
      byId.set(String(c.id), {
        companyId: String(c.id),
        name: String(p.name || "").trim() || "(no name)",
        domain: String(p.domain || ""),
        location: headquarters(p),
        deals,
        firstDeal: typeof p.first_deal_created_date === "string" ? p.first_deal_created_date.slice(0, 7) : null,
      });
    }
  }
  return companyIds.map((id) => byId.get(id)).filter((c): c is ClientCandidate => Boolean(c));
}

/* ------------------------------ firmographics ------------------------------ */

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const COUNTRY_ALIASES: [RegExp, string][] = [
  [/^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i, "United States"],
  [/^(uk|u\.k\.|gb|great britain|united kingdom)$/i, "United Kingdom"],
  [/^(au|aus|australia)$/i, "Australia"],
  [/^(sg|singapore)$/i, "Singapore"],
  [/^(ca|can|canada)$/i, "Canada"],
  [/^(nz|new zealand)$/i, "New Zealand"],
  [/^(ph|philippines)$/i, "Philippines"],
  [/^(hk|hong kong)$/i, "Hong Kong"],
  [/^(uae|ae|united arab emirates)$/i, "United Arab Emirates"],
  [/^(kr|kor|south korea|republic of korea)$/i, "South Korea"],
  [/^(jp|jpn|japan)$/i, "Japan"],
  [/^(in|ind|india)$/i, "India"],
  [/^(my|mys|malaysia)$/i, "Malaysia"],
  [/^(de|deu|germany)$/i, "Germany"],
  [/^(fr|fra|france)$/i, "France"],
  [/^(mx|mex|mexico)$/i, "Mexico"],
];

export function normalizeCountry(v: unknown): string {
  const t = String(v || "").trim();
  return COUNTRY_ALIASES.find(([re]) => re.test(t))?.[1] ?? t;
}

// "City, State, Country". HubSpot records often repeat a part across fields (state "NSW, Australia"
// plus country "Australia"; "Singapore" as city, state and country), so a part already written is
// left out: "Sydney NSW, Australia", "Singapore".
export function headquarters(p: Record<string, any>): string {
  const country = normalizeCountry(p.country);
  const rawState = String(p.state || "").trim();
  const state = country === "United States" ? US_STATES[rawState.toUpperCase()] ?? rawState : rawState;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of [String(p.city || ""), state, country].flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean)) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts.join(", ");
}

// HubSpot industry values are enums (INFORMATION_TECHNOLOGY_AND_SERVICES).
function industryLabel(v: unknown): string {
  const t = String(v || "").trim().toLowerCase().replace(/_/g, " ");
  if (!t) return "";
  return (t[0].toUpperCase() + t.slice(1)).replace(/\bit\b/g, "IT");
}

// Headcount in HubSpot is an estimate, so it is published as a band, not an exact number.
const BANDS: [number, string][] = [
  [10, "1 to 10"], [50, "11 to 50"], [200, "51 to 200"], [500, "201 to 500"], [1000, "501 to 1,000"],
  [5000, "1,001 to 5,000"], [10000, "5,001 to 10,000"],
];
function sizeBand(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${BANDS.find(([max]) => n <= max)?.[1] ?? "10,000+"} employees`;
}

/* ------------------------------ relationship ------------------------------ */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// Service lines read from deal names. "Seats" are the core outbound program, not an add-on.
const SERVICES: [RegExp, string][] = [
  [/inbound/i, "inbound marketing"],
  [/\bseo\b/i, "SEO"],
  [/\baeo\b/i, "AEO"],
  [/\bppc\b|\bpaid\b|performance marketing/i, "paid performance marketing"],
  [/\babm\b|account[- ]based/i, "account-based marketing"],
  [/webinar|\bevents?\b/i, "event marketing"],
  [/content/i, "content marketing"],
  [/linkedin/i, "LinkedIn outreach"],
];

// Seat count named in a deal: "6 Seats" or "7th Additional Seat" / "7th seat renewal".
// "3 months" or "Addtl Seat" without a number say nothing about the total and are ignored.
export function seatsInDealName(name: string): number | null {
  const explicit = /\b(\d{1,2})\s*seats?\b/i.exec(name);
  if (explicit) return Number(explicit[1]);
  const ordinal = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:additional\s+|addtl\.?\s+|add'l\s+)?seat\b/i.exec(name);
  return ordinal ? Number(ordinal[1]) : null;
}

type Deal = { name: string; closed: Date };

export type Relationship = {
  clientSince: string; // "February 2025"
  firstWon: string; // "2025-02": CallboxOne's start-month fallback when a campaign code has none
  months: number; // first win to the latest win
  seats: { first: number; peak: number; latest: number } | null;
  services: string[];
  wonDeals: number;
};

export function relationshipFrom(deals: Deal[]): Relationship | null {
  if (!deals.length) return null;
  const sorted = [...deals].sort((a, b) => a.closed.getTime() - b.closed.getTime());
  const first = sorted[0].closed;
  const last = sorted[sorted.length - 1].closed;
  const months = Math.max(1, Math.round((last.getTime() - first.getTime()) / (30.44 * 864e5)) + 1);

  const counts = sorted.map((d) => seatsInDealName(d.name)).filter((n): n is number => n !== null && n > 0);
  const seats = counts.length ? { first: counts[0], peak: Math.max(...counts), latest: counts[counts.length - 1] } : null;

  const found = new Set<string>();
  for (const d of sorted) for (const [re, label] of SERVICES) if (re.test(d.name)) found.add(label);
  if (found.has("SEO") && found.has("AEO")) {
    found.delete("SEO");
    found.delete("AEO");
    found.add("SEO/AEO");
  }

  return {
    clientSince: monthLabel(first),
    firstWon: first.toISOString().slice(0, 7),
    months,
    seats,
    services: [...found],
    wonDeals: sorted.length,
  };
}

// "Client since" from two HubSpot dates: the first closed-won deal and the day the company's
// lifecycle stage became Customer (e.g. a deal that closed in March, but a customer since late February). When both
// exist and fall in different months, HubSpot doesn't settle the month, so the fact is left empty
// and the writer gets both dates (no guessing). Otherwise the deal month is used, as before; a
// lifecycle date alone (no closed-won deal) is only reported, never used.
export function clientSinceFrom(rel: Pick<Relationship, "clientSince"> | null, enteredCustomer: unknown): { value: string; note: string } {
  const d = new Date(String(enteredCustomer || ""));
  const lifecycle = enteredCustomer && Number.isFinite(d.getTime()) ? d : null;
  const day = lifecycle ? `${lifecycle.getUTCDate()} ${monthLabel(lifecycle)}` : "";
  if (!rel) {
    return {
      value: "",
      note: lifecycle ? `HubSpot says the company became a customer on ${day}, but there is no closed-won deal to confirm it, so Client since was left empty.` : "",
    };
  }
  if (lifecycle && monthLabel(lifecycle) !== rel.clientSince) {
    return {
      value: "",
      note:
        `Client since was left empty: HubSpot gives two dates. The first closed-won deal closed in ${rel.clientSince}, ` +
        `but the company became a customer on ${day}. Check with the CSM and fill it in.`,
    };
  }
  return { value: rel.clientSince, note: "" };
}

// The client's CRM, from Callbox's "CRM BEING USED" field. Placeholders mean "not known".
const NO_CRM = /^(none|no|n\/?a|na|-+|unknown|not sure|tbd|no crm|nothing|null|other)$/i;
export function crmInUse(v: unknown): string {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t && t.length <= 60 && !NO_CRM.test(t) ? t : "";
}

/* ------------------------------ solution lines ------------------------------ */

// The client's ONE core solution ("Cybersecurity", "Payroll software"), summarized from HubSpot's
// company description. The model ranks a main pick plus up to two fallbacks; the first one that
// passes the grounding check in code is used. Empty when none does.
export async function solutionLinesFrom(description: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const text = description.trim();
  if (!apiKey || text.length < 30) return "";
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const prompt =
    "From this company description, name the ONE core solution the company sells: its main category, " +
    "1 to 3 words, in the description's own words (e.g. \"Cybersecurity\", \"Managed IT services\", \"Payroll software\"). " +
    "Then up to 2 alternatives, best first. No adjectives like award-winning or comprehensive. Nothing that is not in the description. " +
    'Return JSON: {"lines": [main, ...alternatives]}\n\nDESCRIPTION:\n' +
    text.slice(0, 1500);
  let lines: string[] = [];
  try {
    const raw = (await model.generateContent(prompt)).response.text().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    lines = Array.isArray(parsed?.lines) ? parsed.lines.map((x: unknown) => String(x || "").trim()) : [];
  } catch {
    return "";
  }
  return groundSolutionLines(lines, text);
}

// Marketing filler is stripped; generic words ("solutions", "services") don't count as grounding.
const PUFFERY = /^(award-winning|comprehensive|leading|innovative|best-in-class|world-class|premier|trusted|cutting-edge|end-to-end|full-service|industry-leading)$/i;
const GENERIC = new Set(["solution", "solutions", "service", "services", "product", "products", "provider", "providers", "offering", "offerings", "company"]);

// Keeps only lines with a specific word (or 6-letter stem) that appears in the description,
// up to `max` (1 by default: the first grounded pick), as a sentence-case list.
export function groundSolutionLines(lines: string[], description: string, max = 1): string {
  const tokens = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const words = new Set(tokens(description));
  const stem = (w: string) => w.slice(0, 6);
  const stems = new Set([...words].filter((w) => w.length >= 6).map(stem));
  const grounded = lines
    .map((l) => l.split(/\s+/).filter((w) => w && !PUFFERY.test(w)).join(" ").trim())
    .filter((l) => l.length > 1 && l.length <= 40)
    .filter((l) => tokens(l).some((w) => !GENERIC.has(w) && (words.has(w) || (w.length >= 6 && stems.has(stem(w))))))
    .filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i)
    .slice(0, max);
  if (!grounded.length) return "";
  // Sentence case list, keeping acronyms (IT, SEO): "Cybersecurity, managed services, IT consulting".
  const tidy = grounded.map((l, i) =>
    l
      .split(/\s+/)
      .map((w, j) => (/^[A-Z0-9]{2,}$/.test(w) ? w : i === 0 && j === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
      .join(" ")
  );
  return tidy.join(", ");
}

/* ------------------------------ primary contact ------------------------------ */

// Billing and procurement contacts sit on many deals but don't own the program.
const NOT_BUYER = /accounts?\s*payable|billing|invoic|procurement|purchasing|\bap\b|bookkeep|accountant/i;

const TITLE_ABBR: [RegExp, string][] = [
  [/\bSr\.?(?=\s|$)/gi, "Senior"],
  [/\bJr\.?(?=\s|$)/gi, "Junior"],
  [/\bDir\.?(?=\s|$)/gi, "Director"],
  [/\bMgr\.?(?=\s|$)/gi, "Manager"],
  [/\bMktg\.?(?=\s|$)/gi, "Marketing"],
  [/\bOps\.?(?=\s|$)/gi, "Operations"],
  [/\bAssoc\.?(?=\s|$)/gi, "Associate"],
  [/\bExec\.?(?=\s|$)/gi, "Executive"],
];
export function normalizeJobTitle(t: string): string {
  return TITLE_ABBR.reduce((x, [re, full]) => x.replace(re, full), t.replace(/\s+/g, " ").trim());
}

// The contact's original source, as a plain phrase for the drafter. Offline or campaign-created
// contacts (outbound, imports) make no claim at all.
const LEAD_SOURCES: Record<string, string> = {
  ORGANIC_SEARCH: "found Callbox through search",
  PAID_SEARCH: "found Callbox through a search ad",
  REFERRALS: "found Callbox through another website",
  AI_REFERRALS: "found Callbox through an AI assistant",
  SOCIAL_MEDIA: "found Callbox through social media",
  PAID_SOCIAL: "found Callbox through social media",
  EMAIL_MARKETING: "came in through a Callbox email",
  DIRECT_TRAFFIC: "came to Callbox's website directly",
};

export type PrimaryContact = { role: string; leadSource: string; deals: number };

// The buyer is the client contact on the most closed-won deals (Netrix: the marketing lead on
// 19 of 20), skipping billing contacts and contacts without a job title.
async function primaryContactFor(wonDealIds: string[]): Promise<PrimaryContact | null> {
  const counts = new Map<string, number>();
  for (let i = 0; i < wonDealIds.length; i += 100) {
    const res = await hs("POST", "/crm/v4/associations/deals/contacts/batch/read", {}, {
      inputs: wonDealIds.slice(i, i + 100).map((id) => ({ id })),
    });
    for (const r of res?.results || []) {
      for (const to of r?.to || []) {
        const cid = String(to?.toObjectId || "");
        if (/^\d+$/.test(cid)) counts.set(cid, (counts.get(cid) || 0) + 1);
      }
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
  if (!ranked.length) return null;
  const res = await hs("POST", "/crm/v3/objects/contacts/batch/read", {}, {
    inputs: ranked.map((id) => ({ id })),
    properties: CONTACT_PROPS,
  });
  const byId = new Map<string, any>((res?.results || []).map((c: any) => [String(c?.id), c?.properties || {}]));
  for (const id of ranked) {
    const p = byId.get(id);
    const title = String(p?.jobtitle || "").trim();
    if (!title || NOT_BUYER.test(title)) continue;
    const phrase = LEAD_SOURCES[String(p?.hs_analytics_source || "")];
    return { role: normalizeJobTitle(title), leadSource: phrase ? `Inbound: the buyer ${phrase}.` : "", deals: counts.get(id) || 0 };
  }
  return null;
}

/* --------------------------------- profile --------------------------------- */

export type ClientProfile = {
  company: {
    companyId: string; name: string; domain: string; headquarters: string; country: string; industry: string; size: string;
    solutionLines: string;
    // The client's CRM ("Salesforce"), for the AI's "Where it goes next" only; never a shown fact.
    // Optional: profiles saved before it existed don't have it.
    crm?: string;
  };
  primaryContact: PrimaryContact | null;
  relationship: Relationship | null;
  facts: { label: string; value: string }[];
  notes: string[];
};

const listJoin = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export async function clientProfile(companyId: string): Promise<ClientProfile> {
  const [company, assoc] = await Promise.all([
    hs("GET", `/crm/v3/objects/companies/${companyId}`, { properties: COMPANY_PROPS.join(",") }),
    hs("GET", `/crm/v4/objects/companies/${companyId}/associations/deals`, { limit: "500" }),
  ]);
  const p = company?.properties || {};
  const ids: string[] = (assoc?.results || []).map((a: any) => String(a?.toObjectId)).filter((x: string) => /^\d+$/.test(x)).slice(0, 300);

  const deals: Deal[] = [];
  const wonIds: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await hs("POST", "/crm/v3/objects/deals/batch/read", {}, {
      inputs: ids.slice(i, i + 100).map((id) => ({ id })),
      properties: DEAL_PROPS,
    });
    for (const d of batch?.results || []) {
      const dp = d?.properties || {};
      const closed = new Date(dp.closedate);
      if (dp.hs_is_closed_won === "true" && Number.isFinite(closed.getTime())) {
        deals.push({ name: String(dp.dealname || ""), closed });
        wonIds.push(String(d.id));
      }
    }
  }

  const rel = relationshipFrom(deals);
  // Contact scope may be missing on an older key: the rest of the profile still imports.
  let contactNote = "";
  const [solutionLines, primaryContact] = await Promise.all([
    solutionLinesFrom(String(p.description || "")).catch(() => ""),
    primaryContactFor(wonIds).catch((e) => {
      contactNote = e instanceof HubSpotConfigError
        ? "The primary contact role needs the crm.objects.contacts.read scope on the HubSpot key."
        : "The primary contact role could not be read from HubSpot.";
      return null;
    }),
  ]);
  const info = {
    companyId,
    name: String(p.name || "").trim(),
    domain: String(p.domain || ""),
    headquarters: headquarters(p),
    country: normalizeCountry(p.country),
    industry: industryLabel(p.industry),
    size: sizeBand(p.numberofemployees),
    solutionLines,
    crm: crmInUse(p.crm_being_used),
  };
  const since = clientSinceFrom(rel, p.hs_v2_date_entered_customer);

  const facts: { label: string; value: string }[] = [];
  if (info.industry) facts.push({ label: "Industry", value: info.industry });
  if (info.headquarters) facts.push({ label: "Headquarters", value: info.headquarters });
  if (info.size) facts.push({ label: "Company size", value: info.size });
  if (rel) {
    if (since.value) facts.push({ label: "Client since", value: since.value });
    const growth: string[] = [];
    if (rel.seats && rel.seats.peak > rel.seats.first) {
      growth.push(
        `Grew from ${rel.seats.first} to ${rel.seats.peak} seats` +
          (rel.seats.latest !== rel.seats.peak ? ` (${rel.seats.latest} on the latest renewal)` : "")
      );
    } else if (rel.seats) {
      growth.push(`${rel.seats.latest} seat${rel.seats.latest === 1 ? "" : "s"}`);
    }
    if (rel.services.length) growth.push(`added ${listJoin(rel.services)}`);
    if (growth.length) {
      const v = growth.join("; ");
      facts.push({ label: "Program growth", value: v[0].toUpperCase() + v.slice(1) });
    }
  }

  const notes = [
    "Firmographics come from the HubSpot company record that holds this client's deals. HubSpot data can be out of date, so check them before publishing.",
  ];
  if (solutionLines) notes.push("The solution line was summarized from HubSpot's company description; check it.");
  if (contactNote) notes.push(contactNote);
  if (since.note) notes.push(since.note);
  if (info.crm) notes.push(`CRM in use: ${info.crm}. The AI may name it only in Where it goes next (not shown as a fact).`);
  if (!rel) notes.push("This record has no closed-won deals, so there is no client-since date or program growth.");
  else if (!rel.seats) notes.push("No seat counts were found in the deal names, so seat growth is not shown.");

  return { company: info, primaryContact, relationship: rel, facts, notes };
}
