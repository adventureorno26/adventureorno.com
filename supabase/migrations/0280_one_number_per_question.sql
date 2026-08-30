-- 0280 — one number per question.
--
-- MEASURED ON PRODUCTION, 2026-08-30, signed in as Erica, at the same moment:
--
--     Settings ▸ Stats said  17 Trips        trips_list(null)
--     /insights      said    56 Trips        trips_list_for_people('{}', 'all')
--
-- Both were "right". `null` and "empty" are opposites across the two generations of stat
-- reader: the old one reads `p_profile is null` as *only the visits we were BOTH on*
-- (`is_shared_visit`), the new one reads an empty array as *no people filter at all*. Two
-- screens, one word, two questions — and the same trap in thirteen functions.
--
-- Given the SAME scope the two generations already agree exactly, which is what makes this
-- a wiring fault rather than an arithmetic one. Measured the same moment:
--
--     trips_list(erica)                           43
--     trips_list_for_people([erica-person],'all') 43   ← identical
--     trips_list(null)                            17   = Our Stats (Erica + Josh)
--     trips_list_for_people([erica,josh],'all')   17   ← identical
--
-- So nothing here changes what any number MEANS. It gives the four readers Settings ▸ Stats
-- still calls with a profile a people-aware sibling, exactly as 0260 and 0261 did for the
-- other nine, so that every stats surface can ask its question through one vocabulary:
--
--     settings_stats · geo_coverage · climbing_stats · peaks_bagged
--
-- THE OLD FOUR STAY. Dropping a database function is a separate and riskier change, and
-- `place_ids_for_view` / `place_visit_counts` / `wander_stats` / `trips_list` and the rest
-- of that generation are still what the 0260 equivalence test compares against. When they
-- go, they go together and with that test.
--
-- TWO OF THE FOUR ARE NOT LINE-FOR-LINE COPIES, and both differences are deliberate:
--
--   * `geo_coverage_for_people` scopes by the places you were ON A VISIT to — the very set
--     `place_ids_for_people` gives the map's markers. The old one scoped by
--     `place_people()`, which is "who TOUCHED this place record" (created it, uploaded a
--     photo to it, has an activity there). That is a different question, and it is why
--     Settings could report a state the map did not show a pin in.
--   * `peaks_bagged_for_people` scopes by the OUTING the peak was bagged on rather than by
--     `peak_bags.profile_id`. All 61 rows in production carry an activity_id and six carry
--     no profile_id at all; the old function handed those six to everybody. Whose outing it
--     was is a fact; a null is not.

-- ---------------------------------------------------------------------------
-- Places you have been, bucketed by what they are.
-- ---------------------------------------------------------------------------
create or replace function public.settings_stats_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(trails_taken bigint, camping bigint, dining bigint, winery bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with mine as (
    select distinct p.id, p.categories
      from public.places p
      join public.accepted_visits v on v.place_id = p.id
     where p.deleted_at is null
       and (coalesce(array_length(p_people, 1), 0) = 0
              or v.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                           where k.kind = 'visit'))
  )
  select
    (select count(*) from mine where categories && array['hiking','walking','running','biking'])::bigint,
    (select count(*) from mine where categories && array['camping'])::bigint,
    (select count(*) from mine where categories && array['dining'])::bigint,
    (select count(*) from mine where categories && array['winery'])::bigint;
$function$
;

-- ---------------------------------------------------------------------------
-- States and countries you have set foot in.
-- ---------------------------------------------------------------------------
create or replace function public.geo_coverage_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(us_states text[], us_state_count integer, countries text[], country_count integer, has_dc boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with base as (
    select p.admin1, p.country
      from public.places p
     where p.saved
       and not coalesce(p.bucket, false)
       and p.deleted_at is null
       and (coalesce(array_length(p_people, 1), 0) = 0
              or p.id in (select public.place_ids_for_people(p_people, p_mode)))
  ),
  us as (
    select distinct admin1 from base
     where country = 'United States' and admin1 is not null and admin1 <> 'District of Columbia'
  ),
  co as (select distinct country from base where country is not null)
  select (select array_agg(admin1 order by admin1) from us), (select count(*)::int from us),
         (select array_agg(country order by country) from co), (select count(*)::int from co),
         exists(select 1 from base where admin1 = 'District of Columbia');
$function$
;

-- ---------------------------------------------------------------------------
-- Vertical climbed. One outing counted once (§0.2) — the distinct-on is the point.
-- ---------------------------------------------------------------------------
create or replace function public.climbing_stats_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(total_ft integer, everests double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.elevation_gain
      from public.visible_activities a
     where a.elevation_gain is not null
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select round(coalesce(sum(elevation_gain),0)*3.28084)::int,
         round((coalesce(sum(elevation_gain),0)/8848.86)::numeric,2)::float
    from qa;
$function$
;

-- ---------------------------------------------------------------------------
-- Summits, scoped by the outing they were bagged on.
-- ---------------------------------------------------------------------------
create or replace function public.peaks_bagged_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(id uuid, name text, ele_ft integer, place_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select pk.id, pk.name, round(pk.ele_m * 3.28084)::int as ele_ft,
         (select pb.place_id from public.peak_bags pb
           where pb.peak_id = pk.id and pb.place_id is not null limit 1) as place_id
    from public.peaks pk
   where coalesce(array_length(p_people, 1), 0) = 0
      or exists (select 1
                   from public.peak_bags pb
                   join public.visible_activities a on a.id = pb.activity_id
                  where pb.peak_id = pk.id
                    and coalesce(a.shared_group_id, a.id) in
                          (select k.key from public.people_memory_keys(p_people, p_mode) k
                            where k.kind = 'outing'))
   order by pk.ele_m desc nulls last, pk.name;
$function$
;

-- A new SECURITY DEFINER function is granted to PUBLIC by default, which reaches `anon`.
revoke all on function public.settings_stats_for_people(uuid[], text) from public, anon;
grant execute on function public.settings_stats_for_people(uuid[], text) to authenticated;
revoke all on function public.geo_coverage_for_people(uuid[], text) from public, anon;
grant execute on function public.geo_coverage_for_people(uuid[], text) to authenticated;
revoke all on function public.climbing_stats_for_people(uuid[], text) from public, anon;
grant execute on function public.climbing_stats_for_people(uuid[], text) to authenticated;
revoke all on function public.peaks_bagged_for_people(uuid[], text) from public, anon;
grant execute on function public.peaks_bagged_for_people(uuid[], text) to authenticated;
