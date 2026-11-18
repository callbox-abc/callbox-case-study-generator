"use client";

// Quick picks in the import panel: today's 5 most active clients (60+ days running, ranked by
// sales-qualified appointments in the last 30 days), refreshed daily at 08:00 PH.
// The browser drives the cached steps (plan -> batches -> final). The first visit after 08:00 PH
// does the work, a few minutes once a day; later visits read the cache and load at once.
// Logos come from BrandIcons; the Community plan requires the visible "Icons by BrandIcons" link.

import { useEffect, useState } from "react";
import type { TopClient, TopClientsPayload } from "@/lib/topClients";

const LOGO_KEY = process.env.NEXT_PUBLIC_BRANDICONS_KEY || "";
const YELLOW = "#f5b914";
const PARALLEL = 3;
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

export default function TopClients({ onPick, disabled }: { onPick: (c: TopClient) => void; disabled?: boolean }) {
  const [data, setData] = useState<TopClientsPayload | null>(null);
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const plan = await getJson("/api/top-clients?step=plan");
      if (!alive) return;
      let checked = 0;
      setProgress({ checked, total: plan.candidates });
      // Batches are cached server-side: on later visits these return at once.
      let next = 0;
      const worker = async () => {
        while (alive && next < plan.batches) {
          const i = next++;
          let b: any = null;
          try {
            b = await getJson(`/api/top-clients?step=batch&i=${i}`);
          } catch {
            b = await getJson(`/api/top-clients?step=batch&i=${i}`).catch(() => null); // one retry
          }
          checked += b?.checked ?? 0;
          if (alive) setProgress({ checked, total: plan.candidates });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (!alive) return;
      const final = await getJson("/api/top-clients?step=final");
      if (alive) setData(final);
    })().catch((e) => alive && setError(e?.message || "Could not load today's clients."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div style={{ ...muted, marginTop: 12 }}>Today&apos;s most active clients are unavailable: {error}</div>;

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

      <div style={{ ...muted, marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
        <span>
          {!data
            ? progress
              ? `Checking today's clients: ${progress.checked} of ${progress.total}… The first check after 8:00 AM PH takes a few minutes; you can search and import meanwhile.`
              : "Loading today's clients…"
            : data.clients.length === 0
              ? "No client with 60+ days running had appointments in the last 30 days."
              : !data.complete
                ? `Ranked ${data.measured} of ${data.candidates} clients; the rest could not be checked today.`
                : `Ranked all ${data.measured} clients.`}
          {data && data.skippedUnnamed > 0
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
