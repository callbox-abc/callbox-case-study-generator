// End-to-end test of the editor in a real browser, with every /api/* call mocked.
//
//   npm run e2e            build, run the flows, check them, compare with the snapshot
//   npm run e2e:update     same, then save the recording as the new snapshot (only if checks pass)
//   node e2e/run.mjs --no-build   reuse the last production build (faster while iterating)
//   E2E_CPU_SLOWDOWN=4 npm run e2e  run Chrome 4x slower, to catch timing races before CI does
//
// Needs Node 22+ and Chrome (or Chromium / Edge). Set CHROME_PATH if it isn't found. Takes about
// a minute plus the build. Nothing outside this machine is called: the app runs with a throwaway
// login and every API answer is mocked in the browser (e2e/editor-flows.mjs).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./cdp.mjs";
import { runEditorFlows } from "./editor-flows.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const outDir = join(here, ".out");
const snapshotFile = join(here, "editor-flows.snapshot.json");
const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const BUILD = !args.has("--no-build");
const USER = "e2e";
const PASS = "e2e-only-password";

const say = (m) => console.log(m);
const children = [];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const env = process.env;
  const candidates =
    process.platform === "win32"
      ? [
          `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => p && existsSync(p));
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const waitForUrl = async (url, what, ms = 60000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`${what} did not start within ${ms / 1000}s`);
};

// Starts a process in its own group, so stopping it also stops what it spawned.
function start(cmd, argv, opts) {
  const child = spawn(cmd, argv, { ...opts, detached: process.platform !== "win32", windowsHide: true });
  child.unref(); // a leftover helper process must not keep the test running; stopAll() ends them
  children.push(child);
  return child;
}
// Returns once they have exited (or after 5s), so their files can be removed.
function stopAll() {
  const stopping = [];
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || !child.pid) continue;
    stopping.push(
      new Promise((resolve) => {
        // A live timer keeps Node running while it waits (the children themselves are unref'd).
        const timer = setTimeout(resolve, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      })
    );
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return Promise.all(stopping);
}
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

// Step-level differences between the snapshot and this run.
function diffSteps(expected, actual) {
  const lines = [];
  const names = [...new Set([...expected.map((s) => s.step), ...actual.map((s) => s.step)])];
  const short = (v) => {
    const t = JSON.stringify(v);
    return t && t.length > 200 ? t.slice(0, 200) + "…" : t;
  };
  for (const name of names) {
    const e = expected.find((s) => s.step === name);
    const a = actual.find((s) => s.step === name);
    if (!e || !a) {
      lines.push(`  [${name}] ${e ? "missing from this run" : "new in this run"}`);
      continue;
    }
    for (const k of new Set([...Object.keys(e), ...Object.keys(a)])) {
      if (JSON.stringify(e[k]) === JSON.stringify(a[k])) continue;
      lines.push(`  [${name}] ${k}\n      snapshot: ${short(e[k])}\n      this run: ${short(a[k])}`);
    }
  }
  return lines;
}

async function main() {
  process.exitCode = 1; // failed until the very end says otherwise
  mkdirSync(outDir, { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome not found. Install Chrome or set CHROME_PATH.");
  const nextBin = createRequire(join(repo, "package.json")).resolve("next/dist/bin/next");

  if (BUILD) {
    say("Building (next build)…");
    // next build rewrites the committed next-env.d.ts (dev vs build type paths): put it back after.
    const envFile = join(repo, "next-env.d.ts");
    const envBefore = existsSync(envFile) ? readFileSync(envFile, "utf8") : null;
    const r = spawnSync(process.execPath, [nextBin, "build"], { cwd: repo, encoding: "utf8", windowsHide: true });
    if (envBefore !== null && readFileSync(envFile, "utf8") !== envBefore) writeFileSync(envFile, envBefore);
    writeFileSync(join(outDir, "build.log"), (r.stdout || "") + (r.stderr || ""));
    if (r.status !== 0) throw new Error(`next build failed: see ${join(outDir, "build.log")}`);
  }

  const appPort = await freePort();
  const cdpPort = await freePort();
  const appUrl = `http://localhost:${appPort}/`;
  const serverLog = openSync(join(outDir, "server.log"), "w");
  // The app's own login gate stays on, with a throwaway login the browser sends.
  start(process.execPath, [nextBin, "start", "-p", String(appPort)], {
    cwd: repo,
    env: { ...process.env, DRAFT_USER: USER, DRAFT_PS: PASS },
    stdio: ["ignore", serverLog, serverLog],
  });
  const profile = mkdtempSync(join(tmpdir(), "csg-e2e-chrome-"));
  // Chrome's own output goes to a log: if it can't start (e.g. a sandbox error on CI), it says why.
  const chromeLog = openSync(join(outDir, "chrome.log"), "w");
  start(chrome, [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ], { stdio: ["ignore", chromeLog, chromeLog] });

  let failed = false;
  try {
    await waitForUrl(appUrl, "The app (next start)");
    await waitForUrl(`http://127.0.0.1:${cdpPort}/json/version`, "Chrome");
    const cdp = await connect(cdpPort);
    say("Running the editor flows…");
    let result;
    try {
      const cpuSlowdown = Number(process.env.E2E_CPU_SLOWDOWN) || 1;
      if (cpuSlowdown > 1) say(`Chrome CPU slowed down ${cpuSlowdown}x (E2E_CPU_SLOWDOWN).`);
      result = await runEditorFlows({ cdp, appUrl, user: USER, pass: PASS, cpuSlowdown, log: say });
    } finally {
      cdp.close();
    }
    const { steps, checks } = result;
    writeFileSync(join(outDir, "last-run.json"), JSON.stringify(steps, null, 2) + "\n");

    const bad = checks.filter((c) => !c.ok);
    say(`\nChecks: ${checks.length - bad.length} of ${checks.length} passed`);
    for (const c of bad) say(`  FAIL ${c.name}${c.detail ? `\n       ${c.detail}` : ""}`);
    if (bad.length) failed = true;

    if (UPDATE) {
      if (bad.length) say("Snapshot NOT updated: fix the failing checks first.");
      else {
        writeFileSync(snapshotFile, JSON.stringify(steps, null, 2) + "\n");
        say(`Snapshot updated: ${steps.length} steps (e2e/editor-flows.snapshot.json). Review the diff before committing.`);
      }
    } else if (!existsSync(snapshotFile)) {
      say("No snapshot yet: run npm run e2e:update to create it.");
      failed = true;
    } else {
      const diff = diffSteps(JSON.parse(readFileSync(snapshotFile, "utf8")), steps);
      if (diff.length) {
        failed = true;
        say(`\nSnapshot: ${diff.length} difference(s). If the change is intended, run npm run e2e:update.`);
        for (const line of diff) say(line);
      } else {
        say(`Snapshot: all ${steps.length} steps match.`);
      }
    }
  } finally {
    await stopAll();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      // Chrome can hold files briefly on Windows; it's in the temp folder either way.
    }
  }
  say(failed ? "\nE2E FAILED" : "\nE2E PASSED");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  stopAll();
  console.error(`\nE2E ERROR: ${e?.message || e}`);
  console.error(`Logs: ${outDir}`);
  process.exitCode = 1;
});
