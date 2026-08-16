-- 0196 — the readers actually enforce the Strava rule.
--
-- 0193 built the lock and fitted it to nothing. It added `can_see_activity()`, the
-- `visible_activities` view and a correct `activities_select` policy — and then not one
-- display reader used any of them. Of the 32 SECURITY DEFINER functions that read
-- `public.activities`, exactly ONE used the guard: `can_see_activity` itself.
--
-- SECURITY DEFINER BYPASSES RLS. That is the whole point of it, and it is why the policy
-- changed nothing a person could see. `mileage_by_person` is the plainest case: it is
-- SECURITY DEFINER, calls `assert_member()`, then selects straight from
-- `public.activities`. Any signed-in member could ask for the other's mileage and get it.
--
-- This file's own §"THE STRAVA RULE CANNOT BE DONE WITH RLS" predicted this exactly:
--
--     "A policy on the table would look correct in psql and change nothing in the app."
--
-- It was written, and the migration walked into it anyway. Writing a trap down does not
-- disarm it.
--
-- WHY A VIEW AND NOT A GUARD IN EACH FUNCTION. `visible_activities` has the same columns
-- as the table, so the change is `from public.activities` -> `from public.visible_activities`
-- and nothing else. A per-row `can_see_activity()` call in fifteen different WHERE clauses
-- is fifteen chances to write it slightly differently, and the one that is wrong is the one
-- nobody notices.
--
-- MACHINE JOBS DO NOT GET THE VIEW, AND THIS IS THE SUBTLE PART. The view filters on
-- `auth.uid()`, which is NULL for pg_cron and every trigger. A rebuild that read it would
-- silently process only non-Strava rows and quietly corrupt what it rebuilt. So
-- `rebuild_place_visits`, `recompute_place_stats`, `rebuild_revealed_area`,
-- `dedupe_shared_outings`, `dedupe_joint_outings` and `apply_inbox_field` keep reading the
-- TABLE. They compute facts; they do not show anything to anyone.
--
-- TWO READERS ARE DELIBERATELY UNCHANGED:
--
--   * `shared_outings` was already right, and is the model the rest now follow. It counts
--     only activities carrying the caller's own `activity_profiles` row, and returns
--     `restricted_rows` — an honest "there are N more here we may not show you" instead of
--     a silently short number.
--   * `data_health` reports ROW COUNTS for diagnostics. A total is not an athlete's data,
--     and a health check that under-reports is a broken health check.
--
-- STILL NOT DONE AFTER THIS, recorded so it is not mistaken for finished:
--
--   1. The nine browser-callable WRITERS (`set_activity_solo`, `reassign_activity`,
--      `assign_activity_to_race`, `add_activity_to_visit`, `apply_naming_rule`,
--      `learn_rule`, `import_file_activity`, `move_visit_to_place`,
--      `group_duplicate_activities`) still accept an activity id without asking whether the
--      caller may see it. Mutating a row you cannot see is a smaller leak than reading it,
--      but it is one.
--   2. `rebuild_revealed_area` builds the fog-of-war map from ALL activities, including the
--      other person's Strava routes, and it runs as a machine so it cannot know who will
--      look. Fixing it means either a per-person revealed area or excluding Strava-origin
--      routes from the fog. That is a design decision, not a substitution — Erica's call.
--
-- ROLLBACK: every function below is `create or replace`; restoring the previous definition
-- restores the previous behaviour. No data is touched, no column added, no policy changed.

