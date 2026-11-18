"use client";

// Quick picks in the import panel: today's 5 most active clients (60+ days running, ranked by
// sales-qualified appointments in the last 30 days), refreshed daily at 08:00 PH.
// The browser drives the cached steps (plan -> batches -> final). The first visit after 08:00 PH
// does the work (several minutes once a day, showing the most active found so far as it goes);
// later visits read the cache and load at once.
// Logos come from BrandIcons; the Community plan requires the visible "Icons by BrandIcons" link.

import { useEffect, useState } from "react";
import type { TopClient, TopClientsPayload } from "@/lib/topClients";

const LOGO_KEY = process.env.NEXT_PUBLIC_BRANDICONS_KEY || "";
const YELLOW = "#f5b914";
const PARALLEL = 2; // CallboxOne slows down under load; more parallel batches only time out
const card: React.CSSProperties = {
  display: "grid",
  gap: 6,
  alignContent: "start",
  padding: 12,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#191a1e",
  color: "#f5f5f7",
  textAlign: "left",
  cursor: "pointer",
  minHeight: 112,
  font: "inherit",
};
const muted: React.CSSProperties = { color: "#a4a4ae", fontSize: 12, lineHeight: 1.45 };

const initials = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function Logo({ c }: { c: TopClient }) {
  const [failed, setFailed] = useState(false);
  const box: React.CSSProperties = { width: 36, height: 36, borderRadius: 8, flex: "0 0 auto", background: "#232429" };
  if (!c.domain || !LOGO_KEY || failed) {
    return (
      <div style={{ ...box, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: YELLOW }} aria-hidden>
        {initials(c.name)}
      </div>
    );
  }
  const src = `https://cdn.brandicons.dev/icons/${encodeURIComponent(c.domain)}/medium?key=${encodeURIComponent(LOGO_KEY)}&p=@letter&pl=@loader-spin&bg=auto`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={36} height={36} style={{ ...box, objectFit: "contain" }} onError={() => setFailed(true)} />;
}

async function getJson(url: string) {
  const r = await fetch(url);
  const json = await r.json().catch(() => null);
  if (!r.ok || !json) throw new Error(json?.error || `HTTP ${r.status}`);
  return json;
}

async function postFinal(rows: unknown[], measured: number, complete: boolean): Promise<TopClientsPayload> {
  const r = await fetch("/api/top-clients?step=final", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, measured, complete }),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json) throw new Error(json?.error || `HTTP ${r.status}`);
  return json;
}

// While the daily check runs, the most active clients found so far are shown (named and with
// logos via the same final step, uncached) and refreshed at most this often.
const EARLY_EVERY_MS = 30_000;

