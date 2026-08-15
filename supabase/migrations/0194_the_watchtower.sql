-- 0194 — the watchtower's ledger.
--
-- Phase 6 puts three always-on servers behind our own Workers. Everything in this stack
-- until now has been managed — Pages, Workers, R2, Supabase — so nobody has ever had to
-- watch a box. Three of them with nobody watching is the real risk of that phase, which
-- is why §6b says the watchtower is built WITH them and not afterwards.
--
-- It is built FIRST, because there is already something to watch and something to catch.
--
-- WHAT IT MUST CHECK, and this is the whole lesson of 2026-08-15: **the content type, not
-- the status code**. Every `/basemap/*` URL answered `200` for four days while serving the
-- app's HTML, because no Worker route was registered and Pages was replying instead. A
-- probe that asked "is it 200?" would have reported everything healthy the entire time.
--
-- So a probe records what came back, and the check is whether it is the RIGHT KIND of
-- thing. A tile that is `text/html` is a failure with a 200 on it.

create table if not exists public.service_health (
  id            bigint generated always as identity primary key,
  service       text        not null,
  url           text        not null,
  checked_at    timestamptz not null default now(),
  ok            boolean     not null,
  status        integer,
  content_type  text,
  bytes         integer,
  ms            integer,
  detail        text
);

comment on table public.service_health is
  'One row per probe. `ok` is a judgement about the CONTENT TYPE and size, not the status '
  'code: /basemap/* returned 200 with the app''s HTML for four days in August 2026 because '
  'no route was registered, and a status-only probe would have called that healthy.';

create index if not exists service_health_recent
  on public.service_health (service, checked_at desc);

alter table public.service_health enable row level security;

-- Members read it; only the prober writes, and it runs as service_role.
drop policy if exists service_health_select on public.service_health;
create policy service_health_select on public.service_health
  for select using (public.is_member());

revoke insert, update, delete on public.service_health from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What Settings shows: the latest result per service, and whether it is stale.
--
-- A probe that STOPPED RUNNING is a failure too, and the loudest way to miss an outage
-- is to look only at the newest row and not at how old it is.
-- ---------------------------------------------------------------------------
create or replace function public.service_status()
returns table (
  service      text,
  ok           boolean,
  status       integer,
  content_type text,
  ms           integer,
  checked_at   timestamptz,
  stale        boolean,
  detail       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select distinct on (h.service)
         h.service, h.ok, h.status, h.content_type, h.ms, h.checked_at,
         h.checked_at < now() - interval '30 minutes' as stale,
         h.detail
    from public.service_health h
   order by h.service, h.checked_at desc;
$function$;

revoke all on function public.service_status() from public, anon;
grant execute on function public.service_status() to authenticated, service_role;

comment on function public.service_status() is
  'The latest probe per service for the Settings screen. `stale` means the WATCHTOWER '
  'itself has stopped reporting, which is an outage in its own right — an old green row '
  'reads exactly like a healthy one.';

-- Keep the ledger from growing without bound; a fortnight is plenty to see a pattern.
create or replace function public.prune_service_health()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.service_health where checked_at < now() - interval '14 days';
$function$;

revoke all on function public.prune_service_health() from public, anon, authenticated;
