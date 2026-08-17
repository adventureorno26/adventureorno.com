-- 0202 — the provenance spine. An activity is an OUTING; a source is EVIDENCE of it.
--
-- Erica, 2026-08-17: "create a plan to build an import workflow that also keeps a ledger of
-- who adds what from what source — we also must be able to de-dupe activities uploaded from
-- different methods that record the same run … the activity should only be counted once."
--
-- WHAT IS WRONG TODAY, measured on production before writing this:
--
--   * `source_id` is NULL on all 265 file rows. Nothing records which file, or whose, or when.
--   * `original_source` was backfilled as `coalesce(original_source, source)`, so every file
--     row says 'file' — a TRANSPORT, not an origin. §6f asked for "where it came from
--     originally, through however many hubs" and this is not that.
--   * `import_file_activity` found a match and returned without inserting: the second
--     recording was not stored, not linked, not logged. It was simply gone.
--   * `ingest_runs` exists (41 rows) but only the OSM suggester writes it, and no database
--     function reads it.
--
-- THE ONE IDEA. An activity is an outing; a source is evidence of that outing. Separating
-- them answers all three of her requirements at once: counting reads activities, so a run
-- recorded by Strava AND AllTrails AND Apple Health is ONE row with THREE evidence rows and
-- cannot be counted three times BY CONSTRUCTION rather than by a dedup job that has to keep
-- winning; the evidence row IS the ledger entry; and two PEOPLE recording one outing stops
-- looking like one person recording it twice.
--
-- The live proof that both cases are real is already in the data, on 2026-03-07:
--   Purcellville to Arlington - Full WOD  08:10:36  45.12mi  strava  owner Erica
--   Purcellville Running                  08:10:42  44.68mi  file    owner Josh
--   Purcellville Trailhead - W&OD         08:21:57  44.93mi  file    owner Erica
-- One run. Erica's Strava copy, Erica's file copy, and Josh's own recording.

-- ---------------------------------------------------------------------------
-- 1. Connections — the identity of a provider account or device. No secrets.
-- ---------------------------------------------------------------------------
-- `strava_accounts` keeps the tokens and stays locked down. This table exists so an
-- ingest row can name WHERE data came from without anything having to read a credential.
create table if not exists public.source_connections (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null,
  owner_profile  uuid not null references public.profiles(id) on delete cascade,
  external_id    text,
  label          text,
  connected_at   timestamptz not null default now(),
  disconnected_at timestamptz,
  constraint source_connections_provider_ck
    check (provider in ('strava','garmin','apple-health','alltrails','komoot','file','recorder','overland','owntracks','google-timeline','unknown'))
);
create unique index if not exists source_connections_identity
  on public.source_connections (provider, coalesce(external_id, ''), owner_profile);

-- ---------------------------------------------------------------------------
-- 2. Runs — one row per import ACTION, human or not.
-- ---------------------------------------------------------------------------
-- EXTENDING the table that already exists rather than adding a rival ledger: a review
-- caught that plan, and two run ledgers would be two answers to one question.
--
-- `actor_kind` is what makes it honest. A webhook has no `auth.uid()`, a nightly job has no
-- initiator, and a migration must never be recorded as a person approving something.
alter table public.ingest_runs
  add column if not exists method               text,
  add column if not exists actor_kind           text not null default 'unknown',
  add column if not exists initiated_by         uuid references public.profiles(id) on delete set null,
  add column if not exists source_connection_id uuid references public.source_connections(id) on delete set null,
  add column if not exists source_owner_profile uuid references public.profiles(id) on delete set null,
  add column if not exists status               text not null default 'finished',
  add column if not exists idempotency_key      text,
  add column if not exists app_version          text;

alter table public.ingest_runs drop constraint if exists ingest_runs_actor_kind_ck;
alter table public.ingest_runs add constraint ingest_runs_actor_kind_ck
  check (actor_kind in ('user','device','webhook','scheduled','service','migration','unknown'));
alter table public.ingest_runs drop constraint if exists ingest_runs_status_ck;
alter table public.ingest_runs add constraint ingest_runs_status_ck
  check (status in ('running','finished','failed'));
create unique index if not exists ingest_runs_idempotency
  on public.ingest_runs (idempotency_key) where idempotency_key is not null;

