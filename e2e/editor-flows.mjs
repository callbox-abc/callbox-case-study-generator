// The editor's user flows (app/page.tsx + hooks/useCaseStudyEditor.ts), run in a real browser with
// every /api/* call mocked: no Supabase, HubSpot, CallboxOne, Gemini or WordPress is touched.
//
// Each step records what the user sees (screen, tab title, toolbar, banners, dialog, fields) and
// the requests the page sent. Named checks cover the behavior that matters, including four bugs
// this test found (Back swallowed after Start over, CMS draft id carried into the next case study,
// stale notice, tab title not reset). The run.mjs runner also compares the whole recording with
// e2e/editor-flows.snapshot.json, so any other change in behavior shows up as a diff.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document, Packer, Paragraph } from "docx";

/* --------------------------------- mocks --------------------------------- */

const sheetOf = (name, headline) => ({ clientName: name, headline, heroStats: [{ value: "111", label: "Appointments" }] });
const recentEntry = (acct, name, headline) => ({
  key: `recent:${acct}`,
  name,
  domain: "",
  campaign: { clientId: acct, clientAccountId: acct, campaignName: `${name.slice(0, 4).toUpperCase()}25071`, clientName: name, teamLeader: null, start: "2025-07", timezone: null },
  company: null,
  stored: { hubspot: null, callboxone: null },
  importedAt: "2026-11-18T00:00:00Z",
  imports: 1,
  cmsDraft: null,
  sheet: { data: sheetOf(name, headline), reviewed: false, aiDrafted: [], savedAt: "2026-11-18T00:00:00Z" },
});
// A client with CallboxOne numbers (117,570 emails delivered) whose saved text still carries a
// draft's numbers: "1,622 emails" conflicts, "a 40-person IT team" isn't a campaign result.
const gamma = {
  ...recentEntry(333, "Gamma Ltd", "Gamma Saved Headline"),
  stored: { hubspot: null, callboxone: { period: { from: "2025-07-01", to: "2026-06-30" } } },
};
gamma.sheet.data = {
  ...gamma.sheet.data,
  heroStats: [{ value: "117,570", label: "Emails delivered" }, { value: "111", label: "Appointments" }],
  channels: { rows: [{ name: "Email", activity: "117,570 delivered", appointments: null }] },
  dek: "Callbox delivered 1,622 emails in the first quarter.",
  subDek: "The program booked 111 appointments.",
  situation: { body: ["Gamma runs a 40-person IT team."] },
};
const RECENT = [recentEntry(111, "Acme Corp", "Acme Saved Headline"), recentEntry(222, "Beta Inc", "Beta Saved Headline"), gamma];

// This week's most active clients: one card whose HubSpot match was ambiguous (two "Company 1"
// records, its Brazil and Korea offices), so the job linked none (lib/topClients.ts chooseCompany).
const TOP_SNAPSHOT = {
  cycle: "2026-11-16",
  refreshedAt: "2026-11-16T00:20:00Z",
  nextRefresh: "2026-11-23T00:00:00Z",
  candidates: 40,
  measured: 40,
  skippedUnnamed: 0,
  clients: [
    {
      name: "Company 1",
      domain: "",
      months: 14,
      sql30: 9,
      conversions30: 3,
      topChannel: "Voice",
      campaign: { clientId: 444, clientAccountId: 444, campaignName: "COMP25071", clientName: "Company 1", teamLeader: null, start: "2025-07", timezone: "Asia/Seoul" },
      company: null,
      stored: { hubspot: null, callboxone: null },
      hubspotAmbiguous: true,
    },
  ],
};