-- ---------------------------------------------------------------------------
-- activities_of_type — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activities_of_type(p_type text, p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, type text, name text, distance double precision, start_date timestamp with time zone, place_id uuid, place_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select a.id, a.type, a.name, a.distance, a.start_date, a.place_id, p.name
    from public.visible_activities a
    left join public.places p on p.id = a.place_id
   where a.type = p_type
     and case when p_profile is null
              then public.is_shared_activity(a.id)
              else exists (select 1 from public.activity_profiles ap
                            where ap.activity_id = a.id and ap.profile_id = p_profile) end
   order by a.start_date desc nulls last;
$function$;

-- ---------------------------------------------------------------------------
-- activity_lines — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activity_lines(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, place_id uuid, type text, summary_polyline text, owner_profile uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select a.id, a.place_id, a.type, a.summary_polyline, a.owner_profile
    from public.visible_activities a
   where a.summary_polyline is not null
     and case when p_profile is null
              then public.is_shared_activity(a.id)
              else exists (select 1 from public.activity_profiles ap
                            where ap.activity_id = a.id and ap.profile_id = p_profile) end;
$function$;

-- ---------------------------------------------------------------------------
-- card_view — 2 reads moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_view(p_place uuid DEFAULT NULL::uuid, p_visit uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_place  public.places;
  v_visit  public.visits;
  v_mode   text;
  v_edit   boolean := public.is_editor_or_owner();
  v_result jsonb;
begin
  perform public.assert_member();

  if p_visit is not null then
    select * into v_visit from public.visits where id = p_visit;
    if v_visit.id is null then raise exception 'no such visit'; end if;
    select * into v_place from public.places where id = v_visit.place_id;
    v_mode := 'visit';
  elsif p_place is not null then
    select * into v_place from public.places where id = p_place;
    if v_place.id is null then raise exception 'no such place'; end if;
    v_mode := case when coalesce(v_place.is_trail, false) then 'trail' else 'place' end;
  else
    raise exception 'card_view needs a place or a visit';
  end if;

  with
  -- A trail's visits include its sections'. Everywhere else it is just this place.
  scope as (
    select v_place.id as place_id
    union
    select m.child_id from public.place_membership m
     where v_mode = 'trail' and m.parent_id = v_place.id
  ),
  rows_v as (
    select av.*
      from public.accepted_visits av
     where (v_mode = 'visit' and av.id = v_visit.id)
        or (v_mode <> 'visit' and av.place_id in (select place_id from scope))
  ),
  visit_rows as (
    select r.id, r.place_id, r.start_date, r.end_date, r.note,
           r.is_trip_qualified, r.is_headline, r.parent_visit_id,
           case when v_mode = 'trail' and r.place_id <> v_place.id
                then (select p.name from public.places p where p.id = r.place_id) end as segment,
           coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                      order by pr.display_name)
                       from public.visit_profiles vp
                       join public.profiles pr on pr.id = vp.profile_id
                      where vp.visit_id = r.id), '[]'::jsonb) as people,
           -- BY visit_id, not by date (§0.1). place_visit_stats counted a photo for
           -- every visit at the place whose range covered its date.
           (select count(*) from public.photos ph
             where ph.visit_id = r.id and ph.deleted_at is null) as photos,
           (select count(*) from public.videos vd where vd.visit_id = r.id) as videos,
           (select count(*) from public.visible_activities a where a.visit_id = r.id) as routes,
           (select count(*) from public.visits c where c.parent_visit_id = r.id) as children,
           -- What is inside this visit, so "N places" and the list it opens are the
           -- same data. Previously one trip_contents call per trip.
           coalesce((select jsonb_agg(jsonb_build_object(
                              'visit_id', c.id, 'place_id', c.place_id,
                              'place_name', cp.name,
                              'start_date', c.start_date, 'end_date', c.end_date)
                            order by c.start_date, cp.name)
                       from public.visits c
                       join public.places cp on cp.id = c.place_id
                      where c.parent_visit_id = r.id
                        and cp.deleted_at is null), '[]'::jsonb) as contents
      from rows_v r
  ),
  route_rows as (
    select a.id, a.name, a.type, a.distance,
           coalesce(a.local_date, a.start_date::date) as day, a.summary_polyline,
           -- WHO DID IT, from the participant rows. The card read this off
           -- `activities.solo_profile`, which cannot say "Erica and Sam but not Josh" —
           -- one nullable column has exactly two states for a household of two, and no
           -- states at all for a household of three (§0.3).
           coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                      order by pr.display_name)
                       from public.activity_profiles ap
                       join public.profiles pr on pr.id = ap.profile_id
                      where ap.activity_id = a.id), '[]'::jsonb) as people
      from public.visible_activities a
     where a.visit_id in (select id from rows_v)
     order by coalesce(a.local_date, a.start_date::date) desc
  ),
  photo_rows as (
    select ph.id, coalesce(ph.local_date, ph.taken_at::date) as day, ph.caption
      from public.photos ph
     where ph.visit_id in (select id from rows_v) and ph.deleted_at is null
     order by coalesce(ph.local_date, ph.taken_at::date) desc
  ),
  member_rows as (
    select p.id, p.name, p.rating, coalesce(p.categories[1], 'place') as category
      from public.place_membership m
      join public.places p on p.id = m.child_id
     where m.parent_id = v_place.id and p.deleted_at is null
       and v_mode <> 'visit'
     order by p.name
  ),
  rating_rows as (
    select pr.display_name as name, r.profile_id, r.rating
      from public.place_ratings r
      join public.profiles pr on pr.id = r.profile_id
     where r.place_id = v_place.id
     order by pr.display_name
  )
  select jsonb_build_object(
    'version', 3,
    'mode', v_mode,
    'can_edit', v_edit,
    'place', jsonb_build_object(
       'id', v_place.id, 'name', v_place.name, 'address', v_place.address,
       'admin1', v_place.admin1, 'lat', v_place.lat, 'lng', v_place.lng,
       'is_trail', coalesce(v_place.is_trail, false),
       'cover_photo_id', v_place.cover_photo_id,
       'categories', coalesce(to_jsonb(v_place.categories), '[]'::jsonb)),
    'visit', case when v_mode = 'visit' then jsonb_build_object(
       'id', v_visit.id, 'start_date', v_visit.start_date, 'end_date', v_visit.end_date,
       'note', v_visit.note, 'trip_marked', v_visit.trip_marked,
       'parent_visit_id', v_visit.parent_visit_id) end,
    'ratings', coalesce((select jsonb_agg(to_jsonb(x)) from rating_rows x), '[]'::jsonb),
    'visits',  coalesce((select jsonb_agg(to_jsonb(x) order by x.start_date desc)
                           from visit_rows x), '[]'::jsonb),
    'routes',  coalesce((select jsonb_agg(to_jsonb(x)) from route_rows x), '[]'::jsonb),
    'photos',  coalesce((select jsonb_agg(to_jsonb(x)) from photo_rows x), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(to_jsonb(x)) from member_rows x), '[]'::jsonb),
    -- Computed from the very rows above, so a label cannot disagree with its list.
    'totals', jsonb_build_object(
       'visits',  (select count(*) from visit_rows),
       'trips',   (select count(*) from visit_rows where is_trip_qualified and is_headline),
       'photos',  (select count(*) from photo_rows),
       'videos',  (select coalesce(sum(videos), 0) from visit_rows),
       'routes',  (select count(*) from route_rows),
       'miles',   coalesce((select sum(distance) from route_rows), 0) / 1609.344,
       'members', (select count(*) from member_rows))
  ) into v_result;

  return v_result;
