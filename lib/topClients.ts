// "Most active clients": a WEEKLY snapshot of the 5 CallboxOne clients with the most
// sales-qualified appointments in the last 30 days (campaigns running 60 days to 24 months),
// with each client's full import data. Built once a week by a Vercel Schedule, Mondays at
// 08:00 PH (Monday 00:00 UTC), and stored in Supabase (app_cache). The import panel only
// reads the snapshot: opening it or clicking a card never calls CallboxOne or HubSpot.
//
// The job runs as a chain of steps, each well inside the function limit, saving progress in the
// job row between steps:
//   rank    measure every candidate's appointments in the last 30 days (get_hubspot_report)
//   select  pick the top 5, named via HubSpot
//   import  pull each pick's full import data: HubSpot profile + CallboxOne quarters, lists, funnel
//   done    publish the snapshot
// The job row (one per week) is also the lock: a second start in the same week does nothing.

import {
  buildPatch,
  listSummary,
  quarterWindows,
  startFromCampaignCode,
  totalsFromReport,
  withCallboxOne,
  type ImportResult,
  type Totals,
} from "@/lib/callboxone";
import { clientProfile, searchClients, type ClientCandidate, type ClientProfile } from "@/lib/hubspot";
import { createServiceClient } from "@/lib/supabase/server";

export type TopCampaign = {
  clientId: number;
  clientAccountId: number;
  campaignName: string;
  clientName: string;
  teamLeader: string | null;
  start: string | null; // YYYY-MM
  timezone: string | null;
};

// What the snapshot keeps per client: exactly what the live import would have fetched.
export type StoredImport = {
  hubspot: ClientProfile | null;
  callboxone: (ImportResult & { startSource: "code" | "hubspot" }) | null;
  error?: string;
};

export type TopClient = {
  name: string; // HubSpot company name, else the CallboxOne client name
  domain: string; // for the logo; "" when HubSpot has no match
  months: number; // how long the campaign has run
  sql30: number;
  conversions30: number;
  topChannel: string; // "Voice" | "LinkedIn" | ""
  campaign: TopCampaign;
  company: ClientCandidate | null;
  stored?: StoredImport;
  // Several same-name HubSpot companies matched (e.g. a client's offices in different countries), so
  // none was linked: no HubSpot facts, the team picks the record or fills them in.
  hubspotAmbiguous?: boolean;
};

export type TopClientsSnapshot = {
  cycle: string; // the Monday (UTC date) the snapshot belongs to
  refreshedAt: string;
  nextRefresh: string;
  candidates: number;
  measured: number;
  skippedUnnamed: number; // ranked, but no matching HubSpot company with deals (internal campaigns etc.)
  clients: TopClient[];
};

export type JobStatus = {
  cycle: string;
  status: string;
  phase: string;
  measured: number;
  candidates: number;
  updatedAt: string | null;
  lastError: string | null;
  imported: number; // of the top 5, how many have their import data saved
  picks: number;
};

type CandidateRow = TopCampaign & { startIso: string };
type MeasuredRow = CandidateRow & { sql: number; conv: number; top: string };
type JobState = {
  phase: "rank" | "select" | "import" | "done";
  candidates: CandidateRow[];
  measuredIds: number[];
  rows: MeasuredRow[]; // only clients with appointments
  picks: TopClient[];
  imported: number;
  skippedUnnamed: number;
  steps: number;
  leaseUntil: number; // a step in progress; another step won't start before this
  errors: string[];
};

const MIN_DAYS = 60;
const MAX_DAYS = 24 * 30.44; // older "active" campaigns are almost always dormant
const TEST = /\btest\b|\[test\]|programmer test|sandbox|dummy/i;
// CallboxOne often stores the offer as the client name ("1Q26 Callbox - AI Readiness Accelerator").
const OFFER_LABEL = /\bcallbox\b|^\s*\d?\s*[qh]\d\s?\d{2}\b/i;
const TOP = 5;
const RANK_CONCURRENCY = 6; // CallboxOne slows down under load
const WINDOW_CONCURRENCY = 3;
const MAX_WINDOWS = 12;
export const STEP_BUDGET_MS = 230_000; // the cron route allows 300s; calls still running are abandoned
const MAX_STEPS = 30;

