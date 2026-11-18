"use client";

// "Import client data": HubSpot (client facts) and CallboxOne (campaign numbers) in one flow.
//
// The two sources fill each other's gaps:
//  - Search: one box queries both. If one source finds nothing, it is searched again with a term
//    from the other (HubSpot company name -> CallboxOne; campaign code letters -> HubSpot).
//  - Start month: when a campaign code has no YYMM, HubSpot's first closed deal is the fallback.
//  - Client name: CallboxOne's "client name" is often the offer label, so HubSpot supplies it.
//  - One AI draft at the end, with both sources on the sheet.
// Narrative text is never touched; client name and country are filled only when empty.

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_REVAMP, MAX_FACTS, applyImportedFacts, mergeFacts, type RevampCaseStudy } from "@/lib/revamp";
import type { StoredImport, TopClient } from "@/lib/topClients";
import type { RecentClient } from "@/lib/recentClients";
import { recentKey } from "@/lib/recentKey";
import { Logo, LogoCredit, RecentClients, TopClients, ago } from "@/components/revamp/TopClients";

export type Campaign = {
  clientId: number;
  clientAccountId: number;
  campaignName: string;
  clientName: string;
  teamLeader: string | null;
  start: string | null;
  timezone?: string | null;
};
export type ImportSource = { key: string; client: Client | null; campaign: Campaign | null; stored: StoredImport | null };
export type Client = { companyId: string; name: string; domain: string; location: string; deals: number; firstDeal: string | null };
type Facts = RevampCaseStudy["facts"];

const YELLOW = "#f5b914";
const box: React.CSSProperties = {
  maxWidth: 1100,
  margin: "10px auto 0",
  padding: "12px 16px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#232429",
  color: "#c7c8d3",
  fontSize: 13,
};
const input: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#191a1e",
  color: "#f5f5f7",
  fontSize: 13,
  outline: "none",
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "#f5f5f7",
  fontSize: 12,
  cursor: "pointer",
};
const row = (selected: boolean): React.CSSProperties => ({
  ...btn,
  textAlign: "left",
  display: "flex",
  gap: 12,
  justifyContent: "space-between",
  flexWrap: "wrap",
  borderColor: selected ? YELLOW : "rgba(255,255,255,0.14)",
  background: selected ? "rgba(245,185,20,0.08)" : "transparent",
});
const muted: React.CSSProperties = { color: "#a4a4ae", fontSize: 12 };

