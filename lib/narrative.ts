// AI drafting of the empty narrative fields, grounded in the sheet's own data.
//
// Guardrails enforced in code (not only in the prompt):
//  1. Only fields that are empty in the sheet are filled; writer text is never replaced.
//  2. Any drafted sentence containing a number that is not in the sheet's data (or a percentage
//     derived from two of its numbers) is dropped.
//  3. Fields with no data behind them are never drafted: client name, country, solution lines,
//     primary contact persona, client quote, facts.
//  4. Em dashes are removed (house style).

import type { RevampCaseStudy, TitledItem } from "@/lib/revamp";

export type NarrativeDraft = {
  headline?: string;
  headlineHighlight?: string;
  dek?: string;
  subDek?: string;
  situation?: { heading?: string; body?: string[]; pullStat?: string };
  channels?: { heading?: string; intro?: string; takeaways?: TitledItem[] };
  howItRan?: { heading?: string; steps?: TitledItem[]; rolesHeading?: string; rolesIntro?: string };
  progression?: { heading?: string; body?: string[]; quarterNotes?: { label: string; note: string }[] };
  funnel?: { heading?: string; intro?: string };
  whatChanged?: { heading?: string; outcomes?: string[] };
  whereNext?: { heading?: string; intro?: string; recommendations?: TitledItem[] };
};

export const NARRATIVE_SHAPE = `{
  "headline": string, "headlineHighlight": string, "dek": string, "subDek": string,
  "situation": {"heading": string, "body": string[], "pullStat": string},
  "channels": {"heading": string, "intro": string, "takeaways": [{"title": string, "body": string}]},
  "howItRan": {"heading": string, "steps": [{"title": string, "body": string}], "rolesHeading": string, "rolesIntro": string},
  "progression": {"heading": string, "body": string[], "quarterNotes": [{"label": string, "note": string}]},
  "funnel": {"heading": string, "intro": string},
  "whatChanged": {"heading": string, "outcomes": string[]},
  "whereNext": {"heading": string, "intro": string, "recommendations": [{"title": string, "body": string}]}
}`;

// Pre-computed, data-backed insights so the model leads with the sharpest facts instead of
// restating totals. Every number here also becomes an allowed number for the guard.
function insights(r: RevampCaseStudy) {
  const out: Record<string, unknown> = {};
  const tracked = r.channels.rows.filter((x) => x.appointments !== null);
  const apptTotal = tracked.reduce((t, x) => t + (x.appointments ?? 0), 0);
  if (apptTotal > 0) {
    const top = [...tracked].sort((a, b) => (b.appointments ?? 0) - (a.appointments ?? 0))[0];
    out.topChannel = {
      name: top.name,
      appointments: top.appointments,
      ofTrackedAppointments: apptTotal,
      sharePct: Math.round(((top.appointments ?? 0) / apptTotal) * 100),
    };
  }
  const untracked = r.channels.rows.filter((x) => x.appointments === null).map((x) => x.name);
  if (untracked.length) out.channelsWithoutAppointmentTracking = untracked;

  const roles = r.howItRan.roles.filter((x) => x.count !== null);
  const titled = roles.reduce((t, x) => t + (x.count ?? 0), 0);
  if (titled > 0) {
    const senior = roles.filter((x) => /c-suite|vp|director|head/i.test(x.role)).reduce((t, x) => t + (x.count ?? 0), 0);
    const top = [...roles].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
    out.seniority = {
      appointmentsWithTitle: titled,
      directorLevelAndAbove: senior,
      directorLevelAndAbovePct: Math.round((senior / titled) * 100),
      largestGroup: top.role,
      largestGroupCount: top.count,
      largestGroupPct: Math.round(((top.count ?? 0) / titled) * 100),
    };
  }

  const full = r.progression.quarters.filter((q) => !q.isPartial && q.count !== null);
  if (full.length >= 2) {
    const peak = [...full].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
    const low = [...full].sort((a, b) => (a.count ?? 0) - (b.count ?? 0))[0];
    out.quarters = {
      peakQuarter: peak.label,
      peakCount: peak.count,
      lowQuarter: low.label,
      lowCount: low.count,
      peakVsLowTimes: low.count ? Math.round(((peak.count ?? 0) / low.count) * 10) / 10 : null,
      fullQuarters: full.length,
    };
  }

  const set = r.funnel.stages[0]?.value ?? null;
  const held = r.funnel.stages[1]?.value ?? null;
  if (set && held) out.firstMeetingsHeld = { held, of: set, pct: Math.round((held / set) * 1000) / 10 };
  const unlogged = r.funnel.stages.filter((x) => x.value === null).map((x) => x.name);
  if (unlogged.length) out.funnelStagesNotLogged = unlogged;
  return out;
}

