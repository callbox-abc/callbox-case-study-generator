// Shape of the "Case Study: Revamp" ACF field group (GraphQL type CaseStudyRevamp).
// camelCase here; toAcfPayload() converts to the ACF field names WordPress expects over REST.

export type TitledItem = { title: string; body: string };

export type RevampCaseStudy = {
  pdfTitle: string; // browser/print document title only; not stored in ACF
  clientName: string;
  solutionLines: string;
  country: string;
  headline: string;
  headlineHighlight: string;
  dek: string;
  subDek: string;
  heroStats: { value: string; label: string }[];
  facts: { label: string; value: string }[];
  situation: { heading: string; body: string[]; pullStat: string };
  channels: {
    heading: string;
    intro: string;
    rows: { name: string; activity: string; appointments: number | null }[];
    takeaways: TitledItem[];
  };
  primaryContact: {
    heading: string;
    intro: string;
    eyebrow: string;
    role: string;
    context: string;
    pressures: TitledItem[];
    partnerReasons: TitledItem[];
  };
  howItRan: {
    heading: string;
    steps: TitledItem[];
    rolesHeading: string;
    rolesIntro: string;
    roles: { role: string; count: number | null }[];
    rolesFootnote: string;
  };
  progression: {
    heading: string;
    body: string[];
    chartTitle: string;
    chartMeta: string;
    quarters: { label: string; count: number | null; note: string; isPeak: boolean; isPartial: boolean }[];
    footnote: string;
  };
  funnel: {
    heading: string;
    intro: string;
    stages: { name: string; description: string; value: number | null }[];
  };
  whatChanged: {
    heading: string;
    outcomes: string[];
    quote: { text: string; name: string; title: string };
  };
  whereNext: { heading: string; intro: string; recommendations: TitledItem[]; footnote: string };
  methodologyNote: string;
  gate: { enabled: boolean; teaserUntil: "situation" | "channels" | "primaryContact"; formIndustryLabel: string };
  // Import context for the AI drafter only: never rendered, never sent to the CMS.
  internal: { leadSource: string; extraFacts: { label: string; value: string }[] };
};

// The JSON shape Gemini is asked to fill. Kept next to the type so they change together.
export const REVAMP_RESPONSE_SHAPE = `{
  "pdfTitle": string,
  "clientName": string, "solutionLines": string, "country": string,
  "headline": string, "headlineHighlight": string, "dek": string, "subDek": string,
  "heroStats": [{"value": string, "label": string}],
  "facts": [{"label": string, "value": string}],
  "situation": {"heading": string, "body": string[], "pullStat": string},
  "channels": {"heading": string, "intro": string,
    "rows": [{"name": string, "activity": string, "appointments": number|null}],
    "takeaways": [{"title": string, "body": string}]},
  "primaryContact": {"heading": string, "intro": string, "eyebrow": string, "role": string, "context": string,
    "pressures": [{"title": string, "body": string}], "partnerReasons": [{"title": string, "body": string}]},
  "howItRan": {"heading": string, "steps": [{"title": string, "body": string}],
    "rolesHeading": string, "rolesIntro": string, "roles": [{"role": string, "count": number|null}], "rolesFootnote": string},
  "progression": {"heading": string, "body": string[], "chartTitle": string, "chartMeta": string,
    "quarters": [{"label": string, "count": number|null, "note": string, "isPeak": boolean, "isPartial": boolean}], "footnote": string},
  "funnel": {"heading": string, "intro": string, "stages": [{"name": string, "description": string, "value": number|null}]},
  "whatChanged": {"heading": string, "outcomes": string[], "quote": {"text": string, "name": string, "title": string}},
  "whereNext": {"heading": string, "intro": string, "recommendations": [{"title": string, "body": string}], "footnote": string},
  "methodologyNote": string
}`;

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = <T>(v: unknown, map: (x: any) => T, keep: (x: T) => boolean = () => true): T[] =>
  Array.isArray(v) ? v.map(map).filter(keep) : [];
// Drafts often write items as "Title: body"; the colon belongs to the source formatting, not the title.
const cleanTitle = (t: string) => t.replace(/[\s:;,.\-–—]+$/, "");
const titled = (v: unknown) =>
  arr(v, (x) => ({ title: cleanTitle(s(x?.title)), body: s(x?.body) }), (x) => Boolean(x.title || x.body));

