-- 0164 — §0.8 phase 2 (ADD ONLY). "+ Add an activity" and what it creates.
--
-- Erica, 2026-08-12: "instead of add a restaurant, it should be add an activity and open
-- to a dropdown to select run, walk, hike, bike, winery, brewery, restaurant, bar,
-- import activity, add a new activity - and everything for that needs to be built."
--
-- THE HALF THAT MATTERS. Those ten entries are not one kind of thing:
--
--   run · walk · hike · bike        → a ROUTE on this visit  (an activities row)
--   winery · brewery · restaurant · bar → a PLACE inside this one, with its own visit
--   import an activity file          → the existing GPX/FIT path, now on the card
--   add a new activity type          → a user-defined option, stored, not hardcoded
--
-- That split is Erica's own model, stated plainly: "A restaurant is a place. A winery is
-- a place. the dates are visits to those places." So the dropdown is a single control
-- over two verbs, and the table below records which verb each option means. The frontend
-- reads this table — it does not carry its own hardcoded list, because then "add a new
-- activity" could never work.
--
-- The two file/creation entries are UI ACTIONS, not options, so they are deliberately
-- not rows here.
--
-- NOTE ON 'bike' AND 'bar': Strava calls a bike outing 'Ride', which is what the 445
-- existing activities use — so the option is labelled Bike and creates type 'Ride'
-- rather than inventing a second spelling. 'bar' is a genuinely new place category and
-- is added to place_categories; 'restaurant' maps to the existing 'dining' category
-- rather than creating a duplicate of it.
--
-- ROLLBACK: drop the two RPCs, drop activity_options, drop activities.visit_id, and
-- delete the 'bar' category row if unused.

begin;

-- ---------------------------------------------------------------------------
-- 1. An activity belongs to a visit (§0.3: "Add activities.visit_id").
-- ---------------------------------------------------------------------------
alter table public.activities
  add column if not exists visit_id uuid null references public.visits(id) on delete set null;

comment on column public.activities.visit_id is
  'The accepted visit this activity happened during (§0.3). Cards select routes by visit '
  'IDENTITY, never by overlapping date.';

create index if not exists activities_visit_id_idx on public.activities(visit_id)
  where visit_id is not null;

-- ---------------------------------------------------------------------------
-- 2. 'bar' is a real place category; 'restaurant' already exists as 'dining'.
-- ---------------------------------------------------------------------------
insert into public.place_categories (slug, label, icon, color, review)
select 'bar', 'Bar', '', '#a855f7', 'Bar Reviews'
where not exists (select 1 from public.place_categories where slug = 'bar');

-- ---------------------------------------------------------------------------
-- 3. What the dropdown offers, and what each entry MEANS.
-- ---------------------------------------------------------------------------
create table if not exists public.activity_options (
  slug            text primary key,
  label           text not null,
  -- 'route' creates an activities row on this visit.
  -- 'place' creates a place inside this one, with its own visit.
  kind            text not null check (kind in ('route','place')),
  activity_type   text null,   -- kind='route': the activities.type to write
  place_category  text null,   -- kind='place': the place_categories.slug to tag
  sort            integer not null default 0,
  active          boolean not null default true,
  created_by      uuid null references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint activity_options_shape check (
    (kind = 'route' and activity_type is not null and place_category is null) or
    (kind = 'place' and place_category is not null and activity_type is null)
  )
);

comment on table public.activity_options is
  'The "+ Add an activity" dropdown (§0.6). A row per option, so "add a new activity '
  'type" can add one WITHOUT a deploy. The frontend must not hardcode this list.';

insert into public.activity_options (slug, label, kind, activity_type, place_category, sort) values
  ('run',        'Run',        'route', 'Run',   null,        10),
  ('walk',       'Walk',       'route', 'Walk',  null,        20),
  ('hike',       'Hike',       'route', 'Hike',  null,        30),
  ('bike',       'Bike',       'route', 'Ride',  null,        40),
  ('winery',     'Winery',     'place',  null,   'winery',    50),
  ('brewery',    'Brewery',    'place',  null,   'brewery',   60),
  ('restaurant', 'Restaurant', 'place',  null,   'dining',    70),
  ('bar',        'Bar',        'place',  null,   'bar',       80)
on conflict (slug) do nothing;

alter table public.activity_options enable row level security;

drop policy if exists activity_options_read on public.activity_options;
create policy activity_options_read on public.activity_options
  for select using (public.is_member());

-- Writes go through the RPC below, never straight from a browser (§0.3).
revoke all on public.activity_options from public, anon;
grant select on public.activity_options to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The RPCs the dropdown calls. Atomic, permission-checked, idempotent (§0.3).
-- ---------------------------------------------------------------------------

