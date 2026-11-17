"use client";

import { X } from "lucide-react";
import EditableField from "@/components/EditableField";
import {
  RevampCaseStudy,
  SectionId,
  SECTION_TITLES,
  isSectionVisible,
  loggedFunnelStages,
  sectionNumbers,
} from "@/lib/revamp";

// Callbox brand tokens (live callboxinc.com): charcoal ink, yellow accent, warm paper.
export const C = {
  ink: "#231F20",
  dark: "#0E0E0E",
  yellow: "#FFCA09",
  paper: "#F4F2EC",
  line: "#E8E6E0",
  mute: "#6B6B6B",
  body: "#3F3B3C",
  white: "#FFFFFF",
  onDark: "#D9D6CF",
  onDarkMute: "#A8A39A",
};
const DISPLAY = "var(--font-display), 'Archivo', 'DM Sans', sans-serif";
const MONO = "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace";
const PAD_X = 48;

type Up = (fn: (d: RevampCaseStudy) => void) => void;

/* ----------------------------- small building blocks ----------------------------- */

function T({
  value, onChange, placeholder, multiline, style, dark,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
  style?: React.CSSProperties; dark?: boolean;
}) {
  return (
    // Empty fields are edit-only: "no-print" keeps their placeholder out of the PDF text layer
    // and out of the pre-print height measurement.
    <div className={(dark ? "ef ef-dark" : "ef") + (value?.trim() ? "" : " no-print")}>
      <EditableField value={value} onChange={onChange} placeholder={placeholder} multiline={multiline} style={style} />
    </div>
  );
}

function Num({
  value, onChange, style, placeholder = "n/a",
}: { value: number | null; onChange: (v: number | null) => void; style?: React.CSSProperties; placeholder?: string }) {
  return (
    <span className={value === null ? "ef no-print" : "ef"} style={{ display: "inline-block" }}>
      <input
        inputMode="numeric"
        value={value === null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          onChange(raw === "" ? null : Number(raw));
        }}
        style={{
          border: "none", outline: "none", background: "transparent", font: "inherit", color: "inherit",
          width: `${Math.max(2, (value === null ? placeholder.length : String(value).length) + 1)}ch`, textAlign: "right",
          fontVariantNumeric: "tabular-nums", ...style,
        }}
      />
    </span>
  );
}

function Mono({ children, color = C.mute, style }: { children: React.ReactNode; color?: string; style?: React.CSSProperties }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, color, ...style }}>
      {children}
    </div>
  );
}

function Del({ onClick, label, dark }: { onClick: () => void; label: string; dark?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="no-print"
      aria-label={label}
      style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, flexShrink: 0, color: dark ? C.onDarkMute : C.mute }}
    >
      <X size={13} />
    </button>
  );
}

function Add({ onClick, label, dark }: { onClick: () => void; label: string; dark?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="no-print"
      style={{
        border: "1px dashed " + (dark ? "rgba(255,255,255,0.3)" : C.line), background: "transparent",
        color: dark ? C.yellow : C.ink, fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em",
        borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginTop: 10,
      }}
    >
      {label}
    </button>
  );
}

function Bar({ value, max, tone, dark }: { value: number | null; max: number; tone: "primary" | "mid" | "muted"; dark?: boolean }) {
  const pct = value && max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  const fill = tone === "primary" ? C.yellow : tone === "mid" ? (dark ? "rgba(255,255,255,0.7)" : "rgba(35,31,32,0.7)") : (dark ? "rgba(255,255,255,0.25)" : C.line);
  return (
    <div style={{ height: 8, borderRadius: 999, background: dark ? "rgba(255,255,255,0.12)" : "rgba(35,31,32,0.06)", overflow: "hidden" }}>
      {pct > 0 && <div style={{ width: pct + "%", height: "100%", borderRadius: 999, background: fill }} />}
    </div>
  );
}

const maxOf = (xs: (number | null)[]) => xs.reduce<number>((m, x) => (x !== null && x > m ? x : m), 0);

/* -------------------------------- skeletons (AI drafting) -------------------------------- */