end $function$;

-- ---------------------------------------------------------------------------
-- climbing_stats — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.climbing_stats(p_profile uuid DEFAULT NULL::uuid)
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
       and (p_profile is null
            or exists (select 1 from public.activity_profiles ap
                        where ap.activity_id = a.id and ap.profile_id = p_profile))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select round(coalesce(sum(elevation_gain),0)*3.28084)::int,
         round((coalesce(sum(elevation_gain),0)/8848.86)::numeric,2)::float
    from qa;
$function$;

-- ---------------------------------------------------------------------------
-- inbox — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inbox(p_limit integer DEFAULT 25, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select coalesce(jsonb_agg(c.card order by c.newest desc), '[]'::jsonb)
  from (
    select
      g.group_key,
      max(g.created_at) as newest,
      split_part(g.group_key, ':', 1) as kind,
      nullif(split_part(g.group_key, ':', 2), '')::uuid as subject
    from public.suggestions g
    where g.status = 'pending'
      and (p_cursor is null or g.created_at < p_cursor)
    group by g.group_key
    order by max(g.created_at) desc
    limit greatest(1, least(100, p_limit))
  ) gk
  cross join lateral (
    select jsonb_build_object(
      'group_key',    gk.group_key,
      'subject_type', case when gk.kind = 'visit' then 'visit' else 'activity' end,
      'subject_id',   gk.subject::text,
      'created_at',   gk.newest,
      'activity',     case when gk.kind = 'activity' then (
                        select jsonb_build_object(
                                 'name', a.name, 'type', a.type, 'distance', a.distance,
                                 'start_date', a.start_date, 'place', p.name)
                          from public.visible_activities a
                          left join public.places p on p.id = a.place_id
                         where a.id = gk.subject) end,
      'visit',        case when gk.kind = 'visit' then (
                        select jsonb_build_object(
                                 'place', p.name, 'start_date', v.start_date,
                                 'end_date', v.end_date)
                          from public.visits v
                          left join public.places p on p.id = v.place_id
                         where v.id = gk.subject) end,
      -- Naming-style options (one field, ranked choices).
      'fields',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'field', s.field, 'label', s.label,
                   'proposed', s.proposed_value, 'current', s.current_value,
                   'source', s.source, 'confidence', s.confidence,
                   'evidence', s.evidence, 'rank', s.rank)
                 order by s.field, s.rank)
          from public.suggestions s
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type <> 'photo'), '[]'::jsonb),
      -- Photo candidates (many subjects, one per photo).
      'photos',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'photo_id', s.subject_id::text,
                   'confidence', s.confidence,
                   'distance_m', (s.evidence ->> 'distance_m')::int,
                   'local_date', s.evidence ->> 'local_date',
                   'taken_at', ph.taken_at)
                 order by (s.evidence ->> 'distance_m')::int)
          from public.suggestions s
          join public.photos ph on ph.id = s.subject_id
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type = 'photo' and ph.deleted_at is null), '[]'::jsonb)
    ) as card, gk.newest
  ) c;
