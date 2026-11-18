// "Today's most active clients": the 5 CallboxOne clients with the most sales-qualified
// appointments in the last 30 days, among campaigns running 60 days to 24 months.
// The list resets at 08:00 Philippine time (UTC+8), which is 00:00 UTC, so a "cycle" is simply
// the UTC date.
//
// Ranking every candidate takes one get_hubspot_report call per client (~14s each in practice,
// ~370 candidates), far more than one Vercel function can do in 60s. So the work is split:
//   plan   -> the candidate list (one list_team_leaders call), cached per cycle
//   batch  -> one slice of candidates measured, cached per cycle and slice
//   final  -> all slices ranked and named via HubSpot, cached per cycle once complete
// The browser drives the batches (like the CallboxOne import). The first visitor after 08:00 PH
// waits a few minutes; everyone after that reads the cache.

import { unstable_cache } from "next/cache";
import { startFromCampaignCode, withCallboxOne } from "@/lib/callboxone";
import { searchClients, type ClientCandidate } from "@/lib/hubspot";

export type TopCampaign = {
  clientId: number;
  clientAccountId: number;
  campaignName: string;
  clientName: string;
  teamLeader: string | null;
  start: string | null; // YYYY-MM
  timezone: string | null;
};

export type TopClient = {
  name: string; // HubSpot company name, else the CallboxOne client name
  domain: string; // for the logo; "" when HubSpot has no match
  months: number; // how long the campaign has run
  sql30: number;
  conversions30: number;
  topChannel: string; // "Voice" | "LinkedIn" | ""
  campaign: TopCampaign; // ready for the import panel
  company: ClientCandidate | null; // ready for the import panel
};

export type TopClientsPlan = { cycle: string; nextRefresh: string; candidates: number; batches: number };
export type TopClientsBatch = { index: number; size: number; checked: number; rows: MeasuredRow[] };
export type TopClientsPayload = {
  cycle: string;
  refreshedAt: string;
  nextRefresh: string;
  candidates: number;
  measured: number;
  complete: boolean;
  // Ranked clients left out because CallboxOne only has an offer label for them and HubSpot
  // has no matching company, so there is no real name to show.
  skippedUnnamed: number;
  clients: TopClient[];
};

type CandidateRow = TopCampaign & { startIso: string };
export type MeasuredRow = CandidateRow & { sql: number; conv: number; top: string };

const MIN_DAYS = 60;
const MAX_DAYS = 24 * 30.44; // older "active" campaigns are almost always dormant
const TEST = /\btest\b|\[test\]|programmer test|sandbox|dummy/i;
// CallboxOne often stores the offer as the client name ("1Q26 Callbox - AI Readiness Accelerator").
const OFFER_LABEL = /\bcallbox\b|^\s*\d?\s*[qh]\d\s?\d{2}\b/i;
export const BATCH_SIZE = 24;
const BATCH_BUDGET_MS = 48_000;
const CONCURRENCY = 8;
const TOP = 5;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const currentCycle = (now = new Date()) => iso(now);
export const nextReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

// Every entry expires at the next reset; a new cycle is a new key anyway.
const cached = <T>(fn: () => Promise<T>, key: string[]) => {
  const secondsLeft = Math.max(60, Math.ceil((nextReset().getTime() - Date.now()) / 1000));
  return unstable_cache(fn, ["top-clients", currentCycle(), ...key], { revalidate: secondsLeft, tags: ["top-clients"] })();
};

/* ---------------------------------- plan ---------------------------------- */

// One campaign per client: the newest one that is 60 days to 24 months old. Newest first.
async function loadCandidates(): Promise<CandidateRow[]> {
  const now = new Date();
  return withCallboxOne(async (call) => {
    const leaders = await call("list_team_leaders", { limit: 500 });
    const byClient = new Map<number, CandidateRow>();
    for (const tl of leaders?.teamLeaders || []) {
      for (const team of tl?.teams || []) {
        for (const c of team?.campaigns || []) {
          const clientId = Number(c?.clientId);
          const code = String(c?.campaignName || "");
          const name = String(c?.clientName || "");
          if (!clientId || TEST.test(name) || TEST.test(code)) continue;
          const startDate = startFromCampaignCode(code);
          if (!startDate) continue;
          const days = (now.getTime() - startDate.getTime()) / 864e5;
          if (days < MIN_DAYS || days > MAX_DAYS) continue;
          const prev = byClient.get(clientId);
          if (prev && prev.startIso >= iso(startDate)) continue;
          byClient.set(clientId, {
            clientId,
            clientAccountId: Number(c?.clientAccountId) || 0,
            campaignName: code,
            clientName: name,
            teamLeader: tl?.name ? String(tl.name) : null,
            start: iso(startDate).slice(0, 7),
            timezone: null,
            startIso: iso(startDate),
          });
        }
      }
    }
    return [...byClient.values()].sort((a, b) => b.startIso.localeCompare(a.startIso));
  });
}

const getCandidates = () => cached(loadCandidates, ["candidates"]);

export async function getPlan(): Promise<TopClientsPlan> {
  const candidates = await getCandidates();
  return {
    cycle: currentCycle(),
    nextRefresh: nextReset().toISOString(),
    candidates: candidates.length,
    batches: Math.ceil(candidates.length / BATCH_SIZE),
  };
}

