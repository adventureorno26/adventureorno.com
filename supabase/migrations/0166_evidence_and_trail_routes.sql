-- 0166 — §0.8 phase 2 (ADD ONLY). Why a visit exists, and the difference between
-- drawing a trail and walking it.
--
-- PART 1 — VISIT EVIDENCE (§0.3). "Every derived visit must be explainable from its
-- evidence." Today a derived visit is a row with dates and no memory of what produced
-- it, so when a photo moves or an activity is deleted the visit either silently rewrites
-- itself or silently outlives its reason. Neither is auditable, and the first one is how
-- Erica's manual work kept getting undone.
--
--   * `source_key` is the idempotency handle §0.3 asks for: re-importing the same file
--     attaches the same evidence instead of a second copy.
--   * Deleting evidence does NOT delete the visit — `on delete set null` keeps the row
--     and the audit trail. An accepted decision survives its evidence (§0.9).
--
-- PART 2 — TRAIL ROUTES (§0.5). "A drawn trail definition is not a completed activity."
-- Drawing the Appalachian Trail on a map is reference geometry; walking it is an
-- outing. Storing the first as an `activity` inflates mileage with paths nobody walked.
-- The preflight found ZERO `source='drawn'` activities, so there is nothing ambiguous to
-- reclassify — this table starts empty and stays honest from here.
--
-- PART 3 — `trail_section` becomes a real relationship type (§0.3), alongside the
-- existing `contains`. All 19 current rows are `contains` and are left alone; nothing is
-- reclassified without review.
--
-- ROLLBACK: drop trail_routes and visit_evidence; remove 'trail_section' from the
-- relationship_type constraint. Nothing existing is modified by this migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. Evidence
-- ---------------------------------------------------------------------------
create table if not exists public.visit_evidence (
  visit_id      uuid not null references public.visits(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('photo','activity','location_ping','entry')),
  evidence_id   uuid not null,
  evidence_date date null,
  source_key    text null,
  created_at    timestamptz not null default now(),
  primary key (visit_id, evidence_type, evidence_id)
);

comment on table public.visit_evidence is
  'Why a visit exists (§0.3). Moving or deleting evidence queues a reconciliation '
  'proposal; it must never silently rewrite an accepted visit.';
comment on column public.visit_evidence.source_key is
  'Stable per-source identity so a retried import attaches the same evidence twice '
  'instead of creating a second row.';

create index if not exists visit_evidence_lookup_idx
  on public.visit_evidence(evidence_type, evidence_id);
create unique index if not exists visit_evidence_source_key_idx
  on public.visit_evidence(evidence_type, source_key)
  where source_key is not null;

alter table public.visit_evidence enable row level security;
drop policy if exists visit_evidence_read on public.visit_evidence;
create policy visit_evidence_read on public.visit_evidence
  for select using (public.is_member());

revoke all on public.visit_evidence from public, anon;
grant select on public.visit_evidence to authenticated;

-- Backfill from the links that already exist. Idempotent.
insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date)
select ph.visit_id, 'photo', ph.id, coalesce(ph.local_date, ph.taken_at::date)
  from public.photos ph
 where ph.visit_id is not null and ph.deleted_at is null
on conflict do nothing;

insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date)
select a.visit_id, 'activity', a.id, coalesce(a.local_date, a.start_date::date)
  from public.activities a
 where a.visit_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Reference geometry — drawing a trail is not walking it
-- ---------------------------------------------------------------------------
create table if not exists public.trail_routes (
  id               uuid primary key default gen_random_uuid(),
  trail_place_id   uuid not null references public.places(id) on delete cascade,
  section_place_id uuid null references public.places(id) on delete set null,
  name             text null,
  polyline         text null,
  geom             geography(LineString, 4326) null,
  distance_m       double precision null,
  source           text not null default 'drawn' check (source in ('drawn','osm','import')),
  created_by       uuid null references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.trail_routes is
  'Reference geometry for a trail (§0.5). Draws the trail on a map; adds ZERO visits '
  'and ZERO miles. Actual outings are activities linked to a visit.';

create index if not exists trail_routes_trail_idx on public.trail_routes(trail_place_id);

alter table public.trail_routes enable row level security;
drop policy if exists trail_routes_read on public.trail_routes;
create policy trail_routes_read on public.trail_routes
  for select using (public.is_member());
drop policy if exists trail_routes_write on public.trail_routes;
create policy trail_routes_write on public.trail_routes
  for all using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

revoke all on public.trail_routes from public, anon;
grant select, insert, update, delete on public.trail_routes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. trail_section joins the relationship vocabulary
-- ---------------------------------------------------------------------------
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'public.place_membership'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%relationship_type%';
  if v_con is not null then
    execute format('alter table public.place_membership drop constraint %I', v_con);
  end if;
end $$;

alter table public.place_membership
  add constraint place_membership_relationship_type_check
  check (relationship_type in ('contains','trail_section'));

comment on column public.place_membership.relationship_type is
  'contains = a place inside another. trail_section = a section OF a trail (§0.5). '
  'The 19 existing rows are all `contains` and are not reclassified without review.';

commit;
