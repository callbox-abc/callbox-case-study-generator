"use client";

// Start screen quick picks: today's 5 most active clients (60+ days running, ranked by
// sales-qualified appointments in the last 30 days), refreshed daily at 08:00 PH.
// Logos come from BrandIcons; the Community plan requires the visible "Icons by BrandIcons" link.

import { useEffect, useState } from "react";
import type { TopClient, TopClientsPayload } from "@/lib/topClients";

const LOGO_KEY = process.env.NEXT_PUBLIC_BRANDICONS_KEY || "";
const YELLOW = "#f5b914";
const card: React.CSSProperties = {
  display: "grid",
  gap: 8,
  alignContent: "start",
  padding: 14,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#232429",
  color: "#f5f5f7",
  textAlign: "left",
  cursor: "pointer",
  minHeight: 132,
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
  const box: React.CSSProperties = { width: 40, height: 40, borderRadius: 8, flex: "0 0 auto", background: "#191a1e" };
  if (!c.domain || !LOGO_KEY || failed) {
    return (
      <div style={{ ...box, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: YELLOW }} aria-hidden>
        {initials(c.name)}
      </div>
    );
  }
  const src = `https://cdn.brandicons.dev/icons/${encodeURIComponent(c.domain)}/medium?key=${encodeURIComponent(LOGO_KEY)}&p=@letter&pl=@loader-spin&bg=auto`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={40} height={40} style={{ ...box, objectFit: "contain" }} onError={() => setFailed(true)} />;
}

export default function TopClients({ onPick }: { onPick: (c: TopClient) => void }) {
  const [data, setData] = useState<TopClientsPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/top-clients")
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok || !json) throw new Error(json?.error || `HTTP ${r.status}`);
        return json as TopClientsPayload;
      })
      .then((json) => alive && setData(json))
      .catch((e) => alive && setError(e?.message || "Could not load today's clients."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div style={{ ...muted, marginTop: 28 }}>Today&apos;s most active clients are unavailable: {error}</div>;

  return (
    <div style={{ marginTop: 32, textAlign: "left" }}>
      <div style={{ marginBottom: 10 }}>
        <b style={{ color: "#f5f5f7", fontSize: 14 }}>Today&apos;s most active clients</b>
        <div style={muted}>
          Running 60+ days, ranked by sales-qualified appointments in the last 30 days. Click one to import it. Refreshes daily at 8:00 AM PH.
        </div>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {!data &&
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ ...card, cursor: "default", opacity: 0.45 }} aria-hidden>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: "#191a1e" }} />
              <div style={{ height: 12, width: "70%", borderRadius: 4, background: "#191a1e" }} />
              <div style={{ height: 10, width: "50%", borderRadius: 4, background: "#191a1e" }} />
            </div>
          ))}
        {data?.clients.map((c) => (
          <button key={c.campaign.clientAccountId} style={card} onClick={() => onPick(c)} title={`Import ${c.name}`}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Logo c={c} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25, overflowWrap: "anywhere" }}>{c.name}</div>
                <div style={{ ...muted, fontSize: 11 }}>{c.campaign.campaignName}</div>
              </div>
            </div>
            <div style={{ fontSize: 13 }}>
              <b style={{ color: YELLOW }}>{c.sql30}</b> appointment{c.sql30 === 1 ? "" : "s"} in 30 days
            </div>
            <div style={muted}>
              {[c.topChannel && `${c.topChannel}-led`, `${c.months} month${c.months === 1 ? "" : "s"} running`].filter(Boolean).join(" · ")}
            </div>
          </button>
        ))}
      </div>

      <div style={{ ...muted, marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
        <span>
          {!data
            ? "Finding today's most active clients… The first load after 8:00 AM PH takes up to a minute."
            : data.clients.length === 0
              ? "No client with 60+ days running had appointments in the last 30 days."
              : !data.complete
                ? `Ranked ${data.measured} of ${data.candidates} clients (time limit); the rest were not checked today.`
                : `Ranked ${data.measured} clients.`}
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
