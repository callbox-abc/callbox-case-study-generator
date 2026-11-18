-- Server-side cache for the Case Study Generator. Run once in the Supabase SQL editor.
--
-- Holds client data, so it has NO public access: row level security is on with no policies, and
-- only the app's server reaches it, with the service role key (SUPABASE_SERVICE_ROLE_KEY in Vercel).
--
-- Rows (key):
--   top-clients:latest                  the last complete weekly snapshot of the 5 most active
--                                       clients, with each one's full import data
--   top-clients:job:<monday date>       that week's job: progress between steps, and the
--                                       once-a-week lock
--   recent:<clientAccountId>            a campaign someone imported (shared "Recently imported
--                                       clients"), with its saved sheet and any CMS draft made from
--                                       it; kept 60 days
--   recent:-:<companyId>                a HubSpot-only import (no campaign)
--   backup:recent:<old key>             entries merged into recent:<clientAccountId> when keys
--                                       stopped including the HubSpot company; kept 60 days

create table if not exists public.app_cache (
  key        text primary key,
  cycle      text not null,
  status     text not null default 'running',
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists app_cache_updated_at on public.app_cache (updated_at desc);

alter table public.app_cache enable row level security;
-- Deliberately no policies: the anon and authenticated roles can't read or write this table.
--
-- Free plan: Supabase pauses a project after a week without activity. A daily Vercel Schedule
-- (/api/cron/keepalive, 12:00 PH) reads one row so the Monday job never meets a paused project.