const TABLE = "app_cache";
const LATEST = "top-clients:latest";
const jobKey = (cycle: string) => `top-clients:job:${cycle}`;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// Weekly cycle: Monday 00:00 UTC = Monday 08:00 PH. The cycle is that Monday's UTC date.
export function currentCycle(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return iso(d);
}
// The week a job run belongs to. Schedules can start a little off the exact minute (jitter), so a
// run up to 30 minutes early still counts as the new week instead of finding last week's job done.
export const jobCycle = (now = new Date()) => currentCycle(new Date(now.getTime() + 30 * 60_000));

export const nextRefresh = (now = new Date()) => {
  const monday = new Date(`${currentCycle(now)}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return monday;
};

/* --------------------------------- storage --------------------------------- */

function db() {
  const c = createServiceClient();
  if (!c) throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  return c;
}

const emptyJob = (): JobState => ({
  phase: "rank",
  candidates: [],
  measuredIds: [],
  rows: [],
  picks: [],
  imported: 0,
  skippedUnnamed: 0,
  steps: 0,
  leaseUntil: 0,
  errors: [],
});

// Starts this week's job. False when it already started (the once-a-week lock).
export async function claimJob(cycle: string): Promise<boolean> {
  const { error } = await db().from(TABLE).insert({ key: jobKey(cycle), cycle, status: "running", payload: emptyJob() });
  if (!error) return true;
  if (error.code === "23505") return false; // duplicate key: already started this week
  throw new Error(`Supabase: ${error.message}`);
}

async function loadJob(cycle: string): Promise<{ status: string; state: JobState; updatedAt: string } | null> {
  const { data, error } = await db().from(TABLE).select("status, payload, updated_at").eq("key", jobKey(cycle)).maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data ? { status: data.status, state: { ...emptyJob(), ...(data.payload as JobState) }, updatedAt: data.updated_at } : null;
}

async function saveJob(cycle: string, state: JobState, status: string) {
  const { error } = await db()
    .from(TABLE)
    .update({ status, payload: state, updated_at: new Date().toISOString() })
    .eq("key", jobKey(cycle));
  if (error) throw new Error(`Supabase: ${error.message}`);
}

async function publish(snapshot: TopClientsSnapshot) {
  const { error } = await db()
    .from(TABLE)
    .upsert({ key: LATEST, cycle: snapshot.cycle, status: "ready", payload: snapshot, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase: ${error.message}`);
}

// What the import panel reads: the last complete snapshot, plus how this week's job is doing.
export async function readSnapshot(): Promise<{ snapshot: TopClientsSnapshot | null; job: JobStatus | null }> {
  const cycle = currentCycle();
  const { data, error } = await db().from(TABLE).select("key, status, payload, updated_at").in("key", [LATEST, jobKey(cycle)]);
  if (error) throw new Error(`Supabase: ${error.message}`);
  const latest = data?.find((r) => r.key === LATEST);
  const job = data?.find((r) => r.key === jobKey(cycle));
  const st = job?.payload as JobState | undefined;
  return {
    snapshot: (latest?.payload as TopClientsSnapshot) ?? null,
    job: job
      ? {
          cycle,
          status: job.status,
          phase: st?.phase ?? "",
          measured: st?.measuredIds?.length ?? 0,
          candidates: st?.candidates?.length ?? 0,
          updatedAt: job.updated_at,
          lastError: st?.errors?.at(-1) ?? null,
          imported: st?.imported ?? 0,
          picks: st?.picks?.length ?? 0,
        }
      : null,
  };
}

/* ---------------------------------- helpers ---------------------------------- */

