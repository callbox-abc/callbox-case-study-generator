// AI drafting of the empty narrative fields, grounded in the sheet's own data.
//
// Guardrails enforced in code (not only in the prompt):
//  1. Only fields that are empty in the sheet are filled; writer text is never replaced.
//  2. Any drafted sentence containing a number that is not in the sheet's data (or a percentage
//     derived from two of its numbers) is dropped.
//  3. Fields with no data behind them are never drafted: client name, country, solution lines,
//     the primary contact's role (it comes from HubSpot or the writer), client quote, facts.
//     The rest of the primary contact section is drafted only once a role is on the sheet.
//  4. Em dashes are removed (house style).

import { comparablePeriods, type RevampCaseStudy, type TitledItem } from "@/lib/revamp";
import { exportable } from "@/lib/unbranded";

export type NarrativeDraft = {
  headline?: string;
  headlineHighlight?: string;
  dek?: string;
  subDek?: string;
  situation?: { heading?: string; body?: string[]; pullStat?: string };
  channels?: { heading?: string; intro?: string; takeaways?: TitledItem[] };
  primaryContact?: { heading?: string; intro?: string; context?: string; pressures?: TitledItem[]; partnerReasons?: TitledItem[] };
  howItRan?: { heading?: string; steps?: TitledItem[]; rolesHeading?: string; rolesIntro?: string };
  progression?: { heading?: string; body?: string[]; quarterNotes?: { label: string; note: string }[] };
  funnel?: { heading?: string; intro?: string };
  whatChanged?: { heading?: string; outcomes?: string[] };
  whereNext?: { heading?: string; intro?: string; recommendations?: TitledItem[] };
  // A number-free second heading per section, used when the main one fails the checks.
  headingBackups?: Partial<Record<SectionKey, string>>;
  // A second headline under the same rules, used when the main one fails the checks.
  headlineBackup?: string;
};

type SectionKey = "situation" | "channels" | "primaryContact" | "howItRan" | "progression" | "funnel" | "whatChanged" | "whereNext";

