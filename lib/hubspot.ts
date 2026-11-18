// Server-only client for Callbox's own HubSpot portal (client deals and company records).
// Env: HUBSPOT_TOKEN (Service Key with crm.objects.deals.read + crm.objects.companies.read).
//
// Read-only, and deliberately narrow:
//  - only the request paths in ALLOWED can be called;
//  - deal amounts are never requested, and deal names never leave the server: the browser only
//    receives facts derived from them (client since, seat growth, services added).

export class HubSpotConfigError extends Error {}

const API = "https://api.hubapi.com";

const ALLOWED: [string, RegExp][] = [
  ["POST", /^\/crm\/v3\/objects\/companies\/search$/],
  ["GET", /^\/crm\/v3\/objects\/companies\/\d+$/],
  ["GET", /^\/crm\/v4\/objects\/companies\/\d+\/associations\/deals$/],
  ["POST", /^\/crm\/v3\/objects\/deals\/batch\/read$/],
];

const COMPANY_PROPS = ["name", "domain", "city", "state", "country", "industry", "numberofemployees"];
// No "amount" or any other money field: the generator has no use for them.
const DEAL_PROPS = ["dealname", "closedate", "hs_is_closed_won"];

async function hs(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<any> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new HubSpotConfigError("HubSpot is not configured. Set HUBSPOT_TOKEN in Vercel and redeploy.");
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) throw new Error(`HubSpot request not allowed: ${method} ${path}`);

  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
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
];

export function normalizeCountry(v: unknown): string {
  const t = String(v || "").trim();
  return COUNTRY_ALIASES.find(([re]) => re.test(t))?.[1] ?? t;
}

function headquarters(p: Record<string, any>): string {
  const country = normalizeCountry(p.country);
  const rawState = String(p.state || "").trim();
  const state = country === "United States" ? US_STATES[rawState.toUpperCase()] ?? rawState : rawState;
  return [String(p.city || "").trim(), state, country].filter(Boolean).join(", ");
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

  return { clientSince: monthLabel(first), months, seats, services: [...found], wonDeals: sorted.length };
}

/* --------------------------------- profile --------------------------------- */

export type ClientProfile = {
  company: { companyId: string; name: string; domain: string; headquarters: string; country: string; industry: string; size: string };
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
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await hs("POST", "/crm/v3/objects/deals/batch/read", {}, {
      inputs: ids.slice(i, i + 100).map((id) => ({ id })),
      properties: DEAL_PROPS,
    });
    for (const d of batch?.results || []) {
      const dp = d?.properties || {};
      const closed = new Date(dp.closedate);
      if (dp.hs_is_closed_won === "true" && Number.isFinite(closed.getTime())) deals.push({ name: String(dp.dealname || ""), closed });
    }
  }

  const rel = relationshipFrom(deals);
  const info = {
    companyId,
    name: String(p.name || "").trim(),
    domain: String(p.domain || ""),
    headquarters: headquarters(p),
    country: normalizeCountry(p.country),
    industry: industryLabel(p.industry),
    size: sizeBand(p.numberofemployees),
  };

  const facts: { label: string; value: string }[] = [];
  if (info.industry) facts.push({ label: "Industry", value: info.industry });
  if (info.headquarters) facts.push({ label: "Headquarters", value: info.headquarters });
  if (info.size) facts.push({ label: "Company size", value: info.size });
  if (rel) {
    facts.push({ label: "Client since", value: rel.clientSince });
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
  if (!rel) notes.push("This record has no closed-won deals, so there is no client-since date or program growth.");
  else if (!rel.seats) notes.push("No seat counts were found in the deal names, so seat growth is not shown.");

  return { company: info, relationship: rel, facts, notes };
}
