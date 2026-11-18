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

import { useRef, useState } from "react";
import { MAX_FACTS, applyImportedFacts, mergeFacts, type RevampCaseStudy } from "@/lib/revamp";
import type { TopClient } from "@/lib/topClients";
import TopClients from "@/components/revamp/TopClients";

export type Campaign = {
  clientId: number;
  clientAccountId: number;
  campaignName: string;
  clientName: string;
  teamLeader: string | null;
  start: string | null;
  timezone?: string | null;
};
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

export default function DataImport({
  up,
  sheet,
  onClose,
  onImported,
}: {
  up: (fn: (d: RevampCaseStudy) => void) => void;
  sheet: Pick<RevampCaseStudy, "facts" | "clientName" | "country" | "solutionLines" | "primaryContact">;
  onClose: () => void;
  onImported?: () => void;
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
  };

  const selected = { client, campaign };
  const run = async (client: Client | null = selected.client, campaign: Campaign | null = selected.campaign) => {
    if (!client && !campaign) return;
    setBusy("import");
    setErr(false);
    const lines: string[] = [];
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

    if (client) {
      setMsgs([`Reading ${client.name} from HubSpot…`]);
      try {
        const prof = await hsPost({ step: "client", companyId: client.companyId });
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

    if (campaign) {
      try {
        const res = await pullCampaign(campaign, { start, fallbackStart: firstWon, onProgress: (m) => setMsgs([...lines, m]) });
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
  const pickTop = (c: TopClient) => {
    setQ(c.name);
    setClients(c.company ? [c.company] : []);
    setCampaigns([c.campaign]);
    setClient(c.company);
    setCampaign(c.campaign);
    setSrcErr({});
    setSearched(true);
    run(c.company, c.campaign);
  };

  const what = [client && "HubSpot", campaign && "CallboxOne"].filter(Boolean).join(" + ");

  return (
    <div className="app-toolbar" style={box}>
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
                </span>
              </button>
            ))}
          </Column>
        </div>
      )}

      {searched && (clients.length > 0 || campaigns.length > 0) && (
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={{ ...btn, borderColor: YELLOW, color: YELLOW, opacity: what ? 1 : 0.5 }} onClick={() => run()} disabled={busy !== "" || !what}>
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
