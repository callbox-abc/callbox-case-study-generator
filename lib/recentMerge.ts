// Merges entries saved for the same campaign under the old keys (recent:<campaign>:<company>):
// one saved before HubSpot matched the client (no company, no logo) and one after. No server code,
// so tests can run it directly.

import type { ClientCandidate } from "@/lib/hubspot";
import type { RecentClient, SavedSheet } from "@/lib/recentClients";
import { codeLetters, sheetMatchesClient } from "@/lib/clientMatch";

const time = (iso?: string | null) => (iso ? Date.parse(iso) || 0 : 0);

// The most finished sheet wins: one that names this client, then reviewed over draft, then newest.
function bestSheet(entries: RecentClient[], names: (string | null | undefined)[]): SavedSheet | null {
  const ranked = entries
    .map((e) => e.sheet)
    .filter((s): s is SavedSheet => Boolean(s))
    .map((s) => ({ s, ours: sheetMatchesClient(s.data?.clientName ?? "", names) }))
    .sort((a, b) => Number(b.ours) - Number(a.ours) || Number(b.s.reviewed) - Number(a.s.reviewed) || time(b.s.savedAt) - time(a.s.savedAt));
  return ranked[0]?.s ?? null;
}

// Adds the HubSpot company to an entry saved without one; its name and logo come with it.
export function withCompany(entry: RecentClient, company: ClientCandidate | null | undefined): RecentClient {
  if (entry.company || !company?.companyId) return entry;
  return { ...entry, company, name: company.name || entry.name, domain: company.domain || entry.domain };
}

export function mergeRecentEntries(key: string, entries: RecentClient[]): RecentClient {
  if (!entries.length) throw new Error("Nothing to merge.");
  const newest = [...entries].sort((a, b) => time(b.importedAt) - time(a.importedAt));
  // Client details come from the newest entry with a HubSpot company (name, logo, HubSpot facts).
  const base = newest.find((e) => e.company) ?? newest[0];
  const first = <T>(get: (e: RecentClient) => T | null | undefined): T | null =>
    get(base) ?? newest.map(get).find((v) => v != null) ?? null;
  const campaign = first((e) => e.campaign);
  const names = [...new Set(entries.flatMap((e) => [e.name, e.company?.name, e.campaign?.clientName]))];
  const cmsDraft = entries
    .map((e) => e.cmsDraft)
    .filter((d): d is NonNullable<RecentClient["cmsDraft"]> => Boolean(d))
    .sort((a, b) => time(b.at) - time(a.at))[0] ?? null;
  return {
    key,
    name: base.name,
    domain: base.domain || newest.find((e) => e.domain)?.domain || "",
    campaign,
    company: base.company,
    stored: {
      ...base.stored,
      hubspot: first((e) => e.stored?.hubspot),
      callboxone: first((e) => e.stored?.callboxone),
    },
    importedAt: newest[0].importedAt,
    imports: entries.reduce((n, e) => n + (e.imports || 0), 0),
    cmsDraft,
    sheet: bestSheet(entries, [...names, codeLetters(campaign?.campaignName)]),
  };
}