// Drop a leading section label that the source used as a heading prefix,
// e.g. "Pre-close Progression: Following the appointment…" -> "Following the appointment…".
const SECTION_PREFIX =
  /^(the\s+)?(situation|challenge|where the pipeline came from|channels?|primary contact|how it ran|progression|pre-?close progression|funnel|what changed|results|where it goes next|next steps|recommendations)\s*[:\-–—]\s*/i;
const heading = (v: unknown) => s(v).replace(SECTION_PREFIX, "");

// Normalises model output into a complete, safe RevampCaseStudy (no undefined, no wrong types).
export function normalizeRevamp(p: any): RevampCaseStudy {
  p = p && typeof p === "object" ? p : {};
  return {
    pdfTitle: s(p.pdfTitle),
    clientName: s(p.clientName),
    solutionLines: s(p.solutionLines),
    country: s(p.country),
    headline: s(p.headline),
    headlineHighlight: s(p.headlineHighlight),
    dek: s(p.dek),
    subDek: s(p.subDek),
    heroStats: arr(p.heroStats, (x) => ({ value: s(x?.value), label: s(x?.label) }), (x) => Boolean(x.value)).slice(0, 4),
    facts: arr(p.facts, (x) => ({ label: s(x?.label), value: s(x?.value) }), (x) => Boolean(x.label && x.value)).slice(0, 8),
    situation: {
      heading: heading(p.situation?.heading),
      body: arr(p.situation?.body, s, (x: string) => x.length > 0),
      pullStat: s(p.situation?.pullStat),
    },
    channels: {
      heading: heading(p.channels?.heading),
      intro: s(p.channels?.intro),
      rows: arr(p.channels?.rows, (x) => ({ name: s(x?.name), activity: s(x?.activity), appointments: n(x?.appointments) }), (x) => Boolean(x.name)),
      takeaways: titled(p.channels?.takeaways).slice(0, 2),
    },
    primaryContact: {
      heading: heading(p.primaryContact?.heading),
      intro: s(p.primaryContact?.intro),
      eyebrow: s(p.primaryContact?.eyebrow),
      role: s(p.primaryContact?.role),
      context: s(p.primaryContact?.context),
      pressures: titled(p.primaryContact?.pressures).slice(0, 6),
      partnerReasons: titled(p.primaryContact?.partnerReasons).slice(0, 3),
    },
    howItRan: {
      heading: heading(p.howItRan?.heading),
      steps: titled(p.howItRan?.steps).slice(0, 6),
      rolesHeading: s(p.howItRan?.rolesHeading),
      rolesIntro: s(p.howItRan?.rolesIntro),
      roles: arr(p.howItRan?.roles, (x) => ({ role: s(x?.role), count: n(x?.count) }), (x) => Boolean(x.role) && x.count !== null).slice(0, 12),
      rolesFootnote: s(p.howItRan?.rolesFootnote),
    },
    progression: {
      heading: heading(p.progression?.heading),
      body: arr(p.progression?.body, s, (x: string) => x.length > 0),
      chartTitle: s(p.progression?.chartTitle),
      chartMeta: s(p.progression?.chartMeta),
      quarters: arr(
        p.progression?.quarters,
        (x) => ({ label: s(x?.label), count: n(x?.count), note: s(x?.note), isPeak: Boolean(x?.isPeak), isPartial: Boolean(x?.isPartial) }),
        (x) => Boolean(x.label) && x.count !== null
      ).slice(0, 12),
      footnote: s(p.progression?.footnote),
    },
    funnel: {
      heading: heading(p.funnel?.heading),
      intro: s(p.funnel?.intro),
      stages: arr(p.funnel?.stages, (x) => ({ name: s(x?.name), description: s(x?.description), value: n(x?.value) }), (x) => Boolean(x.name)).slice(0, 5),
    },
    whatChanged: {
      heading: heading(p.whatChanged?.heading),
      outcomes: arr(p.whatChanged?.outcomes, s, (x: string) => x.length > 0).slice(0, 5),
      quote: { text: s(p.whatChanged?.quote?.text), name: s(p.whatChanged?.quote?.name), title: s(p.whatChanged?.quote?.title) },
    },
    whereNext: {
      heading: heading(p.whereNext?.heading),
      intro: s(p.whereNext?.intro),
      recommendations: titled(p.whereNext?.recommendations).slice(0, 3),
      footnote: s(p.whereNext?.footnote),
    },
    methodologyNote: s(p.methodologyNote),
    gate: { enabled: true, teaserUntil: "channels", formIndustryLabel: s(p.gate?.formIndustryLabel) },
    internal: {
      leadSource: s(p.internal?.leadSource),
      extraFacts: arr(p.internal?.extraFacts, (x) => ({ label: s(x?.label), value: s(x?.value) }), (x) => Boolean(x.label && x.value)).slice(0, 12),
    },
  };
}