// Answers one intercepted request; logs the ones the editor sends on its own.
function mockApi(url, method, body, calls) {
  const u = new URL(url);
  const p = u.pathname;
  const step = u.searchParams.get("step");
  const b = body ? JSON.parse(body) : null;
  const log = (detail) => calls.push({ method, path: p + (step ? `?step=${step}` : ""), ...detail });
  if (p === "/api/top-clients") return { snapshot: TOP_SNAPSHOT, job: null };
  if (p === "/api/recent-clients" && method === "GET") return u.searchParams.get("key") ? { entry: null } : { recent: RECENT };
  if (p === "/api/recent-clients" && step === "sheet") {
    log({ key: b.key, reviewed: b.reviewed, aiDrafted: b.aiDrafted, headline: b.sheet?.headline, dek: b.sheet?.dek });
    return { ok: true };
  }
  if (p === "/api/recent-clients" && step === "draft") {
    log({ key: b.key, id: b.id });
    return { ok: true };
  }
  if (p === "/api/draft-narrative") {
    const fromDoc = Boolean(b.sourceText);
    log({ fromDoc, headline: b.sheet?.headline });
    // A mapped document drafts nothing (so its mapping example can be saved); a client gets a dek.
    // Gamma's first draft (its text still has the stale 1,622) answers late, like the real AI, so
    // the truth check can be seen in progress.
    const slow = /1,622/.test(b.sheet?.dek || "") ? { __delay: 1500 } : {};
    return fromDoc
      ? { sheet: b.sheet, drafted: [], droppedSentences: 0, droppedDetails: [], model: "gemini-3.1-pro-preview" }
      : {
          ...slow,
          sheet: { ...b.sheet, dek: b.sheet.dek || "AI dek from the data." },
          drafted: b.sheet.dek ? [] : ["Dek"],
          droppedSentences: 1,
          droppedDetails: [{ text: "It added $1M.", reason: "money claim" }],
          model: "gemini-3.1-pro-preview",
        };
  }
  if (p === "/api/map-revamp") {
    log({ sourceHasText: /Mapped Co/.test(b.sourceText) });
    return { data: { clientName: "Mapped Co", headline: "Mapped Headline From The Document", heroStats: [{ value: "42", label: "Appointments" }] } };
  }
  if (p === "/api/cms/draft") {
    log({ pageId: b.pageId ?? null, headline: b.revamp?.headline });
    return {
      id: 4321,
      status: "draft",
      editLink: "https://cms.example/wp-admin/post.php?post=4321&action=edit",
      missingAcfKeys: [],
      parent: b.pageId ? { status: "kept", id: 99 } : { status: "set", id: 99, title: "Callbox Lead Generation Success Stories" },
    };
  }
  if (p === "/api/save-example") {
    log({ wasCorrected: b.wasCorrected, headline: b.mappedOutput?.headline });
    return { ok: true };
  }
  log({ unmocked: true });
  return { __status: 404, error: "not mocked" };
}

/* --------------------------------- flows --------------------------------- */

