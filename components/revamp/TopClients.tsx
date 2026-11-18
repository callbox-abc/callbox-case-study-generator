"use client";

// Import panel quick picks, both read from Supabase (no CallboxOne or HubSpot calls here):
//  - TopClients: this week's 5 most active clients, built Mondays 08:00 PH by the cron job, each
//    with its full import data, so a click fills the sheet instantly.
//  - RecentClients: clients anyone imported recently (shared), with any CMS draft made from them.
// Logos come from BrandIcons; the Community plan requires the visible "Icons by BrandIcons" link.

import { useEffect, useState } from "react";
import type { JobStatus, TopClient, TopClientsSnapshot } from "@/lib/topClients";
import type { RecentClient } from "@/lib/recentClients";

const LOGO_KEY = process.env.NEXT_PUBLIC_BRANDICONS_KEY || "";
const YELLOW = "#f5b914";
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

export function Logo({ name, domain, size = 36 }: { name: string; domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box: React.CSSProperties = { width: size, height: size, borderRadius: 8, flex: "0 0 auto", background: "#232429" };
  if (!domain || !LOGO_KEY || failed) {
    return (
      <div style={{ ...box, display: "grid", placeItems: "center", fontSize: size > 30 ? 12 : 10.5, fontWeight: 700, color: YELLOW }} aria-hidden>
        {initials(name)}
      </div>
    );
  }
  const src = `https://cdn.brandicons.dev/icons/${encodeURIComponent(domain)}/medium?key=${encodeURIComponent(LOGO_KEY)}&p=@letter&pl=@loader-spin&bg=auto`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} style={{ ...box, objectFit: "contain" }} onError={() => setFailed(true)} />;
}

const DAY = 864e5;
export function ago(isoTime: string): string {
  const ms = Date.now() - Date.parse(isoTime);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(ms / DAY);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" });

/* --------------------------------- weekly picks --------------------------------- */

const POLL_MS = 15_000;

// Whole-job progress: checking clients 0-85%, choosing the top 5 to 88%, saving their data to 100%.
function jobPercent(job: JobStatus): number {
  if (job.phase === "rank") return job.candidates ? Math.max(2, Math.round((job.measured / job.candidates) * 85)) : 2;
  if (job.phase === "select") return 86;
  if (job.phase === "import") return 88 + Math.round((job.imported / Math.max(1, job.picks)) * 12);
  return 100;
}

function jobStage(job: JobStatus): string {
  if (job.phase === "rank")
    return job.candidates ? `checking clients: ${job.measured} of ${job.candidates}` : "loading the client list";
  if (job.phase === "select") return "choosing the top 5";
  if (job.phase === "import") return `saving the top 5's data: ${job.imported} of ${job.picks || 5}`;
  return "publishing";
}

function JobProgress({ job, first }: { job: JobStatus; first: boolean }) {
  const pct = jobPercent(job);
  return (
    <div style={{ marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Weekly snapshot progress">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", ...muted }}>
        <span>
          {first ? "Building the first weekly snapshot" : "Updating this week's snapshot (last week's list is shown until it's done)"}
          {" · "}
          {jobStage(job)}
        </span>
        <b style={{ color: "#f5f5f7" }}>{pct}%</b>
      </div>
      <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: "#191a1e", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: YELLOW, transition: "width 0.8s ease" }} />
      </div>
      {job.lastError && <div style={{ ...muted, marginTop: 4, color: "#fca5a5" }}>Last error: {job.lastError}</div>}
    </div>
  );
}

