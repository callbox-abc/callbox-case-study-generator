// Server-only client for the CallboxOne (Pipeline) MCP server.
// Env: CALLBOXONE_MCP_URL (server URL), CALLBOXONE_TOKEN (Bearer: Pipeline PAT or OAuth token).
// Read-only: only reporting/search tools are called.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RevampCaseStudy } from "@/lib/revamp";

export class CallboxOneConfigError extends Error {}

const ALLOWED_TOOLS = new Set([
  "get_identity",
  "list_client_lists",
  "search_campaign_by_name",
  "list_campaigns",
  "get_report_stats",
  "get_opportunity_progression",
]);

export async function withCallboxOne<T>(fn: (call: (name: string, args: Record<string, unknown>) => Promise<any>) => Promise<T>): Promise<T> {
  const url = process.env.CALLBOXONE_MCP_URL;
  const token = process.env.CALLBOXONE_TOKEN;
  if (!url || !token) {
    throw new CallboxOneConfigError("CallboxOne is not configured. Set CALLBOXONE_MCP_URL and CALLBOXONE_TOKEN in Vercel and redeploy.");
  }

  const client = new Client({ name: "callbox-case-study-generator", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown>) => {
    if (!ALLOWED_TOOLS.has(name)) throw new Error(`Tool not allowed: ${name}`);
    const res: any = await client.callTool({ name, arguments: args });
    const text = (res?.content || []).find((c: any) => c?.type === "text")?.text ?? "";
    if (res?.isError) throw new Error(`CallboxOne ${name} failed: ${String(text).slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`CallboxOne ${name} returned non-JSON output.`);
    }
  };

  try {
    return await fn(call);
  } finally {
    await client.close().catch(() => {});
  }
}

/* ------------------------------------ helpers ------------------------------------ */

// Campaign codes end in YYMM + sequence digit, e.g. NETRIX25071 = July 2025.
export function startFromCampaignCode(code: string): Date | null {
  const m = /(\d{2})(\d{2})\d$/.exec((code || "").trim());
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d > new Date() ? null : d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Window = { label: string; from: string; to: string; partial: boolean };

// Calendar quarters from the start month to today; the last one may be partial.
export function quarterWindows(start: Date, today = new Date()): Window[] {
  const out: Window[] = [];
  let y = start.getUTCFullYear();
  let q = Math.floor(start.getUTCMonth() / 3);
  for (;;) {
    const qStart = new Date(Date.UTC(y, q * 3, 1));
    if (qStart > today) break;
    const qEnd = new Date(Date.UTC(y, q * 3 + 3, 0));
    const from = qStart < start ? start : qStart;
    const partial = qEnd > today;
    const to = partial ? today : qEnd;
    const label = partial
      ? from.getUTCMonth() === to.getUTCMonth()
        ? `${SHORT[from.getUTCMonth()]} ${from.getUTCFullYear()}`
        : `${SHORT[from.getUTCMonth()]}–${SHORT[to.getUTCMonth()]} ${to.getUTCFullYear()}`
      : `Q${q + 1} ${y}`;
    out.push({ label, from: iso(from), to: iso(to), partial });
    q += 1;
    if (q > 3) {
      q = 0;
      y += 1;
    }
  }
  return out;
}

// Appointment and registration job titles are free text (90 distinct titles on one campaign),
// so they are grouped by seniority, which works for any industry. Only titles are read;
// contact names, emails and phones in the same records are never used or returned.
export const LEVELS = [
  ["lvlCsuite", "C-suite"],
  ["lvlVp", "VP"],
  ["lvlDirector", "Director / Head"],
  ["lvlManager", "Manager / Lead"],
  ["lvlSpecialist", "Specialist / Engineer"],
  ["lvlOther", "Other"],
] as const;
type LevelKey = (typeof LEVELS)[number][0];

export function seniorityOf(title: string): LevelKey {
  const x = (title || "").toLowerCase().replace(/office of the \w+/g, "");
  if (/\bchief\b|\bc(e|f|i|t|o|m|s|is|r|d)o\b|\bciso\b|\bfounder\b|\bowner\b/.test(x) || /(?<!vice )\bpresident\b/.test(x)) return "lvlCsuite";
  if (/\b(vice president|vp|svp|evp|avp)\b/.test(x)) return "lvlVp";
  if (/\bdirector\b|\bhead\b/.test(x)) return "lvlDirector";
  if (/\bmanager\b|\blead\b/.test(x)) return "lvlManager";
  if (/architect|engineer|developer|analyst|administrator|specialist|\bsme\b|consultant/.test(x)) return "lvlSpecialist";
  return "lvlOther";
}

const levelCounts = (records: any[], prefix: "sql_" | "er_") => {
  const out: Record<string, number> = {};
  for (const [k] of LEVELS) out[prefix + k] = 0;
  for (const r of Array.isArray(records) ? records : []) {
    const t = typeof r?.jobTitle === "string" ? r.jobTitle.trim() : "";
    if (t) out[prefix + seniorityOf(t)] += 1;
  }
  return out;
};

export type Totals = {
  voiceCalls: number; emailDelivered: number; emailOpens: number; emailClicks: number;
  liMessages: number; liReplies: number; sql: number; sqlCalling: number; sqlLinkedIn: number; er: number;
} & Record<string, number>;
const ZERO: Totals = {
  voiceCalls: 0, emailDelivered: 0, emailOpens: 0, emailClicks: 0, liMessages: 0, liReplies: 0, sql: 0, sqlCalling: 0, sqlLinkedIn: 0, er: 0,
  ...Object.fromEntries(LEVELS.flatMap(([k]) => [["sql_" + k, 0], ["er_" + k, 0]])),
};
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Totals arriving from the browser (step-by-step import) are re-checked before use.
export function sanitizeTotals(v: any): Totals {
  return Object.fromEntries(Object.keys(ZERO).map((k) => [k, n(v?.[k])])) as Totals;
}

export function sanitizeWindow(v: any): Window | null {
  const d = /^\d{4}-\d{2}-\d{2}$/;
  if (!v || typeof v.label !== "string" || !d.test(v.from) || !d.test(v.to)) return null;
  return { label: v.label.slice(0, 40), from: v.from, to: v.to, partial: Boolean(v.partial) };
}

export function totalsFromReport(report: any, clientAccountId: number): Totals {
  const c = (report?.campaigns || []).find((x: any) => Number(x?.clientAccountId) === Number(clientAccountId)) ?? report?.campaigns?.[0];
  const ch = c?.week?.channels || {};
  const cv = c?.week?.conversions || {};
  return {
    voiceCalls: n(ch.voiceCalls), emailDelivered: n(ch.emailDelivered), emailOpens: n(ch.emailOpens), emailClicks: n(ch.emailClicks),
    liMessages: n(ch.liMessages), liReplies: n(ch.liReplies),
    sql: n(cv.sqlTotal), sqlCalling: n(cv.sqlCalling), sqlLinkedIn: n(cv.sqlLinkedIn), er: n(cv.erTotal),
    ...levelCounts(report?.report?.sqls, "sql_"),
    ...levelCounts(report?.report?.ers, "er_"),
  };
}

const add = (a: Totals, b: Totals): Totals =>
  Object.fromEntries(Object.keys(a).map((k) => [k, (a as any)[k] + (b as any)[k]])) as Totals;
const fmt = (x: number) => x.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "");

/* --------------------------------- lists --------------------------------- */

// Prospect lists worked on the campaign, grouped by what kind of list they are. Only counts and
// groups leave the server: list names often carry data-vendor names and are never returned.
export type ListSummary = { lists: number; records: number; mix: { kind: string; lists: number; records: number }[] };

const LIST_KINDS: [RegExp, string][] = [
  [/webinar|brighttalk|event|summit|conference/i, "webinar and event audiences"],
  [/inbound/i, "inbound lead lists"],
  [/engaged|re-?engag|reactivat|nurture|recycl/i, "re-engagement lists"],
];

export function listSummary(resp: any, clientAccountId: number): ListSummary | null {
  const all = Array.isArray(resp?.lists) ? resp.lists : [];
  const lists = all.filter((l: any) => !clientAccountId || Number(l?.clientAccountId) === Number(clientAccountId));
  if (!lists.length) return null;
  const groups = new Map<string, { lists: number; records: number }>();
  let records = 0;
  for (const l of lists) {
    const name = String(l?.list || "");
    const kind = LIST_KINDS.find(([re]) => re.test(name))?.[1] ?? "built and enriched prospect lists";
    const n = Number(l?.recordCount) || 0;
    records += n;
    const g = groups.get(kind) ?? { lists: 0, records: 0 };
    g.lists += 1;
    g.records += n;
    groups.set(kind, g);
  }
  const mix = Array.from(groups, ([kind, g]) => ({ kind, ...g })).sort((a, b) => b.lists - a.lists || b.records - a.records);
  return { lists: lists.length, records, mix };
}

export function sanitizeListSummary(v: any): ListSummary | null {
  if (!v || typeof v !== "object") return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
  const mix = Array.isArray(v.mix)
    ? v.mix
        .slice(0, 6)
        .map((m: any) => ({ kind: String(m?.kind || "").slice(0, 60), lists: num(m?.lists), records: num(m?.records) }))
        .filter((m: { kind: string; lists: number }) => m.kind && m.lists > 0)
    : [];
  const lists = num(v.lists);
  return lists > 0 ? { lists, records: num(v.records), mix } : null;
}

/* ------------------------------ market (timezone) ------------------------------ */

// The campaign's Pipeline time zone is where the campaign ran (the target market), not where the
// client is based, so it fills a "Market" fact, never the client's country.
const TZ_MARKET: [RegExp, string][] = [
  [/^(US\/|America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana)|Pacific\/Honolulu)/, "United States"],
  [/^(Canada\/|America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns))/, "Canada"],
  [/^Australia\//, "Australia"],
  [/^(Pacific\/Auckland|NZ)/, "New Zealand"],
  [/^Asia\/Singapore/, "Singapore"],
  [/^Asia\/Manila/, "Philippines"],
  [/^Asia\/Hong_Kong/, "Hong Kong"],
  [/^Asia\/Kuala_Lumpur/, "Malaysia"],
  [/^Asia\/(Kolkata|Calcutta)/, "India"],
  [/^Asia\/Dubai/, "United Arab Emirates"],
  [/^Asia\/Tokyo/, "Japan"],
  [/^(Europe\/London|GB)/, "United Kingdom"],
  [/^Europe\/Dublin/, "Ireland"],
  [/^America\/Bogota/, "Colombia"],
  [/^America\/Mexico_City/, "Mexico"],
];

export function marketFromTimezone(tz: string | null | undefined): string {
  const t = String(tz || "");
  return TZ_MARKET.find(([re]) => re.test(t))?.[1] ?? "";
}

export type ImportResult = {
  campaign: { clientId: number; clientAccountId: number; campaignName: string; clientName: string };
  period: { from: string; to: string; months: number; ongoing: boolean };
  patch: Pick<RevampCaseStudy, "heroStats" | "facts"> & {
    channels: Pick<RevampCaseStudy["channels"], "rows">;
    progression: Pick<RevampCaseStudy["progression"], "quarters" | "chartTitle" | "chartMeta">;
    funnel: Pick<RevampCaseStudy["funnel"], "stages">;
    howItRan: Pick<RevampCaseStudy["howItRan"], "roles" | "rolesFootnote">;
    methodologyNote: string;
  };
  notes: string[];
};

// Builds the data sections of the sheet from CallboxOne numbers only. Narrative fields are untouched.
export function buildPatch(
  campaign: ImportResult["campaign"],
  windows: Window[],
  perWindow: Totals[],
  progression: any,
  extras: { lists?: ListSummary | null; timezone?: string } = {},
): ImportResult {
  // A trailing period with no activity at all means the campaign has stopped: drop it, so the
  // duration ends at the last active period instead of reading as "ongoing".
  const active = (t: Totals) => t.voiceCalls + t.liMessages + t.emailDelivered + t.sql + t.er > 0;
  windows = [...windows];
  perWindow = [...perWindow];
  while (windows.length > 1 && !active(perWindow[perWindow.length - 1])) {
    windows.pop();
    perWindow.pop();
  }
  // Still running = the latest period is the current, unfinished one and it has activity.
  const ongoing = windows[windows.length - 1]?.partial === true;

  const total = perWindow.reduce(add, ZERO);
  const lists = extras.lists ?? null;
  const from = windows[0]?.from ?? "";
  const to = windows[windows.length - 1]?.to ?? "";
  const months = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (30.44 * 864e5)));
  const notes: string[] = [];

  const rows: RevampCaseStudy["channels"]["rows"] = [];
  if (total.liMessages > 0 || total.sqlLinkedIn > 0)
    rows.push({ name: "LinkedIn", activity: `${fmt(total.liMessages)} messages sent · ${fmt(total.liReplies)} replies${total.liMessages ? ` · a ${pct(total.liReplies, total.liMessages)} reply rate` : ""}`, appointments: total.sqlLinkedIn });
  if (total.voiceCalls > 0 || total.sqlCalling > 0)
    rows.push({ name: "Voice", activity: `${fmt(total.voiceCalls)} calls placed`, appointments: total.sqlCalling });
  if (total.emailDelivered > 0)
    rows.push({ name: "Email", activity: `${fmt(total.emailDelivered)} delivered · ${fmt(total.emailOpens)} opens (${pct(total.emailOpens, total.emailDelivered)}) · ${fmt(total.emailClicks)} clicks`, appointments: null });
  rows.sort((a, b) => (b.appointments ?? -1) - (a.appointments ?? -1));
  if (total.emailDelivered > 0) notes.push("Email appointments are not split out in CallboxOne; the email row shows no appointment count.");

  const peak = Math.max(0, ...perWindow.map((t, i) => (windows[i].partial ? 0 : t.sql)));
  // Period notes are computed from the numbers, not written by the AI, so they can't misdescribe
  // a quarter (e.g. "held steady" for a drop from 35 to 24).
  const fullCounts = perWindow.filter((_, i) => !windows[i].partial).map((t) => t.sql);
  const low = fullCounts.length >= 2 ? Math.min(...fullCounts) : -1;
  const quarterNote = (i: number): string => {
    const w = windows[i];
    const n = perWindow[i].sql;
    if (w.partial) return "Still running.";
    if (i === 0) return "Launch quarter.";
    if (peak > 0 && n === peak) return "Peak quarter.";
    if (n === low && low < peak) return "Low point.";
    const prev = perWindow[i - 1].sql;
    if (n > prev) return `Up from ${windows[i - 1].label}.`;
    if (n < prev) return `Down from ${windows[i - 1].label}.`;
    return `Level with ${windows[i - 1].label}.`;
  };
  const quarters = windows.map((w, i) => ({
    label: w.label,
    count: perWindow[i].sql,
    note: quarterNote(i),
    isPeak: !w.partial && peak > 0 && perWindow[i].sql === peak,
    isPartial: w.partial,
  }));

  const c = progression?.counts || {};
  // CallboxOne returns 0 for stages nobody logged; treat 0 after the first stage as "not logged".
  const logged = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  const stages: RevampCaseStudy["funnel"]["stages"] = [
    { name: "Appointments set", description: "Sales-qualified appointments handed to the client.", value: total.sql || null },
    { name: "First appointment transpired", description: total.sql && logged(c.firstApptTranspired) ? `Confirmed as held. ${pct(c.firstApptTranspired, total.sql)} of everything booked.` : "Confirmed as held.", value: logged(c.firstApptTranspired) },
    { name: "Second appointment transpired", description: "The stakeholder meeting, where the buying group forms.", value: logged(c.secondApptTranspired) },
    { name: "Opportunity created", description: "Logged as a live deal in the client's CRM.", value: logged(c.opportunityCreated) },
    { name: "Closed won", description: "Revenue attributable to the program.", value: logged(c.closedWon) },
  ];

  const startD = new Date(from);
  const endD = new Date(to);
  const startLabel = `${MONTHS[startD.getUTCMonth()]} ${startD.getUTCFullYear()}`;
  const endLabel = `${MONTHS[endD.getUTCMonth()]} ${endD.getUTCFullYear()}`;
  const monthsLabel = `${months} month${months === 1 ? "" : "s"}`;
  // An ongoing campaign has no real end date yet: say so instead of printing today's month.
  const period = ongoing
    ? `${startLabel} to present (ongoing), ${monthsLabel} so far`
    : `${startLabel} to ${endLabel}, ${monthsLabel}`;
  const range = ongoing ? `${startLabel} to present` : `${startLabel} to ${endLabel}`;

  const heroStats = [
    ...(total.sql > 0 ? [{ value: fmt(total.sql), label: "Sales-qualified appointments" }] : []),
    ...(total.er > 0 ? [{ value: fmt(total.er), label: "Event registrations" }] : []),
    ...(total.liReplies > 0 ? [{ value: fmt(total.liReplies), label: "LinkedIn replies from target buyers" }] : []),
    // Prospect records worked says more about scale than calls (calls are already in the channel row).
    ...(lists && lists.records > 0
      ? [{ value: fmt(lists.records), label: `Prospect records worked across ${lists.lists} list${lists.lists === 1 ? "" : "s"}` }]
      : []),
    ...(total.voiceCalls > 0 ? [{ value: fmt(total.voiceCalls), label: "Calls placed" }] : []),
  ].slice(0, 4);

  const channelsWorked = rows.map((r) => r.name).join(", ");
  const market = marketFromTimezone(extras.timezone);
  const facts = [
    { label: "Period measured", value: period },
    ...(market ? [{ label: "Market", value: market }] : []),
    ...(channelsWorked ? [{ label: "Channels worked", value: channelsWorked }] : []),
    ...(lists && lists.records > 0
      ? [{ label: "Lists worked", value: `${fmt(lists.lists)} list${lists.lists === 1 ? "" : "s"}, ${fmt(lists.records)} prospect records` }]
      : []),
    ...(lists && lists.mix.length
      ? [{ label: "List sources", value: lists.mix.map((m) => `${m.lists} ${m.lists === 1 ? m.kind.replace(/lists$/, "list").replace(/audiences$/, "audience") : m.kind}`).join(", ") }]
      : []),
  ];

  // Role chart: appointments by seniority, from the appointment records' job titles.
  const sqlByLevel = LEVELS.map(([k, label]) => ({ key: k, label, count: total["sql_" + k] || 0 }));
  const erByLevel = LEVELS.map(([k, label]) => ({ key: k, label, count: total["er_" + k] || 0 }));
  const rolesTotal = sqlByLevel.reduce((t, x) => t + x.count, 0);
  const erRolesTotal = erByLevel.reduce((t, x) => t + x.count, 0);
  const roles = sqlByLevel
    .filter((x) => x.count > 0)
    .sort((a, b) => (a.key === "lvlOther" ? 1 : b.key === "lvlOther" ? -1 : b.count - a.count))
    .map((x) => ({ role: x.label, count: x.count }));
  let rolesFootnote = "";
  const topSql = [...sqlByLevel].sort((a, b) => b.count - a.count)[0];
  const topEr = [...erByLevel].sort((a, b) => b.count - a.count)[0];
  if (erRolesTotal > 0 && topEr.count > 0) {
    rolesFootnote =
      topEr.key === topSql.key
        ? `The same level leads event registrations: ${fmt(topEr.count)} of ${fmt(erRolesTotal)}, or ${pct(topEr.count, erRolesTotal)}.`
        : `Event registrations were led by ${topEr.label}: ${fmt(topEr.count)} of ${fmt(erRolesTotal)}, or ${pct(topEr.count, erRolesTotal)}.`;
  }
  if (rolesTotal && rolesTotal !== total.sql) {
    notes.push(`The role chart covers ${fmt(rolesTotal)} appointment records with a job title (CallboxOne counts ${fmt(total.sql)} appointments).`);
  }

  return {
    campaign,
    period: { from, to, months, ongoing },
    patch: {
      heroStats,
      facts,
      channels: { rows },
      progression: { quarters, chartTitle: "Sales-qualified appointments, by quarter", chartMeta: `${fmt(total.sql)} total · ${range}` },
      funnel: { stages },
      howItRan: { roles, rolesFootnote },
      methodologyNote:
        (ongoing
          ? `Figures are drawn from the CallboxOne campaign record for ${campaign.campaignName} since ${startLabel}; the campaign was still running when they were pulled. `
          : `Figures are drawn from the CallboxOne campaign record for ${campaign.campaignName} between ${startLabel} and ${endLabel}. `) +
        "Appointments are sales-qualified appointments; channel activity combines Pipeline calling with HubSpot email and LinkedIn data. " +
        "They describe what happened in this campaign, not a forecast for another.",
    },
    notes,
  };
}
