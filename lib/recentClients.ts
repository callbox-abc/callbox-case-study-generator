// "Recently imported clients": every live HubSpot + CallboxOne import is saved in Supabase
// (app_cache), shared by everyone using the app. The next person sees that a client was already
// pulled (and whether a CMS draft exists), and can open the saved data instantly instead of
// pulling it again. The app has one shared login, so entries show when, not who.

import type { ClientCandidate } from "@/lib/hubspot";
import { normalizeRevamp, type RevampCaseStudy } from "@/lib/revamp";
import { canonicalRecentKey, isLegacyRecentKey, recentKey } from "@/lib/recentKey";
import { mergeRecentEntries, withCompany } from "@/lib/recentMerge";
import { createServiceClient } from "@/lib/supabase/server";
import { stripClientDetails } from "@/lib/unbranded";
import type { StoredImport, TopCampaign, TopClientsSnapshot } from "@/lib/topClients";

export type RecentClient = {
  key: string;
  name: string;
  domain: string;
  campaign: TopCampaign | null;
  company: ClientCandidate | null;
  stored: StoredImport;
  importedAt: string;
  imports: number; // live imports of this client so far
  cmsDraft: { id: number; editLink: string; at: string } | null;
  // The finished sheet (AI text, edits, review state), saved as people work on this client, so
  // loading it again restores their text instead of drafting it anew.
  sheet?: SavedSheet | null;
  // The client's unbranded case study (lib/unbranded.ts) is a separate document with its own
  // sheet and CMS draft: saving or sending one never replaces the other.
  unbrandedSheet?: SavedSheet | null;
  unbrandedCmsDraft?: { id: number; editLink: string; at: string } | null;
};

export type SavedSheet = {
  data: RevampCaseStudy;
  reviewed: boolean; // someone clicked "Mark as reviewed" on it
  aiDrafted: string[]; // AI-written fields not reviewed yet (empty once reviewed)
  savedAt: string;
};

const TABLE = "app_cache";
const PREFIX = "recent:";
const BACKUP = "backup:"; // entries merged away by mergeLegacyEntries, kept KEEP_DAYS
const TOP_CLIENTS = "top-clients:latest"; // the weekly snapshot (lib/topClients.ts)
const KEEP_DAYS = 60;
const LIST_SIZE = 12;
const MAX_BYTES = 200_000;

function db() {
  const c = createServiceClient();
  if (!c) throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  return c;
}

/* ------------------------- one entry per campaign (old keys) ------------------------- */

// Entries used to be keyed by campaign + HubSpot company, so a campaign saved before HubSpot
// matched it (no company) and after (with one) became two entries, each with its own sheet and
// CMS draft link. Those are merged into the campaign's single entry (lib/recentMerge.ts), once
// per server instance, before anything reads or writes an entry. Each old row is copied to
// backup:<old key> first; the backups are removed after KEEP_DAYS. A merged entry that still has
// no HubSpot company gets the one this week's top clients matched to its campaign.
type Row = { key: string; payload: RecentClient; updated_at: string };
let merged: Promise<void> | null = null;

function ensureMerged(): Promise<void> {
  merged ??= mergeLegacyEntries().then(
    () => undefined,
    (e) => {
      merged = null; // try again on the next request
      console.error("recent-clients merge failed:", e instanceof Error ? e.message : e);
    }
  );
  return merged;
}

