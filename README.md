# Callbox Case Study Generator

Upload a draft case study (.docx / .pdf / pasted text) → Gemini 2.5 Flash maps it into
Callbox's case study fields → edit inline → export a real, copy-pasteable PDF via the
browser's print dialog.

## Architecture

- **`app/page.tsx`** — the whole UI (upload, AI-mapping wait state, editable preview).
  Runs entirely client-side (`"use client"`).
- **`app/api/map/route.ts`** — the only server-side code. Takes raw document text,
  calls Gemini, returns mapped JSON. **This is the only place the Gemini API key is used**,
  and it is read from `process.env.GEMINI_API_KEY` — never sent to the browser.
- **`lib/extract.ts`** — client-side `.docx`/`.pdf` text extraction (mammoth for docx;
  pdf.js loaded from a CDN `.mjs` build for pdf — see the comment in that file for why).
- **PDF export** — `window.print()` with a `@media print` stylesheet that hides all
  editor chrome. This keeps the exported PDF's text real and selectable/copy-pasteable,
  unlike canvas-based renderers (html2canvas, etc.) which rasterize text into an image.

## Local development

```bash
npm install
cp .env.example .env.local   # then paste your real Gemini key into .env.local
npm run dev
```

`.env.local` is git-ignored — it will not be committed.

## Deploying to Vercel

1. Push this project to a GitHub/GitLab/Bitbucket repo (or run `vercel` from this
   directory with the Vercel CLI).
2. In the Vercel dashboard, import the repo as a new project. Framework preset
   should auto-detect as **Next.js** — no build command changes needed.
3. **Before your first deploy** (or any time after, followed by a redeploy), go to:
   `Project -> Settings -> Environment Variables`
   - Key: `GEMINI_API_KEY`
   - Value: your actual Gemini API key
   - Environments: check all of Production, Preview, and Development (or scope it
     down if you want different keys per environment)
   - Click **Save**.
4. Deploy (or redeploy — env var changes require a redeploy to take effect).
5. Once live, open the deployed URL and try the upload flow. If mapping fails with
   a message about `GEMINI_API_KEY is not set`, the env var either wasn't saved,
   wasn't applied to the right environment, or the app needs a redeploy.

### Rotating or revoking the key

If the key is ever exposed (e.g. pasted somewhere it shouldn't have been), revoke it
in Google AI Studio / Google Cloud Console immediately and issue a new one — then
update the Vercel env var and redeploy. Because the key only ever lives in
`app/api/map/route.ts` server-side, it is never present in any browser-loaded
JavaScript bundle, so exposure would only happen if the key value itself were
leaked some other way (e.g. committed to git, pasted in chat, etc.) — never through
normal use of the deployed app.

## Known constraints worth knowing about

- **Next.js version**: pinned to `14.2.35`. Next.js 14 is end-of-life, and one
  unpatched DoS advisory (CVE-2026-23864) affects the App Router's Server Actions /
  RSC data-fetching path. This app doesn't use Server Actions (the page is a plain
  client component; `/api/map` is a normal Route Handler), so it isn't in the
  affected code path — but this is worth re-checking if the app grows to use
  Server Actions later, since at that point upgrading to Next 15+ would matter.
- **PDF parsing** runs entirely in the browser via a CDN-hosted pdf.js build,
  not bundled through npm/webpack — this was a deliberate choice after hitting a
  known Next.js + pdfjs-dist 4.x production build failure (their worker ships as
  an ES module, which trips Terser during minification when bundled locally).
- **AI-mapped fields are a best-effort extraction**, not guaranteed accurate — the
  prompt is instructed not to invent facts absent from the source, but always
  read over a freshly mapped case study before exporting it.