// Shimmer placeholder shown in a field while the AI drafts it. Screen only (never printed).
function Skel({ lines = 1, dark, big, cols }: { lines?: number; dark?: boolean; big?: boolean; cols?: number }) {
  const bar = (i: number, n: number) => (
    <div
      key={i}
      className={dark ? "sk sk-dark" : "sk"}
      style={{ height: big ? 26 : 11, width: n > 1 && i === n - 1 ? "60%" : "100%", borderRadius: 6 }}
    />
  );
  if (cols) {
    return (
      <div className="no-print" aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "16px 22px", marginTop: 14 }}>
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} style={{ display: "grid", gap: 8, paddingTop: 10 }}>
            {[0, 1, 2].map((i) => bar(i, 3))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="no-print" aria-hidden="true" style={{ display: "grid", gap: 8, padding: "6px 0", maxWidth: big ? 560 : undefined }}>
      {Array.from({ length: lines }).map((_, i) => bar(i, lines))}
    </div>
  );
}

const EMPTY_SET = new Set<string>();

/* ------------------------------------ section frame ------------------------------------ */

function Section({
  id, num, band, children, hiddenHint, drafting,
}: {
  id: SectionId; num?: number; band?: "paper" | "dark"; children: React.ReactNode; hiddenHint: string; drafting?: boolean;
}) {
  const visible = num !== undefined;
  const dark = band === "dark";
  return (
    <section
      className={visible ? "" : "no-print"}
      style={{
        background: dark ? C.dark : band === "paper" ? C.paper : C.white,
        color: dark ? C.white : C.ink,
        padding: `34px ${PAD_X}px`,
        borderTop: band === "paper" ? "1px solid " + C.line : undefined,
        borderBottom: band === "paper" ? "1px solid " + C.line : undefined,
        outline: visible ? undefined : "2px dashed " + C.line,
        outlineOffset: -8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, paddingTop: 8, borderTop: "3px solid " + C.yellow, width: "fit-content", marginBottom: 14 }}>
        <Mono color={dark ? C.yellow : C.mute}>
          {visible ? String(num).padStart(2, "0") + " · " : ""}
          {SECTION_TITLES[id]}
        </Mono>
      </div>
      {!visible && (
        <div className="no-print" style={{ fontFamily: MONO, fontSize: 10.5, color: C.mute, marginBottom: 12 }}>
          {drafting ? "AI is drafting this section…" : <>Hidden in the PDF and CMS page: {hiddenHint}</>}
        </div>
      )}
      {children}
    </section>
  );
}

const h2 = (dark?: boolean): React.CSSProperties => ({
  fontFamily: DISPLAY, fontWeight: 800, fontVariationSettings: "'wdth' 86", letterSpacing: "-0.025em",
  fontSize: 26, lineHeight: 1.12, color: dark ? C.white : C.ink,
});
const bodyS = (dark?: boolean): React.CSSProperties => ({ fontSize: 13.5, lineHeight: 1.65, color: dark ? C.onDark : C.body });
const smallS = (dark?: boolean): React.CSSProperties => ({ fontSize: 12.5, lineHeight: 1.6, color: dark ? C.onDark : C.mute });
const cardS: React.CSSProperties = { background: C.white, border: "1px solid " + C.line, borderRadius: 12, padding: "18px 20px" };

/* --------------------------------------- the sheet --------------------------------------- */