$function$;

-- ---------------------------------------------------------------------------
-- match_photo — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_photo(p_taken_at timestamp with time zone, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS TABLE(place_id uuid, name text, meters double precision, reason text, score double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select auth.uid() as uid),
  photo as (
    select
      p_taken_at as t,
      case
        when p_lat is not null and p_lng is not null
        then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
      end as g
  ),
  near_ping as (
    select lp.geom as pg, abs(extract(epoch from (lp.recorded_at - photo.t))) as dt
    from location_pings lp, photo, me
    where photo.t is not null
      and lp.profile_id = me.uid
      and lp.recorded_at between photo.t - interval '3 hours' and photo.t + interval '3 hours'
    order by dt asc
    limit 1
  ),
  cand as (
    select pl.id, pl.name,
           st_distance(pl.geom, photo.g) as meters,
           'photo location'::text as reason,
           greatest(0, 100 - st_distance(pl.geom, photo.g) / 30) as score
    from places pl, photo, me
    where photo.g is not null and pl.geom is not null
      and (pl.saved or pl.created_by = me.uid)
      and st_dwithin(pl.geom, photo.g, 5000)

    union all
    select pl.id, pl.name,
           st_distance(pl.geom, np.pg) as meters,
           'you were here then'::text as reason,
           greatest(0, 95 - st_distance(pl.geom, np.pg) / 40 - np.dt / 900) as score
    from places pl, near_ping np, me
    where (pl.saved or pl.created_by = me.uid) and pl.geom is not null
      and st_dwithin(pl.geom, np.pg, 5000)

    union all
    select pl.id, pl.name,
           0::double precision as meters,
           ('same time as ' || coalesce(a.name, a.type))::text as reason,
           greatest(0, 85 - abs(extract(epoch from (a.start_date - photo.t))) / 3600) as score
    from public.visible_activities a
    join places pl on pl.id = a.place_id, photo, me
    where a.place_id is not null and a.start_date is not null and photo.t is not null
      and a.start_date between photo.t - interval '6 hours' and photo.t + interval '6 hours'
      and (exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id and ap.profile_id = me.uid)
           or a.owner_profile = me.uid
           or me.uid = any(coalesce(a.also_profiles, '{}'::uuid[])))

    union all
    select pl.id, pl.name,
           0::double precision as meters,
           'on your visit dates'::text as reason,
           55::double precision as score
    from places pl, photo, me
    where photo.t is not null and pl.first_visit is not null
      and (pl.saved or pl.created_by = me.uid)
      and photo.t::date between pl.first_visit - 1
                            and coalesce(pl.last_visit, pl.first_visit) + 1
  )
  select place_id, name, meters, reason, score
  from (
    select distinct on (c.id)
      c.id as place_id, c.name, c.meters, c.reason, c.score
    from cand c
    order by c.id, c.score desc
  ) best
  where public.is_member()
  order by score desc
  limit 6;
$function$;