export function TopClients({ onPick, disabled }: { onPick: (c: TopClient) => void; disabled?: boolean }) {
  const [data, setData] = useState<{ snapshot: TopClientsSnapshot | null; job: JobStatus | null } | null>(null);
  const [error, setError] = useState("");

  // While the weekly job runs, the saved progress is re-read every 15s so the bar moves on its own.
  // This only reads Supabase; it never calls CallboxOne or HubSpot.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;
    const load = async () => {
      try {
        const r = await fetch("/api/top-clients");
        const json = await r.json().catch(() => null);
        if (!r.ok || !json) throw new Error(json?.error || `HTTP ${r.status}`);
        if (!alive) return;
        loaded = true;
        setData(json);
        setError("");
        if (json.job?.status === "running") timer = setTimeout(load, POLL_MS);
      } catch (e: any) {
        if (!alive) return;
        if (!loaded) setError(e?.message || "Could not load the clients snapshot.");
        else timer = setTimeout(load, POLL_MS * 2); // keep showing the last good data and try again
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  if (error) return <div style={{ ...muted, marginTop: 12 }}>Most active clients are unavailable: {error}</div>;
  const snap = data?.snapshot ?? null;
  const job = data?.job ?? null;
  const running = job?.status === "running";
  const stale = Boolean(snap && job && snap.cycle !== job.cycle);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ color: "#f5f5f7" }}>This week&apos;s most active clients</b>
        <span style={muted}>· running 60+ days, by sales-qualified appointments in the last 30 days · click one to load its saved data instantly</span>
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
        {!data &&
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ ...card, cursor: "default", opacity: 0.45 }} aria-hidden>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#232429" }} />
              <div style={{ height: 11, width: "70%", borderRadius: 4, background: "#232429" }} />
            </div>
          ))}
        {snap?.clients.map((c) => (
          <button
            key={c.campaign.clientAccountId}
            style={{ ...card, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}
            disabled={disabled}
            onClick={() => onPick(c)}
            title={`Load ${c.name}`}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Logo name={c.name} domain={c.domain} />
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

      {running && job && <JobProgress job={job} first={!snap} />}

      <div style={{ ...muted, marginTop: 6 }}>
        {!data
          ? "Loading this week's clients…"
          : !snap
            ? running
              ? "The 5 cards appear when the snapshot is ready; this panel updates on its own."
              : job?.status === "failed"
                ? `This week's snapshot failed${job.lastError ? `: ${job.lastError}` : "."} It runs again Monday at 8:00 AM PH.`
                : "No snapshot yet. It's built every Monday at 8:00 AM PH."
            : [
                `Snapshot from ${dayLabel(snap.refreshedAt)} · ranked ${snap.measured} of ${snap.candidates} clients`,
                snap.skippedUnnamed ? `${snap.skippedUnnamed} skipped (no company name in CallboxOne or HubSpot)` : "",
                stale && job?.lastError && !running ? `last error: ${job.lastError}` : "",
                stale && job?.status === "failed" ? "this week's update failed, so last week's list is shown" : "",
                `next update ${dayLabel(snap.nextRefresh)}, 8:00 AM PH`,
              ]
                .filter(Boolean)
                .join(" · ") + "."}
      </div>
    </div>
  );
}

/* -------------------------------- recent imports -------------------------------- */

export function RecentClients({
  recent,
  onPick,
  disabled,
}: {
  recent: RecentClient[];
  onPick: (r: RecentClient) => void;
  disabled?: boolean;
}) {
  if (!recent.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ color: "#f5f5f7" }}>Recently imported clients</b>
        <span style={muted}>· by anyone using this app · click one to load its saved sheet (no new calls)</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {recent.map((r) => (
          <div
            key={r.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px 6px 6px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#191a1e",
              maxWidth: "100%",
            }}
          >
            <button
              onClick={() => onPick(r)}
              disabled={disabled}
              title={`Load the saved import of ${r.name}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                padding: 0,
                color: "#f5f5f7",
                font: "inherit",
                cursor: disabled ? "default" : "pointer",
                textAlign: "left",
                minWidth: 0,
              }}
            >
              <Logo name={r.name} domain={r.domain} size={28} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700 }}>{r.name}</span>
                <span style={{ display: "block", ...muted, fontSize: 11 }}>
                  {[
                    r.campaign?.campaignName,
                    r.sheet ? `${r.sheet.reviewed ? "reviewed" : "draft saved"} ${ago(r.sheet.savedAt)}` : `imported ${ago(r.importedAt)}`,
                    r.imports > 1 ? `${r.imports} imports` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
            {r.cmsDraft && (
              <a
                href={r.cmsDraft.editLink}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: YELLOW, whiteSpace: "nowrap" }}
                title="A CMS draft was already made from this client"
              >
                CMS draft #{r.cmsDraft.id}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Required by the BrandIcons Community plan wherever its logos appear.
export function LogoCredit() {
  return (
    <div style={{ ...muted, marginTop: 8, textAlign: "right" }}>
      <a href="https://brandicons.dev" target="_blank" rel="noreferrer" style={{ color: "#a4a4ae" }}>
        Icons by BrandIcons
      </a>
    </div>
  );
}
