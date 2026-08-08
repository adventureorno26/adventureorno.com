-- 0132 — The Trips number comes from the Trips table.
--
-- Erica: "Trips should come from the Trip table."
--
-- THE BUG, measured live. `wander_stats` counted trips as
--     select count(distinct p.id) from places p ... where p.category = 'trip'
-- i.e. it counted PLACES carrying a legacy category. Migration 0127 reclassified
-- every one of those into a counting destination (region/city), so the number
-- collapsed: the stats bar reported 1 trip while the canonical `trips` table held 8.
-- This is the same defect as Barbados reading "0 visits" — a count derived from a
-- retired place category instead of from the real table.
--
-- THE RULE. Trips are first-class rows in `trips` (ADR 0001), so count those. The
-- view filter matches every other statistic: a trip belongs to a view when any stop
-- on it has a visit that qualifies for that view.
--     p_profile IS NULL -> visits attributed to BOTH (solo_profile is null)
--     otherwise         -> that person's visits PLUS Both
-- Measured against live data: all 8 trips / Both 7 / Erica 8 / Josh 7, and zero
-- trips have no qualifying visit, so nothing silently drops out of every view.
--
-- places_count and miles are unchanged.

create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count integer, miles double precision, trips_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qv as (   -- qualifying visits for this view
    select v.place_id, v.start_date, v.end_date
    from public.visits v
    where case when p_profile is null
               then v.solo_profile is null
               else (v.solo_profile is null or v.solo_profile = p_profile) end
  )
  select
    -- places: distinct counting places that have a qualifying visit, each once
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place)                                              as places_count,
    -- miles: activity distance attributed through its own visit's view
    (select coalesce(sum(a.distance),0)/1609.344
       from public.activities a
      where a.place_id is not null
        and case when p_profile is null
                 then a.solo_profile is null
                 else (a.solo_profile is null or a.solo_profile = p_profile) end)
                                                                            as miles,
    -- trips: real trips, from the trips table, visible in this view
    (select count(*)::int
       from public.trips t
      where exists (
        select 1
          from public.trip_stops s
          join qv on qv.place_id = s.place_id
         where s.trip_id = t.id
           and (t.start_date is null or t.end_date is null
                or (qv.start_date <= t.end_date and qv.end_date >= t.start_date))
      ))                                                                    as trips_count;
$function$;

-- `confirm_suggested_trip` filtered on `category = 'trip'`, which after 0127 matches
-- essentially nothing — confirming a suggested trip found no row and silently did
-- nothing. A suggested trip place is identified by `suggested`, not by the retired
-- category, so match on that instead.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_suggested_trip'
   limit 1;

  if v_def is null then return; end if;

  -- Accept a suggested place regardless of which category era it was created in.
  v_def := replace(v_def,
    'where id = p_place and category = ''trip'' and deleted_at is null',
    'where id = p_place and (suggested or category = ''trip'') and deleted_at is null');

  execute v_def;
end $$;
