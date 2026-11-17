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

// "Import numbers from CallboxOne": fills the data sections (hero stats, period/channel facts,
// channels, quarters, funnel) from the campaign record. Narrative text is never touched.
export default function CallboxOneImport({ up, onClose }: { up: (fn: (d: RevampCaseStudy) => void) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState<"" | "search" | "import">("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);
  const [startOverride, setStartOverride] = useState("");

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy("search");
    setMsg("");
    setErr(false);
    try {
      const res = await fetch(`/api/callboxone/search?q=${encodeURIComponent(q.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Search failed.");
      setResults(json.campaigns || []);
      if (!json.campaigns?.length) setMsg("No active campaigns match that search.");
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
    setMsg(`Pulling ${c.campaignName} from CallboxOne (one report per quarter, this can take a minute)…`);
    try {
      const res = await fetch("/api/callboxone/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...c, start: startOverride || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed.");
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
      });
      setMsg(
        `Imported ${c.campaignName}: ${json.period.months} months (${json.period.from} to ${json.period.to}). ` +
          (json.notes?.length ? json.notes.join(" ") : "")
      );
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

      {msg && <div style={{ marginTop: 10, color: err ? "#fca5a5" : "#c7c8d3" }}>{msg}</div>}
    </div>
  );
}
