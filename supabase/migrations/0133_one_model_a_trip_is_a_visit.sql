-- 0133 — One model: a place counts once, a visit counts every time, and a trip is
-- a visit you marked. (Place-model, Slices 1 and 2.)
--
-- Erica: "previously we discussed making Everything a place. A trip would be a visit
-- to that place over a number of days, and a trip would be identified when I created
-- it and marked it a trip, or when I marked an existing card as a trip."
--
-- WHY THIS KEEPS COMING BACK — the actual mechanism, not a guess.
-- THREE models were live at once, each authoritative in some document:
--   * ADR 0001 (accepted 2026-07-29): a trip is a first-class `trips` row, NOT a place
--   * NewClaude.md (the spec): everything is a Place; a trip is a non-counting rollup
--   * what Erica actually wants: a trip is a VISIT she marked as one
-- So each session picked a different one and undid the last.
--
-- And migration 0127's data fix could not hold, because `sync_place_category` has
--     when NEW.categories @> array['trip'] then 'trip'
-- as its SECOND branch. 0127 cleared the category on those rows; every later UPDATE
-- re-derived it straight back from `categories[]`. Measured today: Cape Cod, Rehoboth
-- Beach and West Palm Beach had all returned to category='trip', and therefore back
-- to counts_as_place = false — Cape Cod holds 10 photos and a real visit and counted
-- as NOTHING. That is the "I keep having to redo the same work" loop, in one trigger.
--
-- So this migration removes the CONCEPT, not the rows. There is no 'trip' category to
-- come back to.
--
-- THE MODEL FROM HERE
--   PLACE    counts once, ever. Every real thing: city, region, restaurant, beach,
--            trail, destination. counts_as_place = NOT is_trail — only a trail is a
--            pure rollup (a sum of segments that already counted). A destination
--            ALWAYS counts.
--   VISIT    counts every time. Dates + attribution + is_trip.
--            A trip IS a visit spanning days that a PERSON marked. Nothing automatic
--            ever sets is_trip, so nothing can regenerate behind her.
--   EVIDENCE photos and activities hang off the visit. (Display half is Slice 3.)
--
-- Stats read straight off that: Places = counting places with a qualifying visit;
-- Visits = visit rows; Trips = visits where is_trip.

-- ─────────────────────────────────────────── A. visits carry the trip flag
--
-- THE SECOND HALF OF THE ROOT CAUSE. `visits.is_trip` already existed — since
-- migration 0047 — as a GENERATED column:
--     is_trip boolean generated always as (end_date > start_date) stored
-- So the database has been deciding, on its own, that ANY visit longer than one day
-- IS a trip. That is the exact opposite of "a trip is identified when I created it
-- and marked it a trip". Measured live: 50 of 485 visits are flagged trips this way
-- and Erica marked none of them; PlacePanel already prints "· Trip" on each.
-- Brewster's 2-day stay was auto-promoted to a trip by arithmetic.
--
-- It becomes an ordinary column that only a person sets. Nothing derives it from
-- duration, so a long weekend is not silently a trip and marking one is permanent.
alter table public.visits drop column if exists is_trip;

alter table public.visits
  add column is_trip boolean not null default false,
  add column if not exists status text not null default 'taken';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visits_status_check') then
    alter table public.visits
      add constraint visits_status_check check (status in ('taken','planned'));
  end if;
end $$;

comment on column public.visits.is_trip is
  'A person marked this visit as a trip. NEVER set by automation. The Trips statistic counts these.';
comment on column public.visits.status is
  'taken = it happened; planned = a future-dated trip not yet taken.';

-- ─────────────────────────────── B. the trip category cannot be derived any more
create or replace function public.sync_place_category()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- NOTE: there is deliberately NO 'trip' branch. A trip is a visit (0133), not a
  -- place category. Re-adding one here silently un-counts every destination it
  -- touches, which is exactly the bug this migration removes.
  NEW.category := case
    when NEW.is_trail then 'trail'
    when NEW.categories @> array['city'] then 'city'
    when NEW.categories @> array['region'] then 'region'
    when NEW.category is not null and NEW.category <> 'trip' then NEW.category
    when coalesce(array_length(NEW.categories,1),0) > 0 then NEW.categories[1]
    when coalesce(array_length(NEW.activity_categories,1),0) > 0 then NEW.activity_categories[1]
    else null end;
  NEW.holds_children := coalesce(NEW.category in ('trail','city','region'), false);
  NEW.kind := case when NEW.holds_children then 'container' else 'leaf' end;
  return NEW;
end $function$;

-- Strip the retired tag everywhere, then let the trigger re-derive honestly.
update public.places
   set categories = array_remove(categories, 'trip')
 where categories @> array['trip'];

update public.places set category = null where category = 'trip';