-- A route on this visit. `p_client_key` makes a retry after a dropped connection
-- return the SAME activity instead of a second one.
create or replace function public.add_activity_to_visit(
  p_visit       uuid,
  p_option      text,
  p_name        text default null,
  p_distance_m  double precision default null,
  p_client_key  text default null
) returns public.activities
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_opt   public.activity_options;
  v_visit public.visits;
  v_row   public.activities;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_opt from public.activity_options where slug = p_option and active;
  if v_opt.slug is null then raise exception 'unknown activity option: %', p_option; end if;
  if v_opt.kind <> 'route' then
    raise exception 'option % creates a place — call add_place_to_visit', p_option;
  end if;

  select * into v_visit from public.visits where id = p_visit;
  if v_visit.id is null then raise exception 'no such visit'; end if;

  -- Idempotent retry: same key, same visit, same activity.
  if p_client_key is not null then
    -- source_id is the table's EXISTING external-identity column (Strava and imports
    -- already use it). Reusing it beats adding a second idempotency key that half the
    -- writers would forget.
    select * into v_row from public.activities
     where visit_id = p_visit and source_id = p_client_key limit 1;
    if v_row.id is not null then return v_row; end if;
  end if;

  -- local_date is GENERATED from start_date (0143) — it cannot be written, and the
  -- generated value is the one that is correct west of Greenwich anyway.
  insert into public.activities (place_id, visit_id, type, name, distance, start_date,
                                 source, source_id, solo_profile)
  values (v_visit.place_id, p_visit, v_opt.activity_type,
          coalesce(p_name, v_opt.label), coalesce(p_distance_m, 0),
          v_visit.start_date::timestamptz,
          'manual', p_client_key, v_visit.solo_profile)
  returning * into v_row;

  return v_row;
end $function$;

-- A place inside this one — a restaurant, winery, brewery or bar — with its own first
-- visit on the same date. §0.6: "Never create a duplicate place merely to add it."
create or replace function public.add_place_to_visit(
  p_visit      uuid,
  p_option     text,
  p_name       text,
  p_lat        double precision default null,
  p_lng        double precision default null,
  p_client_key text default null
) returns public.places
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_opt    public.activity_options;
  v_visit  public.visits;
  v_parent public.places;
  v_place  public.places;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'a place needs a name'; end if;

  select * into v_opt from public.activity_options where slug = p_option and active;
  if v_opt.slug is null then raise exception 'unknown activity option: %', p_option; end if;
  if v_opt.kind <> 'place' then
    raise exception 'option % creates a route — call add_activity_to_visit', p_option;
  end if;

  select * into v_visit from public.visits where id = p_visit;
  if v_visit.id is null then raise exception 'no such visit'; end if;
  select * into v_parent from public.places where id = v_visit.place_id;

  -- Reuse an existing child of the same name before creating another one.
  select p.* into v_place
    from public.places p
    join public.place_membership m on m.child_id = p.id and m.parent_id = v_parent.id
   where lower(btrim(p.name)) = lower(btrim(p_name)) and p.deleted_at is null
   limit 1;

  if v_place.id is null then
    insert into public.places (name, lat, lng, saved, categories, created_by)
    values (btrim(p_name),
            coalesce(p_lat, v_parent.lat), coalesce(p_lng, v_parent.lng),
            true, array[v_opt.place_category], auth.uid())
    returning * into v_place;

    -- A place that now holds a child IS a container. The existing membership guard
    -- refuses a parent without holds_children, and it is right to: this is the flag
    -- that says the parent can hold things. Setting it here keeps the flag TRUE to
    -- the fact instead of leaving it to drift — the derived-vs-source bug that has
    -- bitten this project repeatedly (§8).
    update public.places set holds_children = true
     where id = v_parent.id and not coalesce(holds_children, false);

    -- place_membership is canonical (§0.3). part_of is still mirrored by its own
    -- trigger during the compatibility period; this writes the canonical side.
    insert into public.place_membership (child_id, parent_id, relationship_type)
    values (v_place.id, v_parent.id, 'contains')
    on conflict do nothing;
  end if;

  -- Its dates are visits to it — Erica's words. Same day as the parent visit.
  insert into public.visits (place_id, start_date, end_date, status, manual, source,
                             accepted_at, accepted_by, solo_profile, parent_visit_id)
  select v_place.id, v_visit.start_date, v_visit.end_date, 'taken', true, 'manual',
         now(), auth.uid(), v_visit.solo_profile,
         case when public.counts_as_trip(v_visit.*) then v_visit.id else null end
  where not exists (
    select 1 from public.visits x
     where x.place_id = v_place.id and x.start_date = v_visit.start_date
  );

  return v_place;
end $function$;

revoke all on function public.add_activity_to_visit(uuid, text, text, double precision, text)
  from public, anon;
grant execute on function public.add_activity_to_visit(uuid, text, text, double precision, text)
  to authenticated;
revoke all on function public.add_place_to_visit(uuid, text, text, double precision, double precision, text)
  from public, anon;
grant execute on function public.add_place_to_visit(uuid, text, text, double precision, double precision, text)
  to authenticated;

commit;