export async function runEditorFlows({ cdp, appUrl, user, pass, cpuSlowdown = 1, screenshotDir = null, log = () => {} }) {
  const calls = [];
  const errors = [];
  const steps = [];
  const checks = [];

  cdp.on("Runtime.exceptionThrown", (p) => errors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 300)));
  cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
    const res = mockApi(request.url, request.method, request.postData, calls);
    const status = res.__status || 200;
    const delay = res.__delay || 0; // a mock can answer late, like the real service
    delete res.__status;
    delete res.__delay;
    const fulfill = () =>
      cdp.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(res)).toString("base64"),
      });
    if (delay) setTimeout(fulfill, delay);
    else fulfill();
  });

  /* ----------------------------- helpers ----------------------------- */
  const js = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // A page check that throws counts as "not yet": while a page loads, document.body can still be
  // null (seen on CI, which is slower: "Cannot read properties of null (reading 'innerText')").
  // The last error is kept for the timeout message.
  const waitFor = async (fn, what, ms = 15000) => {
    const t = Date.now();
    let lastError = null;
    while (Date.now() - t < ms) {
      try {
        if (await fn()) return true;
      } catch (e) {
        lastError = e;
      }
      await wait(100);
    }
    throw new Error(`Timed out waiting for ${what}${lastError ? ` (last error: ${lastError.message.split("\n")[0]})` : ""}`);
  };
  const maybe = (fn, ms) => waitFor(fn, "", ms).catch(() => false);
  const page = (expr) => () => cdp.evaluate(expr);
  const shows = (re) => page(`${re}.test(document.body?.innerText ?? "")`);
  const dialogOpen = page(`!!document.querySelector('[role=dialog]')`);
  const onStart = shows(/Start with a blank case study/);
  const inEditor = shows(/Case Study Editor/);
  const sent = (re, n = 1) => () => calls.filter((c) => re.test(c.path)).length >= n;
  const toolbarHas = (label) => page(`[...document.querySelector('.app-toolbar')?.querySelectorAll('button') ?? []].some(b => b.textContent.trim() === ${js(label)})`);

  const click = async (re) => {
    await waitFor(page(`[...document.querySelectorAll('button')].some(b => ${re}.test(b.textContent) && !b.disabled)`), `a button matching ${re}`);
    await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent) && !b.disabled).click()`);
  };
  const setField = (placeholder, value) =>
    cdp.evaluate(`(() => {
      const el = document.querySelector('[placeholder=${js(placeholder)}]');
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  const dropFile = (b64, name) =>
    cdp.evaluate(`(() => {
      const bytes = Uint8Array.from(atob(${js(b64)}), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], ${js(name)}));
      const input = document.querySelector('input[type=file]');
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  const snap = () =>
    cdp.evaluate(`(() => {
      const text = document.body?.innerText ?? "";
      const stage = /Case Study Editor/.test(text) ? 'editor' : /Reading your document/.test(text) ? 'mapping' : /Start with a blank case study/.test(text) ? 'start' : 'other';
      const val = (p) => document.querySelector('[placeholder=' + JSON.stringify(p) + ']')?.value ?? null;
      const toolbar = document.querySelector('.app-toolbar');
      return {
        stage,
        title: document.title,
        toolbar: stage === 'editor' ? [...toolbar.querySelectorAll('button')].map(b => b.textContent.trim() + (b.disabled ? ' (disabled)' : '')) : null,
        banners: [...document.querySelectorAll('[role=status]')].map(e => e.innerText.trim()),
        dialog: document.querySelector('[role=dialog]')?.innerText.trim() ?? null,
        importPanel: /Recently imported clients|most active clients/i.test(text),
        headline: val('Headline (H1)'),
        dek: val('Dek: who the client is and what changed'),
        client: val('Client'),
      };
    })()`);
  // Requests within a step are sorted, so the order two parallel requests arrive in never matters.
  const sortCalls = (cs) => [...cs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const record = async (step, extra = {}) => {
    const s = { step, ...(await snap()), calls: sortCalls(calls.splice(0)), ...extra };
    steps.push(s);
    // Optional (E2E_SCREENSHOTS=1): what the step looked like, for reviewing UI and CI failures.
    if (screenshotDir) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = `${String(steps.length).padStart(2, "0")} ${step.replace(/[^\w.-]+/g, " ").trim()}.png`;
      writeFileSync(join(screenshotDir, file), Buffer.from(shot.result.data, "base64"));
    }
    log(`  ${step}`);
    return s;
  };
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
    if (!ok) log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  };
  const callsOf = (s, re) => s.calls.filter((c) => re.test(c.path));
  const unloadBlocked = () =>
    cdp.evaluate(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
  // Download PDF with window.print stubbed: the title at that moment is the PDF's file name.
  const downloadPdf = async () => {
    await cdp.evaluate(`window.__print = null;`);
    await click(/^Download PDF$/);
    await waitFor(page(`window.__print !== null`), "the print call");
    const p = await cdp.evaluate(`window.__print`);
    return { titleAtPrint: p.title, pageRule: p.page ? p.page.replace(/[\d.]+in/g, "<n>in") : null, titleAfter: await cdp.evaluate("document.title") };
  };
  const startOver = async () => {
    await click(/Start over/);
    await waitFor(async () => (await onStart()) || (await dialogOpen()), "the start screen or the save prompt");
  };
  const openClient = async (name) => {
    await click(new RegExp(name));
    await waitFor(sent(/\/api\/draft-narrative/), `the AI draft for ${name}`);
    await waitFor(shows(/AI drafted/), "the AI banner");
  };
  const fromImport = async () => {
    await click(/Start from HubSpot \+ CallboxOne/);
    await waitFor(shows(/Recently imported clients/), "the recent clients list");
  };
  const APP_TITLE = "Callbox Case Study Generator";

  /* ----------------------------- set up ----------------------------- */
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setExtraHTTPHeaders", { headers: { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") } });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  // A slower machine on purpose (E2E_CPU_SLOWDOWN=4 = four times slower), to catch timing races
  // locally before CI does.
  if (cpuSlowdown > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
  await cdp.send("Page.navigate", { url: appUrl });
  await waitFor(onStart, "the start screen", 30000);
  // The page is server-rendered: clicks before hydration are lost, so click until the editor opens.
  await waitFor(async () => {
    await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /Start with a blank/.test(b.textContent))?.click()`);
    return maybe(inEditor, 700);
  }, "the app to hydrate", 30000);
  await cdp.evaluate(`
    window.print = () => {
      window.__print = { title: document.title, page: document.getElementById('dynamic-page-size')?.textContent || null };
      window.dispatchEvent(new Event('beforeprint'));
      window.dispatchEvent(new Event('afterprint'));
    };`);
  await startOver();
  let s = await record("A. start screen");
  check("start screen title", s.title === APP_TITLE, s.title);

  /* ---------------- B. the Word template: read word for word ---------------- */
  const tplB64 = await cdp.evaluate(
    `fetch('/callbox-case-study-template.docx').then(r => r.arrayBuffer()).then(b => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); })`
  );
  await dropFile(tplB64, "callbox-case-study-template.docx");
  await waitFor(shows(/The template was empty/), "the template notice");
  s = await record("B1. template dropped");
  check("template opens the editor with the import panel", s.stage === "editor" && s.importPanel);
  await startOver();
  await record("B2. start over from template (no prompt)");

  /* ---------------- C. a draft document, mapped by the AI ---------------- */
  const doc = new Document({ sections: [{ children: ["Client: Mapped Co", "Headline: Mapped Headline From The Document", "42 appointments"].map((t) => new Paragraph(t)) }] });
  await dropFile((await Packer.toBuffer(doc)).toString("base64"), "draft.docx");
  await waitFor(sent(/\/api\/draft-narrative/), "the AI draft of the mapped document");
  await waitFor(shows(/nothing it could ground/), "the AI banner");
  s = await record("C1. document mapped");
  check("document is mapped into the sheet", s.headline === "Mapped Headline From The Document" && callsOf(s, /map-revamp/).length === 1);
  check("no notice left over from the previous sheet (bug: stale notice)", !s.banners.some((b) => /template was empty/.test(b)), s.banners.join(" | "));
  let print = await downloadPdf();
  await waitFor(sent(/save-example/), "the mapping example");
  s = await record("C2. downloaded PDF (mapping example saved)", { print });
  check("PDF file name is CS_ + the headline", print.titleAtPrint === "CS_Mapped-Headline-Document" && print.titleAfter === "Mapped Headline From The Document", JSON.stringify(print));
  check("PDF page is sized to the content", /@page \{ size: <n>in <n>in; margin: 0; \}/.test(print.pageRule || ""), print.pageRule);
  check("mapping example saved once, uncorrected", callsOf(s, /save-example/).length === 1 && callsOf(s, /save-example/)[0].wasCorrected === false);
  await setField("Headline (H1)", "Mapped Headline Edited");
  print = await downloadPdf();
  await wait(500); // nothing should be sent: give a stray request time to show up
  s = await record("C3. downloaded again (no second example)", { print });
  check("mapping example not saved twice", callsOf(s, /save-example/).length === 0);
  await startOver();
  s = await record("C4. start over from document (no prompt)");
  check("tab title resets on Start over (bug: kept the last headline)", s.title === APP_TITLE, s.title);

  /* ---------------- D. a saved client: AI, Save, review, leave guards ---------------- */
  await fromImport();
  await record("D1. import panel open");
  await openClient("Acme Corp");
  s = await record("D2. Acme loaded, AI drafted", { unloadBlocked: await unloadBlocked() });
  check("saved client loads and the AI fills empty fields", s.headline === "Acme Saved Headline" && s.dek === "AI dek from the data.");
  check("AI text makes the sheet unsaved", s.toolbar.includes("Save") && s.unloadBlocked === true, JSON.stringify(s.toolbar));
  await click(/^Save$/);
  await waitFor(sent(/step=sheet/), "the sheet save");
  await waitFor(toolbarHas("Saved"), "the Saved label");
  s = await record("D3. saved");
  check("Save sends the sheet with its unreviewed AI fields", callsOf(s, /step=sheet/)[0]?.reviewed === false && js(callsOf(s, /step=sheet/)[0]?.aiDrafted) === js(["Dek"]));
  await click(/Mark as reviewed/);
  await waitFor(sent(/step=sheet/), "the review save");
  s = await record("D4. marked as reviewed", { unloadBlocked: await unloadBlocked() });
  check("Mark as reviewed saves the review", callsOf(s, /step=sheet/)[0]?.reviewed === true && s.unloadBlocked === false);
  await setField("Headline (H1)", "Acme Edited Headline");
  await waitFor(toolbarHas("Save"), "the Save label");
  s = await record("D5. edited (dirty)", { unloadBlocked: await unloadBlocked() });
  check("closing the tab warns about unsaved edits", s.unloadBlocked === true);
  await startOver();
  s = await record("D6. start over asks");
  check("Start over asks to save", /Save before exit\?/.test(s.dialog || ""), s.dialog);
  await click(/^Cancel$/);
  await waitFor(async () => !(await dialogOpen()), "the prompt to close");
  await record("D7. cancel keeps the editor");
  await cdp.evaluate("history.back()");
  const backAsked = await maybe(dialogOpen, 3000);
  s = await record("D8. browser Back asks", { backAsked });
  check("browser Back asks to save (bug: swallowed after an earlier Start over)", backAsked);
  if (!backAsked) await startOver(); // recover, so the remaining flows still run
  await click(/Exit without saving/);
  await waitFor(onStart, "the start screen");
  s = await record("D9. exit without saving");
  check("tab title resets after exit", s.title === APP_TITLE, s.title);

  /* ---------------- E. switching clients, CMS, print ---------------- */
  await fromImport();
  await openClient("Acme Corp");
  await setField("Headline (H1)", "Acme Edited Before Switch");
  await waitFor(toolbarHas("Save"), "the Save label");
  await record("E1. Acme edited");
  await click(/Beta Inc/);
  await waitFor(dialogOpen, "the switch prompt");
  s = await record("E2. switching asks to save Acme");
  check("switching clients asks to save the current one", /Save Acme Corp first\?/.test(s.dialog || ""), s.dialog);
  await click(/Save and continue/);
  await waitFor(sent(/step=sheet/), "Acme's save");
  await waitFor(sent(/\/api\/draft-narrative/), "Beta's AI draft");
  await waitFor(page(`document.querySelector('[placeholder="Headline (H1)"]')?.value === "Beta Saved Headline"`), "Beta's sheet");
  await waitFor(shows(/AI drafted/), "the AI banner");
  s = await record("E3. Beta loaded on a clean sheet");
  check("Acme is saved before switching", callsOf(s, /step=sheet/)[0]?.key === "recent:111" && callsOf(s, /step=sheet/)[0]?.headline === "Acme Edited Before Switch");
  check("Beta starts from its own sheet", s.headline === "Beta Saved Headline");
  await click(/^Send to CMS as draft$/);
  await waitFor(sent(/cms\/draft/), "the CMS request");
  await waitFor(sent(/step=draft/), "the draft link save");
  await waitFor(shows(/Draft #4321/), "the CMS banner");
  s = await record("E4. sent to the CMS");
  check("first send creates a new draft", callsOf(s, /cms\/draft/)[0]?.pageId === null);
  await click(/^Update CMS draft$/);
  await waitFor(sent(/cms\/draft/), "the CMS update");
  await waitFor(sent(/step=draft/), "the draft link save");
  s = await record("E5. CMS draft updated");
  check("second send updates the same draft", callsOf(s, /cms\/draft/)[0]?.pageId === 4321);
  await cdp.evaluate(`window.dispatchEvent(new Event('beforeprint'))`);
  const during = await cdp.evaluate("document.title");
  await cdp.evaluate(`window.dispatchEvent(new Event('afterprint'))`);
  const ctrlP = { during, after: await cdp.evaluate("document.title") };
  check("Ctrl+P uses the file name too, then restores the title", ctrlP.during === "CS_Beta-Saved-Headline" && ctrlP.after === "Beta Saved Headline", JSON.stringify(ctrlP));
  print = await downloadPdf();
  s = await record("E6. downloaded PDF", { ctrlP, print, unloadBlocked: await unloadBlocked() });
  await startOver();
  s = await record("E7. start over after CMS (saved, no prompt)");
  check("a saved sheet leaves without asking", s.stage === "start" && s.dialog === null);

  /* ---------------- F. blank sheet ---------------- */
  await click(/Start with a blank case study/);
  await waitFor(inEditor, "the editor");
  s = await record("F1. blank sheet");
  check("blank sheet has no Save or AI button", !s.toolbar.some((b) => /^Save|Fill empty fields/.test(b)), JSON.stringify(s.toolbar));
  check("blank sheet after a CMS send starts a new draft (bug: offered Update CMS draft)", s.toolbar.includes("Send to CMS as draft") && !s.banners.some((b) => /Draft #/.test(b)), JSON.stringify(s.toolbar));
  await setField("Headline (H1)", "Typed On A Blank Sheet");
  const blankUnload = await unloadBlocked();
  check("a blank sheet never warns on close", blankUnload === false);
  await startOver();
  s = await record("F2. start over from blank (no prompt)", { unloadBlocked: blankUnload });
  check("blank sheet leaves without asking", s.stage === "start" && s.dialog === null);

  /* ---------------- G. one client's CMS draft never reaches the next ---------------- */
  await fromImport();
  await openClient("Acme Corp");
  await click(/^(Send to CMS as draft|Update CMS draft)$/);
  await waitFor(sent(/cms\/draft/), "Acme's CMS request");
  await waitFor(sent(/step=draft/), "the draft link save");
  s = await record("G1. Acme sent to the CMS");
  check("Acme gets a new draft", callsOf(s, /cms\/draft/)[0]?.pageId === null);
  await startOver();
  await record("G2. start over after Acme's CMS draft");
  await fromImport();
  await openClient("Beta Inc");
  s = await record("G3. Beta loaded after Start over");
  check("next client offers a new draft, not Acme's", s.toolbar.includes("Send to CMS as draft") && !s.banners.some((b) => /Draft #/.test(b)), JSON.stringify(s.toolbar));
  await click(/^(Send to CMS as draft|Update CMS draft)$/);
  await waitFor(sent(/cms\/draft/), "Beta's CMS request");
  await waitFor(sent(/step=draft/), "the draft link save");
  s = await record("G4. Beta sent to the CMS");
  check("Beta never overwrites Acme's draft (bug: sent Acme's page id)", callsOf(s, /cms\/draft/)[0]?.pageId === null, JSON.stringify(callsOf(s, /cms\/draft/)));
  await startOver();
  if (await dialogOpen()) await click(/Exit without saving/);
  await waitFor(onStart, "the start screen");
  await record("G5. back on the start screen");

  /* ---------------- H. verifying truth data (CallboxOne is the source of truth) ---------------- */
  // Clicks a button inside the truth banner's list item that contains the given text.
  const clickInFinding = async (text, label) => {
    const find = `[...document.querySelectorAll('[role=status] li')].find(li => li.textContent.includes(${js(text)}))`;
    await waitFor(page(`!!${find}`), `the finding "${text}"`);
    await cdp.evaluate(`[...${find}.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(label)}).click()`);
  };
  const truthBanner = (st) => st.banners.find((b) => /^(Verifying truth data|Truth data verified)/.test(b)) || "";
  const progressBar = page(`!!document.querySelector('[role=progressbar]')`);
  await fromImport();
  await click(/Gamma Ltd/);
  // The AI is still writing (its answer comes 1.5s late): the check shows as in progress.
  await waitFor(progressBar, "the truth check's progress bar");
  s = await record("H1. Gamma loaded: verifying while the AI writes", { progressBar: true });
  check(
    "while the AI writes, the truth check shows it is in progress, with what it found so far",
    /^Verifying truth data… 2 sentences in the text have numbers/.test(truthBanner(s)) && /The AI is still writing/.test(truthBanner(s)),
    truthBanner(s)
  );
  // (The draft request itself was sent before H1 was recorded, so it is in H1's requests.)
  await waitFor(async () => !(await progressBar()), "the AI draft to finish");
  s = await record("H2. Gamma: truth data verified", { progressBar: await progressBar() });
  check("once the text is final, the bar goes and the check says it is done", s.progressBar === false && /^Truth data verified:/.test(truthBanner(s)), truthBanner(s));
  check("truth check flags the draft's number CallboxOne doesn't have", /2 sentences/.test(truthBanner(s)) && /Dek: “Callbox delivered 1,622 emails in the first quarter\.” \(not in CallboxOne: 1,622\)/.test(truthBanner(s)), truthBanner(s));
  check("truth check passes numbers CallboxOne has", !/111 appointments/.test(truthBanner(s)), truthBanner(s));
  await clickInFinding("40-person", "Keep");
  await waitFor(shows(/1 sentence in the text has/), "one finding left");
  s = await record("H3. kept the 40-person team (not a campaign result)");
  check("a kept sentence leaves the list and stays in the text", !/40-person/.test(truthBanner(s)) && (await cdp.evaluate(`document.body.innerText.includes("Gamma runs a 40-person IT team.") || [...document.querySelectorAll('textarea')].some(t => t.value.includes("40-person"))`)));
  await clickInFinding("1,622", "Remove");
  await waitFor(sent(/\/api\/draft-narrative/), "the AI redraft of the emptied dek");
  await waitFor(page(`document.querySelector('[placeholder="Dek: who the client is and what changed"]')?.value === "AI dek from the data."`), "the redrafted dek");
  await waitFor(async () => !(await progressBar()), "the redraft to finish");
  s = await record("H4. removed 1,622: the AI redrafts the dek from the data");
  check("Remove takes the sentence out and the AI redrafts the emptied field", s.dek === "AI dek from the data." && callsOf(s, /draft-narrative/).length === 1);
  check(
    "verified: no number left that CallboxOne doesn't back, and the kept sentence is counted",
    /^Truth data verified: every number in the text matches the CallboxOne data, apart from 1 sentence kept on purpose\./.test(truthBanner(s)),
    truthBanner(s)
  );
  await startOver();
  if (await dialogOpen()) await click(/Exit without saving/);
  await waitFor(onStart, "the start screen");
  s = await record("H5. back on the start screen");
  check("the truth check belongs to one case study", !s.banners.some((b) => /truth data/i.test(b)));

  /* ---------------- I. no guessing between same-name HubSpot companies ---------------- */
  await fromImport();
  const cardHint = await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /COMP25071/.test(b.textContent))?.textContent.includes('Several HubSpot matches: none linked') ?? false`);
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /COMP25071/.test(b.textContent)).click()`);
  await waitFor(shows(/Several HubSpot companies are named Company 1/), "the note about the ambiguous HubSpot match");
  await waitFor(async () => !(await page(`[...document.querySelectorAll('button')].some(b => /Import|Search/.test(b.textContent) && b.disabled)`)()), "the import to finish");
  const note = await cdp.evaluate(`(document.body.innerText.match(/Several HubSpot companies are named[^\\n]*/) || [""])[0]`);
  s = await record("I1. weekly card with several same-name HubSpot companies", { cardHint, note });
  check("an ambiguous weekly card says no HubSpot company was linked", cardHint === true);
  check(
    "opening it explains why, and fills no HubSpot facts (left for the team)",
    /none was linked and no HubSpot facts were filled\. Search Company 1 above to pick the right one, or fill in the client facts by hand\./.test(note) && !s.client,
    note
  );
  await startOver();
  if (await dialogOpen()) await click(/Exit without saving/);
  await waitFor(onStart, "the start screen");
  await record("I2. back on the start screen");

  check("no requests to unmocked APIs", !steps.some((st) => st.calls.some((c) => c.unmocked)));
  check("no errors in the page", errors.length === 0, errors.join(" | "));
  return { steps, checks, errors };
}