export default function TopClients({ onPick, disabled }: { onPick: (c: TopClient) => void; disabled?: boolean }) {
  const [data, setData] = useState<TopClientsPayload | null>(null);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const plan = await getJson("/api/top-clients?step=plan");
      if (!alive) return;
      setProgress({ checked: 0, total: plan.candidates });
      // Batches are cached server-side once complete: on later visits they return at once.
      // A partial batch (it hit its deadline) is kept for now and retried once at the end.
      const done = new Map<number, { checked: number; partial: boolean; rows: unknown[] }>();
      const collected = () => {
        let checked = 0;
        const rows: unknown[] = [];
        done.forEach((b) => {
          checked += b.checked;
          rows.push(...b.rows);
        });
        return { checked, rows };
      };

      // Early results: the top clients among those checked so far.
      let finishedRef = false;
      let lastEarly = 0;
      let earlyBusy = false;
      let earlyRows = 0;
      const showEarly = () => {
        const { checked, rows } = collected();
        if (earlyBusy || rows.length === earlyRows || Date.now() - lastEarly < EARLY_EVERY_MS) return;
        earlyBusy = true;
        lastEarly = Date.now();
        earlyRows = rows.length;
        postFinal(rows, checked, false)
          .then((early) => alive && !finishedRef && setData(early))
          .catch(() => {})
          .finally(() => (earlyBusy = false));
      };

      let failuresInARow = 0;
      const runBatch = async (i: number) => {
        if (failuresInARow >= 3) return; // CallboxOne is struggling: stop instead of piling on
        try {
          const b = await getJson(`/api/top-clients?step=batch&i=${i}`);
          failuresInARow = 0;
          done.set(i, { checked: b.checked ?? 0, partial: Boolean(b.partial), rows: b.rows ?? [] });
        } catch {
          failuresInARow += 1;
        }
        if (!alive) return;
        setProgress({ checked: collected().checked, total: plan.candidates });
        showEarly();
      };
      let next = 0;
      const worker = async () => {
        while (alive && next < plan.batches) await runBatch(next++);
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      // One retry, one at a time, for batches that failed or stopped early.
      for (let i = 0; alive && i < plan.batches; i++) if (!done.has(i) || done.get(i)!.partial) await runBatch(i);
      if (!alive) return;
      if (failuresInARow >= 3 && done.size === 0) throw new Error("CallboxOne is not answering right now. Try again later.");

      const { checked, rows } = collected();
      const complete = done.size === plan.batches && [...done.values()].every((b) => !b.partial);
      const final = await postFinal(rows, checked, complete);
      finishedRef = true;
      if (alive) {
        setData(final);
        setFinished(true);
      }
    })().catch((e) => alive && setError(e?.message || "Could not load today's clients."));
    return () => {
      alive = false;
    };
  }, []);

  if (error && !data) return <div style={{ ...muted, marginTop: 12 }}>Today&apos;s most active clients are unavailable: {error}</div>;

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.checked / progress.total) * 100)) : 0;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ color: "#f5f5f7" }}>Today&apos;s most active clients</b>
        <span style={muted}>· running 60+ days, by sales-qualified appointments in the last 30 days · click one to import it · refreshes daily at 8:00 AM PH</span>
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
        {!data &&
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ ...card, cursor: "default", opacity: 0.45 }} aria-hidden>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#232429" }} />
              <div style={{ height: 11, width: "70%", borderRadius: 4, background: "#232429" }} />
              <div style={{ height: 9, width: "50%", borderRadius: 4, background: "#232429" }} />
            </div>
          ))}
        {data?.clients.map((c) => (
          <button
            key={c.campaign.clientAccountId}
            style={{ ...card, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}
            disabled={disabled}
            onClick={() => onPick(c)}
            title={`Import ${c.name}`}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Logo c={c} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.25, overflowWrap: "anywhere" }}>{c.name}</div>
                <div style={{ ...muted, fontSize: 11 }}>{c.campaign.campaignName}</div>
              </div>
            </div>
            <div style={{ fontSize: 12.5 }}>
              <b style={{ color: YELLOW }}>{c.sql30}</b> appointment{c.sql30 === 1 ? "" : "s"} in 30 days
            </div>
            <div style={{ ...muted, fontSize: 11.5 }}>
              {[c.topChannel && `${c.topChannel}-led`, `${c.months} month${c.months === 1 ? "" : "s"} running`].filter(Boolean).join(" · ")}
            </div>
          </button>
        ))}
      </div>

      {!finished && progress && (
        <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: "#191a1e", overflow: "hidden" }} aria-hidden>
          <div style={{ width: `${pct}%`, height: "100%", background: YELLOW, transition: "width 0.4s" }} />
        </div>
      )}

      <div style={{ ...muted, marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
        <span>
          {!finished && error
            ? `Stopped at ${progress?.checked ?? 0} of ${progress?.total ?? 0} clients: ${error} Showing the most active found before that.`
            : !finished
            ? progress
              ? `Checking today's clients: ${progress.checked} of ${progress.total} (${pct}%). ` +
                (data
                  ? "Showing the most active found so far; the list updates as the check runs."
                  : "The first check after 8:00 AM PH takes several minutes; you can search and import meanwhile.")
              : "Loading today's clients…"
            : data && data.clients.length === 0
              ? "No client with 60+ days running had appointments in the last 30 days."
              : data && !data.complete
                ? `Ranked ${data.measured} of ${data.candidates} clients; the rest could not be checked today.`
                : `Ranked all ${data?.measured ?? 0} clients.`}
          {finished && data && data.skippedUnnamed > 0
            ? ` ${data.skippedUnnamed} skipped: CallboxOne only has an offer name for them and HubSpot has no matching company.`
            : ""}
        </span>
        <a href="https://brandicons.dev" target="_blank" rel="noreferrer" style={{ color: "#a4a4ae" }}>
          Icons by BrandIcons
        </a>
      </div>
    </div>
  );
}