const tb = (x: TitledItem) => ({ title: x.title, body: x.body });
const para = (t: string) => ({ paragraph: t });
// ACF number fields: send null for "not logged". The ACF REST schema only accepts a number or
// null here; an empty string fails validation with rest_invalid_param.
const num = (v: number | null) => (v === null || v === 0 ? null : v);

// Converts to the ACF field names from acf-case-study-revamp.json, as WordPress REST expects.
export function toAcfPayload(r: RevampCaseStudy) {
  return {
    client_name: r.clientName,
    solution_lines: r.solutionLines,
    country: r.country,
    headline: r.headline,
    headline_highlight: r.headlineHighlight,
    dek: r.dek,
    sub_dek: r.subDek,
    hero_stats: r.heroStats.filter((x) => x.value.trim() && !/^0+([.,]0+)?\s*%?$/.test(x.value.trim())),
    facts: r.facts,
    situation: { heading: r.situation.heading, body: r.situation.body.map(para), pull_stat: r.situation.pullStat },
    channels: {
      heading: r.channels.heading,
      intro: r.channels.intro,
      rows: r.channels.rows.map((x) => ({ name: x.name, activity: x.activity, appointments: num(x.appointments) })),
      takeaways: r.channels.takeaways.map(tb),
    },
    primary_contact: {
      heading: r.primaryContact.heading,
      intro: r.primaryContact.intro,
      eyebrow: r.primaryContact.eyebrow,
      role: r.primaryContact.role,
      context: r.primaryContact.context,
      pressures: r.primaryContact.pressures.map(tb),
      partner_reasons: r.primaryContact.partnerReasons.map(tb),
    },
    how_it_ran: {
      heading: r.howItRan.heading,
      steps: r.howItRan.steps.map(tb),
      roles_heading: r.howItRan.rolesHeading,
      roles_intro: r.howItRan.rolesIntro,
      roles: r.howItRan.roles.map((x) => ({ role: x.role, count: num(x.count) })),
      roles_footnote: r.howItRan.rolesFootnote,
    },
    progression: {
      heading: r.progression.heading,
      body: r.progression.body.map(para),
      chart_title: r.progression.chartTitle,
      chart_meta: r.progression.chartMeta,
      quarters: r.progression.quarters.map((x) => ({
        label: x.label,
        count: x.count, // periods keep 0: a completed period with 0 is a real result
        note: x.note,
        is_peak: x.isPeak,
        is_partial: x.isPartial,
      })),
      footnote: r.progression.footnote,
    },
    funnel: {
      heading: r.funnel.heading,
      intro: r.funnel.intro,
      stages: r.funnel.stages.map((x) => ({ name: x.name, description: x.description, value: num(x.value) })),
    },
    what_changed: {
      heading: r.whatChanged.heading,
      outcomes: r.whatChanged.outcomes.map((t) => ({ text: t })),
      quote: r.whatChanged.quote,
    },
    where_next: {
      heading: r.whereNext.heading,
      intro: r.whereNext.intro,
      recommendations: r.whereNext.recommendations.map(tb),
      footnote: r.whereNext.footnote,
    },
    methodology_note: r.methodologyNote,
    gate: {
      enabled: r.gate.enabled,
      teaser_until: r.gate.teaserUntil,
      form_industry_label: r.gate.formIndustryLabel,
    },
  };
}

export const EMPTY_REVAMP: RevampCaseStudy = normalizeRevamp({});

// Facts that imports own (HubSpot client facts, then CallboxOne program facts), in display order.
export const IMPORTED_FACT_ORDER = [
  "industry", "headquarters", "company size", "client since", "program growth",
  "period measured", "market", "channels worked", "lists worked", "list sources",
];
export const MAX_FACTS = 8;

