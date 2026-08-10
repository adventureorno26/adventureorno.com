-- A MACHINE MAY ONLY PROPOSE. A PERSON'S DECISION WRITES, AND IT IS PERMANENT.
--
-- Erica: "make sure after a user approves it in the application, nothing
-- overwrites it."
--
-- Every naming bug so far had one shape: a guess was written into the record as
-- though it were a fact, and then something else overwrote it. 181 activities named
-- from the clock; a hike named after an adjacent Scout camp; trailhead hikes called
-- "SR630"; places called "-"; a Strava re-sync restoring "Morning Hike" over a fix.
--
-- There are already four partial, inconsistent versions of "don't touch this":
-- places.name_locked, visits.manual, photos.visit_id, and "only rename while it
-- still says 'New place'". None cover activities. None record who decided, or when,
-- or why. So there is nothing to trust and nothing to audit. This migration adds the
-- one ledger that does.
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR. It is pure addition: three tables, one guard
-- function, and a backfill of the locks that already exist in other forms. Nothing
-- reads the guard until step 4 of docs/INGEST-BUILD-PLAN.md, and no existing column
-- is dropped or rewritten. See docs/INGEST-REBUILD.md §3, §4 and §9.

begin;

-- ---------------------------------------------------------------------------
-- 1. suggestions — one PROPOSED change to one field. Never a fact.
-- ---------------------------------------------------------------------------
create table if not exists public.suggestions (
  id             uuid primary key default gen_random_uuid(),
  subject_type   text not null check (subject_type in ('activity','place','visit','photo')),
  subject_id     uuid not null,
  field          text not null,           -- 'name' | 'place_id' | 'visit_id' | 'is_trip' | 'is_trail'
  current_value  jsonb,                   -- the value when proposed; detects staleness
  proposed_value jsonb not null,
  label          text not null,           -- "Call this Potomac Heritage Trail"
  source         text not null,           -- 'osm' | 'maptiler' | 'alltrails' | 'exif'
                                          -- | 'google-photos' | 'rule' | 'strava'
  confidence     numeric check (confidence between 0 and 1),
  evidence       jsonb,                   -- {samples:9, trails:{...}, parks:{...}}
  group_key      text not null,           -- everything about one activity = one card
  rank           int not null default 0,  -- 0 = recommended
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','superseded','stale')),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.suggestions is
  'A machine''s PROPOSED change to one field. Never authoritative: a row here has '
  'changed nothing. Approving one writes the value and records it in approved_fields.';
comment on column public.suggestions.evidence is
  'Why the suggester believes this — e.g. {"samples":9,"trail":"Potomac Heritage Trail",'
  '"trail_hits":7}. Shown on the card: a suggestion you cannot check is just another guess.';

create index if not exists suggestions_pending_idx
  on public.suggestions (created_at desc)
  where status = 'pending';
create index if not exists suggestions_group_idx on public.suggestions (group_key);
create index if not exists suggestions_subject_idx
  on public.suggestions (subject_type, subject_id, field);

-- NEVER PROPOSE THE SAME THING TWICE. A rejected suggestion keeps its row precisely
-- so the suggester cannot re-offer what Erica already turned down. Approved and
-- superseded rows are excluded so a value can legitimately be proposed again later
-- (e.g. after clear_approval).
create unique index if not exists suggestions_no_repeats_idx
  on public.suggestions (subject_type, subject_id, field, md5(proposed_value::text))
  where status in ('pending','rejected');

-- ---------------------------------------------------------------------------
-- 2. approved_fields — THE DECISION. Permanent.
-- ---------------------------------------------------------------------------
-- Deliberately no expiry and no cascade from a rule change. The only way a lock
-- goes away is a person explicitly clearing it (clear_approval, step 3).
create table if not exists public.approved_fields (
  subject_type text not null check (subject_type in ('activity','place','visit','photo')),
  subject_id   uuid not null,
  field        text not null,
  value        jsonb not null,
  approved_by  uuid not null references public.profiles(id),
  approved_at  timestamptz not null default now(),
  via          text not null default 'inbox'
               check (via in ('inbox','edit','rule','backfill')),
  primary key (subject_type, subject_id, field)
);

comment on table public.approved_fields is
  'A person decided this field. Permanent: no machine may overwrite it. Presence of a '
  'row here is exactly what may_autowrite() refuses on.';
comment on column public.approved_fields.via is
  'How it was decided. ''edit'' = she changed it in the app, which IS an approval — '
  'she must never confirm the same thing twice.';

-- ---------------------------------------------------------------------------
-- 3. ingest_runs — so failures are visible instead of mysterious.
-- ---------------------------------------------------------------------------
-- One Overpass call in fourteen returned 504 during testing. Today that vanishes
-- silently; it should read as "3 activities couldn't be looked up — retry".
create table if not exists public.ingest_runs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,          -- 'strava-webhook' | 'file-import' | 'suggester' | 'backfill'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           int not null default 0,
  failed       int not null default 0,
  notes        jsonb                   -- {"overpass_504": 1, ...}
);