// The facts the model may use: numbers, labels and any writer text already on the sheet.
export function narrativeInput(r: RevampCaseStudy) {
  return {
    insights: insights(r),
    existingText: {
      clientName: r.clientName, solutionLines: r.solutionLines, country: r.country,
      headline: r.headline, dek: r.dek,
      situation: r.situation, primaryContactRole: r.primaryContact.role,
      howItRanSteps: r.howItRan.steps, outcomes: r.whatChanged.outcomes,
    },
    heroStats: r.heroStats,
    facts: r.facts,
    channels: r.channels.rows,
    appointmentsBySeniority: r.howItRan.roles,
    rolesFootnote: r.howItRan.rolesFootnote,
    quarters: r.progression.quarters.map((q) => ({ label: q.label, count: q.count, isPeak: q.isPeak, isPartial: q.isPartial })),
    chartMeta: r.progression.chartMeta,
    funnel: r.funnel.stages,
    methodologyNote: r.methodologyNote,
  };
}

/* ------------------------------- number guard ------------------------------- */

const NUM = /\d[\d,]*(?:\.\d+)?%?/g;
const norm = (t: string) => t.replace(/,/g, "").replace(/%$/, "");

// base: numbers that appear in the data, plus small counts.
// pct: percentages computed from two key numbers (only valid with "%" or "percent").
// ratio: "x times" ratios computed from two key numbers (only valid with "times", "x" or "-fold").
export type Allowed = { base: Set<string>; pct: Set<string>; ratio: Set<string> };

export function allowedNumbers(r: RevampCaseStudy): Allowed {
  const base = new Set<string>();
  const pct = new Set<string>();
  const ratio = new Set<string>();
  for (const m of JSON.stringify(narrativeInput(r)).match(NUM) || []) base.add(norm(m));
  for (let i = 0; i <= 24; i++) base.add(String(i));

  const key: number[] = [];
  for (const s of r.heroStats) {
    const v = Number(norm(s.value));
    if (Number.isFinite(v)) key.push(v);
  }
  for (const x of r.channels.rows) if (x.appointments !== null) key.push(x.appointments);
  for (const x of r.howItRan.roles) if (x.count !== null) key.push(x.count);
  for (const x of r.progression.quarters) if (x.count !== null) key.push(x.count);
  for (const x of r.funnel.stages) if (x.value !== null) key.push(x.value);
  const totalRoles = r.howItRan.roles.reduce((t, x) => t + (x.count ?? 0), 0);
  if (totalRoles) key.push(totalRoles);
  for (const a of key)
    for (const b of key) {
      if (b > 0 && a <= b) {
        const p = (a / b) * 100;
        pct.add(String(Math.round(p)));
        pct.add(String(Math.round(p * 10) / 10));
      }
      if (b > 0 && a > b) {
        const q = a / b;
        ratio.add(String(Math.round(q * 10) / 10));
        ratio.add(String(Math.round(q)));
      }
    }
  return { base, pct, ratio };
}

// The data has no money figures, so any monetary claim is unsupported by definition.
const MONEY = /[$€£¥]|\b(usd|eur|revenue|roi|million|billion|worth|deal value|pipeline value|arr|mrr)\b/i;