-- ────────────────────────────── C. only a trail is a rollup; destinations count
alter table public.places drop column if exists counts_as_place;
alter table public.places
  add column counts_as_place boolean
  generated always as (not coalesce(is_trail, false)) stored;

comment on column public.places.counts_as_place is
  'Every place counts once except a trail, which is a rollup of segments that already counted. Trips are visits, so they never appear here.';

-- ───────────────────────────────── D. the 8 canonical trips become trip visits
do $$
declare
  t record;
  v_dest uuid;
  v_visit uuid;
  v_status text;
  v_solo uuid;
  v_cutoff constant date := '2025-12-21';
  v_erica uuid := (select id from public.profiles where role = 'owner'
                    and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_made int := 0; v_flagged int := 0; v_skipped int := 0;
begin
  for t in select * from public.trips order by start_date nulls last, id loop
    -- Where the trip went: its origin place if it has one, else its first stop.
    v_dest := t.source_place_id;
    if v_dest is null then
      select s.place_id into v_dest
        from public.trip_stops s
        join public.places p on p.id = s.place_id
       where s.trip_id = t.id
       order by coalesce(p.holds_children, false) desc, s.ctid
       limit 1;
    end if;

    if v_dest is null or t.start_date is null or t.end_date is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_status := case when t.status = 'upcoming' then 'planned' else 'taken' end;
    v_solo := case when t.start_date < v_cutoff then v_erica else null end;

    -- Reuse the visit that already covers this window rather than adding a second
    -- one — the destination usually already has a visit from its photos.
    select v.id into v_visit
      from public.visits v
     where v.place_id = v_dest
       and v.start_date <= t.end_date
       and v.end_date   >= t.start_date
     order by (v.end_date - v.start_date) desc
     limit 1;

    if v_visit is not null then
      update public.visits
         set is_trip = true,
             manual  = true,                       -- survives rebuild_place_visits
             status  = v_status,
             start_date = least(start_date, t.start_date),
             end_date   = greatest(end_date, t.end_date)
       where id = v_visit;
      v_flagged := v_flagged + 1;
    else
      insert into public.visits (place_id, start_date, end_date, manual, is_trip, status, solo_profile, solo_override)
      values (v_dest, t.start_date, t.end_date, true, true, v_status, v_solo, false);
      v_made := v_made + 1;
    end if;

    -- Every stop becomes a place held by the destination. part_of is what the
    -- membership trigger mirrors, so write through it.
    update public.places p
       set part_of = array(select distinct x from unnest(p.part_of || v_dest) x)
     where p.id in (select s.place_id from public.trip_stops s where s.trip_id = t.id)
       and p.id <> v_dest
       and not (v_dest = any(p.part_of));

    perform public.recompute_place_stats(v_dest);
  end loop;

  raise notice '0133: % trip visits created, % existing visits marked as trips, % trips skipped (no destination or dates)',
    v_made, v_flagged, v_skipped;
end $$;

-- ─────────────────────────────── E. the Trips statistic counts trip visits
-- Supersedes 0132, which counted rows in `trips`. Same view rule as every other stat.
create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count integer, miles double precision, trips_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qv as (
    select v.place_id, v.is_trip
      from public.visits v
     where case when p_profile is null
                then v.solo_profile is null
                else (v.solo_profile is null or v.solo_profile = p_profile) end
       and v.status = 'taken'
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place)                                              as places_count,
    (select coalesce(sum(a.distance),0)/1609.344
       from public.activities a
      where a.place_id is not null
        and case when p_profile is null
                 then a.solo_profile is null
                 else (a.solo_profile is null or a.solo_profile = p_profile) end)
                                                                            as miles,
    -- a trip counts EVERY time: two stays in San Diego are two trips
    (select count(*)::int from qv where qv.is_trip)                         as trips_count;
$function$;

-- Mark a visit as a trip, or unmark it. The ONLY way is_trip is ever set.
create or replace function public.set_visit_is_trip(p_visit uuid, p_is_trip boolean)
returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.visits
     set is_trip = coalesce(p_is_trip, false),
         manual  = case when p_is_trip then true else manual end
   where id = p_visit
  returning * into v_row;

  if v_row.id is null then raise exception 'visit % not found', p_visit; end if;
  perform public.recompute_place_stats(v_row.place_id);
  return v_row;
end $function$;

revoke all on function public.set_visit_is_trip(uuid, boolean) from public;
revoke all on function public.set_visit_is_trip(uuid, boolean) from anon;
grant execute on function public.set_visit_is_trip(uuid, boolean) to authenticated;
grant execute on function public.set_visit_is_trip(uuid, boolean) to service_role;

-- Refresh every place whose counting status just changed.
do $$
declare r record;
begin
  for r in select id from public.places loop
    perform public.recompute_place_stats(r.id);
  end loop;
end $$;