// Merges imported facts into the sheet: an imported fact replaces the one with the same label,
// imported facts sit in IMPORTED_FACT_ORDER, and facts the writer added stay after them. Over the
// limit, the lowest-priority imported facts are left out (never the writer's); they are returned.
export function mergeFacts(
  current: RevampCaseStudy["facts"],
  incoming: RevampCaseStudy["facts"],
): { facts: RevampCaseStudy["facts"]; dropped: string[]; droppedFacts: RevampCaseStudy["facts"] } {
  const key = (l: string) => l.trim().toLowerCase();
  const rank = (l: string) => {
    const i = IMPORTED_FACT_ORDER.indexOf(key(l));
    return i === -1 ? Infinity : i;
  };
  const byLabel = new Map<string, { label: string; value: string }>();
  for (const f of current) byLabel.set(key(f.label), f);
  for (const f of incoming) byLabel.set(key(f.label), f);
  const imported = [...byLabel.values()].filter((f) => rank(f.label) !== Infinity).sort((a, b) => rank(a.label) - rank(b.label));
  const writer = current.filter((f) => rank(f.label) === Infinity);
  const room = Math.max(0, MAX_FACTS - writer.length);
  return {
    facts: [...imported.slice(0, room), ...writer],
    dropped: imported.slice(room).map((f) => f.label),
    droppedFacts: imported.slice(room),
  };
}

// Applies imported facts to a sheet. Facts that don't fit the display limit are kept in
// internal.extraFacts, so the AI drafter still sees them (e.g. "List sources": without it the
// draft claimed every list was built by Callbox). Returns the labels left off the display.
export function applyImportedFacts(d: RevampCaseStudy, incoming: RevampCaseStudy["facts"]): string[] {
  const key = (l: string) => l.trim().toLowerCase();
  const m = mergeFacts(d.facts, incoming);
  d.facts = m.facts;
  const shown = new Set(d.facts.map((f) => key(f.label)));
  const extra = new Map<string, { label: string; value: string }>();
  for (const f of [...(d.internal?.extraFacts || []), ...m.droppedFacts]) if (!shown.has(key(f.label))) extra.set(key(f.label), f);
  d.internal = { leadSource: d.internal?.leadSource || "", extraFacts: [...extra.values()] };
  return m.dropped;
}

// Sections that render in the PDF/page, in order. Empty optional sections are hidden and the
// remaining ones are renumbered, matching the WordPress template and the Next.js page.
export type SectionId =
  | "situation" | "channels" | "primaryContact" | "howItRan" | "progression" | "funnel" | "whatChanged" | "whereNext";

export const SECTION_TITLES: Record<SectionId, string> = {
  situation: "The situation",
  channels: "Where the pipeline came from",
  primaryContact: "The primary contact",
  howItRan: "How it ran",
  progression: "The progression",
  funnel: "Pre-close progression",
  whatChanged: "What changed",
  whereNext: "Where it goes next",
};

export const SECTION_ORDER: SectionId[] = [
  "situation", "channels", "primaryContact", "howItRan", "progression", "funnel", "whatChanged", "whereNext",
];

// Periods that can be compared with each other (peak, low, "x times"). Imports label whole
// quarters "Q3 2025" and shorter periods by their months ("Aug–Sep 2025": a mid-quarter launch,
// or the current period). So in a series of quarters, a month-labeled period is shorter and is
// left out; a series with no quarter labels (a writer's own months or halves) is compared as is.
// Periods still running (isPartial) are never compared.
const QUARTER_LABEL = /^Q[1-4]\s+\d{4}$/i;
export function comparablePeriods<T extends { label: string; count: number | null; isPartial: boolean }>(periods: T[]): T[] {
  const counted = periods.filter((p) => !p.isPartial && p.count !== null);
  const quarters = counted.filter((p) => QUARTER_LABEL.test(p.label.trim()));
  return quarters.length ? quarters : counted;
}

export function loggedFunnelStages(r: RevampCaseStudy) {
  return r.funnel.stages.filter((x) => x.value !== null && x.value > 0);
}

export function isSectionVisible(r: RevampCaseStudy, id: SectionId): boolean {
  switch (id) {
    case "situation": return Boolean(r.situation.heading || r.situation.body.some(Boolean));
    case "channels": return r.channels.rows.length > 0;
    case "primaryContact": return Boolean(r.primaryContact.role);
    case "howItRan": return r.howItRan.steps.length > 0;
    case "progression": return r.progression.quarters.some((q) => q.count !== null && q.count > 0);
    case "funnel": return loggedFunnelStages(r).length >= 3;
    case "whatChanged": return r.whatChanged.outcomes.some(Boolean);
    case "whereNext": return r.whereNext.recommendations.length > 0;
  }
}