export async function mergeLegacyEntries(): Promise<number> {
  const { data, error } = await db().from(TABLE).select("key, payload, updated_at").like("key", `${PREFIX}%:%`);
  if (error) throw new Error(`Supabase: ${error.message}`);
  const legacy = ((data || []) as Row[]).filter((r) => isLegacyRecentKey(r.key));
  if (!legacy.length) return 0;

  const groups = new Map<string, Row[]>();
  for (const r of legacy) groups.set(canonicalRecentKey(r.key), [...(groups.get(canonicalRecentKey(r.key)) || []), r]);
  // A campaign entry already saved under its new key joins its group.
  const { data: current, error: currentError } = await db().from(TABLE).select("key, payload, updated_at").in("key", [...groups.keys()]);
  if (currentError) throw new Error(`Supabase: ${currentError.message}`);
  for (const r of (current || []) as Row[]) groups.get(r.key)?.push(r);
  const { data: snap } = await db().from(TABLE).select("payload").eq("key", TOP_CLIENTS).maybeSingle();
  const matched = new Map(
    ((snap?.payload as TopClientsSnapshot | undefined)?.clients || []).map((c) => [recentKey(c.campaign?.clientAccountId), c.company])
  );

  const now = new Date().toISOString();
  const backups = legacy.map((r) => ({ key: BACKUP + r.key, cycle: now.slice(0, 10), status: "merged", payload: r.payload, updated_at: now }));
  const { error: backupError } = await db().from(TABLE).upsert(backups);
  if (backupError) throw new Error(`Supabase: ${backupError.message}`);

  const rows = [...groups].map(([key, g]) => {
    const updated = g.map((r) => r.updated_at).sort().at(-1) || now; // keeps its place in the list
    return { key, cycle: updated.slice(0, 10), status: "saved", payload: withCompany(mergeRecentEntries(key, g.map((r) => r.payload)), matched.get(key)), updated_at: updated };
  });
  const { error: saveError } = await db().from(TABLE).upsert(rows);
  if (saveError) throw new Error(`Supabase: ${saveError.message}`);
  const { error: deleteError } = await db().from(TABLE).delete().in("key", legacy.map((r) => r.key));
  if (deleteError) throw new Error(`Supabase: ${deleteError.message}`);
  return legacy.length;
}

/* ---------------------------------- reads ---------------------------------- */