-- The 41 rows already there are the OSM suggester: a scheduled machine, not a person.
update public.ingest_runs
   set actor_kind = 'scheduled', method = coalesce(method, 'osm-suggester')
 where source = 'suggester' and actor_kind = 'unknown';

-- ---------------------------------------------------------------------------
-- 3. Artifacts — the bytes we were given, kept once.
-- ---------------------------------------------------------------------------
-- The old importer's worst property was discarding what it could not use, which makes
-- re-derivation impossible. One row per file, referenced by items — never a raw key copied
-- onto every activity.
create table if not exists public.import_artifacts (
  id            uuid primary key default gen_random_uuid(),
  sha256        text not null,
  byte_size     bigint,
  media_type    text,
  object_key    text,
  retention     text not null default 'keep',
  created_at    timestamptz not null default now(),
  constraint import_artifacts_retention_ck check (retention in ('keep','purge-requested','purged'))
);
create unique index if not exists import_artifacts_sha on public.import_artifacts (sha256);

-- ---------------------------------------------------------------------------
-- 4. Items — one incoming record, and what we decided about it.
-- ---------------------------------------------------------------------------
-- NEVER SILENTLY DROP. A file that turns out to be a duplicate still gets a row saying so,
-- which is the difference between "we already had it" and the old `return v_id` that left
-- no trace at all.
create table if not exists public.ingest_items (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.ingest_runs(id) on delete cascade,
  artifact_id   uuid references public.import_artifacts(id) on delete set null,
  entity_kind   text not null default 'activity',
  external_key  text,
  event_at      timestamptz,
  disposition   text not null,
  reason        text,
  created_at    timestamptz not null default now(),
  constraint ingest_items_disposition_ck
    check (disposition in ('inserted','attached','duplicate','proposed','skipped','failed'))
);
create index if not exists ingest_items_by_run on public.ingest_items (run_id);

-- ---------------------------------------------------------------------------
-- 5. Sources — the evidence, and the join that makes counting-once structural.
-- ---------------------------------------------------------------------------
create table if not exists public.activity_sources (
  id             uuid primary key default gen_random_uuid(),
  activity_id    uuid not null references public.activities(id) on delete cascade,
  ingest_item_id uuid references public.ingest_items(id) on delete set null,
  connection_id  uuid references public.source_connections(id) on delete set null,
  provider       text not null,
  origin         text not null default 'unknown',
  external_key   text,
  device_name    text,
  is_primary     boolean not null default false,
  confidence     text not null default 'exact',
  created_at     timestamptz not null default now(),
  constraint activity_sources_confidence_ck check (confidence in ('exact','strong','proposed'))
);
create index if not exists activity_sources_by_activity on public.activity_sources (activity_id);

-- TIER 1 IS SCOPED, NOT GLOBAL, and a review is the reason.
--
-- A provider key proves "the same SOURCE RECORD", not "the same outing". Checked against
-- Strava with Erica's own token: her watch activities carry
-- `external_id = garmin_ping_610945955935` with `device_name = "Garmin fēnix 6S"`, her phone
-- ones carry `<UUID>-activity` / "Strava App". So external_id reliably names the ORIGIN —
-- which is how `origin` gets filled in honestly instead of guessed — but `garmin_ping_…` is
-- a Garmin *ping* id, not the FIT `file_id`, so it is no join key to the file itself.
-- A global unique on external_key would therefore collapse things that merely look alike.
create unique index if not exists activity_sources_one_per_source_record
  on public.activity_sources (provider, coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid), external_key)
  where external_key is not null;

comment on table public.activity_sources is
  'Evidence that an outing happened: one row per Strava activity, FIT/GPX file, Apple Health '
  'workout or recorder session. An activity may have several. Counting reads ACTIVITIES, so '
  'the same run arriving from three apps is counted once by construction.';

-- ---------------------------------------------------------------------------
-- 6. RLS — read for members, writes only through the importer.
-- ---------------------------------------------------------------------------
alter table public.source_connections enable row level security;
alter table public.import_artifacts   enable row level security;
alter table public.ingest_items       enable row level security;
alter table public.activity_sources   enable row level security;
alter table public.ingest_runs        enable row level security;

