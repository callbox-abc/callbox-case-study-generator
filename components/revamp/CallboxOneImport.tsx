"use client";

import { useState } from "react";
import type { RevampCaseStudy } from "@/lib/revamp";

type Campaign = {
  clientId: number;
  clientAccountId: number;
  campaignName: string;
  clientName: string;
  teamLeader: string | null;
  start: string | null;
  timezone?: string | null;
};

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

// Reads a response as JSON; a non-JSON body (e.g. Vercel's "An error occurred…" timeout page)
// becomes a readable error instead of "Unexpected token".
async function readJson(res: Response) {
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    const timeout = res.status === 504 || /timeout|an error occurred/i.test(text);
    throw new Error(
      timeout
        ? "CallboxOne took too long to answer (server time limit). Try again in a moment."
        : `Server error (HTTP ${res.status}): ${text.slice(0, 140)}`
    );
  }
  if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status}).`);
  return json;
}

const post = (body: unknown) =>
  fetch("/api/callboxone/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(readJson);

// "Import numbers from CallboxOne": fills the data sections (hero stats, period/channel facts,
// channels, quarters, funnel) from the campaign record. Narrative text is never touched.
export default function CallboxOneImport({
  up,
  onClose,
  onImported,
}: {
  up: (fn: (d: RevampCaseStudy) => void) => void;
  onClose: () => void;
  onImported?: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState<"" | "search" | "import">("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);
  const [startOverride, setStartOverride] = useState("");
  const [who, setWho] = useState<{ userName: string | null; globalClientScope: boolean } | null>(null);

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy("search");
    setMsg("");
    setErr(false);
    try {
      const json = await readJson(await fetch(`/api/callboxone/search?q=${encodeURIComponent(q.trim())}`));
      setResults(json.campaigns || []);
      setWho(json.identity || null);
      if (!json.campaigns?.length) {
        const scope = json.identity && !json.identity.globalClientScope
          ? ` The token belongs to ${json.identity.userName || "a user"} without global client access, so only that user's teams are searchable.`
          : "";
        setMsg("No active campaigns match that search." + scope);
      }
    } catch (e: any) {
      setErr(true);
      setMsg(e?.message || "Search failed.");
    } finally {
      setBusy("");
    }
  };

  const importCampaign = async (c: Campaign) => {
    setBusy("import");
    setErr(false);
    try {
      setMsg(`Planning ${c.campaignName}…`);
      const { windows } = await post({ step: "plan", campaignName: c.campaignName, start: startOverride || undefined });

      // One request per quarter (each stays under the server time limit), 3 at a time, one retry each.
      const perWindow: unknown[] = new Array(windows.length);
      let done = 0;
      const report = () => setMsg(`Pulling ${c.campaignName} from CallboxOne: ${done}/${windows.length} quarters…`);
      report();
      const fetchWindow = async (i: number) => {
        const body = { step: "window", clientId: c.clientId, clientAccountId: c.clientAccountId, from: windows[i].from, to: windows[i].to };
        try {
          perWindow[i] = (await post(body)).totals;
        } catch {
          perWindow[i] = (await post(body)).totals;
        }
        done += 1;
        report();
      };
      let next = 0;
      const worker = async () => {
        while (next < windows.length) await fetchWindow(next++);
      };
      // Lists (counts and groups only) are fetched alongside the quarters; optional extra data.
      const listsP = post({ step: "lists", clientId: c.clientId, clientAccountId: c.clientAccountId }).catch(() => ({ lists: null }));
      const progressionP = post({
        step: "progression",
        clientId: c.clientId,
        from: windows[0].from,
        to: windows[windows.length - 1].to,
      });
      await Promise.all([worker(), worker(), worker()]);
      const { progression } = await progressionP;
      const { lists } = await listsP;

      setMsg("Building the data sections…");
      const json = await post({ step: "build", campaign: c, windows, perWindow, progression, lists });
      const p = json.patch;
      up((d) => {
        d.heroStats = p.heroStats;
        // Replace only the facts CallboxOne owns; keep the rest the writer entered.
        const owned = new Set(p.facts.map((f: { label: string }) => f.label.toLowerCase()));
        d.facts = [...p.facts, ...d.facts.filter((f) => !owned.has(f.label.toLowerCase()))].slice(0, 8);
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
      });
      setMsg(
        `Imported ${c.campaignName}: ${json.period.months} months (${json.period.from} to ${json.period.to}). ` +
          (json.notes?.length ? json.notes.join(" ") + " " : "") +
          "The AI is now drafting the empty sections from these numbers."
      );
      onImported?.();
    } catch (e: any) {
      setErr(true);
      setMsg(e?.message || "Import failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="app-toolbar" style={box}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <b style={{ color: "#f5f5f7" }}>Import numbers from CallboxOne</b>
        <input
          id="cb1-search"
          aria-label="Campaign or client name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Campaign code or client, e.g. NETRIX"
          style={{ ...input, flex: "1 1 240px" }}
        />
        <input
          id="cb1-start"
          aria-label="Start month override"
          value={startOverride}
          onChange={(e) => setStartOverride(e.target.value)}
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

      {results.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {results.map((c) => (
            <button
              key={c.clientAccountId}
              onClick={() => importCampaign(c)}
              disabled={busy !== ""}
              style={{ ...btn, textAlign: "left", display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}
            >
              <span>
                <b>{c.campaignName}</b> · {c.clientName}
              </span>
              <span style={{ color: "#a4a4ae" }}>
                {c.start ? `since ${c.start}` : "start unknown"}
                {c.teamLeader ? ` · TL ${c.teamLeader}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {who && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#a4a4ae" }}>
          Connected to CallboxOne as <b>{who.userName || "unknown user"}</b> ·{" "}
          {who.globalClientScope ? "all clients" : "own teams only"}
        </div>
      )}
      {msg && <div style={{ marginTop: 10, color: err ? "#fca5a5" : "#c7c8d3" }}>{msg}</div>}
    </div>
  );
}
