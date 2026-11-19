# Callbox Case Study Generator

Builds Callbox case studies in the revamp layout from live client data, a draft document, a filled
Word template, or a blank sheet. Writers edit the sheet in place, the AI drafts the empty text, and the
result goes out as a PDF or as a WordPress draft on the CMS.

- Live: https://callbox-case-study-generator.vercel.app (shared login)
- Stack: Next.js 16 (App Router) on Vercel Pro, Supabase, Gemini, CallboxOne MCP, HubSpot, WordPress REST
- Built and maintained by James Daniel Esmatao, Web Developer & Technical SEO Specialist

## What it does

### Start screen (in priority order)

1. **Start from HubSpot + CallboxOne**: opens the editor with the import panel.
2. **Drop a document**: a `.docx` or `.pdf` draft is mapped into the layout by the AI. A filled
   **Case Study Template** is read field by field instead, with no AI involved.
3. **Start with a blank case study**.
4. **Download Case Study Template**: a Word file with every field labeled
   (`public/callbox-case-study-template.docx`).

### Import panel

- **One search box for both sources.** If one source finds nothing, it is searched again with a term from
  the other (HubSpot company name for CallboxOne, campaign code letters for HubSpot).
- **This week's most active clients**: 5 cards built once a week (see below). A click loads the saved data
  instantly, with no live calls.
- **Recently imported clients**: every live import, shared by everyone using the app, with when it was
  pulled, whether its sheet is reviewed or a draft, and any CMS draft made from it. One entry per
  campaign (one per HubSpot company for a HubSpot-only import), whether or not HubSpot matched it.
- **"Already in recent search" prompt**: searching or importing a saved client asks first:
  **Use Cached data** (default) or **Fetch Live Data** (replaces the saved copy for everyone).

### Editor

- The sheet mirrors the live case study page. Empty sections are dashed and stay out of the PDF and the CMS.
- **AI drafting** fills only empty text fields, from the sheet's own data. It runs on its own after an
  import or a mapped document; **Fill empty fields with AI** appears when there is data and something
  is still empty (to redraft a field, clear it).
- **Mark as reviewed** records that the AI text was checked. The banner lists AI-written fields until then.
- **Save** stores the sheet in the client's shared copy. Mark as reviewed and Send to CMS also save.
  **Start over**, the browser's Back button, and switching clients ask **"Save before exit?"** when a
  pulled client has unsaved changes. Each new client starts from a clean sheet.
- **Download PDF** prints exactly what is on screen (real, selectable text) without the editor controls.
- **Send to CMS as draft** creates or updates a WordPress draft page under
  "Callbox Lead Generation Success Stories". It never publishes.

## Where the data comes from