create index if not exists ingest_runs_recent_idx on public.ingest_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- 4. THE GUARD.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose. The design shows a plain SQL function, but a guard
-- whose answer depends on the CALLER'S row visibility is worse than no guard: a
-- caller who simply cannot see the lock would be told "yes, go ahead" and would
-- overwrite a decision. The answer must be the same for everyone who asks.
create or replace function public.may_autowrite(p_type text, p_id uuid, p_field text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.approved_fields
     where subject_type = p_type and subject_id = p_id and field = p_field);
$function$;

comment on function public.may_autowrite(text, uuid, text) is
  'May a machine write this field? False once a person has decided it. Machine-'
  'initiated writers (docs/INGEST-REBUILD.md §4.2) must call this first and skip on false.';

revoke all on function public.may_autowrite(text, uuid, text) from public;
revoke all on function public.may_autowrite(text, uuid, text) from anon;
grant execute on function public.may_autowrite(text, uuid, text) to authenticated;
grant execute on function public.may_autowrite(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS — members read; nobody writes from the client.
-- ---------------------------------------------------------------------------
-- Every write goes through a SECURITY DEFINER RPC (step 3). No INSERT/UPDATE/DELETE
-- policy exists on any of these tables, so RLS denies those outright; approved_fields
-- in particular must never be editable directly — changing a decision is audited.
alter table public.suggestions     enable row level security;
alter table public.approved_fields enable row level security;
alter table public.ingest_runs     enable row level security;

drop policy if exists suggestions_select on public.suggestions;
create policy suggestions_select on public.suggestions
  for select using (public.is_member());

drop policy if exists approved_fields_select on public.approved_fields;
create policy approved_fields_select on public.approved_fields
  for select using (public.is_member());

drop policy if exists ingest_runs_select on public.ingest_runs;
create policy ingest_runs_select on public.ingest_runs
  for select using (public.is_member());

-- Rule #8: no anon reach, ever. Grant only the SELECT the policies above gate.
revoke all on table public.suggestions     from public, anon;
revoke all on table public.approved_fields from public, anon;
revoke all on table public.ingest_runs     from public, anon;

grant select on table public.suggestions     to authenticated;
grant select on table public.approved_fields to authenticated;
grant select on table public.ingest_runs     to authenticated;

grant all on table public.suggestions     to service_role;
grant all on table public.approved_fields to service_role;
grant all on table public.ingest_runs     to service_role;

-- ---------------------------------------------------------------------------
-- 6. BACKFILL — the locks that already exist, in their own words.
-- ---------------------------------------------------------------------------
-- Additive and reversible: the old columns keep working exactly as they do now.
-- name_locked and manual were only ever booleans, so who locked them was never
-- recorded. Attribute to the row's creator where we have one, else the owner, and
-- mark via='backfill' so the ledger is honest about where the fact came from.
with owner as (
  select id from public.profiles where role = 'owner' order by created_at limit 1
)
insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
select 'place', p.id, 'name', to_jsonb(p.name),
       coalesce((select pr.id from public.profiles pr where pr.id = p.created_by), o.id),
       'backfill'
  from public.places p cross join owner o
 where p.name_locked
   and nullif(btrim(p.name), '') is not null
on conflict (subject_type, subject_id, field) do nothing;

with owner as (
  select id from public.profiles where role = 'owner' order by created_at limit 1
)
insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
select 'visit', v.id, 'place_id', to_jsonb(v.place_id),
       coalesce((select pr.id from public.profiles pr where pr.id = v.created_by), o.id),
       'backfill'
  from public.visits v cross join owner o
 where v.manual
   and v.place_id is not null
on conflict (subject_type, subject_id, field) do nothing;

-- NO PHOTO BACKFILL. The design (§9.3) assumed photos.visit_id was already in use;
-- it is not — 0 of 168 photos carry one. Photo pinning starts clean at step 5.
--
-- AND NO ACTIVITY BACKFILL, deliberately (§9.4). The 328 activity names fixed today
-- were written by a machine from place names, not chosen by Erica, so they stay
-- UNLOCKED and remain open to a better suggestion from the route scorer — which we
-- measured doing better on at least 11 of them.

commit;
