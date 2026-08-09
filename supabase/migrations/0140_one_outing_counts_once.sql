-- One outing counts once — however many times it was recorded.
--
-- Erica's 45-mile Purcellville→Arlington run on 2026-03-07 is stored THREE times:
-- her Strava record (45.1 mi), a file import of the same run (44.9 mi), and Josh's
-- record of the same run (44.7 mi). The headline mileage counted all three: 134.7
-- miles for one run.
--
-- Three distinct causes, one fix:
--   * the same person's outing imported twice (13 pairs)
--   * the same outing arriving from Strava AND a file (2 pairs)
--   * Erica and Josh each recording the outing they did together (2 pairs)
--
-- WHY TIME MATTERS: "same day" alone is not enough. On 2024-09-03 there is a
-- "Morning Walk" and an "Evening Walk", both 1.4 miles, twelve hours apart — two
-- real walks. The rule here is deliberately tight (same type, starts within 20
-- minutes, distance within 10%); anything looser is left alone for a human.
--
-- NOTHING IS DELETED. Duplicates are GROUPED via shared_group_id, which already
-- existed for exactly this and was unused on 438 of 444 rows. Every record stays,
-- and ungrouping restores the old behaviour. Pre-state:
-- supabase/snapshots/2026-08-08-activities-pre-dedupe.json

begin;

-- 1. THE GROUPER. Non-destructive: it only ever writes shared_group_id.
--    The survivor of a group is the richest record — a Strava row with a route
--    beats a bare file import — and ties break on the earliest start.
create or replace function public.group_duplicate_activities(
  p_minutes int default 20,
  p_pct numeric default 0.10,
  p_apply boolean default false
)
returns table(kept uuid, dropped uuid, kept_name text, dropped_name text,
              minutes_apart numeric, pct_diff numeric, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  create temp table _pairs on commit drop as
  select
    -- Richer record wins: a route beats no route, then Strava beats a file import,
    -- then the earlier start. Deterministic, so re-running changes nothing.
    case when (a.summary_polyline is not null, a.source = 'strava', -extract(epoch from a.start_date))
            >= (b.summary_polyline is not null, b.source = 'strava', -extract(epoch from b.start_date))
         then a.id else b.id end as keep_id,
    case when (a.summary_polyline is not null, a.source = 'strava', -extract(epoch from a.start_date))
            >= (b.summary_polyline is not null, b.source = 'strava', -extract(epoch from b.start_date))
         then b.id else a.id end as drop_id,
    round((abs(extract(epoch from (a.start_date - b.start_date)))/60)::numeric, 1) as mins,
    round((abs(a.distance - b.distance) / nullif(greatest(a.distance, b.distance),0) * 100)::numeric, 1) as pct,
    case when a.owner_profile is distinct from b.owner_profile then 'joint outing'
         when a.source is distinct from b.source              then 'same outing from two sources'
         else 'imported twice' end as why
  from public.activities a
  join public.activities b
    on a.id < b.id
   and a.type = b.type
   and a.distance > 0 and b.distance > 0
   and abs(extract(epoch from (a.start_date - b.start_date))) <= p_minutes * 60
   and abs(a.distance - b.distance) <= greatest(a.distance, b.distance) * p_pct;

  if p_apply then
    -- Assign every member of a duplicate chain the SAME group id, keyed on the
    -- survivor, so a three-way duplicate (this run) collapses to one group and not
    -- two overlapping pairs.
    update public.activities t
       set shared_group_id = coalesce(k.shared_group_id, k.id)
      from _pairs p
      join public.activities k on k.id = p.keep_id
     where t.id in (p.keep_id, p.drop_id);
  end if;

  return query
    select p.keep_id, p.drop_id, ka.name, da.name, p.mins, p.pct, p.why
      from _pairs p
      join public.activities ka on ka.id = p.keep_id
      join public.activities da on da.id = p.drop_id
     order by da.start_date;
end $function$;

revoke all on function public.group_duplicate_activities(int, numeric, boolean) from public;
revoke all on function public.group_duplicate_activities(int, numeric, boolean) from anon;
grant execute on function public.group_duplicate_activities(int, numeric, boolean) to authenticated;

-- 2. STOP THE NIGHTLY DELETE. dedupe_joint_outings runs at 04:20 every night and
--    ran `delete from public.activities` on the row it considered a duplicate.
--    Erica's standing rule is that nothing mass-deletes her data. Same name so the
--    existing cron entry keeps working; it groups now instead of deleting, and it
--    covers same-person duplicates too, which it never could before (it only ever
--    compared owner vs non-owner, and required both starts within 800 m — which is
--    why it never caught the March 7 run at all).
create or replace function public.dedupe_joint_outings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  select count(*) into v_n
    from public.group_duplicate_activities(20, 0.10, true);
  return v_n;
end $function$;

-- 3. COUNT A GROUP ONCE, EVERYWHERE. mileage_by_person, settings_stats and
--    wrapped_year_miles already deduped on shared_group_id — but wander_stats, the
--    HEADLINE miles on the map, did not, and neither did races or climbing. That
--    asymmetry is why the map total disagreed with the per-type breakdown.
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
  ),
  qa as (
    -- One row per OUTING, not per record: a group counts once.
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.activities a
     where a.place_id is not null
       and case when p_profile is null
                then a.solo_profile is null
                else (a.solo_profile is null or a.solo_profile = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place)                                     as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    -- a trip counts EVERY time: two stays in San Diego are two trips
    (select count(*)::int from qv where qv.is_trip)                as trips_count;
$function$;

create or replace function public.climbing_stats(p_profile uuid default null)
returns table(total_ft integer, everests double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qa as (
    select distinct on (coalesce(shared_group_id, id)) id, elevation_gain
      from public.activities
     where elevation_gain is not null
       and (p_profile is null or solo_profile is null or solo_profile = p_profile)
     order by coalesce(shared_group_id, id), id
  )
  select round(coalesce(sum(elevation_gain),0)*3.28084)::int,
         round((coalesce(sum(elevation_gain),0)/8848.86)::numeric,2)::float
    from qa;
$function$;

commit;