drop policy if exists source_connections_select on public.source_connections;
create policy source_connections_select on public.source_connections for select using (public.is_member());
drop policy if exists ingest_items_select on public.ingest_items;
create policy ingest_items_select on public.ingest_items for select using (public.is_member());
drop policy if exists ingest_runs_select on public.ingest_runs;
create policy ingest_runs_select on public.ingest_runs for select using (public.is_member());

-- Sources follow the activity they evidence: if you may not see the activity, you may not
-- see what it was built from. Otherwise the evidence table becomes a way around 0200.
drop policy if exists activity_sources_select on public.activity_sources;
create policy activity_sources_select on public.activity_sources for select
  using (public.is_member() and public.can_see_activity(activity_id));

-- Artifacts are file hashes and private object keys. Members get no read at all; only the
-- service role, which is what the importer runs as.
revoke all on public.import_artifacts from anon, authenticated;
revoke insert, update, delete on public.source_connections, public.ingest_items,
  public.ingest_runs, public.activity_sources from anon, authenticated;
revoke all on public.source_connections, public.ingest_items, public.ingest_runs,
  public.activity_sources from anon;

-- ---------------------------------------------------------------------------
-- 7. Backfill — only what is SUPPORTED, with `unknown` left as unknown.
-- ---------------------------------------------------------------------------
do $$
declare
  v_erica uuid := (select id from public.profiles where role='owner'
                    and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_conn  uuid;
  v_run   uuid;
begin
  if v_erica is null then return; end if;

  -- The one connection that exists. Josh has never completed an OAuth, and inventing a
  -- connection for him would be exactly the kind of guess this migration is against.
  insert into public.source_connections (provider, owner_profile, external_id, label, connected_at)
  select 'strava', sa.profile_id, sa.athlete_id::text, 'Strava', sa.created_at
    from public.strava_accounts sa
  on conflict do nothing;
  select id into v_conn from public.source_connections where provider='strava' limit 1;

  insert into public.ingest_runs (source, method, actor_kind, source_owner_profile, status, started_at, finished_at, notes)
  values ('migration','backfill-0202','migration', v_erica, 'finished', now(), now(),
          jsonb_build_object('note','Provenance reconstructed from columns that already existed. Nothing here is inferred beyond what the row states.'))
  returning id into v_run;

  -- STRAVA: provider and connection are known facts. The DEVICE is not — `external_id` and
  -- `device_name` live in Strava's API and were never stored, so a later enrichment pass
  -- can fill `origin`/`device_name`; guessing 'garmin' now would be fiction.
  insert into public.activity_sources
    (activity_id, connection_id, provider, origin, external_key, is_primary, confidence)
  select a.id, v_conn, 'strava', 'strava', a.strava_id::text, true, 'exact'
    from public.activities a
   where lower(coalesce(a.original_source,'')) = 'strava'
     and not exists (select 1 from public.activity_sources s where s.activity_id = a.id)
  on conflict do nothing;

  -- FILE: we know a person uploaded it and we know who. We do NOT know what produced it —
  -- `source_id` is NULL on all 265 — so the upstream provider stays 'unknown'. Garmin,
  -- AllTrails and Apple Health all arrive as 'file', and picking one would be a guess
  -- dressed as provenance.
  insert into public.activity_sources
    (activity_id, provider, origin, external_key, is_primary, confidence)
  select a.id, 'file', 'unknown', null, true, 'exact'
    from public.activities a
   where lower(coalesce(a.original_source,'')) <> 'strava'
     and not exists (select 1 from public.activity_sources s where s.activity_id = a.id)
  on conflict do nothing;
end $$;

-- What the app should read instead of `activities.original_source`, which is a transport.
create or replace view public.activity_provenance as
  select a.id as activity_id,
         a.owner_profile,
         count(s.id)                                   as source_count,
         array_agg(distinct s.provider order by s.provider) as providers,
         array_agg(distinct s.origin   order by s.origin)   as origins,
         bool_or(lower(s.provider) = 'strava')         as has_strava_source
    from public.activities a
    left join public.activity_sources s on s.activity_id = a.id
   group by a.id, a.owner_profile;

comment on view public.activity_provenance is
  'Where an activity''s evidence came from. `source_count > 1` is the same outing recorded '
  'by more than one app — the case activities.original_source could never express.';