export const NARRATIVE_SHAPE = `{
  "headline": string, "headlineHighlight": string, "dek": string, "subDek": string,
  "situation": {"heading": string, "body": string[], "pullStat": string},
  "channels": {"heading": string, "intro": string, "takeaways": [{"title": string, "body": string}]},
  "primaryContact": {"heading": string, "intro": string, "context": string,
    "pressures": [{"title": string, "body": string}], "partnerReasons": [{"title": string, "body": string}]},
  "howItRan": {"heading": string, "steps": [{"title": string, "body": string}], "rolesHeading": string, "rolesIntro": string},
  "progression": {"heading": string, "body": string[], "quarterNotes": [{"label": string, "note": string}]},
  "funnel": {"heading": string, "intro": string},
  "whatChanged": {"heading": string, "outcomes": string[]},
  "whereNext": {"heading": string, "intro": string, "recommendations": [{"title": string, "body": string}]},
  "headlineBackup": string,
  "headingBackups": {"situation": string, "channels": string, "primaryContact": string, "howItRan": string,
    "progression": string, "funnel": string, "whatChanged": string, "whereNext": string}
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

  const current = r.progression.quarters.find((q) => q.isPartial);
  if (current) {
    out.campaignOngoing = true;
    out.currentPeriod = { label: current.label, countSoFar: current.count ?? 0, note: "still running, not a full period" };
  }
  // Whole quarters only: a short launch period would make the low look lower than it was.
  const full = comparablePeriods(r.progression.quarters);
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
  if (set && held) {
    out.firstMeetingsHeld = {
      held,
      of: set,
      pct: Math.round((held / set) * 1000) / 10,
      // Pre-computed so a recommendation like "59 of 111 have no confirmed first meeting" passes
      // the number guard (it only accepts numbers present in the data).
      appointmentsWithoutConfirmedMeeting: Math.max(0, set - held),
    };
  }
  const unlogged = r.funnel.stages.filter((x) => x.value === null).map((x) => x.name);
  if (unlogged.length) out.funnelStagesNotLogged = unlogged;
  return out;
}

// The facts the model may use: numbers, labels and any writer text already on the sheet.
// An unbranded sheet is stripped first: the model never sees a client detail, so it can't write one.
export function narrativeInput(sheet: RevampCaseStudy) {
  const r = exportable(sheet);
  return {
    ...(r.unbranded ? { unbranded: true } : {}),
    insights: insights(r),
    existingText: {
      clientName: r.clientName, solutionLines: r.solutionLines, country: r.country,
      headline: r.headline, dek: r.dek,
      situation: r.situation, primaryContactRole: r.primaryContact.role,
      leadSource: r.internal?.leadSource ?? "",
      howItRanSteps: r.howItRan.steps, outcomes: r.whatChanged.outcomes,
    },
    heroStats: r.heroStats,
    // Facts on display plus imported facts left off it by the display limit.
    facts: [...r.facts, ...(r.internal?.extraFacts ?? [])],
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
// basePct: percentages that appear in the data as percentages ("18.4%" in an activity line, or an
// insight field named *Pct). A plain data number is NOT a valid percentage: 40 appointments must
// not let "40%" through.
// pct and ratio map a derived value to the number pairs it can come from. A derived value is only
// accepted when both of its numbers appear in the same sentence ("87 of 111 ... 78%"): with ~30
// data numbers, the set of all possible ratios covers almost every whole number otherwise.
export type Allowed = {
  base: Set<string>;
  basePct: Set<string>;
  baseRatio: Set<string>;
  pct: Map<string, [number, number][]>;
  ratio: Map<string, [number, number][]>;
};

// Insight fields named *Pct / *Times are percentages / ratios the data already provides.
function collectFields(o: unknown, suffix: RegExp, out: Set<string>) {
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (suffix.test(k) && typeof v === "number") out.add(norm(String(v)));
    else if (typeof v === "object") collectFields(v, suffix, out);
  }
}

export function allowedNumbers(r: RevampCaseStudy): Allowed {
  const base = new Set<string>();
  const basePct = new Set<string>();
  const baseRatio = new Set<string>();
  const pct = new Map<string, [number, number][]>();
  const ratio = new Map<string, [number, number][]>();
  const put = (m: Map<string, [number, number][]>, k: number, a: number, b: number) => {
    const key = String(k);
    const list = m.get(key) ?? [];
    list.push([a, b]);
    m.set(key, list);
  };
  // Only the data counts, not the sheet's existing text: a number that is only in the text (e.g. a
  // draft's "1,622 emails" when CallboxOne has 117,570) isn't backed, so the AI may not repeat it,
  // and the truth check (lib/truthCheck.ts) flags it. CallboxOne is the source of truth.
  const { existingText: _text, ...data } = narrativeInput(r);
  const json = JSON.stringify(data);
  for (const m of json.match(NUM) || []) {
    if (m.endsWith("%")) basePct.add(norm(m));
    else base.add(norm(m));
  }
  collectFields(data, /pct$/i, basePct);
  collectFields(data, /times$/i, baseRatio);
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
        put(pct, Math.round(p), a, b);
        put(pct, Math.round(p * 10) / 10, a, b);
      }
      if (b > 0 && a > b) {
        const q = a / b;
        put(ratio, Math.round(q * 10) / 10, a, b);
        put(ratio, Math.round(q), a, b);
      }
    }
  return { base, basePct, baseRatio, pct, ratio };
}

// The data has no money figures, so any monetary claim is unsupported by definition.
const MONEY = /[$€£¥]|\b(usd|eur|revenue|roi|million|billion|worth|deal value|pipeline value|arr|mrr)\b/i;

// A case study reports what happened; forecasts are claims the data can't back.
const FORECAST = /\b(projected|projection|projections|projecting|projects\s+[\d,.]*\d|forecast\w*|predict\w*|expect(s|ed)? to|will (increase|grow|double|triple|deliver|generate|produce|reach|add|boost)|on track to|on pace to)\b/i;

// True when one of the value's source pairs has both numbers written in the sentence.
function pairInSentence(pairs: [number, number][] | undefined, sentence: string): boolean {
  if (!pairs) return false;
  const nums = new Set((sentence.match(NUM) || []).map(norm));
  return pairs.some(([a, b]) => nums.has(String(a)) && nums.has(String(b)));
}

function numberOk(sentence: string, m: RegExpMatchArray, A: Allowed): boolean {
  const tok = m[0];
  const v = norm(tok);
  const after = sentence.slice((m.index ?? 0) + tok.length, (m.index ?? 0) + tok.length + 12).toLowerCase();
  if (tok.endsWith("%") || /^\s*percent/.test(after)) return A.basePct.has(v) || pairInSentence(A.pct.get(v), sentence);
  if (/^\s*(x\b|times\b|-?fold\b)/.test(after)) return A.baseRatio.has(v) || pairInSentence(A.ratio.get(v), sentence);
  return A.base.has(v);
}

// Split only at sentence ends (punctuation followed by whitespace), so decimals like 2.5 stay whole.
export const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/);

// The numbers in a sentence that the data doesn't back, as written ("1,622", "40%").
export function unbackedNumbers(sentence: string, A: Allowed): string[] {
  return [...sentence.matchAll(NUM)].filter((m) => !numberOk(sentence, m, A)).map((m) => m[0]);
}

const stripDashes = (t: string) => t.replace(/\s*—\s*/g, ", ").replace(/\s+-\s+/g, ", ");

// Removes sentences with unsupported numbers or any money claim. Returns the cleaned text.
// What the checks removed, and why: shown to the writer so a missing heading is explainable.
export type Drops = { n: number; items?: { text: string; reason: string }[] };
const noteDrop = (dropped: Drops, text: string, reason: string) => {
  dropped.n += 1;
  if (dropped.items && dropped.items.length < 20) dropped.items.push({ text: text.slice(0, 160), reason });
};

export function guardText(text: string, A: Allowed, dropped: Drops): string {
  const clean = stripDashes(String(text || "").trim());
  if (!clean) return "";
  // Split only at sentence ends (punctuation followed by whitespace), so decimals like 2.5 stay whole.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const reason = MONEY.test(s)
      ? "money claim"
      : FORECAST.test(s)
        ? "forecast"
        : [...s.matchAll(NUM)].every((m) => numberOk(s, m, A))
          ? ""
          : "number not in the data";
    if (reason) noteDrop(dropped, s, reason);
    return !reason;
  });
  return kept.join(" ").trim();
}

/* ------------------------------- house style ------------------------------- */

// Unsupported quality claims: the data can't back "high-quality" or "a significant portion".
const VAGUE_CLAIM = /\b(high[- ]quality|top[- ]tier|best[- ]in[- ]class|world[- ]class|significant portion|significant number|vast majority)\b/i;

// Filler words removed or swapped for plain ones.
export function plainWords(t: string): string {
  return t
    // Records on a list were worked, not people engaged or reached.
    .replace(/\b(engag|reach|contact)(ed|ing|es|e)?(\s+)([\d,]+\s+(?:prospect\s+)?records)\b/gi, (_m, verb: string, end: string | undefined, sp: string, rest: string) => {
      const e = (end || "").toLowerCase();
      const w = e === "ing" ? "working" : e === "es" ? "works" : e === "ed" ? "worked" : "work";
      return (verb[0] === verb[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w) + sp + rest;
    })
    // Appointments are set, not held: only "first appointment transpired" counts meetings held.
    .replace(/\b(appointments|meetings)\s+held\s+with\b/gi, (m: string) => (m[0] === "A" || m[0] === "M" ? "Appointments with" : "appointments with"))
    .replace(/\s*\b(successfully|effectively|seamlessly)\b/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\butiliz(e|es|ed|ing)\b/gi, (_m, e: string) => ({ e: "use", es: "uses", ed: "used", ing: "using" } as Record<string, string>)[e.toLowerCase()])
    .replace(/\bleverag(e|es|ed|ing)\b/gi, (_m, e: string) => ({ e: "use", es: "uses", ed: "used", ing: "using" } as Record<string, string>)[e.toLowerCase()])
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Share words are fine next to the real number ("most, 87 of 111") but not instead of it.
const VAGUE_SHARE = /\b(large|vast|clear|overwhelming|strong) majority\b|\bmajority of\b|\bthe bulk of\b|\ba (large|big|sizable|substantial) (share|portion|part|chunk)\b|\bmost of (the )?(program|campaign|appointments|results|meetings|pipeline)\b/i;

export function dropVague(text: string, dropped: Drops): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const ok = !VAGUE_CLAIM.test(s) && !(VAGUE_SHARE.test(s) && !/\d/.test(s));
    if (!ok) noteDrop(dropped, s, VAGUE_CLAIM.test(s) ? "unsupported quality claim" : "share word without the number");
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

// Headlines use Title Case, like the live case study titles. Small words stay lowercase unless
// first or last; acronyms and mixed-case words (US, IT, MSP, SaaS, LinkedIn) are kept as written.
const SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "at", "by", "in", "of", "on", "to", "up", "as", "via", "vs", "per"]);
export function titleCase(t: string): string {
  const words = t.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) =>
      w
        .split("-")
        .map((part, j) => {
          const m = /^([("'“]*)([A-Za-z][A-Za-z’']*)(.*)$/.exec(part);
          if (!m) return part; // numbers such as 111 or 3x
          const [, pre, core, post] = m;
          if (/[A-Z]/.test(core.slice(1))) return part;
          const edge = (i === 0 && j === 0) || i === words.length - 1;
          if (!edge && j === 0 && SMALL_WORDS.has(core.toLowerCase())) return pre + core.toLowerCase() + post;
          return pre + core[0].toUpperCase() + core.slice(1).toLowerCase() + post;
        })
        .join("-")
    )
    .join(" ");
}

// Section headings that only name the section ("Channel performance", "Key outcomes from the
// program") instead of saying what happened in it.
const GENERIC_HEADING = new RegExp(
  "^(the\\s+)?(" +
    "(channel|program|campaign)\\s+(performance|results|overview)" +
    "|key\\s+(outcomes|results|takeaways)(\\s+from\\s+the\\s+(program|campaign))?" +
    "|results|outcomes|overview|summary|next steps|recommendations" +
    "|optimi[sz]ing\\s+for\\s+(future\\s+)?growth" +
    ")$",
  "i"
);

// Case study headlines describe the client by type ("US-Based Cybersecurity Provider"), never by
// name. True when the text contains a distinctive word of the client's name.
const NAME_GENERIC = new Set([
  "inc", "llc", "ltd", "corp", "co", "group", "global", "holdings", "company", "solutions", "technologies",
  "technology", "systems", "services", "international", "the", "and",
]);
export function namesClient(text: string, clientName: string): boolean {
  const toks = clientName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NAME_GENERIC.has(w));
  const t = text.toLowerCase();
  return toks.some((w) => new RegExp(`\\b${w}\\b`).test(t));
}

// "Callbox recommends two actions" must match the number of items actually kept.
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
export function matchItemCount(text: string, n: number): string {
  if (!text || n < 1 || n > 6) return text;
  return text.replace(
    /\b(one|two|three|four|five|six|\d|several|a few|a couple of|multiple|a number of)(\s+)(key\s+|clear\s+|main\s+)?(actions?|recommendations?|steps?|moves?|priorities|priority|changes?)\b/gi,
    (_m, _num: string, sp: string, adj: string | undefined, noun: string) => {
      const base = noun.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");
      const plural = n === 1 ? base : base === "priority" ? "priorities" : base + "s";
      // Vague counts ("several actions") become the real count too.
      const word = /^\d$/.test(_num) ? String(n) : COUNT_WORDS[n];
      const cased = _num[0] === _num[0].toUpperCase() && !/^\d$/.test(_num) ? word[0].toUpperCase() + word.slice(1) : word;
      return `${cased}${sp}${adj ?? ""}${plural}`;
    }
  );
}

/* ---------------------------------- merge ---------------------------------- */

const empty = (v: unknown) => (Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim());

// Fills only empty fields of `r` from the draft, after the number guard. Returns the new sheet,
// the list of drafted fields (for the review banner) and how many sentences were dropped.
export function mergeNarrative(r: RevampCaseStudy, draft: NarrativeDraft) {
  const next: RevampCaseStudy = structuredClone(r);
  const allowed = allowedNumbers(r);
  const dropped: Drops = { n: 0, items: [] };
  const drafted: string[] = [];
  // Proper words from the client's own name stay capitalized in sentence-case headings.
  // So is the client's CRM ("Log every stage in Salesforce").
  const crm = (r.internal?.extraFacts ?? []).find((f) => f.label.trim().toLowerCase() === "crm in use")?.value ?? "";
  const keep = new Set(
    [r.clientName, r.solutionLines, r.country, crm].join(" ").toLowerCase().split(/[^a-z]+/).filter(Boolean)
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

  // Section heading: the main one if it passes the checks and says something specific, else the
  // number-free backup. A generic label only survives when neither is specific.
  const hb = draft.headingBackups || {};
  const role = r.primaryContact.role.trim().toLowerCase();
  const generic = (h: string) => GENERIC_HEADING.test(h.trim()) || (role.length > 0 && h.trim().toLowerCase().replace(/^the\s+/, "") === role);
  const head = (main: unknown, key: SectionKey) => {
    const a = gh(main);
    const b = gh(hb[key]);
    if (a && !generic(a)) return a;
    if (b && !generic(b)) return b;
    return a || b;
  };

  const set = <T>(label: string, current: T, value: T, apply: (v: T) => void) => {
    if (empty(current) && !empty(value)) {
      apply(value);
      drafted.push(label);
    }
  };

  // Headline: Title Case like the live case study titles. A drafted headline is dropped (never
  // edited) when it names the client or credits the whole appointment total to one channel
  // ("111 Appointments Through LinkedIn" when LinkedIn produced 87); the backup headline is then
  // tried under the same checks.
  const totals = new Set<string>();
  const tracked = r.channels.rows.reduce((t, x) => t + (x.appointments ?? 0), 0);
  if (tracked) totals.add(String(tracked));
  const apptStat = r.heroStats.find((x) => /appointment/i.test(x.label));
  if (apptStat) totals.add(norm(apptStat.value));
  const headlineIssue = (h: string): string => {
    if (namesClient(h, r.clientName)) return "names the client";
    const nums = (h.match(NUM) || []).map(norm);
    const named = r.channels.rows.filter((x) => {
      const name = x.name.replace(/[^A-Za-z0-9]/g, "");
      return name && new RegExp(`\\b${name}\\b`, "i").test(h);
    });
    if (named.length === 1 && nums.some((v) => totals.has(v) && v !== String(named[0].appointments))) {
      return `credits all appointments to ${named[0].name}`;
    }
    return "";
  };
  const pickHeadline = (...candidates: unknown[]): string => {
    for (const c of candidates) {
      const h = titleCase(g(c).replace(/[\s:;,.]+$/, ""));
      if (!h) continue;
      const issue = headlineIssue(h);
      if (!issue) return h;
      noteDrop(dropped, h, issue);
    }
    return "";
  };
  set("Headline", next.headline, pickHeadline(draft.headline, draft.headlineBackup), (v) => (next.headline = v));
  // Highlight must be a substring of the (final) headline: matched ignoring case, taken from it.
  const hl = g(draft.headlineHighlight).replace(/[\s:;,.]+$/, "");
  const at = hl ? next.headline.toLowerCase().indexOf(hl.toLowerCase()) : -1;
  if (empty(next.headlineHighlight) && at >= 0) next.headlineHighlight = next.headline.slice(at, at + hl.length);
  set("Dek", next.dek, g(draft.dek), (v) => (next.dek = v));
  set("Sub-dek", next.subDek, g(draft.subDek), (v) => (next.subDek = v));

  const S = draft.situation || {};
  set("Situation heading", next.situation.heading, head(S.heading, "situation"), (v) => (next.situation.heading = v));
  set("Situation text", next.situation.body, gl(S.body), (v) => (next.situation.body = v));
  set("Pull stat", next.situation.pullStat, g(S.pullStat), (v) => (next.situation.pullStat = v));

  const C = draft.channels || {};
  if (next.channels.rows.length) {
    set("Channels heading", next.channels.heading, head(C.heading, "channels"), (v) => (next.channels.heading = v));
    set("Channels intro", next.channels.intro, g(C.intro), (v) => (next.channels.intro = v));
    set("Channel takeaways", next.channels.takeaways, gt(C.takeaways).slice(0, 2), (v) => (next.channels.takeaways = v));
  }

  // Primary contact: only once a role is on the sheet (from HubSpot or the writer). The role
  // itself is never drafted.
  const PC = draft.primaryContact || {};
  if (!next.unbranded && next.primaryContact.role.trim()) {
    set("Contact heading", next.primaryContact.heading, head(PC.heading, "primaryContact"), (v) => (next.primaryContact.heading = v));
    set("Contact intro", next.primaryContact.intro, g(PC.intro), (v) => (next.primaryContact.intro = v));
    set("Contact context", next.primaryContact.context, g(PC.context), (v) => (next.primaryContact.context = v));
    set("Role pressures", next.primaryContact.pressures, gt(PC.pressures).slice(0, 4), (v) => (next.primaryContact.pressures = v));
    set("Partner reasons", next.primaryContact.partnerReasons, gt(PC.partnerReasons).slice(0, 3), (v) => (next.primaryContact.partnerReasons = v));
  }

  const H = draft.howItRan || {};
  set("How it ran heading", next.howItRan.heading, head(H.heading, "howItRan"), (v) => (next.howItRan.heading = v));
  set("How it ran steps", next.howItRan.steps, gt(H.steps).slice(0, 4), (v) => (next.howItRan.steps = v));
  if (next.howItRan.roles.length) {
    set("Roles heading", next.howItRan.rolesHeading, gh(H.rolesHeading), (v) => (next.howItRan.rolesHeading = v));
    set("Roles intro", next.howItRan.rolesIntro, g(H.rolesIntro), (v) => (next.howItRan.rolesIntro = v));
  }

  const P = draft.progression || {};
  if (next.progression.quarters.length) {
    set("Progression heading", next.progression.heading, head(P.heading, "progression"), (v) => (next.progression.heading = v));
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
    set("Funnel heading", next.funnel.heading, head(F.heading, "funnel"), (v) => (next.funnel.heading = v));
    set("Funnel intro", next.funnel.intro, g(F.intro), (v) => (next.funnel.intro = v));
  }

  const W = draft.whatChanged || {};
  set("What changed heading", next.whatChanged.heading, head(W.heading, "whatChanged"), (v) => (next.whatChanged.heading = v));
  set("Outcomes", next.whatChanged.outcomes, gl(W.outcomes).slice(0, 4), (v) => (next.whatChanged.outcomes = v));

  const N = draft.whereNext || {};
  set("Where next heading", next.whereNext.heading, head(N.heading, "whereNext"), (v) => (next.whereNext.heading = v));
  set("Where next intro", next.whereNext.intro, g(N.intro), (v) => (next.whereNext.intro = v));
  set("Recommendations", next.whereNext.recommendations, gt(N.recommendations).slice(0, 3), (v) => (next.whereNext.recommendations = v));
  // If the guard dropped an item, an intro like "two actions" no longer matches: fix the count.
  next.whereNext.intro = matchItemCount(next.whereNext.intro, next.whereNext.recommendations.length);
  next.howItRan.heading = matchItemCount(next.howItRan.heading, next.howItRan.steps.length);
  if (next.whereNext.recommendations.length && empty(next.whereNext.footnote)) {
    next.whereNext.footnote = "This section is a Callbox recommendation, not a result the client has reported.";
  }

  return { next, drafted, droppedSentences: dropped.n, droppedDetails: dropped.items ?? [] };
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
  const pc = !r.unbranded && !empty(r.primaryContact.role);
  want("primaryContact.heading", r.primaryContact.heading, pc);
  want("primaryContact.intro", r.primaryContact.intro, pc);
  want("primaryContact.context", r.primaryContact.context, pc);
  want("primaryContact.pressures", r.primaryContact.pressures, pc);
  want("primaryContact.partnerReasons", r.primaryContact.partnerReasons, pc);
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