/* ---------------------------------- batch ---------------------------------- */

// Measures one slice: sales-qualified appointments in the last 30 days, per client.
async function measureBatch(index: number): Promise<TopClientsBatch> {
  const t0 = Date.now();
  const all = await getCandidates();
  const slice = all.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
  const now = new Date();
  const from = iso(new Date(now.getTime() - 30 * 864e5));
  const to = iso(now);
  const rows: MeasuredRow[] = [];
  let checked = 0;
  await withCallboxOne(async (call) => {
    let next = 0;
    const worker = async () => {
      while (next < slice.length && Date.now() - t0 < BATCH_BUDGET_MS) {
        const c = slice[next++];
        try {
          const r = await call("get_hubspot_report", { clientId: c.clientId, from, to });
          const cv = r?.metrics?.conversions || {};
          const camp = r?.timezone?.campaign || {};
          rows.push({
            ...c,
            // The report names the client's campaign it measured: prefer it for the import.
            clientAccountId: Number(camp.clientAccountId) || c.clientAccountId,
            campaignName: camp.campaignName ? String(camp.campaignName) : c.campaignName,
            teamLeader: camp.teamLeader ? String(camp.teamLeader) : c.teamLeader,
            timezone: camp.timezone ? String(camp.timezone) : r?.timezone?.timezone ? String(r.timezone.timezone) : null,
            sql: num(cv.sqlTotal),
            conv: num(cv.total),
            top: num(cv.sqlLinkedIn) > num(cv.sqlCalling) ? "LinkedIn" : num(cv.sqlCalling) > 0 ? "Voice" : "",
          });
          checked += 1;
        } catch {
          checked += 1; // a client whose report fails counts as checked with no result
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  });
  // Only clients with appointments matter for the ranking; the rest stay out of the payload.
  return { index, size: slice.length, checked, rows: rows.filter((x) => x.sql > 0) };
}

export function getBatch(index: number): Promise<TopClientsBatch> {
  return cached(() => measureBatch(index), ["batch", String(index)]);
}

/* ---------------------------------- final ---------------------------------- */

// The HubSpot company for a CallboxOne client: by client name, else by the campaign code letters
// (NETRIX25071 -> "NETRIX"), skipping offer labels that are not company names.
async function companyFor(c: CandidateRow): Promise<ClientCandidate | null> {
  if (!process.env.HUBSPOT_TOKEN) return null;
  const terms: string[] = [];
  if (!OFFER_LABEL.test(c.clientName)) terms.push(c.clientName.replace(/\s*[-(].*$/, "").trim());
  const letters = /^[A-Za-z]+/.exec(c.campaignName)?.[0] ?? "";
  if (letters.length >= 3) terms.push(letters);
  for (const t of terms) {
    if (t.length < 2) continue;
    const found = await searchClients(t).catch(() => []);
    if (found.length) return found[0];
  }
  return null;
}

class Incomplete extends Error {
  payload: TopClientsPayload;
  constructor(payload: TopClientsPayload) {
    super("incomplete");
    this.payload = payload;
  }
}

async function buildFinal(): Promise<TopClientsPayload> {
  const now = new Date();
  const plan = await getPlan();
  const batches = await Promise.all(Array.from({ length: plan.batches }, (_, i) => getBatch(i).catch(() => null)));
  const measured = batches.reduce((t, b) => t + (b?.checked ?? 0), 0);
  const ranked = batches
    .flatMap((b) => b?.rows ?? [])
    .sort((a, b) => b.sql - a.sql || b.conv - a.conv);

  // Company name and domain from HubSpot; the same company twice (e.g. several Netrix campaigns
  // under different client ids) is listed once.
  const pool = ranked.slice(0, TOP * 3);
  const companies = await Promise.all(pool.map((m) => companyFor(m).catch(() => null)));
  const clients: TopClient[] = [];
  const seen = new Set<string>();
  let skippedUnnamed = 0;
  pool.forEach((m, i) => {
    if (clients.length >= TOP) return;
    const company = companies[i];
    if (!company && OFFER_LABEL.test(m.clientName)) {
      skippedUnnamed += 1;
      return;
    }
    const key = company?.companyId || (/^[A-Za-z]+/.exec(m.campaignName)?.[0] ?? String(m.clientId)).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const { startIso, sql, conv, top, ...campaign } = m;
    clients.push({
      name: company?.name || m.clientName,
      domain: company?.domain || "",
      months: Math.max(1, Math.round((now.getTime() - Date.parse(startIso)) / (30.44 * 864e5))),
      sql30: sql,
      conversions30: conv,
      topChannel: top,
      campaign,
      company,
    });
  });

  const payload: TopClientsPayload = {
    cycle: plan.cycle,
    refreshedAt: now.toISOString(),
    nextRefresh: plan.nextRefresh,
    candidates: plan.candidates,
    measured,
    complete: batches.every(Boolean) && measured >= plan.candidates,
    skippedUnnamed,
    clients,
  };
  // An incomplete list (a batch failed) is returned but not cached, so the next visit retries.
  if (!batches.every(Boolean)) throw new Incomplete(payload);
  return payload;
}

export async function getFinal(): Promise<TopClientsPayload> {
  try {
    return await cached(buildFinal, ["final"]);
  } catch (e) {
    if (e instanceof Incomplete) return e.payload;
    throw e;
  }
}