export default function RevampSheet({ r, up, pending = EMPTY_SET }: { r: RevampCaseStudy; up: Up; pending?: Set<string> }) {
  const nums = sectionNumbers(r);
  // While the AI drafts, fields it is filling show a skeleton instead of the editable field.
  const sk = (key: string, lines = 1, dark?: boolean, big?: boolean, cols?: number) =>
    pending.has(key) ? <Skel lines={lines} dark={dark} big={big} cols={cols} /> : null;
  const secPending = (id: string) => Array.from(pending).some((k) => k.startsWith(id + "."));

  const titledList = (
    path: (d: RevampCaseStudy) => { title: string; body: string }[],
    cols: number,
    addLabel: string,
    dark?: boolean,
  ) => {
    const items = path(r);
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "16px 22px", marginTop: 14 }}>
          {items.map((it, i) => (
            <div key={i} className="avoid-break" style={{ paddingTop: 10, borderTop: "1px solid " + (dark ? "rgba(255,255,255,0.18)" : C.line) }}>
              <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <T dark={dark} value={it.title} onChange={(v) => up((d) => { path(d)[i].title = v; })} placeholder="Title" multiline
                    style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, color: dark ? C.white : C.ink }} />
                </div>
                <Del dark={dark} label="Remove item" onClick={() => up((d) => { path(d).splice(i, 1); })} />
              </div>
              <T dark={dark} value={it.body} onChange={(v) => up((d) => { path(d)[i].body = v; })} placeholder="Body" multiline style={smallS(dark)} />
            </div>
          ))}
        </div>
        <Add dark={dark} label={addLabel} onClick={() => up((d) => { path(d).push({ title: "", body: "" }); })} />
      </>
    );
  };

  const paragraphs = (path: (d: RevampCaseStudy) => string[], dark?: boolean) => (
    <>
      {path(r).map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <T dark={dark} value={p} onChange={(v) => up((d) => { path(d)[i] = v; })} placeholder="Paragraph…" multiline style={bodyS(dark)} />
          </div>
          <Del dark={dark} label="Remove paragraph" onClick={() => up((d) => { path(d).splice(i, 1); })} />
        </div>
      ))}
      <Add dark={dark} label="+ Paragraph" onClick={() => up((d) => { path(d).push(""); })} />
    </>
  );

  /* ---------------- masthead ---------------- */
  const hl = r.headlineHighlight && r.headline.includes(r.headlineHighlight) ? r.headlineHighlight : "";
  const masthead = (
    <header style={{ background: C.dark, color: C.white, padding: `40px ${PAD_X}px 30px` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.ink, border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "5px 12px" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: C.yellow }} />
          <Mono color={C.white} style={{ fontSize: 10 }}>Case study</Mono>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/callbox-logo.svg" alt="Callbox" style={{ height: 30 }} />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline", marginBottom: 14 }}>
        {(["clientName", "solutionLines", "country"] as const).map((k, i) => (
          <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            {i > 0 && (
              // A separator prints only between two filled values; empty fields are edit-only.
              <div className={r[k].trim() && (["clientName", "solutionLines", "country"] as const).slice(0, i).some((x) => r[x].trim()) ? "" : "no-print"}>
                <Mono color={C.onDarkMute}>·</Mono>
              </div>
            )}
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.onDark, minWidth: 60 }}>
              <T dark value={r[k]} onChange={(v) => up((d) => { d[k] = v; })} placeholder={k === "clientName" ? "Client" : k === "country" ? "Country" : "Solution lines"}
                style={{ fontFamily: MONO, textTransform: "uppercase", width: `${Math.max(8, (r[k] || "").length + 2)}ch` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Print shows the highlight; on screen the headline is edited as plain text. */}
      <h1 className="print-only" style={{ ...h2(true), fontSize: 36, lineHeight: 1.04, margin: "0 0 16px", maxWidth: 620 }}>
        {hl ? (
          <>
            {r.headline.slice(0, r.headline.indexOf(hl))}
            <mark style={{ background: C.yellow, color: C.dark, padding: "0 0.08em" }}>{hl}</mark>
            {r.headline.slice(r.headline.indexOf(hl) + hl.length)}
          </>
        ) : r.headline}
      </h1>
      <div className="no-print" style={{ marginBottom: 6 }}>
        {sk("headline", 2, true, true) ?? <T dark value={r.headline} onChange={(v) => up((d) => { d.headline = v; })} placeholder="Headline (H1)" multiline
          style={{ ...h2(true), fontSize: 36, lineHeight: 1.04, maxWidth: 620 }} />}
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 6 }}>
          <Mono color={C.onDarkMute}>Highlight</Mono>
          <div style={{ flex: 1 }}>
            <T dark value={r.headlineHighlight} onChange={(v) => up((d) => { d.headlineHighlight = v; })}
              placeholder="Exact phrase from the headline to highlight in yellow" style={{ fontSize: 12, color: hl || !r.headlineHighlight ? C.onDark : "#FCA5A5" }} />
          </div>
        </div>
      </div>

      {sk("dek", 2, true) ?? <T dark value={r.dek} onChange={(v) => up((d) => { d.dek = v; })} placeholder="Dek: who the client is and what changed" multiline
        style={{ fontSize: 15, lineHeight: 1.55, color: "#EDEBE6", maxWidth: 620, marginTop: 10 }} />}
      {sk("subDek", 1, true) ?? <T dark value={r.subDek} onChange={(v) => up((d) => { d.subDek = v; })} placeholder="Sub-dek (optional)" multiline
        style={{ fontSize: 13, lineHeight: 1.6, color: C.onDarkMute, maxWidth: 620, marginTop: 6 }} />}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, r.heroStats.length || 1))}, minmax(0, 1fr))`, gap: 12, marginTop: 24 }}>
        {r.heroStats.map((s, i) => (
          <div key={i} className="avoid-break" style={{ position: "relative", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderTop: "3px solid " + C.yellow, borderRadius: 12, padding: "14px 14px 12px" }}>
            <div style={{ position: "absolute", top: 4, right: 4 }}><Del dark label="Remove stat" onClick={() => up((d) => { d.heroStats.splice(i, 1); })} /></div>
            <T dark value={s.value} onChange={(v) => up((d) => { d.heroStats[i].value = v; })} placeholder="0"
              style={{ ...h2(true), fontSize: 30, lineHeight: 1, color: i === 0 ? C.yellow : C.white }} />
            <T dark value={s.label} onChange={(v) => up((d) => { d.heroStats[i].label = v; })} placeholder="Stat label" multiline
              style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1.45, color: C.onDark, marginTop: 8 }} />
          </div>
        ))}
      </div>
      {r.heroStats.length < 4 && <Add dark label="+ Stat" onClick={() => up((d) => { d.heroStats.push({ value: "", label: "" }); })} />}
    </header>
  );

  /* ---------------- fact bar ---------------- */
  const factBar = (
    <section style={{ background: C.paper, borderBottom: "1px solid " + C.line, padding: `22px ${PAD_X}px` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px 20px" }}>
        {r.facts.map((f, i) => (
          <div key={i} className="avoid-break">
            <div style={{ display: "flex", gap: 2 }}>
              <div style={{ flex: 1 }}>
                <T value={f.label} onChange={(v) => up((d) => { d.facts[i].label = v; })} placeholder="Label"
                  style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, color: C.mute }} />
              </div>
              <Del label="Remove fact" onClick={() => up((d) => { d.facts.splice(i, 1); })} />
            </div>
            <T value={f.value} onChange={(v) => up((d) => { d.facts[i].value = v; })} placeholder="Value" multiline
              style={{ fontSize: 12.5, lineHeight: 1.45, color: C.ink, marginTop: 3 }} />
          </div>
        ))}
      </div>
      {r.facts.length < 8 && <Add label="+ Fact" onClick={() => up((d) => { d.facts.push({ label: "", value: "" }); })} />}
    </section>
  );

  /* ---------------- sections ---------------- */
  const S = r.situation;
  const situation = (
    <Section id="situation" drafting={secPending("situation")} num={nums.situation} hiddenHint="add a heading or a paragraph.">
      {sk("situation.heading", 1, false, true) ?? <T value={S.heading} onChange={(v) => up((d) => { d.situation.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 12 }} />}
      {sk("situation.body", 4) ?? paragraphs((d) => d.situation.body)}
      {(S.pullStat || true) && (
        <div style={{ marginTop: 14, paddingLeft: 16, borderLeft: "3px solid " + C.yellow }} className={S.pullStat ? "" : "no-print"}>
          {sk("situation.pullStat", 2) ?? <T value={S.pullStat} onChange={(v) => up((d) => { d.situation.pullStat = v; })} placeholder="Pull stat (optional)" multiline
            style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.45, color: C.ink }} />}
        </div>
      )}
    </Section>
  );

  const ch = r.channels;
  const chMax = maxOf(ch.rows.map((x) => x.appointments));
  const channels = (
    <Section id="channels" drafting={secPending("channels")} num={nums.channels} band="paper" hiddenHint="add at least one channel row.">
      {sk("channels.heading", 1, false, true) ?? <T value={ch.heading} onChange={(v) => up((d) => { d.channels.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 10 }} />}
      {sk("channels.intro", 2) ?? <T value={ch.intro} onChange={(v) => up((d) => { d.channels.intro = v; })} placeholder="Intro" multiline style={bodyS()} />}
      <div style={{ ...cardS, marginTop: 16, padding: "4px 20px" }}>
        {ch.rows.map((row, i) => (
          <div key={i} className="avoid-break" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 16, alignItems: "center", padding: "14px 0", borderBottom: i < ch.rows.length - 1 ? "1px solid " + C.line : undefined }}>
            <div>
              <T value={row.name} onChange={(v) => up((d) => { d.channels.rows[i].name = v; })} placeholder="Channel" style={{ ...h2(), fontSize: 17 }} />
              <T value={row.activity} onChange={(v) => up((d) => { d.channels.rows[i].activity = v; })} placeholder="Activity line" multiline style={{ ...smallS(), fontSize: 11.5 }} />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                <Mono style={{ fontSize: 9 }}>Appointments produced</Mono>
                <Num value={row.appointments} onChange={(v) => up((d) => { d.channels.rows[i].appointments = v; })} style={{ ...h2(), fontSize: 18 }} />
              </div>
              <Bar value={row.appointments} max={chMax} tone={row.appointments !== null && row.appointments === chMax && chMax > 0 ? "primary" : "mid"} />
            </div>
            <Del label="Remove channel" onClick={() => up((d) => { d.channels.rows.splice(i, 1); })} />
          </div>
        ))}
      </div>
      <Add label="+ Channel" onClick={() => up((d) => { d.channels.rows.push({ name: "", activity: "", appointments: null }); })} />
      {sk("channels.takeaways", 3, false, false, 2) ?? titledList((d) => d.channels.takeaways, 2, "+ Takeaway")}
    </Section>
  );

  const pc = r.primaryContact;
  const primary = (
    <Section id="primaryContact" drafting={secPending("primaryContact")} num={nums.primaryContact} hiddenHint="fill in the role.">
      <T value={pc.heading} onChange={(v) => up((d) => { d.primaryContact.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 10 }} />
      <T value={pc.intro} onChange={(v) => up((d) => { d.primaryContact.intro = v; })} placeholder="Intro" multiline style={bodyS()} />
      <div className="avoid-break" style={{ ...cardS, borderTop: "3px solid " + C.yellow, marginTop: 16 }}>
        <T value={pc.eyebrow} onChange={(v) => up((d) => { d.primaryContact.eyebrow = v; })} placeholder="Eyebrow"
          style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }} />
        <T value={pc.role} onChange={(v) => up((d) => { d.primaryContact.role = v; })} placeholder="Role, e.g. Senior Director of Marketing" style={{ ...h2(), fontSize: 22, margin: "4px 0" }} />
        <T value={pc.context} onChange={(v) => up((d) => { d.primaryContact.context = v; })} placeholder="Context" multiline style={smallS()} />
      </div>
      {(pc.pressures.length > 0 || true) && (
        <div className={pc.pressures.length ? "" : "no-print"} style={{ marginTop: 18 }}>
          <Mono>What this role is carrying</Mono>
          {titledList((d) => d.primaryContact.pressures, 2, "+ Pressure")}
        </div>
      )}
      <div className={pc.partnerReasons.length ? "avoid-break" : "no-print"} style={{ ...cardS, marginTop: 18 }}>
        <Mono>Why that leads to a partner rather than a hire</Mono>
        {titledList((d) => d.primaryContact.partnerReasons, 3, "+ Reason")}
      </div>
    </Section>
  );

  const hr = r.howItRan;
  const rolesMax = maxOf(hr.roles.map((x) => x.count));
  const rolesTotal = hr.roles.reduce((t, x) => t + (x.count ?? 0), 0);
  const howItRan = (
    <Section id="howItRan" drafting={secPending("howItRan")} num={nums.howItRan} hiddenHint="add at least one step.">
      {sk("howItRan.heading", 1, false, true) ?? <T value={hr.heading} onChange={(v) => up((d) => { d.howItRan.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 6 }} />}
      {sk("howItRan.steps", 3, false, false, 2) ?? (
        <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "18px 24px", marginTop: 12 }}>
        {hr.steps.map((st, i) => (
          <div key={i} className="avoid-break">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Mono>No. {String(i + 1).padStart(2, "0")}</Mono>
              <Del label="Remove step" onClick={() => up((d) => { d.howItRan.steps.splice(i, 1); })} />
            </div>
            <T value={st.title} onChange={(v) => up((d) => { d.howItRan.steps[i].title = v; })} placeholder="Step title" multiline style={{ ...h2(), fontSize: 16, margin: "4px 0" }} />
            <T value={st.body} onChange={(v) => up((d) => { d.howItRan.steps[i].body = v; })} placeholder="What happened" multiline style={smallS()} />
          </div>
        ))}
      </div>
      <Add label="+ Step" onClick={() => up((d) => { d.howItRan.steps.push({ title: "", body: "" }); })} />
        </>
      )}

      <div className={hr.roles.length ? "" : "no-print"} style={{ marginTop: 24 }}>
        {sk("howItRan.rolesHeading", 1) ?? <T value={hr.rolesHeading} onChange={(v) => up((d) => { d.howItRan.rolesHeading = v; })} placeholder="Roles heading (optional)" multiline style={{ ...h2(), fontSize: 19 }} />}
        {sk("howItRan.rolesIntro", 2) ?? <T value={hr.rolesIntro} onChange={(v) => up((d) => { d.howItRan.rolesIntro = v; })} placeholder="Roles intro" multiline style={{ ...smallS(), marginTop: 4 }} />}
        <div className="avoid-break" style={{ ...cardS, marginTop: 12 }}>
          <Mono style={{ marginBottom: 12 }}>Appointments by role{rolesTotal ? `, all ${rolesTotal.toLocaleString("en-US")}` : ""}</Mono>
          <div style={{ display: "grid", gap: 9 }}>
            {hr.roles.map((ro, i) => (
              <div key={i}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                  <div style={{ flex: 1 }}>
                    <T value={ro.role} onChange={(v) => up((d) => { d.howItRan.roles[i].role = v; })} placeholder="Role" style={{ fontSize: 12.5, fontWeight: i === 0 ? 700 : 500, color: C.ink }} />
                  </div>
                  <Num value={ro.count} onChange={(v) => up((d) => { d.howItRan.roles[i].count = v; })} style={{ fontSize: 12.5, fontWeight: 700 }} />
                  <span style={{ fontSize: 12, color: C.mute, minWidth: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {rolesTotal && ro.count !== null ? Math.round((ro.count / rolesTotal) * 100) + "%" : ""}
                  </span>
                  <Del label="Remove role" onClick={() => up((d) => { d.howItRan.roles.splice(i, 1); })} />
                </div>
                <Bar value={ro.count} max={rolesMax} tone={i === 0 ? "primary" : i === hr.roles.length - 1 && hr.roles.length > 3 ? "muted" : "mid"} />
              </div>
            ))}
          </div>
          <Add label="+ Role" onClick={() => up((d) => { d.howItRan.roles.push({ role: "", count: null }); })} />
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid " + C.line }} className={hr.rolesFootnote ? "" : "no-print"}>
            <T value={hr.rolesFootnote} onChange={(v) => up((d) => { d.howItRan.rolesFootnote = v; })} placeholder="Footnote (optional)" multiline style={{ ...smallS(), fontSize: 11.5 }} />
          </div>
        </div>
      </div>
    </Section>
  );

  const pg = r.progression;
  const qMax = maxOf(pg.quarters.map((x) => x.count));
  const progression = (
    <Section id="progression" drafting={secPending("progression")} num={nums.progression} band="paper" hiddenHint="add at least one period.">
      {sk("progression.heading", 1, false, true) ?? <T value={pg.heading} onChange={(v) => up((d) => { d.progression.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 10 }} />}
      {sk("progression.body", 3) ?? paragraphs((d) => d.progression.body)}
      <div className="avoid-break" style={{ ...cardS, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", paddingBottom: 10, marginBottom: 14, borderBottom: "1px solid " + C.line }}>
          <div style={{ flex: 1 }}>
            <T value={pg.chartTitle} onChange={(v) => up((d) => { d.progression.chartTitle = v; })} placeholder="Chart title" style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }} />
          </div>
          <div style={{ width: 220 }}>
            <T value={pg.chartMeta} onChange={(v) => up((d) => { d.progression.chartMeta = v; })} placeholder="Chart meta"
              style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, textAlign: "right" }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(6, Math.max(1, pg.quarters.length))}, minmax(0, 1fr))`, gap: 14 }}>
          {pg.quarters.map((q, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", paddingLeft: q.isPeak ? 10 : 0, borderLeft: q.isPeak ? "3px solid " + C.yellow : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <T value={q.label} onChange={(v) => up((d) => { d.progression.quarters[i].label = v; })} placeholder="Q1 2026"
                  style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, color: q.isPeak ? C.ink : C.mute }} />
                <Del label="Remove period" onClick={() => up((d) => { d.progression.quarters.splice(i, 1); })} />
              </div>
              <div style={{ margin: "6px 0 8px" }}>
                <Num value={q.count} onChange={(v) => up((d) => { d.progression.quarters[i].count = v; })} placeholder="0"
                  style={{ ...h2(), fontSize: 26, textAlign: "left", color: q.isPartial ? "#A8A39A" : C.ink }} />
              </div>
              <Bar value={q.count} max={qMax} tone={q.isPeak ? "primary" : q.isPartial ? "muted" : "mid"} />
              {pending.has("progression.quarterNotes") && !q.note ? <Skel lines={2} /> : <T value={q.note} onChange={(v) => up((d) => { d.progression.quarters[i].note = v; })} placeholder="Note" multiline style={{ ...smallS(), fontSize: 11, marginTop: 8 }} />}
              {/* Pinned to the bottom of every column so the toggles line up across periods. */}
              <div className="no-print" style={{ marginTop: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4, fontFamily: MONO, fontSize: 9.5, color: C.mute }}>
                {(["isPeak", "isPartial"] as const).map((k) => (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", cursor: "pointer" }}>
                    <input type="checkbox" style={{ margin: 0 }} checked={q[k]} onChange={(e) => up((d) => { d.progression.quarters[i][k] = e.target.checked; })} />
                    {k === "isPeak" ? "Peak" : "Partial"}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Add label="+ Period" onClick={() => up((d) => { d.progression.quarters.push({ label: "", count: null, note: "", isPeak: false, isPartial: false }); })} />
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid " + C.line }} className={pg.footnote ? "" : "no-print"}>
          <T value={pg.footnote} onChange={(v) => up((d) => { d.progression.footnote = v; })} placeholder="Footnote (optional)" multiline style={{ ...smallS(), fontSize: 11.5 }} />
        </div>
      </div>
    </Section>
  );

  const fn = r.funnel;
  const logged = loggedFunnelStages(r);
  const funnel = (
    <Section id="funnel" drafting={secPending("funnel")} num={nums.funnel} hiddenHint={`shows once 3 or more stages have a value (${logged.length} logged now).`}>
      {sk("funnel.heading", 1, false, true) ?? <T value={fn.heading} onChange={(v) => up((d) => { d.funnel.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 10 }} />}
      {sk("funnel.intro", 2) ?? <T value={fn.intro} onChange={(v) => up((d) => { d.funnel.intro = v; })} placeholder="Intro" multiline style={bodyS()} />}
      <div style={{ ...cardS, padding: 0, marginTop: 14, overflow: "hidden" }}>
        {fn.stages.map((st, i) => {
          const isWon = st.value !== null && i === fn.stages.length - 1 && /closed\s*won/i.test(st.name);
          return (
            <div key={i} className={st.value === null ? "no-print avoid-break" : "avoid-break"}
              style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: i < fn.stages.length - 1 ? "1px solid " + C.line : undefined, background: isWon ? C.dark : undefined, color: isWon ? C.white : C.ink, opacity: st.value === null ? 0.6 : 1 }}>
              <Mono color={isWon ? C.yellow : C.mute}>{String(i + 1).padStart(2, "0")}</Mono>
              <div style={{ flex: 1 }}>
                <T dark={isWon} value={st.name} onChange={(v) => up((d) => { d.funnel.stages[i].name = v; })} placeholder="Stage" style={{ fontSize: 13.5, fontWeight: 700 }} />
                <T dark={isWon} value={st.description} onChange={(v) => up((d) => { d.funnel.stages[i].description = v; })} placeholder="Description" multiline style={{ ...smallS(isWon), fontSize: 11.5 }} />
              </div>
              <Num value={st.value} onChange={(v) => up((d) => { d.funnel.stages[i].value = v; })} placeholder="not logged"
                style={{ ...h2(isWon), fontSize: 22, color: isWon ? C.yellow : C.ink }} />
              <Del dark={isWon} label="Remove stage" onClick={() => up((d) => { d.funnel.stages.splice(i, 1); })} />
            </div>
          );
        })}
      </div>
      {fn.stages.length < 5 && <Add label="+ Stage" onClick={() => up((d) => { d.funnel.stages.push({ name: "", description: "", value: null }); })} />}
    </Section>
  );

  const wc = r.whatChanged;
  const whatChanged = (
    <Section id="whatChanged" drafting={secPending("whatChanged")} num={nums.whatChanged} hiddenHint="add at least one outcome.">
      {sk("whatChanged.heading", 1, false, true) ?? <T value={wc.heading} onChange={(v) => up((d) => { d.whatChanged.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(), marginBottom: 10 }} />}
      {sk("whatChanged.outcomes", 4) ?? (
        <>
      {wc.outcomes.map((o, i) => (
        <div key={i} className="avoid-break" style={{ display: "flex", gap: 14, padding: "12px 0", borderTop: "1px solid " + C.line }}>
          <span style={{ flex: "0 0 7px", height: 7, background: C.yellow, marginTop: 8 }} />
          <div style={{ flex: 1 }}>
            <T value={o} onChange={(v) => up((d) => { d.whatChanged.outcomes[i] = v; })} placeholder="Outcome" multiline style={{ fontSize: 13.5, lineHeight: 1.6, color: C.body }} />
          </div>
          <Del label="Remove outcome" onClick={() => up((d) => { d.whatChanged.outcomes.splice(i, 1); })} />
        </div>
      ))}
      <Add label="+ Outcome" onClick={() => up((d) => { d.whatChanged.outcomes.push(""); })} />
        </>
      )}
      <figure className={wc.quote.text ? "avoid-break" : "no-print"} style={{ margin: "18px 0 0", padding: "18px 20px", background: C.paper, borderRadius: 12, borderLeft: "3px solid " + C.yellow }}>
        <T value={wc.quote.text} onChange={(v) => up((d) => { d.whatChanged.quote.text = v; })} placeholder="Client quote (optional, hidden when empty)" multiline style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, color: C.ink }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1 }}><T value={wc.quote.name} onChange={(v) => up((d) => { d.whatChanged.quote.name = v; })} placeholder="Name" style={{ fontSize: 12, color: C.mute }} /></div>
          <div style={{ flex: 1 }}><T value={wc.quote.title} onChange={(v) => up((d) => { d.whatChanged.quote.title = v; })} placeholder="Title" style={{ fontSize: 12, color: C.mute }} /></div>
        </div>
      </figure>
    </Section>
  );

  const wn = r.whereNext;
  const whereNext = (
    <Section id="whereNext" drafting={secPending("whereNext")} num={nums.whereNext} band="dark" hiddenHint="add at least one recommendation.">
      {sk("whereNext.heading", 1, true, true) ?? <T dark value={wn.heading} onChange={(v) => up((d) => { d.whereNext.heading = v; })} placeholder="Section heading" multiline style={{ ...h2(true), marginBottom: 10 }} />}
      {sk("whereNext.intro", 2, true) ?? <T dark value={wn.intro} onChange={(v) => up((d) => { d.whereNext.intro = v; })} placeholder="Intro" multiline style={bodyS(true)} />}
      {sk("whereNext.recommendations", 3, true, false, 3) ?? titledList((d) => d.whereNext.recommendations, 3, "+ Recommendation", true)}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.14)" }} className={wn.footnote ? "" : "no-print"}>
        <T dark value={wn.footnote} onChange={(v) => up((d) => { d.whereNext.footnote = v; })} placeholder="Footnote (optional)" multiline style={{ ...smallS(true), fontSize: 11.5, color: C.onDarkMute }} />
      </div>
    </Section>
  );

  /* ---------------- CTA + methodology ---------------- */
  const cta = (
    <section className="avoid-break" style={{ padding: `30px ${PAD_X}px 26px`, background: C.white }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-end", justifyContent: "space-between", paddingBottom: 20, borderBottom: "1px solid " + C.line }}>
        <div>
          <Mono>Your pipeline</Mono>
          <div style={{ ...h2(), fontSize: 22, margin: "6px 0" }}>Start with the buyer you cannot reach.</div>
          <div style={{ ...smallS(), maxWidth: 420 }}>Tell us which titles you need in front of and what a useful sales conversation looks like for your team.</div>
        </div>
        <a href="https://www.callboxinc.com/contact/" style={{ background: C.yellow, color: C.ink, fontWeight: 700, fontSize: 13, textDecoration: "none", padding: "11px 18px", borderRadius: 10, whiteSpace: "nowrap" }}>
          Talk to our team
        </a>
      </div>
      <div className={r.methodologyNote ? "" : "no-print"} style={{ marginTop: 14 }}>
        <T value={r.methodologyNote} onChange={(v) => up((d) => { d.methodologyNote = v; })} placeholder="Methodology note: where the figures come from" multiline style={{ fontSize: 10.5, lineHeight: 1.6, color: C.mute }} />
      </div>
    </section>
  );

  return (
    <div style={{ fontFamily: "var(--font-body), 'DM Sans', system-ui, sans-serif", color: C.ink, background: C.white }}>
      {masthead}
      {factBar}
      {situation}
      {channels}
      {primary}
      {howItRan}
      {progression}
      {funnel}
      {whatChanged}
      {whereNext}
      {cta}
    </div>
  );
}

export { isSectionVisible };