function numberOk(sentence: string, m: RegExpMatchArray, A: Allowed): boolean {
  const tok = m[0];
  const v = norm(tok);
  const after = sentence.slice((m.index ?? 0) + tok.length, (m.index ?? 0) + tok.length + 12).toLowerCase();
  if (tok.endsWith("%") || /^\s*percent/.test(after)) return A.base.has(v) || A.pct.has(v);
  if (A.base.has(v)) return true;
  if (/^\s*(x\b|times\b|-?fold\b)/.test(after)) return A.ratio.has(v);
  return false;
}

const stripDashes = (t: string) => t.replace(/\s*—\s*/g, ", ").replace(/\s+-\s+/g, ", ");

// Removes sentences with unsupported numbers or any money claim. Returns the cleaned text.
export function guardText(text: string, A: Allowed, dropped: { n: number }): string {
  const clean = stripDashes(String(text || "").trim());
  if (!clean) return "";
  // Split only at sentence ends (punctuation followed by whitespace), so decimals like 2.5 stay whole.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const ok = !MONEY.test(s) && [...s.matchAll(NUM)].every((m) => numberOk(s, m, A));
    if (!ok) dropped.n += 1;
    return ok;
  });
  return kept.join(" ").trim();
}

/* ------------------------------- house style ------------------------------- */

// Unsupported quality claims: the data can't back "high-quality" or "a significant portion".
const VAGUE_CLAIM = /\b(high[- ]quality|top[- ]tier|best[- ]in[- ]class|world[- ]class|significant portion|significant number|vast majority)\b/i;

// Filler words removed or swapped for plain ones.
export function plainWords(t: string): string {
  return t
    .replace(/\s*\b(successfully|effectively|seamlessly)\b/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\butiliz(e|es|ed|ing)\b/gi, (_m, e: string) => ({ e: "use", es: "uses", ed: "used", ing: "using" } as Record<string, string>)[e.toLowerCase()])
    .replace(/\bleverag(e|es|ed|ing)\b/gi, (_m, e: string) => ({ e: "use", es: "uses", ed: "used", ing: "using" } as Record<string, string>)[e.toLowerCase()])
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function dropVague(text: string, dropped: { n: number }): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const ok = !VAGUE_CLAIM.test(s);
    if (!ok) dropped.n += 1;
    return ok;
  });
  return kept.join(" ").trim();
}

const MONTHS_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