| Source | What it provides | Code |
|---|---|---|
| CallboxOne (Pipeline) MCP server | Campaign numbers: calls, LinkedIn, email, appointments by quarter, lists, seniority mix, funnel | `lib/callboxone.ts`, `app/api/callboxone/*` |
| HubSpot (Callbox's own portal) | Client facts: industry, HQ, size band, client since, program growth (seats, services), primary contact role, solution line | `lib/hubspot.ts`, `app/api/hubspot` |
| Gemini | Narrative drafting, document mapping, solution line | `app/api/draft-narrative`, `app/api/map-revamp`, `lib/aiModels.ts` |
| Supabase (`app_cache` table) | Weekly snapshot, recent imports, saved sheets | `lib/topClients.ts`, `lib/recentClients.ts` |
| WordPress (cms.callboxinc.com) | Draft pages with the "Case Study: Revamp" ACF fields | `app/api/cms/draft` |
| BrandIcons | Client logos in the import panel | `components/revamp/TopClients.tsx` |

Privacy by design: HubSpot deal amounts are never requested and deal names never leave the server; for
contacts only the job title and original source are requested (never names, emails or phones);
CallboxOne list names (often data vendors) never leave the server. Both integrations are read-only.

## Weekly "most active clients"

The 5 CallboxOne clients with the most sales-qualified appointments in the last 30 days, among
campaigns running 60 days to 24 months, each with its full import data. Built **once a week** by a
Vercel Schedule, **Mondays 08:00 Asia/Manila**, and stored in Supabase. Opening the panel or clicking a
card never calls CallboxOne or HubSpot.

The job (`lib/topClients.ts`) runs as a chain of steps of up to about 4 minutes each, saving progress
between steps:

1. **rank**: one `list_team_leaders` call for the candidates, then `get_hubspot_report` per client
   (same appointment count as `get_report_stats` at ~1.5KB instead of ~800KB).
2. **select**: the top 5 that match a HubSpot company with deals (this drops internal campaigns and
   guarantees a name and logo). Lookups run 2 at a time; HubSpot 429s are retried.
3. **import**: each pick's full HubSpot profile and CallboxOne quarters, lists and funnel.
4. **publish**: the snapshot replaces last week's.

That week's job row is the lock, so a second start in the same week does nothing. While it runs, the
panel shows a progress bar and refreshes itself every 15s (reading Supabase only). If a run fails, last
week's list stays up and the panel shows the last error.

### Schedules (`vercel.json`)

| Schedule | When (Asia/Manila) | Route |
|---|---|---|
| `top-clients-weekly` | Mondays 08:00 | `/api/cron/top-clients` (starts the week's job) |
| `top-clients-resume` | Mondays every 10 min, 08:00 to 10:59 | `/api/cron/top-clients/resume` (continues a stalled job, never starts one) |
| `supabase-keepalive` | Daily 12:00 | `/api/cron/keepalive` (one read, so the free Supabase project never pauses) |

All three are GET (Schedules default to POST). The routes accept only `Authorization: Bearer <CRON_SECRET>`,
which Vercel sends; `proxy.ts` lets `/api/cron/*` past the shared login only with that token. Run one by
hand from the project's **Schedules** tab (**Run Schedule**). Do not add a `crons` key back next to
`schedules`: every run would fire twice.

## AI drafting

- **Models**: `gemini-3.1-pro-preview` drafts the narrative (default temperature, up to 180s); if it fails,
  times out or returns no usable JSON, `gemini-2.5-flash` takes over (temperature 0.4, 90s). The review
  banner names the model used. Override with `GEMINI_DRAFT_MODEL`. Document mapping and the solution
  line use `gemini-2.5-flash`.
- **Guardrails in code** (`lib/narrative.ts`), not only in the prompt:
  - only empty fields are filled; writer text is never replaced;
  - a sentence with a number that isn't in the sheet's data (or derived from two of its numbers) is
    dropped, as are money claims and forecasts; the banner lists what was removed and why;
  - the headline is Title Case and never names the client; a headline that credits the whole
    appointment total to one channel is rejected (a backup headline is tried);
  - generic section headings lose to a specific backup heading;
  - "appointments held" becomes "appointments" (only "first appointment transpired" counts meetings held);
  - em dashes are removed.
- **House style for headlines**: client by type (e.g. "US-Based Cybersecurity Provider"), 9 to 16 words,
  at most one number, e.g. *IT Provider Builds Qualified Pipeline Across US Spanish-Speaking Markets With
  Multilingual Outreach*.

## Project structure

```
app/page.tsx                       Picks the screen (start, mapping, editor) and wires the parts below
hooks/useCaseStudyEditor.ts        Editor state and the actions across concerns (start, load, switch, leave)
hooks/useAiDraft.ts                AI drafting of empty fields and the review banner state
hooks/useSheetSave.ts              Saving a pulled client's sheet, unsaved changes, the save prompt
hooks/useCmsDraft.ts               Send to CMS as draft
hooks/useLeaveGuard.ts             Back button and tab close with unsaved changes
hooks/usePrintTitle.ts             Tab title and the PDF file name (CS_Case-Study-Name)
hooks/useMappingExample.ts         Few-shot example saved from a mapped document
components/editor/                 Start screen, toolbar, banners, save prompt, sheet footer, print CSS
lib/printPage.ts                   Sizes the PDF page to the content before printing
app/api/callboxone/{search,import} CallboxOne search and step-by-step import (one request per quarter)
app/api/hubspot                    HubSpot client search and client profile
app/api/draft-narrative            AI drafting of empty fields (model chain + guardrails)
app/api/map-revamp                 AI mapping of an uploaded draft into the layout
app/api/cms/draft                  WordPress draft create/update (never publishes)
app/api/top-clients                Weekly snapshot (read-only)
app/api/recent-clients             Recent imports, saved sheets, CMS draft links
app/api/cron/*                     Weekly job, resume, Supabase keep-alive (CRON_SECRET only)
app/api/save-example               Records corrected mappings (Supabase mapping_examples, anon key)
app/api/map                        Legacy mapper (old layout); the only reader of those examples
components/revamp/RevampSheet.tsx  The editable sheet (revamp layout)
components/revamp/DataImport.tsx   Import panel: search, imports, cached-client prompt
components/revamp/TopClients.tsx   Weekly cards, recent imports, logos
lib/revamp.ts                      Sheet type, normalizing, ACF payload, fact merging
lib/narrative.ts                   Drafting input, guardrails, merge rules
lib/aiModels.ts                    Drafting model chain and fallback
lib/callboxone.ts / lib/hubspot.ts Server-only clients (allow-listed tools and paths)
lib/topClients.ts                  Weekly job (steps, lock, snapshot)
lib/recentClients.ts               Shared recent imports and saved sheets
lib/templateSchema.ts              Word template fields (drives the .docx and its reader)
lib/templateParse.ts               Reads a filled template word for word (no AI)
lib/extract.ts                     .docx (mammoth) and .pdf (pdf.js from cdnjs) text extraction
tests/                             Unit tests for the pure functions (npm test)
scripts/build-template.mjs         Builds public/callbox-case-study-template.docx
supabase/app_cache.sql             Table for the snapshot, recent imports and saved sheets
proxy.ts                           Shared login (Basic Auth) for every page and API route
```

## Environment variables

Set them in Vercel (Project, Settings, Environment Variables) and in `.env.local` for local work.
Never commit real values; `.env.example` lists them all.

| Variable | Needed for |
|---|---|
| `DRAFT_USER`, `DRAFT_PS` | Shared login for every page and API route (nothing is served without them) |
| `GEMINI_API_KEY` | AI drafting, mapping, solution line |
| `GEMINI_DRAFT_MODEL` | Optional: drafting model override |
| `CALLBOXONE_MCP_URL`, `CALLBOXONE_TOKEN` | CallboxOne search and import |
| `HUBSPOT_TOKEN` | HubSpot Service Key: `crm.objects.deals.read`, `crm.objects.companies.read`, `crm.objects.contacts.read` |
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | Snapshot, recent imports, saved sheets (set by the Vercel Marketplace Supabase integration) |
| `SUPABASE_ANON_KEY` | Corrected-mapping examples (`mapping_examples`), best effort |
| `CRON_SECRET` | Weekly job and keep-alive (any long random string) |
| `MAINSITE_URL`, `MAIN_CLIENT_USERNAME`, `MAIN_CLIENT_PASSWORD` | Send to CMS (WordPress Application Password) |
| `WP_REVAMP_TEMPLATE`, `WP_CASE_STUDY_PARENT_ID` | Optional CMS overrides (template file, parent page id) |
| `NEXT_PUBLIC_BRANDICONS_KEY` | Logos. Public by design: each key works only on its registered domain (one for production, one for `localhost`) |

## Setup

### Local

```bash
npm install
cp .env.example .env.local   # fill in the values you need
npm run dev                  # http://localhost:3000, log in with DRAFT_USER / DRAFT_PS
```

`next dev` (Next 16) writes `AGENTS.md` and `CLAUDE.md` into the project; delete them rather than commit them.

### Supabase (once)

Run `supabase/app_cache.sql` in the Supabase SQL Editor (paste the file's contents). The table has row level
security on and **no policies**: only the server reaches it, with the service role key. The free plan
pauses inactive projects; the daily keep-alive schedule prevents that.

### Deploy

Push to `main`; Vercel builds and deploys. Schedules come from `vercel.json`. After the first deploy, run
`top-clients-weekly` once from the **Schedules** tab to build the first snapshot (about 10 to 20 minutes).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | Type check (`tsc --noEmit`) |
| `npm test` | Unit tests (Vitest), about 1 second; `npm run test:watch` reruns them on save |
| `npm run template` | Rebuild `public/callbox-case-study-template.docx` after changing `lib/templateSchema.ts` |

## Tests

`tests/` covers the pure functions behind the app's accuracy: no network, no Supabase, no AI, no env vars.
Run `npm test` before merging anything that touches `lib/`.

| File | Guards |
|---|---|
| `numberGuard.test.ts` | Drafted sentences only keep numbers from the data; derived % and ratios need both source numbers in the sentence; a data count never passes as a %; money and forecasts dropped |
| `narrative.test.ts` | Writer text is never replaced (also during drafting); headline never names the client or credits the total to one channel; no contact section without a role; recommendation counts; house style |
| `clientMatch.test.ts` | A saved sheet naming another client is refused (the Logitech over Derevo bug); one entry per campaign |
| `recentMerge.test.ts` | Merging old entries keeps the HubSpot-matched details, the right sheet and the newest CMS draft |
| `dates.test.ts` | Start month from campaign codes (2-digit sequence, region suffix), quarter windows, weekly cycle and its 30-minute grace |
| `hubspot.test.ts` | Seats and services from deal names, grounded solution line, job titles, countries, seniority groups |
| `revamp.test.ts` | Model output cleaning, ACF payload (0 vs null, no drafter-only data), fact limits, section numbering |
| `templateParse.test.ts` | The Word template is read word for word; the shipped `.docx` is recognized and reads as empty |

`tests/fixtures.ts` holds a Netrix-shaped sheet with the numbers the tests reason about.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Weekly cards missing or stale | The import panel shows the job's last error; the **Schedules** tab has run history. The resume schedule continues a stalled job on Monday mornings. |
| "Supabase is not configured" / snapshot errors | Supabase project paused or env vars missing; restore the project, check `SUPABASE_SERVICE_ROLE_KEY`. |
| A card has initials instead of a logo | No HubSpot domain for that client, or BrandIcons has no logo for it. |
| AI banner says the fallback wrote the text | Gemini 3.1 Pro Preview failed or timed out; the reason is in the API response (`fallbackReason`). |
| Save button says "Save failed, retry" | Supabase unreachable; the sheet stays on screen, try again. |
| CMS draft not under the success stories page | The parent page wasn't found by title or slug; set `WP_CASE_STUDY_PARENT_ID`. |

## Known constraints

- **One shared login**: the app knows when something was saved, not who saved it. Two people editing the
  same client at once: the last save wins.
- **Vercel Schedules is in beta**; runs are not retried on error (the resume schedule covers the weekly job).
- **Gemini 3.1 Pro Preview is a preview model**; the Flash fallback keeps drafting working if it changes.
- **PDF parsing** loads pdf.js from cdnjs at runtime instead of bundling it (pdfjs-dist 4.x ships ES modules
  only, which breaks the production bundle).
- **AI output is a draft**: review it before downloading or sending to the CMS; the code guards catch
  unsupported numbers and known style problems, not every inaccuracy.
