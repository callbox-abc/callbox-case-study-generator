// "Recently imported clients": every live HubSpot + CallboxOne import is saved in Supabase
// (app_cache), shared by everyone using the app. The next person sees that a client was already
// pulled (and whether a CMS draft exists), and can open the saved data instantly instead of
// pulling it again. The app has one shared login, so entries show when, not who.

import type { ClientCandidate } from "@/lib/hubspot";
import { recentKey } from "@/lib/recentKey";
import { createServiceClient } from "@/lib/supabase/server";
import type { StoredImport, TopCampaign } from "@/lib/topClients";

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
};

const TABLE = "app_cache";
const PREFIX = "recent:";
const KEEP_DAYS = 60;
const LIST_SIZE = 12;
const MAX_BYTES = 200_000;

function db() {
  const c = createServiceClient();
  if (!c) throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  return c;
}


export async function listRecent(): Promise<RecentClient[]> {
  const { data, error } = await db()
    .from(TABLE)
    .select("payload")
    .like("key", `${PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(LIST_SIZE);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data || []).map((r) => r.payload as RecentClient);
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
export async function saveRecent(body: any): Promise<string | null> {
  if (JSON.stringify(body ?? {}).length > MAX_BYTES) throw new Error("Import too large to save.");
  const campaign = cleanCampaign(body?.campaign);
  const company = cleanCompany(body?.company);
  const stored = cleanStored(body?.hubspot, body?.callboxone);
  if (!stored.hubspot && !stored.callboxone) return null;
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
  };
  const now = new Date().toISOString();
  const { error } = await db().from(TABLE).upsert({ key, cycle: now.slice(0, 10), status: "saved", payload: entry, updated_at: now });
  if (error) throw new Error(`Supabase: ${error.message}`);

  // Keep the list small: entries untouched for KEEP_DAYS are removed.
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  await db().from(TABLE).delete().like("key", `${PREFIX}%`).lt("updated_at", cutoff);
  return key;
}

// Records that a CMS draft was created from this client's import.
export async function attachDraft(key: string, id: number, editLink: string) {
  if (!key.startsWith(PREFIX) || !Number.isInteger(id) || id <= 0) return;
  const { data } = await db().from(TABLE).select("payload").eq("key", key).maybeSingle();
  if (!data) return;
  const entry = data.payload as RecentClient;
  entry.cmsDraft = { id, editLink: str(editLink, 300), at: new Date().toISOString() };
  await db().from(TABLE).update({ payload: entry, updated_at: new Date().toISOString() }).eq("key", key);
}