// Sentence case for headings and item titles: "Multi-Channel Engagement" -> "Multi-channel engagement".
// Keeps acronyms (IT, CIO), mixed case (LinkedIn), Q-labels, months, Callbox and the client's name.
export function sentenceCase(t: string, keep: Set<string>): string {
  const words = t.split(/\s+/);
  return words
    .map((w, i) =>
      w
        .split("-")
        .map((part, j) => {
          if (i === 0 && j === 0) return part;
          const m = /^([A-Z][a-z]+)([’'][a-z]+)?([,:;.!?)]*)$/.exec(part);
          if (!m) return part;
          const core = m[1];
          if (MONTHS_RE.test(core) || core === "Callbox" || keep.has(core.toLowerCase())) return part;
          return part.toLowerCase();
        })
        .join("-")
    )
    .join(" ");
}

/* ---------------------------------- merge ---------------------------------- */

const empty = (v: unknown) => (Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim());

// Fills only empty fields of `r` from the draft, after the number guard. Returns the new sheet,
// the list of drafted fields (for the review banner) and how many sentences were dropped.
export function mergeNarrative(r: RevampCaseStudy, draft: NarrativeDraft) {
  const next: RevampCaseStudy = structuredClone(r);
  const allowed = allowedNumbers(r);
  const dropped = { n: 0 };
  const drafted: string[] = [];
  // Proper words from the client's own name stay capitalized in sentence-case headings.
  const keep = new Set(
    [r.clientName, r.solutionLines, r.country].join(" ").toLowerCase().split(/[^a-z]+/).filter(Boolean)
  );
  // Body text: number guard, then filler words, then unsupported quality claims.
  const g = (t: unknown) => dropVague(plainWords(guardText(String(t ?? ""), allowed, dropped)), dropped);
  // Headings and item titles: same checks plus sentence case and no trailing punctuation.
  const gh = (t: unknown) => sentenceCase(g(t).replace(/[\s:;,.]+$/, ""), keep);
  const gl = (xs: unknown) => (Array.isArray(xs) ? xs.map(g).filter(Boolean) : []);
  const gt = (xs: unknown): TitledItem[] =>
    Array.isArray(xs)
      ? xs
          .map((x: any) => ({ title: gh(x?.title), body: g(x?.body) }))
          .filter((x) => x.title && x.body)
      : [];

  const set = <T>(label: string, current: T, value: T, apply: (v: T) => void) => {
    if (empty(current) && !empty(value)) {
      apply(value);
      drafted.push(label);
    }
  };

  set("Headline", next.headline, gh(draft.headline), (v) => (next.headline = v));
  // Highlight must be an exact substring of the (final) headline.
  const hl = g(draft.headlineHighlight);
  if (empty(next.headlineHighlight) && hl && next.headline.includes(hl)) next.headlineHighlight = hl;
  set("Dek", next.dek, g(draft.dek), (v) => (next.dek = v));
  set("Sub-dek", next.subDek, g(draft.subDek), (v) => (next.subDek = v));

  const S = draft.situation || {};
  set("Situation heading", next.situation.heading, gh(S.heading), (v) => (next.situation.heading = v));
  set("Situation text", next.situation.body, gl(S.body), (v) => (next.situation.body = v));
  set("Pull stat", next.situation.pullStat, g(S.pullStat), (v) => (next.situation.pullStat = v));

  const C = draft.channels || {};
  if (next.channels.rows.length) {
    set("Channels heading", next.channels.heading, gh(C.heading), (v) => (next.channels.heading = v));
    set("Channels intro", next.channels.intro, g(C.intro), (v) => (next.channels.intro = v));
    set("Channel takeaways", next.channels.takeaways, gt(C.takeaways).slice(0, 2), (v) => (next.channels.takeaways = v));
  }

  const H = draft.howItRan || {};
  set("How it ran heading", next.howItRan.heading, gh(H.heading), (v) => (next.howItRan.heading = v));
  set("How it ran steps", next.howItRan.steps, gt(H.steps).slice(0, 4), (v) => (next.howItRan.steps = v));
  if (next.howItRan.roles.length) {
    set("Roles heading", next.howItRan.rolesHeading, gh(H.rolesHeading), (v) => (next.howItRan.rolesHeading = v));
    set("Roles intro", next.howItRan.rolesIntro, g(H.rolesIntro), (v) => (next.howItRan.rolesIntro = v));
  }

  const P = draft.progression || {};
  if (next.progression.quarters.length) {
    set("Progression heading", next.progression.heading, gh(P.heading), (v) => (next.progression.heading = v));
    set("Progression text", next.progression.body, gl(P.body), (v) => (next.progression.body = v));
    let notes = 0;
    for (const qn of Array.isArray(P.quarterNotes) ? P.quarterNotes : []) {
      const q = next.progression.quarters.find((x) => x.label === qn?.label);
      // The count is already shown above the note: drop notes that only restate it,
      // and trim "with 35 appointments" tails.
      const note = g(qn?.note)
        .replace(/\s*(,\s*)?with\s+\d[\d,]*\s+(sales-qualified\s+)?appointments?/i, "")
        .replace(/^\s*\d[\d,]*\s+(sales-qualified\s+)?appointments?\.?\s*$/i, "")
        .trim();
      if (q && empty(q.note) && note) {
        q.note = note;
        notes += 1;
      }
    }
    if (notes) drafted.push("Quarter notes");
  }

  const F = draft.funnel || {};
  if (next.funnel.stages.length) {
    set("Funnel heading", next.funnel.heading, gh(F.heading), (v) => (next.funnel.heading = v));
    set("Funnel intro", next.funnel.intro, g(F.intro), (v) => (next.funnel.intro = v));
  }

  const W = draft.whatChanged || {};
  set("What changed heading", next.whatChanged.heading, gh(W.heading), (v) => (next.whatChanged.heading = v));
  set("Outcomes", next.whatChanged.outcomes, gl(W.outcomes).slice(0, 4), (v) => (next.whatChanged.outcomes = v));

  const N = draft.whereNext || {};
  set("Where next heading", next.whereNext.heading, gh(N.heading), (v) => (next.whereNext.heading = v));
  set("Where next intro", next.whereNext.intro, g(N.intro), (v) => (next.whereNext.intro = v));
  set("Recommendations", next.whereNext.recommendations, gt(N.recommendations).slice(0, 3), (v) => (next.whereNext.recommendations = v));
  if (next.whereNext.recommendations.length && empty(next.whereNext.footnote)) {
    next.whereNext.footnote = "This section is a Callbox recommendation, not a result the client has reported.";
  }

  return { next, drafted, droppedSentences: dropped.n };
}

/* ------------------------- pending fields (skeletons) ------------------------- */

// Keys of the fields the AI will draft for this sheet: the same rules mergeNarrative applies.
// Used to show skeletons while drafting, and to apply the result only where still empty.
export function pendingFields(r: RevampCaseStudy): Set<string> {
  const keys = new Set<string>();
  const want = (key: string, v: unknown, when = true) => {
    if (when && empty(v)) keys.add(key);
  };
  want("headline", r.headline);
  want("dek", r.dek);
  want("subDek", r.subDek);
  want("situation.heading", r.situation.heading);
  want("situation.body", r.situation.body);
  want("situation.pullStat", r.situation.pullStat);
  const ch = r.channels.rows.length > 0;
  want("channels.heading", r.channels.heading, ch);
  want("channels.intro", r.channels.intro, ch);
  want("channels.takeaways", r.channels.takeaways, ch);
  want("howItRan.heading", r.howItRan.heading);
  want("howItRan.steps", r.howItRan.steps);
  const ro = r.howItRan.roles.length > 0;
  want("howItRan.rolesHeading", r.howItRan.rolesHeading, ro);
  want("howItRan.rolesIntro", r.howItRan.rolesIntro, ro);
  const q = r.progression.quarters.length > 0;
  want("progression.heading", r.progression.heading, q);
  want("progression.body", r.progression.body, q);
  if (q && r.progression.quarters.some((x) => empty(x.note))) keys.add("progression.quarterNotes");
  const fu = r.funnel.stages.length > 0;
  want("funnel.heading", r.funnel.heading, fu);
  want("funnel.intro", r.funnel.intro, fu);
  want("whatChanged.heading", r.whatChanged.heading);
  want("whatChanged.outcomes", r.whatChanged.outcomes);
  want("whereNext.heading", r.whereNext.heading);
  want("whereNext.intro", r.whereNext.intro);
  want("whereNext.recommendations", r.whereNext.recommendations);
  return keys;
}

const getPath = (o: any, path: string) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o: any, path: string, v: unknown) => {
  const parts = path.split(".");
  const last = parts.pop() as string;
  const target = parts.reduce((x, k) => x[k], o);
  target[last] = v;
};

// Applies a drafted sheet onto the CURRENT sheet, field by field, only where the current value
// is still empty. Edits made while the AI was drafting are therefore never overwritten.
export function applyDrafted(current: RevampCaseStudy, drafted: RevampCaseStudy, keys: Set<string>): RevampCaseStudy {
  const next: RevampCaseStudy = structuredClone(current);
  for (const key of keys) {
    if (key === "progression.quarterNotes") {
      for (const q of next.progression.quarters) {
        const dq = drafted.progression.quarters.find((x) => x.label === q.label);
        if (dq && empty(q.note) && !empty(dq.note)) q.note = dq.note;
      }
      continue;
    }
    const v = getPath(drafted, key);
    if (empty(getPath(next, key)) && !empty(v)) setPath(next, key, structuredClone(v));
  }
  if (empty(next.headlineHighlight) && drafted.headlineHighlight && next.headline.includes(drafted.headlineHighlight)) {
    next.headlineHighlight = drafted.headlineHighlight;
  }
  if (next.whereNext.recommendations.length && empty(next.whereNext.footnote) && !empty(drafted.whereNext.footnote)) {
    next.whereNext.footnote = drafted.whereNext.footnote;
  }
  return next;
}
