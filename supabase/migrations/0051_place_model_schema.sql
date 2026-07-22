-- 0051_place_model_schema.sql — §1 of the Place-model redesign. ADDITIVE ONLY.
-- Adds the new structural columns/tables and backfills them from existing data.
-- Nothing is dropped or repointed here: part_of, trail_id, categories[] all stay
-- intact so the current app keeps working. Retiring legacy comes in a later step
-- once the new model is wired and verified.
--
-- Model: ONE object = Place. counts_as_place true = it adds to "places visited"
-- (everywhere you went, incl. cities/regions); false ONLY for trail/trip rollups
-- (they summarize places that already counted). holds_children = it's a container
-- (city/region/trail/trip). A city is BOTH (counts AND holds) — the flags are
-- independent.

-- ── places: new structural columns ────────────────────────────────────────────
alter table public.places
  add column if not exists kind text not null default 'leaf',   -- 'leaf' | 'container'
  add column if not exists category text,                        -- normalized singular category
  add column if not exists holds_children boolean not null default false,
  add column if not exists boundary geometry(MultiPolygon, 4326); -- city/region spatial boundary (Nominatim)

-- counts_as_place is DERIVED and always correct: everything counts except the two
-- rollup categories. Generated so it can never drift out of sync with category.
alter table public.places
  add column if not exists counts_as_place boolean
    generated always as (category is distinct from 'trail' and category is distinct from 'trip') stored;

create index if not exists places_boundary_gix on public.places using gist (boundary);
create index if not exists places_category_idx on public.places (category);

-- Backfill `category` (singular) from the existing signals, most-specific first:
--   trail (is_trail) > trip (categories @> trip) > first manual category > first
--   auto activity category. Left null when a place has no category at all
--   (uncategorized places still count — null is not 'trail'/'trip').
update public.places set category = case
  when is_trail then 'trail'
  when categories @> array['trip'] then 'trip'
  when coalesce(array_length(categories,1),0) > 0 then categories[1]
  when coalesce(array_length(activity_categories,1),0) > 0 then activity_categories[1]
  else null
end
where category is null;

-- Containers = trail/trip today (cities/regions get designated + get boundaries in
-- a later step; this only sets what we can infer now).
update public.places
  set holds_children = (category in ('trail','trip')),
      kind = case when category in ('trail','trip') then 'container' else 'leaf' end
where kind = 'leaf' and not holds_children;

-- ── place_membership: the single explicit parent↔child mechanism ───────────────
-- Replaces the part_of uuid[] array (kept in parallel for now; retired later).
create table if not exists public.place_membership (
  child_id   uuid not null references public.places(id) on delete cascade,
  parent_id  uuid not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (child_id, parent_id),
  check (child_id <> parent_id)
);
create index if not exists place_membership_parent_idx on public.place_membership (parent_id);

alter table public.place_membership enable row level security;
drop policy if exists place_membership_select on public.place_membership;
create policy place_membership_select on public.place_membership for select using (public.is_member());
drop policy if exists place_membership_write on public.place_membership;
create policy place_membership_write on public.place_membership for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- Backfill memberships from the existing part_of arrays (non-destructive copy).
insert into public.place_membership (child_id, parent_id)
select p.id, unnest(p.part_of)
from public.places p
where coalesce(array_length(p.part_of,1),0) > 0
on conflict do nothing;

-- ── visits: protect manually-entered visits from rebuilds ──────────────────────
alter table public.visits
  add column if not exists manual boolean not null default false;

-- ── activities: source + source_id for dedup and re-sync preservation ──────────
alter table public.activities
  add column if not exists source text,       -- 'strava' | 'garmin' | 'drawn'
  add column if not exists source_id text;     -- external id for de-dup / re-sync
-- Best-effort backfill of source from existing signals.
update public.activities set source = case
  when source is not null then source
  when strava_id is not null then 'strava'
  else 'drawn'
end
where source is null;
update public.activities set source_id = strava_id::text
  where source_id is null and strava_id is not null;