export function sectionNumbers(r: RevampCaseStudy): Partial<Record<SectionId, number>> {
  const out: Partial<Record<SectionId, number>> = {};
  let i = 0;
  for (const id of SECTION_ORDER) if (isSectionVisible(r, id)) out[id] = ++i;
  return out;
}

// File name for the saved PDF (browsers use the page title): "CS_" + the case study's title with
// its words joined by dashes, e.g. "CS_B2B-Company-Drives-503-Sales-Qualified-Appointments-in-
// the-Philippines-Over-29-Months". Same title as the browser tab: the PDF Title field, else the
// headline. Punctuation goes, accented letters stay, and it stops at a whole word near 120 chars.
const NOT_WORD = new RegExp("[^\\p{L}\\p{N}]+", "u");
export function pdfFileName(r: Pick<RevampCaseStudy, "pdfTitle" | "headline" | "clientName">): string {
  const title = r.pdfTitle.trim() || r.headline.trim() || r.clientName.trim();
  const words = title.replace(/['’]/g, "").split(NOT_WORD).filter(Boolean);
  let name = "";
  for (const w of words) {
    const next = name ? `${name}-${w}` : w;
    if (next.length > 120) break;
    name = next;
  }
  return `CS_${name || "Case-Study"}`;
}

export function revampPlainText(r: RevampCaseStudy): string {
  const L: string[] = [];
  const push = (...x: string[]) => x.filter(Boolean).forEach((v) => L.push(v));
  push((r.headline || "Untitled case study").toUpperCase(), "");
  push([r.clientName, r.solutionLines, r.country].filter(Boolean).join(" · "));
  push(r.dek, r.subDek);
  const stats = r.heroStats.filter((x) => x.value.trim() && !/^0+([.,]0+)?\s*%?$/.test(x.value.trim()));
  if (stats.length) push("", ...stats.map((x) => `${x.value} ${x.label}`));
  if (r.facts.length) push("", ...r.facts.map((x) => `${x.label}: ${x.value}`));
  const nums = sectionNumbers(r);
  const head = (id: SectionId, h: string) => push("", `${String(nums[id]).padStart(2, "0")} · ${SECTION_TITLES[id].toUpperCase()}`, h);
  if (nums.situation) { head("situation", r.situation.heading); push(...r.situation.body, r.situation.pullStat); }
  if (nums.channels) { head("channels", r.channels.heading); push(r.channels.intro, ...r.channels.rows.map((x) => `${x.name}: ${x.activity}` + (x.appointments ? ` · appointments ${x.appointments}` : "")), ...r.channels.takeaways.map((x) => `${x.title}: ${x.body}`)); }
  if (nums.primaryContact) { const p = r.primaryContact; head("primaryContact", p.heading); push(p.intro, `${p.eyebrow} ${p.role}`.trim(), p.context, ...p.pressures.map((x) => `${x.title}: ${x.body}`), ...p.partnerReasons.map((x) => `${x.title}: ${x.body}`)); }
  if (nums.howItRan) { const h = r.howItRan; head("howItRan", h.heading); push(...h.steps.map((x, i) => `${i + 1}. ${x.title}: ${x.body}`), h.rolesHeading, h.rolesIntro, ...h.roles.filter((x) => x.count).map((x) => `${x.role}: ${x.count}`), h.rolesFootnote); }
  if (nums.progression) { const g = r.progression; head("progression", g.heading); push(...g.body, ...g.quarters.filter((q) => q.isPartial || q.count !== null).map((q) => (q.isPartial && !q.count ? `${q.label}: ongoing ${q.note}` : `${q.label}: ${q.count}${q.isPartial ? " (ongoing)" : ""} ${q.note}`).trim()), g.footnote); }
  if (nums.funnel) { head("funnel", r.funnel.heading); push(r.funnel.intro, ...loggedFunnelStages(r).map((x) => `${x.name}: ${x.value}`)); }
  if (nums.whatChanged) { const w = r.whatChanged; head("whatChanged", w.heading); push(...w.outcomes.map((x) => `- ${x}`)); if (w.quote.text) push(`"${w.quote.text}" ${[w.quote.name, w.quote.title].filter(Boolean).join(", ")}`); }
  if (nums.whereNext) { const n = r.whereNext; head("whereNext", n.heading); push(n.intro, ...n.recommendations.map((x) => `${x.title}: ${x.body}`), n.footnote); }
  push("", r.methodologyNote, "", "Callbox Inc.");
  return L.join("\n");
}