// Reads a response as JSON; a non-JSON body (e.g. Vercel's "An error occurred…" timeout page)
// becomes a readable error instead of "Unexpected token".
async function readJson(res: Response, source: string) {
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    const timeout = res.status === 504 || /timeout|an error occurred/i.test(text);
    throw new Error(
      timeout ? `${source} took too long to answer (server time limit). Try again in a moment.` : `Server error (HTTP ${res.status}): ${text.slice(0, 140)}`
    );
  }
  if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status}).`);
  return json;
}

const postJson = (url: string, body: unknown, source: string) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => readJson(r, source));
const hsPost = (body: unknown) => postJson("/api/hubspot", body, "HubSpot");
const cbPost = (body: unknown) => postJson("/api/callboxone/import", body, "CallboxOne");

// Search terms one source can lend the other.
const nameTerm = (name: string) => name.split(/[^A-Za-z0-9&]+/).find((w) => w.length >= 3) ?? "";
const codeTerm = (code: string) => /^[A-Za-z]+/.exec(code.trim())?.[0] ?? "";

// Step-by-step CallboxOne pull: one request per quarter (each stays under the server time limit),
// 3 at a time, one retry each; lists and progression alongside.
async function pullCampaign(c: Campaign, opts: { start: string; fallbackStart: string | null; onProgress: (m: string) => void }) {
  opts.onProgress(`Planning ${c.campaignName}…`);
  const plan = await cbPost({ step: "plan", campaignName: c.campaignName, start: opts.start || undefined, fallbackStart: opts.fallbackStart || undefined });
  const windows = plan.windows;
  const perWindow: unknown[] = new Array(windows.length);
  let done = 0;
  const report = () => opts.onProgress(`Pulling ${c.campaignName} from CallboxOne: ${done}/${windows.length} quarters…`);
  report();
  const fetchWindow = async (i: number) => {
    const body = { step: "window", clientId: c.clientId, clientAccountId: c.clientAccountId, from: windows[i].from, to: windows[i].to };
    try {
      perWindow[i] = (await cbPost(body)).totals;
    } catch {
      perWindow[i] = (await cbPost(body)).totals;
    }
    done += 1;
    report();
  };
  let next = 0;
  const worker = async () => {
    while (next < windows.length) await fetchWindow(next++);
  };
  const listsP = cbPost({ step: "lists", clientId: c.clientId, clientAccountId: c.clientAccountId }).catch(() => ({ lists: null }));
  const progressionP = cbPost({ step: "progression", clientId: c.clientId, from: windows[0].from, to: windows[windows.length - 1].to });
  await Promise.all([worker(), worker(), worker()]);
  const { progression } = await progressionP;
  const { lists } = await listsP;
  opts.onProgress("Building the data sections…");
  const built = await cbPost({ step: "build", campaign: c, windows, perWindow, progression, lists });
  return { ...built, startSource: plan.startSource as "override" | "code" | "hubspot" };
}

function applyCampaignPatch(d: RevampCaseStudy, p: any) {
  d.heroStats = p.heroStats;
  applyImportedFacts(d, p.facts);
  d.channels.rows = p.channels.rows;
  d.progression.quarters = p.progression.quarters.map((nq: any) => {
    const old = d.progression.quarters.find((oq) => oq.label === nq.label);
    return { ...nq, note: old?.note || nq.note };
  });
  d.progression.chartTitle = d.progression.chartTitle || p.progression.chartTitle;
  d.progression.chartMeta = p.progression.chartMeta;
  d.funnel.stages = p.funnel.stages;
  if (p.howItRan.roles.length) d.howItRan.roles = p.howItRan.roles;
  d.howItRan.rolesFootnote = d.howItRan.rolesFootnote || p.howItRan.rolesFootnote;
  d.methodologyNote = d.methodologyNote || p.methodologyNote;
}

function Column({ title, hint, error, empty, children }: { title: string; hint: string; error?: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
      <div>
        <b style={{ color: "#f5f5f7" }}>{title}</b> <span style={muted}>· {hint}</span>
      </div>
      {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : empty ? <div style={muted}>No match.</div> : children}
    </div>
  );
}

// Asked before pulling a client live when it is already saved (recent searches): the cached data
// (or reviewed sheet) can be used as is, or replaced with fresh data for everyone.
function CachedPrompt({
  entry,
  onCached,
  onLive,
  onClose,
}: {
  entry: RecentClient;
  onCached: () => void;
  onLive: () => void;
  onClose: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const name = entry.campaign?.campaignName || entry.name;
  const saved = entry.sheet
    ? `${entry.sheet.reviewed ? "a reviewed" : "a draft"} case study, saved ${ago(entry.sheet.savedAt)}`
    : `the imported data, saved ${ago(entry.importedAt)}`;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cached-prompt-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          padding: 22,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "#232429",
          color: "#f5f5f7",
          boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Logo name={entry.name} domain={entry.domain} />
          <b id="cached-prompt-title" style={{ fontSize: 15, lineHeight: 1.35 }}>
            {name} was already in recent search. Do you want to override the data?
          </b>
        </div>
        <p style={{ color: "#a4a4ae", lineHeight: 1.55, margin: "12px 0 18px" }}>
          Saved: {saved}
          {entry.cmsDraft ? `, with CMS draft #${entry.cmsDraft.id}` : ""}. Fetching live data pulls fresh numbers from HubSpot and
          CallboxOne and replaces the saved data{entry.sheet ? " and sheet" : ""} for everyone.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={onLive} style={btn}>
            Fetch Live Data
          </button>
          <button ref={primary} onClick={onCached} style={{ ...btn, background: YELLOW, borderColor: YELLOW, color: "#17181c", fontWeight: 700 }}>
            Use Cached data
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DataImport({
  up,
  sheet,
  onClose,
  onImported,
  onSource,
  onLoadSaved,
  prepareSwitch,
}: {
  up: (fn: (d: RevampCaseStudy) => void) => void;
  sheet: Pick<RevampCaseStudy, "facts" | "clientName" | "country" | "solutionLines" | "primaryContact">;
  onClose: () => void;
  onImported?: () => void;
  // The saved-import key of the data now on the sheet, so a CMS draft can be linked to it.
  // Where the data on the sheet came from, so the editor can autosave the sheet to that client.
  onSource?: (src: ImportSource) => void;
  // A client with a saved sheet: the editor restores the sheet itself (text, review state).
  onLoadSaved?: (r: RecentClient) => void;
  // Before another client is loaded: the editor may ask to save the current one and clears the
  // sheet ("switched"), or the user cancels (false).
  prepareSwitch?: (next: { clientAccountId?: number | null; companyId?: string | null }) => Promise<"same" | "switched" | false>;
}) {
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const [q, setQ] = useState(sheet.clientName);
  const [start, setStart] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [searched, setSearched] = useState(false);
  const [srcErr, setSrcErr] = useState<{ hubspot?: string; callboxone?: string }>({});
  const [who, setWho] = useState<{ userName: string | null; globalClientScope: boolean } | null>(null);
  const [busy, setBusy] = useState<"" | "search" | "import">("");
  const [msgs, setMsgs] = useState<string[]>([]);
  const [err, setErr] = useState(false);
  // Clients anyone imported recently (shared): quick picks and "already imported" badges.
  const [recent, setRecent] = useState<RecentClient[]>([]);
  // A live pull was asked for a client that is already saved: ask first.
  const [prompt, setPrompt] = useState<{ cached: RecentClient; client: Client | null; campaign: Campaign | null } | null>(null);
  const closePrompt = useCallback(() => setPrompt(null), []);
  const loadRecent = () =>
    fetch("/api/recent-clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.recent && setRecent(j.recent))
      .catch(() => {});
  useEffect(() => {
    loadRecent();
  }, []);

  const search = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setBusy("search");
    setMsgs([]);
    setErr(false);
    const errs: { hubspot?: string; callboxone?: string } = {};
    const hsFind = (t: string): Promise<Client[]> =>
      hsPost({ step: "search", q: t })
        .then((j) => j.clients || [])
        .catch((e) => {
          errs.hubspot = e?.message || "HubSpot search failed.";
          return [];
        });
    const cbFind = (t: string): Promise<Campaign[]> =>
      fetch(`/api/callboxone/search?q=${encodeURIComponent(t)}`)
        .then((r) => readJson(r, "CallboxOne"))
        .then((j) => {
          if (j.identity) setWho(j.identity);
          return j.campaigns || [];
        })
        .catch((e) => {
          errs.callboxone = e?.message || "CallboxOne search failed.";
          return [];
        });

    let [hs, cb] = await Promise.all([hsFind(term), cbFind(term)]);
    // Each source lends the other a search term when its own search came up empty.
    if (!cb.length && hs.length && !errs.callboxone) {
      const t = nameTerm(hs[0].name);
      if (t && t.toLowerCase() !== term.toLowerCase()) cb = await cbFind(t);
    }
    if (!hs.length && cb.length && !errs.hubspot) {
      const t = codeTerm(cb[0].campaignName);
      if (t.length >= 3 && t.toLowerCase() !== term.toLowerCase()) hs = await hsFind(t);
    }
    setClients(hs);
    setCampaigns(cb);
    setClient(hs.length === 1 ? hs[0] : null);
    setCampaign(cb.length === 1 ? cb[0] : null);
    setSrcErr(errs);
    setSearched(true);
    setBusy("");
    const preClient = hs.length === 1 ? hs[0] : null;
    const preCampaign = cb.length === 1 ? cb[0] : null;
    if (preClient || preCampaign) {
      const cached = await findCached(preClient, preCampaign);
      if (cached) setPrompt({ cached, client: preClient, campaign: preCampaign });
    }
  };

  const selected = { client, campaign };
  // With `stored`, the saved data (weekly snapshot or a recent import) is applied instead of
  // calling HubSpot and CallboxOne. A live import is saved for everyone afterwards.
  const run = async (
    client: Client | null = selected.client,
    campaign: Campaign | null = selected.campaign,
    stored?: StoredImport,
    storedLabel = "saved data"
  ) => {
    if (!client && !campaign) return;
    if (prepareSwitch) {
      const ready = await prepareSwitch({ clientAccountId: campaign?.clientAccountId, companyId: client?.companyId });
      if (!ready) return;
      if (ready === "switched") sheetRef.current = EMPTY_REVAMP; // compare against the clean sheet
    }
    setBusy("import");
    setErr(false);
    const lines: string[] = [];
    if (stored) lines.push(`Loaded from ${storedLabel}: no new HubSpot or CallboxOne calls. Search the client to pull fresh numbers.`);
    let profUsed: any = null;
    let resUsed: any = null;
    let failed = false;
    let pulledNumbers = false;
    // Fact merges are mirrored locally so the message can name facts left out by the limit.
    let facts: Facts = sheetRef.current.facts;
    const dropped = new Set<string>();
    const mergeLocal = (incoming: Facts) => {
      const m = mergeFacts(facts, incoming);
      facts = m.facts;
      m.dropped.forEach((x) => dropped.add(x));
    };
    let firstWon: string | null = null;

    if (client && stored && !stored.hubspot) lines.push(`The ${storedLabel} has no HubSpot profile for ${client.name}.`);
    if (client && (!stored || stored.hubspot)) {
      setMsgs([...lines, stored ? `Loading ${client.name}…` : `Reading ${client.name} from HubSpot…`]);
      try {
        const prof: any = stored ? stored.hubspot : await hsPost({ step: "client", companyId: client.companyId });
        profUsed = prof;
        const now = sheetRef.current;
        mergeLocal(prof.facts);
        up((d) => {
          applyImportedFacts(d, prof.facts);
          if (!d.clientName.trim() && prof.company.name) d.clientName = prof.company.name;
          if (!d.country.trim() && prof.company.country) d.country = prof.company.country;
          if (!d.solutionLines.trim() && prof.company.solutionLines) d.solutionLines = prof.company.solutionLines;
          const pc = prof.primaryContact;
          if (pc) {
            if (!d.primaryContact.role.trim()) d.primaryContact.role = pc.role;
            if (!d.primaryContact.eyebrow.trim()) d.primaryContact.eyebrow = "Callbox works with";
          }
          d.internal = { extraFacts: d.internal?.extraFacts || [], leadSource: pc?.leadSource || "" };
        });
        firstWon = prof.relationship?.firstWon ?? null;
        const kept: string[] = [];
        if (now.clientName.trim() && prof.company.name && now.clientName.trim() !== prof.company.name) kept.push(`client name (HubSpot says ${prof.company.name})`);
        if (now.country.trim() && prof.company.country && now.country.trim() !== prof.company.country) kept.push(`country (HubSpot says ${prof.company.country})`);
        if (now.solutionLines.trim() && prof.company.solutionLines && now.solutionLines.trim() !== prof.company.solutionLines) {
          kept.push(`solution lines (HubSpot suggests ${prof.company.solutionLines})`);
        }
        const pc = prof.primaryContact;
        if (pc && now.primaryContact.role.trim() && now.primaryContact.role.trim() !== pc.role) kept.push(`primary contact role (HubSpot says ${pc.role})`);
        lines.push(
          `HubSpot: ${prof.facts.length} client fact${prof.facts.length === 1 ? "" : "s"} from ${prof.company.name || client.name}.` +
            (pc ? ` Primary contact: ${pc.role} (the client contact on ${pc.deals} closed-won deal${pc.deals === 1 ? "" : "s"}).` : "") +
            (kept.length ? ` Kept the sheet's ${kept.join(" and ")}.` : "") +
            (prof.notes?.length ? " " + prof.notes.join(" ") : "")
        );
      } catch (e: any) {
        failed = true;
        lines.push(`HubSpot failed: ${e?.message || "unknown error"}`);
      }
    }

    if (campaign && stored && !stored.callboxone) {
      lines.push(`The ${storedLabel} has no CallboxOne numbers for ${campaign.campaignName}${stored.error ? ` (${stored.error})` : ""}.`);
    }
    if (campaign && (!stored || stored.callboxone)) {
      try {
        const res: any = stored
          ? stored.callboxone
          : await pullCampaign(campaign, { start, fallbackStart: firstWon, onProgress: (m) => setMsgs([...lines, m]) });
        resUsed = res;
        mergeLocal(res.patch.facts);
        up((d) => applyCampaignPatch(d, res.patch));
        const notes: string[] = [...(res.notes || [])];
        const began = String(res.period.from).slice(0, 7);
        if (res.startSource === "hubspot") {
          notes.push(`The campaign code has no start month, so HubSpot's first closed deal (${firstWon}) was used. Set a start month above if the campaign began later.`);
        } else if (firstWon && began < firstWon) {
          notes.push(`The campaign starts (${began}) before HubSpot's first closed deal (${firstWon}). Check the start month.`);
        }
        lines.push(`CallboxOne: ${campaign.campaignName}, ${res.period.months} months (${res.period.from} to ${res.period.to}).` + (notes.length ? " " + notes.join(" ") : ""));
        pulledNumbers = true;
      } catch (e: any) {
        failed = true;
        lines.push(`CallboxOne failed: ${e?.message || "unknown error"}`);
      }
    }

    if (dropped.size) lines.push(`Not shown, to stay within ${MAX_FACTS} facts (the AI still uses them): ${[...dropped].join(", ")}.`);
    // A live import is saved for everyone ("Recently imported clients"); saved data isn't re-saved.
    let key: string | null = recentKey(campaign?.clientAccountId, client?.companyId);
    if (!stored && (profUsed || resUsed)) {
      key = await fetch("/api/recent-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, campaign, hubspot: profUsed, callboxone: resUsed }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.key ?? key)
        .catch(() => key);
      loadRecent();
    }
    if (profUsed || resUsed) {
      onSource?.({ key: key || recentKey(campaign?.clientAccountId, client?.companyId), client, campaign, stored: stored ?? { hubspot: profUsed, callboxone: resUsed } });
    }
    if (pulledNumbers) {
      lines.push("The AI is now drafting the empty sections from this data.");
      onImported?.();
    }
    setErr(failed);
    setMsgs(lines);
    setBusy("");
  };

  // Quick pick: the client and campaign are already known, so they are selected and imported
  // right away, without a search.
  // A saved sheet (someone already drafted or reviewed this client) is restored as is: no new
  // HubSpot, CallboxOne or AI calls, except the AI filling fields that are still empty.
  const loadSaved = async (r: RecentClient) => {
    if (prepareSwitch && !(await prepareSwitch({ clientAccountId: r.campaign?.clientAccountId, companyId: r.company?.companyId }))) return;
    setQ(r.name);
    setClients(r.company ? [r.company] : []);
    setCampaigns(r.campaign ? [r.campaign] : []);
    setClient(r.company);
    setCampaign(r.campaign);
    setSrcErr({});
    setSearched(true);
    setErr(false);
    setMsgs([
      `Loaded the ${r.sheet!.reviewed ? "reviewed" : "draft"} case study saved ${ago(r.sheet!.savedAt)}: no new HubSpot, CallboxOne or AI calls (the AI only fills fields that are still empty). Search the client to start over with fresh numbers.`,
    ]);
    onLoadSaved?.(r);
  };

  const pickTop = async (c: TopClient) => {
    // A saved sheet for this client, from the list or (if it has scrolled off) looked up directly.
    const key = recentKey(c.campaign.clientAccountId, c.company?.companyId);
    let saved = recent.find((r) => r.key === key);
    if (!saved && onLoadSaved) {
      setBusy("import");
      saved = await fetch(`/api/recent-clients?key=${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.entry ?? undefined)
        .catch(() => undefined);
      setBusy("");
    }
    if (saved?.sheet && onLoadSaved) return loadSaved(saved);
    setQ(c.name);
    setClients(c.company ? [c.company] : []);
    setCampaigns([c.campaign]);
    setClient(c.company);
    setCampaign(c.campaign);
    setSrcErr({});
    setSearched(true);
    run(c.company, c.campaign, c.stored, "this week's snapshot");
  };

  // A recent import: load what was saved, without new calls.
  const pickRecent = (r: RecentClient) => {
    if (r.sheet && onLoadSaved) return loadSaved(r);
    setQ(r.name);
    setClients(r.company ? [r.company] : []);
    setCampaigns(r.campaign ? [r.campaign] : []);
    setClient(r.company);
    setCampaign(r.campaign);
    setSrcErr({});
    setSearched(true);
    run(r.company, r.campaign, r.stored, `the import saved ${ago(r.importedAt)}`);
  };

  // The saved entry for a selection: matched on the campaign (its CallboxOne numbers are the costly
  // part), else on the HubSpot company; from the list, or looked up directly if it scrolled off.
  const findCached = async (cl: Client | null, ca: Campaign | null): Promise<RecentClient | undefined> => {
    const inList = recent.find((r) =>
      ca ? r.campaign?.clientAccountId === ca.clientAccountId : Boolean(cl && r.company?.companyId === cl.companyId)
    );
    if (inList) return inList;
    const key = recentKey(ca?.clientAccountId, cl?.companyId);
    return fetch(`/api/recent-clients?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.entry ?? undefined)
      .catch(() => undefined);
  };

  // The Import button: a selection that is already saved asks before pulling live.
  const requestImport = async () => {
    const cl = client;
    const ca = campaign;
    if (!cl && !ca) return;
    setBusy("import");
    const cached = await findCached(cl, ca);
    setBusy("");
    if (cached) setPrompt({ cached, client: cl, campaign: ca });
    else run(cl, ca);
  };

  // "Already imported" badges for search results.
  const savedFor = (companyId?: string, clientAccountId?: number) =>
    recent.find((r) => (companyId && r.company?.companyId === companyId) || (clientAccountId && r.campaign?.clientAccountId === clientAccountId));
  const savedBadge = (r: RecentClient | undefined) =>
    r ? ` · imported ${ago(r.importedAt)}${r.cmsDraft ? ` · CMS draft #${r.cmsDraft.id}` : ""}` : "";

  const what = [client && "HubSpot", campaign && "CallboxOne"].filter(Boolean).join(" + ");

  return (
    <div className="app-toolbar" style={box}>
      {prompt && (
        <CachedPrompt
          entry={prompt.cached}
          onClose={closePrompt}
          onCached={() => {
            const r = prompt.cached;
            setPrompt(null);
            pickRecent(r);
          }}
          onLive={() => {
            const { client: cl, campaign: ca } = prompt;
            setPrompt(null);
            run(cl, ca);
          }}
        />
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <b style={{ color: "#f5f5f7" }}>Import client data</b>
        <input
          id="import-search"
          aria-label="Client name or campaign code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && busy === "" && search()}
          placeholder="Client or campaign code, e.g. Netrix or NETRIX"
          style={{ ...input, flex: "1 1 240px" }}
        />
        <input
          id="import-start"
          aria-label="Campaign start month override"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Start YYYY-MM (optional)"
          style={{ ...input, width: 170 }}
        />
        <button style={btn} onClick={search} disabled={busy !== ""}>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
        <button style={btn} onClick={onClose} disabled={busy === "import"}>
          Close
        </button>
      </div>

      <TopClients onPick={pickTop} disabled={busy !== ""} />
      <RecentClients recent={recent} onPick={pickRecent} disabled={busy !== ""} />
      <LogoCredit />

      {searched && (
        <div style={{ marginTop: 12, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <Column title="HubSpot client" hint="industry, HQ, size, client since, growth" error={srcErr.hubspot} empty={!clients.length}>
            {clients.map((c) => (
              <button key={c.companyId} style={row(client?.companyId === c.companyId)} disabled={busy !== ""} onClick={() => setClient(client?.companyId === c.companyId ? null : c)}>
                <span>
                  <b>{c.name}</b>
                  {c.domain ? ` · ${c.domain}` : ""}
                  {c.location ? ` · ${c.location}` : ""}
                </span>
                <span style={muted}>
                  {c.deals} deal{c.deals === 1 ? "" : "s"}
                  {c.firstDeal ? ` · first deal created ${c.firstDeal}` : ""}
                  {savedBadge(savedFor(c.companyId))}
                </span>
              </button>
            ))}
          </Column>
          <Column title="CallboxOne campaign" hint="activity, appointments, quarters, funnel" error={srcErr.callboxone} empty={!campaigns.length}>
            {campaigns.map((c) => (
              <button key={c.clientAccountId} style={row(campaign?.clientAccountId === c.clientAccountId)} disabled={busy !== ""} onClick={() => setCampaign(campaign?.clientAccountId === c.clientAccountId ? null : c)}>
                <span>
                  <b>{c.campaignName}</b> · {c.clientName}
                </span>
                <span style={muted}>
                  {c.start ? `since ${c.start}` : "start unknown"}
                  {c.teamLeader ? ` · TL ${c.teamLeader}` : ""}
                  {savedBadge(savedFor(undefined, c.clientAccountId))}
                </span>
              </button>
            ))}
          </Column>
        </div>
      )}

      {searched && (clients.length > 0 || campaigns.length > 0) && (
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={{ ...btn, borderColor: YELLOW, color: YELLOW, opacity: what ? 1 : 0.5 }} onClick={requestImport} disabled={busy !== "" || !what}>
            {busy === "import" ? "Importing…" : what ? `Import ${what}` : "Select a row to import"}
          </button>
          <span style={muted}>Click a row to select or unselect it. Single matches are preselected.</span>
        </div>
      )}

      {who && (
        <div style={{ ...muted, marginTop: 8 }}>
          CallboxOne connected as <b>{who.userName || "unknown user"}</b> · {who.globalClientScope ? "all clients" : "own teams only"}
        </div>
      )}
      {msgs.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 4, color: err ? "#fca5a5" : "#c7c8d3" }}>
          {msgs.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}