export async function listRecent(): Promise<RecentClient[]> {
  await ensureMerged();
  const { data, error } = await db()
    .from(TABLE)
    .select("payload")
    .like("key", `${PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(LIST_SIZE);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data || []).map((r) => r.payload as RecentClient);
}

// One client's entry, wherever it is in the list (the list only shows the latest few).
export async function getRecent(key: string): Promise<RecentClient | null> {
  if (!key.startsWith(PREFIX)) return null;
  await ensureMerged();
  key = canonicalRecentKey(key); // a page opened before the key change may still send an old key
  const { data, error } = await db().from(TABLE).select("payload").eq("key", key).maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data?.payload as RecentClient) ?? null;
}

/* --------------------------- input checks (from the browser) --------------------------- */

const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
const int = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);

function cleanCampaign(c: any): TopCampaign | null {
  if (!c || typeof c !== "object" || !int(c.clientId)) return null;
  return {
    clientId: int(c.clientId),
    clientAccountId: int(c.clientAccountId),
    campaignName: str(c.campaignName, 80),
    clientName: str(c.clientName, 200),
    teamLeader: str(c.teamLeader, 120) || null,
    start: typeof c.start === "string" && /^\d{4}-\d{2}$/.test(c.start) ? c.start : null,
    timezone: str(c.timezone, 60) || null,
  };
}

function cleanCompany(c: any): ClientCandidate | null {
  if (!c || typeof c !== "object" || !/^\d{1,20}$/.test(String(c.companyId ?? ""))) return null;
  return {
    companyId: String(c.companyId),
    name: str(c.name, 200),
    domain: str(c.domain, 200),
    location: str(c.location, 200),
    deals: int(c.deals),
    firstDeal: typeof c.firstDeal === "string" && /^\d{4}-\d{2}$/.test(c.firstDeal) ? c.firstDeal : null,
  };
}

// The import results came from this app's own routes; they are only shape-checked here.
function cleanStored(hubspot: any, callboxone: any): StoredImport {
  const obj = (x: any) => (x && typeof x === "object" && !Array.isArray(x) ? x : null);
  const cb = obj(callboxone);
  return {
    hubspot: obj(hubspot) && obj(hubspot.company) && Array.isArray(hubspot.facts) ? hubspot : null,
    callboxone: cb && obj(cb.patch) && obj(cb.period) ? { ...cb, startSource: cb.startSource === "hubspot" ? "hubspot" : "code" } : null,
  };
}

// Saves (or refreshes) a client after a live import. Returns its key, or null if nothing to save.
// New numbers clear the saved sheet of the kind of case study being pulled (branded or unbranded);
// the other kind's sheet and CMS draft stay as they were.
export async function saveRecent(body: any): Promise<string | null> {
  if (JSON.stringify(body ?? {}).length > MAX_BYTES) throw new Error("Import too large to save.");
  const campaign = cleanCampaign(body?.campaign);
  const company = cleanCompany(body?.company);
  const stored = cleanStored(body?.hubspot, body?.callboxone);
  if (!stored.hubspot && !stored.callboxone) return null;
  await ensureMerged();
  const key = recentKey(campaign?.clientAccountId, company?.companyId);

  const { data: prev } = await db().from(TABLE).select("payload").eq("key", key).maybeSingle();
  const before = prev?.payload as RecentClient | undefined;
  const entry: RecentClient = {
    key,
    name: company?.name || stored.hubspot?.company?.name || campaign?.clientName || "Unknown client",
    domain: company?.domain || stored.hubspot?.company?.domain || "",
    campaign,
    company,
    stored,
    importedAt: new Date().toISOString(),
    imports: (before?.imports ?? 0) + 1,
    cmsDraft: before?.cmsDraft ?? null,
    // New numbers: the next draft and edits save a new sheet.
    sheet: body?.unbranded === true ? before?.sheet ?? null : null,
    unbrandedSheet: body?.unbranded === true ? null : before?.unbrandedSheet ?? null,
    unbrandedCmsDraft: before?.unbrandedCmsDraft ?? null,
  };
  const now = new Date().toISOString();
  const { error } = await db().from(TABLE).upsert({ key, cycle: now.slice(0, 10), status: "saved", payload: entry, updated_at: now });
  if (error) throw new Error(`Supabase: ${error.message}`);

  // Keep the list small: entries untouched for KEEP_DAYS are removed.
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  await db().from(TABLE).delete().like("key", `${PREFIX}%`).lt("updated_at", cutoff);
  await db().from(TABLE).delete().like("key", `${BACKUP}%`).lt("updated_at", cutoff);
  return key;
}

// Saves the sheet being worked on for this client. A client loaded from the weekly snapshot has
// no entry yet, so one is created from the snapshot's import data.
export async function saveSheet(body: any): Promise<void> {
  if (JSON.stringify(body ?? {}).length > MAX_BYTES) throw new Error("Sheet too large to save.");
  const key = canonicalRecentKey(String(body?.key || ""));
  if (!key.startsWith(PREFIX)) throw new Error("Invalid key.");
  await ensureMerged();
  const data = normalizeRevamp(body?.sheet);
  const sheet: SavedSheet = {
    // An unbranded sheet is stored without client details, whatever the browser sent.
    data: data.unbranded ? stripClientDetails(data) : data,
    reviewed: body?.reviewed === true,
    aiDrafted: Array.isArray(body?.aiDrafted) ? body.aiDrafted.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 60) : [],
    savedAt: new Date().toISOString(),
  };
  const { data: prev } = await db().from(TABLE).select("payload").eq("key", key).maybeSingle();
  let entry = prev?.payload as RecentClient | undefined;
  if (!entry) {
    const campaign = cleanCampaign(body?.campaign);
    const company = cleanCompany(body?.client);
    const stored = cleanStored(body?.stored?.hubspot, body?.stored?.callboxone);
    if (key !== recentKey(campaign?.clientAccountId, company?.companyId)) throw new Error("Key does not match the client.");
    entry = {
      key,
      name: company?.name || stored.hubspot?.company?.name || campaign?.clientName || sheet.data.clientName || "Unknown client",
      domain: company?.domain || stored.hubspot?.company?.domain || "",
      campaign,
      company,
      stored,
      importedAt: sheet.savedAt,
      imports: 0, // loaded from the weekly snapshot, not pulled live
      cmsDraft: null,
    };
  }
  // Saved before HubSpot matched this campaign: take the company now that it's known.
  entry = withCompany(entry, cleanCompany(body?.client));
  if (sheet.data.unbranded) entry.unbrandedSheet = sheet;
  else entry.sheet = sheet;
  const { error } = await db().from(TABLE).upsert({ key, cycle: sheet.savedAt.slice(0, 10), status: "saved", payload: entry, updated_at: sheet.savedAt });
  if (error) throw new Error(`Supabase: ${error.message}`);
}

// Records that a CMS draft was created from this client's import (its unbranded case study's, with
// `unbranded`).
export async function attachDraft(key: string, id: number, editLink: string, unbranded = false) {
  if (!key.startsWith(PREFIX) || !Number.isInteger(id) || id <= 0) return;
  await ensureMerged();
  key = canonicalRecentKey(key);
  const { data } = await db().from(TABLE).select("payload").eq("key", key).maybeSingle();
  if (!data) return;
  const entry = data.payload as RecentClient;
  const draft = { id, editLink: str(editLink, 300), at: new Date().toISOString() };
  if (unbranded) entry.unbrandedCmsDraft = draft;
  else entry.cmsDraft = draft;
  await db().from(TABLE).update({ payload: entry, updated_at: new Date().toISOString() }).eq("key", key);
}
