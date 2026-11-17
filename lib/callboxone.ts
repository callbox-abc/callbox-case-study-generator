// Server-only client for the CallboxOne (Pipeline) MCP server.
// Env: CALLBOXONE_MCP_URL (server URL), CALLBOXONE_TOKEN (Bearer: Pipeline PAT or OAuth token).
// Read-only: only reporting/search tools are called.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RevampCaseStudy } from "@/lib/revamp";

export class CallboxOneConfigError extends Error {}

const ALLOWED_TOOLS = new Set([
  "get_identity",
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

export type ImportResult = {
  campaign: { clientId: number; clientAccountId: number; campaignName: string; clientName: string };
  period: { from: string; to: string; months: number };
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
): ImportResult {
  const total = perWindow.reduce(add, ZERO);
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
  const quarters = windows.map((w, i) => ({
    label: w.label,
    count: perWindow[i].sql,
    note: "",
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
  const period = `${MONTHS[startD.getUTCMonth()]} ${startD.getUTCFullYear()} to ${MONTHS[endD.getUTCMonth()]} ${endD.getUTCFullYear()}, ${months} months`;

  const heroStats = [
    ...(total.sql > 0 ? [{ value: fmt(total.sql), label: "Sales-qualified appointments" }] : []),
    ...(total.er > 0 ? [{ value: fmt(total.er), label: "Event registrations" }] : []),
    ...(total.liReplies > 0 ? [{ value: fmt(total.liReplies), label: "LinkedIn replies from target buyers" }] : []),
    ...(total.voiceCalls > 0 ? [{ value: fmt(total.voiceCalls), label: "Calls placed" }] : []),
  ].slice(0, 4);

  const channelsWorked = rows.map((r) => r.name).join(", ");
  const facts = [
    { label: "Period measured", value: period },
    ...(channelsWorked ? [{ label: "Channels worked", value: channelsWorked }] : []),
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
    period: { from, to, months },
    patch: {
      heroStats,
      facts,
      channels: { rows },
      progression: { quarters, chartTitle: "Sales-qualified appointments, by quarter", chartMeta: `${fmt(total.sql)} total · ${period.split(",")[0]}` },
      funnel: { stages },
      howItRan: { roles, rolesFootnote },
      methodologyNote:
        `Figures are drawn from the CallboxOne campaign record for ${campaign.campaignName} between ${MONTHS[startD.getUTCMonth()]} ${startD.getUTCFullYear()} and ${MONTHS[endD.getUTCMonth()]} ${endD.getUTCFullYear()}. ` +
        "Appointments are sales-qualified appointments; channel activity combines Pipeline calling with HubSpot email and LinkedIn data. " +
        "They describe what happened in this campaign, not a forecast for another.",
    },
    notes,
  };
}