const TIMEOUT = Symbol("timeout");
// Resolves to TIMEOUT at the deadline instead of waiting for a slow call.
function beforeDeadline<T>(p: Promise<T>, deadline: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([p, stop]).finally(() => clearTimeout(timer));
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

/* ----------------------------------- rank ----------------------------------- */

// One campaign per client: the newest one that is 60 days to 24 months old.
async function loadCandidates(call: (n: string, a: Record<string, unknown>) => Promise<any>): Promise<CandidateRow[]> {
  const now = new Date();
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
}

async function stepRank(st: JobState, deadline: number, checkpoint: () => Promise<void>) {
  const now = new Date();
  const from = iso(new Date(now.getTime() - 30 * 864e5));
  const to = iso(now);
  await withCallboxOne(async (call) => {
    if (!st.candidates.length) {
      st.candidates = await loadCandidates(call);
      await checkpoint();
    }
    const done = new Set(st.measuredIds);
    const todo = st.candidates.filter((c) => !done.has(c.clientId));
    await pool(todo, RANK_CONCURRENCY, async (c) => {
      if (Date.now() >= deadline) return;
      let r: any;
      try {
        r = await beforeDeadline(call("get_hubspot_report", { clientId: c.clientId, from, to }), deadline);
      } catch {
        st.measuredIds.push(c.clientId); // a client whose report fails counts as checked, with no result
        return;
      }
      if (r === TIMEOUT) return; // measured again in the next step
      const cv = r?.metrics?.conversions || {};
      const camp = r?.timezone?.campaign || {};
      st.measuredIds.push(c.clientId);
      if (st.measuredIds.length % 25 === 0) checkpoint().catch(() => {});
      const sql = num(cv.sqlTotal);
      if (sql > 0) {
        st.rows.push({
          ...c,
          // The report names the client's campaign it measured: prefer it for the import.
          clientAccountId: Number(camp.clientAccountId) || c.clientAccountId,
          campaignName: camp.campaignName ? String(camp.campaignName) : c.campaignName,
          teamLeader: camp.teamLeader ? String(camp.teamLeader) : c.teamLeader,
          timezone: camp.timezone ? String(camp.timezone) : r?.timezone?.timezone ? String(r.timezone.timezone) : null,
          sql,
          conv: num(cv.total),
          top: num(cv.sqlLinkedIn) > num(cv.sqlCalling) ? "LinkedIn" : num(cv.sqlCalling) > 0 ? "Voice" : "",
        });
      }
    });
  });
  if (st.candidates.length && st.measuredIds.length >= st.candidates.length) st.phase = "select";
}

/* ---------------------------------- select ---------------------------------- */

// Which HubSpot company a campaign belongs to, only when that is certain. Uncertain facts are left
// for the team to fill rather than guessed: a client's offices can be separate HubSpot records
// with the same name (Company 1 Brazil and Company 1 Korea, or LG Electronics and LG Electronics
// Australia), and taking the one with the most deals would give the Korea campaign Brazil's
// headquarters, client-since date and contact.
//   one company with deals                      -> that company
//   several, one of them named exactly like the client -> that one
//   several otherwise                           -> none (ambiguous): the card shows the name only
export type CompanyChoice = { company: ClientCandidate | null; ambiguous: boolean; name: string };
const plainName = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function chooseCompany(found: ClientCandidate[], term: string): CompanyChoice {
  if (found.length <= 1) return { company: found[0] ?? null, ambiguous: false, name: found[0]?.name ?? term };
  const exact = found.filter((c) => plainName(c.name) === plainName(term));
  if (exact.length === 1) return { company: exact[0], ambiguous: false, name: exact[0].name };
  const names = new Set(found.map((c) => c.name));
  return { company: null, ambiguous: true, name: names.size === 1 ? found[0].name : term };
}

// One card per HubSpot company (several campaigns on one record are one client); a campaign with
// no linked company is its own card, since campaign ids are unique.
export const pickKey = (campaign: { clientAccountId: number }, company: ClientCandidate | null) =>
  company ? `company:${company.companyId}` : `campaign:${campaign.clientAccountId}`;

// The HubSpot company for a CallboxOne client: by client name, else by the campaign code letters
// (NETRIX25071 -> "NETRIX"), skipping offer labels that are not company names.
async function companyFor(c: CandidateRow): Promise<CompanyChoice> {
  const none: CompanyChoice = { company: null, ambiguous: false, name: c.clientName };
  if (!process.env.HUBSPOT_TOKEN) return none;
  const terms: string[] = [];
  if (!OFFER_LABEL.test(c.clientName)) terms.push(c.clientName.replace(/\s*[-(].*$/, "").trim());
  const letters = /^[A-Za-z]+/.exec(c.campaignName)?.[0] ?? "";
  if (letters.length >= 3) terms.push(letters);
  for (const t of terms) {
    if (t.length < 2) continue;
    const found = await searchClients(t).catch(() => []);
    if (found.length) return chooseCompany(found, t);
  }
  return none;
}

async function stepSelect(st: JobState) {
  const now = new Date();
  const ranked = [...st.rows].sort((a, b) => b.sql - a.sql || b.conv - a.conv);
  const shortlist = ranked.slice(0, TOP * 5); // room for the ones skipped below
  // Two lookups at a time: firing all of them at once hit HubSpot's search rate limit, and the
  // rejected lookups looked like "no match" (no name, no logo).
  const choices: CompanyChoice[] = shortlist.map((m) => ({ company: null, ambiguous: false, name: m.clientName }));
  await pool(
    shortlist.map((m, i) => ({ m, i })),
    2,
    async ({ m, i }) => {
      choices[i] = await companyFor(m).catch(() => choices[i]);
    }
  );
  const picks: TopClient[] = [];
  const seen = new Set<string>();
  st.skippedUnnamed = 0;
  shortlist.forEach((m, i) => {
    if (picks.length >= TOP) return;
    const { company, ambiguous, name } = choices[i];
    // A top client must match a HubSpot company with deals (every paying client does): this drops
    // internal campaigns (e.g. "CS DVO NAM MKTG Reactivation"). Several same-name companies with
    // deals is a client too (its offices): listed by name, with no HubSpot company linked.
    if (!company && !ambiguous) {
      st.skippedUnnamed += 1;
      return;
    }
    const key = pickKey(m, company);
    if (seen.has(key)) return;
    seen.add(key);
    const { startIso, sql, conv, top, ...campaign } = m;
    picks.push({
      name: company?.name || name,
      domain: company?.domain || "",
      months: Math.max(1, Math.round((now.getTime() - Date.parse(startIso)) / (30.44 * 864e5))),
      sql30: sql,
      conversions30: conv,
      topChannel: top,
      campaign,
      company,
      ...(ambiguous ? { hubspotAmbiguous: true } : {}),
    });
  });
  st.picks = picks;
  st.imported = 0;
  st.phase = "import";
}

/* ---------------------------------- import ---------------------------------- */

class OutOfTime extends Error {}

// The same data the import panel fetches live, pulled once for the snapshot.
async function importOne(c: TopClient, deadline: number): Promise<StoredImport> {
  const stored: StoredImport = { hubspot: null, callboxone: null };
  if (c.company) {
    stored.hubspot = await clientProfile(c.company.companyId).catch((e) => {
      stored.error = `HubSpot: ${msg(e)}`;
      return null;
    });
  }
  const fromCode = startFromCampaignCode(c.campaign.campaignName);
  const firstWon = stored.hubspot?.relationship?.firstWon;
  const start = fromCode ?? (firstWon ? new Date(`${firstWon}-01T00:00:00Z`) : null);
  if (!start) {
    stored.error = `No start month for ${c.campaign.campaignName}.`;
    return stored;
  }
  const windows = quarterWindows(start).slice(-MAX_WINDOWS);
  try {
    const built = await withCallboxOne(async (call) => {
      const perWindow: Totals[] = new Array(windows.length);
      let timedOut = false;
      await pool(
        windows.map((w, i) => ({ w, i })),
        WINDOW_CONCURRENCY,
        async ({ w, i }) => {
          const r = await beforeDeadline(
            call("get_report_stats", { clientId: c.campaign.clientId, clientAccountId: c.campaign.clientAccountId, from: w.from, to: w.to }),
            deadline
          );
          if (r === TIMEOUT) timedOut = true;
          else perWindow[i] = totalsFromReport(r, c.campaign.clientAccountId);
        }
      );
      if (timedOut) throw new OutOfTime();
      const lists = await call("list_client_lists", { clientId: c.campaign.clientId })
        .then((res) => listSummary(res, c.campaign.clientAccountId))
        .catch(() => null);
      const progression = await call("get_opportunity_progression", {
        clientId: c.campaign.clientId,
        from: windows[0].from,
        to: windows[windows.length - 1].to,
      })
        .then((res) => ({ counts: res?.counts || {} }))
        .catch(() => ({ counts: {} }));
      return buildPatch(
        { clientId: c.campaign.clientId, clientAccountId: c.campaign.clientAccountId, campaignName: c.campaign.campaignName, clientName: c.campaign.clientName },
        windows,
        perWindow,
        progression,
        { lists, timezone: c.campaign.timezone ?? "" }
      );
    });
    stored.callboxone = { ...built, startSource: fromCode ? "code" : "hubspot" };
  } catch (e) {
    if (e instanceof OutOfTime) throw e; // the step ends; this client is imported again next step
    stored.error = [stored.error, `CallboxOne: ${msg(e)}`].filter(Boolean).join(" ");
  }
  return stored;
}

async function stepImport(st: JobState, deadline: number, checkpoint: () => Promise<void>) {
  while (st.imported < st.picks.length) {
    if (deadline - Date.now() < 100_000) return; // not enough time for a full client: next step
    st.picks[st.imported].stored = await importOne(st.picks[st.imported], deadline);
    st.imported += 1;
    await checkpoint();
  }
  st.phase = "done";
}

/* ----------------------------------- steps ----------------------------------- */

// Runs one step of this week's job. Returns whether the job is finished (or can't continue).
export async function runStep(cycle: string): Promise<{ done: boolean; phase: string; note?: string }> {
  const job = await loadJob(cycle);
  if (!job) return { done: true, phase: "none", note: "No job for this week." };
  if (job.status !== "running") return { done: true, phase: job.status };
  const st = job.state;
  if (st.leaseUntil > Date.now()) return { done: true, phase: st.phase, note: "Another step is running." };
  st.leaseUntil = Date.now() + STEP_BUDGET_MS + 60_000;
  await saveJob(cycle, st, "running");

  const deadline = Date.now() + STEP_BUDGET_MS;
  // Saves progress mid-step so the import panel's count moves (the lease stays held).
  const checkpoint = () => saveJob(cycle, st, "running");
  try {
    if (st.phase === "rank") await stepRank(st, deadline, checkpoint);
    if (st.phase === "select") await stepSelect(st);
    if (st.phase === "import") await stepImport(st, deadline, checkpoint);
  } catch (e) {
    if (!(e instanceof OutOfTime)) st.errors = [...st.errors, msg(e)].slice(-10);
  }
  st.steps += 1;
  st.leaseUntil = 0;

  if (st.phase === "done") {
    await publish({
      cycle,
      refreshedAt: new Date().toISOString(),
      nextRefresh: nextRefresh().toISOString(),
      candidates: st.candidates.length,
      measured: st.measuredIds.length,
      skippedUnnamed: st.skippedUnnamed,
      clients: st.picks,
    });
    await saveJob(cycle, st, "done");
    return { done: true, phase: "done" };
  }
  if (st.steps >= MAX_STEPS) {
    await saveJob(cycle, st, "failed");
    return { done: true, phase: "failed", note: st.errors.at(-1) };
  }
  await saveJob(cycle, st, "running");
  return { done: false, phase: st.phase };
}

// A job whose chain broke (no step for 10 minutes) can be picked up again by the resume cron.
export async function isStalled(cycle: string): Promise<boolean> {
  const job = await loadJob(cycle);
  if (!job || job.status !== "running") return false;
  return job.state.leaseUntil < Date.now() && Date.now() - Date.parse(job.updatedAt) > 10 * 60_000;
}