-- ---------------------------------------------------------------------------
-- mileage_by_person — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mileage_by_person(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(type text, activity_count bigint, meters double precision, miles numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once: the same run recorded by two people shares a
    -- shared_group_id (0140/0141).
    select distinct on (coalesce(a.shared_group_id, a.id)) a.type, a.distance
      from public.visible_activities a
     where case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$function$;

-- ---------------------------------------------------------------------------
-- place_days — 2 reads moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_days(p_place uuid)
 RETURNS TABLE(day date, activities integer, entries integer, photos integer, pings integer, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with d as (
    select start_date::date as day, 'a' as kind
      from public.visible_activities where place_id = p_place and start_date is not null
    union all
    select date, 'e' from public.entries where place_id = p_place and date is not null
    union all
    select taken_at::date, 'p' from public.photos where place_id = p_place and deleted_at is null and taken_at is not null
    union all
    select recorded_at::date, 'g'
      from public.location_pings where place_id = p_place
  ),
  grouped as (
    select
      day,
      count(*) filter (where kind = 'a')::int as activities,
      count(*) filter (where kind = 'e')::int as entries,
      count(*) filter (where kind = 'p')::int as photos,
      count(*) filter (where kind = 'g')::int as pings
    from d group by day
  )
  select
    g.*,
    (select a.name from public.visible_activities a
       where a.place_id = p_place and a.start_date::date = g.day and a.name is not null
       order by a.start_date desc limit 1) as label
  from grouped g
  order by g.day desc;
$function$;

-- ---------------------------------------------------------------------------
-- place_people — 2 reads moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_people()
 RETURNS TABLE(place_id uuid, profile_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select id, created_by from places where created_by is not null
  union
  select place_id, owner_profile from public.visible_activities where place_id is not null and owner_profile is not null
  union
  select a.place_id, unnest(a.also_profiles) from public.visible_activities a
    where a.place_id is not null and array_length(a.also_profiles, 1) is not null
  union
  select place_id, uploaded_by from photos where place_id is not null and uploaded_by is not null
$function$;

-- ---------------------------------------------------------------------------
-- race_stats — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.race_stats(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket text, n integer, miles double precision, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select b.bucket, count(*)::int as n, coalesce(sum(a.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from public.visible_activities a
  join public.places p on p.id = a.place_id
  cross join lateral (select public.race_bucket(a.distance/1609.344) as bucket) b
  where (a.is_race or p.categories @> array['race'])
    and case when p_profile is null
             then public.is_shared_activity(a.id)
             else exists (select 1 from public.activity_profiles ap
                           where ap.activity_id = a.id and ap.profile_id = p_profile) end
  group by b.bucket
  order by ord;
$function$;

-- ---------------------------------------------------------------------------
-- races_list — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.races_list(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, times integer, miles double precision, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select p.id, p.name, count(a.*)::int as times,
    coalesce(sum(a.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(a.distance),0)/1609.344) / nullif(count(a.*),0)) as bucket
  from public.places p
  join public.visible_activities a on a.place_id = p.id
  where (a.is_race or p.categories @> array['race'])
    and case when p_profile is null
             then public.is_shared_activity(a.id)
             else exists (select 1 from public.activity_profiles ap
                           where ap.activity_id = a.id and ap.profile_id = p_profile) end
  group by p.id, p.name
  having count(a.*) > 0
  order by p.name;
$function$;

-- ---------------------------------------------------------------------------
-- rule_offer — 2 reads moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rule_offer(p_activity uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lat double precision; v_lng double precision; v_name text; v_pt geography;
  v_n int; v_radius constant int := 1500;
begin
  perform public.assert_member();

  select a.lat, a.lng, btrim(a.name) into v_lat, v_lng, v_name
    from public.visible_activities a where a.id = p_activity;
  if v_lat is null or v_lng is null or coalesce(v_name,'') = '' then
    return jsonb_build_object('offer', false);
  end if;
  v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;

  -- Already covered by a rule? Then there is nothing to offer.
  if exists (
    select 1 from public.naming_rules r
     where r.auto_apply and r.name = v_name and r.center is not null
       and st_dwithin(r.center, v_pt, r.radius_m)) then
    return jsonb_build_object('offer', false, 'reason', 'already a rule');
  end if;

  -- How many activities near here has she APPROVED this same name for?
  select count(*) into v_n
    from public.visible_activities a
    join public.approved_fields af
      on af.subject_type = 'activity' and af.subject_id = a.id and af.field = 'name'
   where btrim(a.name) = v_name
     and a.geom is not null
     and st_dwithin(a.geom, v_pt, v_radius);

  return jsonb_build_object(
    'offer', v_n >= 3, 'name', v_name, 'learned_from', v_n, 'radius_m', v_radius);
end
$function$;

-- ---------------------------------------------------------------------------
-- visit_detail — 2 reads moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visit_detail(p_visit uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select jsonb_build_object(
    'visit', to_jsonb(v) - 'geom',
    -- WHO WAS THERE, as rows. The page read `visit.solo_profile`, which can say one
    -- person or everybody and nothing in between (§0.3).
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                         order by pr.display_name)
                          from public.visit_profiles vp
                          join public.profiles pr on pr.id = vp.profile_id
                         where vp.visit_id = v.id), '[]'::jsonb),
    'place', jsonb_build_object(
        'id', p.id, 'name', p.name, 'admin1', p.admin1, 'country', p.country,
        'address', p.address, 'lat', p.lat, 'lng', p.lng, 'is_trail', p.is_trail),
    -- The activities OF THIS VISIT. activities.visit_id has held the answer since 0164;
    -- this used to re-derive it from dates and the place, and got it wrong whenever two
    -- visits to one place shared a day.
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'type', a.type, 'distance', a.distance,
               'elevation_gain', a.elevation_gain, 'moving_time', a.moving_time,
               'local_date', a.local_date, 'start_date', a.start_date,
               'place_id', a.place_id,
               'people', coalesce((select jsonb_agg(pr.display_name order by pr.display_name)
                                     from public.activity_profiles ap
                                     join public.profiles pr on pr.id = ap.profile_id
                                    where ap.activity_id = a.id), '[]'::jsonb))
               order by a.start_date)
        from public.visible_activities a
       where a.visit_id = v.id
         -- one row per outing: a duplicate recorded twice is still one thing you did
         and a.id = (select a2.id from public.visible_activities a2
                      where coalesce(a2.shared_group_id, a2.id) = coalesce(a.shared_group_id, a.id)
                      order by (a2.summary_polyline is not null) desc,
                               (a2.source = 'strava') desc, a2.id
                      limit 1)), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'taken_at', ph.taken_at, 'local_date', ph.local_date,
               'caption', ph.caption, 'pinned', coalesce(ph.visit_id = v.id, false))
               order by ph.taken_at)
        from public.photos ph
       where ph.deleted_at is null
         and (ph.visit_id = v.id
              or (ph.visit_id is null and ph.place_id = v.place_id
                  and coalesce(ph.local_date, ph.taken_at::date)
                      between v.start_date and v.end_date))), '[]'::jsonb),
    -- What is inside this trip. `counts_as_trip`, not raw is_trip: a multi-day visit is
    -- a trip whether or not anyone marked it (§0.4), and its contents should show.
    'contents', case when public.counts_as_trip(v.*) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'place_id', c.place_id, 'place_name', c.place_name,
               'visit_id', c.visit_id, 'start_date', c.start_date, 'end_date', c.end_date)
               order by c.start_date)
        from public.trip_contents(v.id) c), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.visits v
  join public.places p on p.id = v.place_id
  where v.id = p_visit;
$function$;

-- ---------------------------------------------------------------------------
-- wander_stats — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wander_stats(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(places_count integer, miles double precision, trips_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with qv as (
    select av.id, av.place_id, av.is_trip_qualified, av.is_headline
      from public.accepted_visits av
     where case
             when p_profile is null then public.is_shared_visit(av.id)
             else exists (select 1 from public.visit_profiles vp
                           where vp.visit_id = av.id and vp.profile_id = p_profile)
           end
  ),
  qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.visible_activities a
     where a.place_id is not null
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place
        and p.deleted_at is null)                                  as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    (select count(*)::int from qv
      where qv.is_trip_qualified and qv.is_headline)               as trips_count;
$function$;

-- ---------------------------------------------------------------------------
-- wrapped_year_miles — 1 read moved to the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wrapped_year_miles(p_year integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(shared_group_id, id)) distance
      from public.visible_activities
     where start_date >= make_date(p_year, 1, 1)
       and start_date <  make_date(p_year + 1, 1, 1)
     order by coalesce(shared_group_id, id), id
  )
  select round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon;
$function$;
