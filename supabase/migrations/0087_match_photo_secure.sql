-- Security hardening of match_photo (was: SECURITY DEFINER, granted to all
-- authenticated, no is_member() check, searched EVERYONE's pings/activities).
-- Now: returns nothing to non-members, and only reads the CALLER's own movement
-- history + places the caller is allowed to see.

create or replace function public.match_photo(
  p_taken_at timestamptz,
  p_lat double precision default null,
  p_lng double precision default null
) returns table (
  place_id uuid,
  name text,
  meters double precision,
  reason text,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  photo as (
    select
      p_taken_at as t,
      case
        when p_lat is not null and p_lng is not null
        then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
      end as g
  ),
  -- The caller's OWN closest ping in time (within 3h).
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
    -- 1) The photo's own GPS near a place the caller can see.
    select pl.id, pl.name,
           st_distance(pl.geom, photo.g) as meters,
           'photo location'::text as reason,
           greatest(0, 100 - st_distance(pl.geom, photo.g) / 30) as score
    from places pl, photo, me
    where photo.g is not null and pl.geom is not null
      and (pl.saved or pl.created_by = me.uid)
      and st_dwithin(pl.geom, photo.g, 5000)

    union all
    -- 2) A ping of the caller's near the photo's time.
    select pl.id, pl.name,
           st_distance(pl.geom, np.pg) as meters,
           'you were here then'::text as reason,
           greatest(0, 95 - st_distance(pl.geom, np.pg) / 40 - np.dt / 900) as score
    from places pl, near_ping np, me
    where (pl.saved or pl.created_by = me.uid) and pl.geom is not null
      and st_dwithin(pl.geom, np.pg, 5000)

    union all
    -- 3) The caller's own Strava activity around that time, attached to a place.
    select pl.id, pl.name,
           0::double precision as meters,
           ('same time as ' || coalesce(a.name, a.type))::text as reason,
           greatest(0, 85 - abs(extract(epoch from (a.start_date - photo.t))) / 3600) as score
    from activities a
    join places pl on pl.id = a.place_id, photo, me
    where a.place_id is not null and a.start_date is not null and photo.t is not null
      and a.start_date between photo.t - interval '6 hours' and photo.t + interval '6 hours'
      and (a.solo_profile = me.uid or a.solo_profile is null
           or a.owner_profile = me.uid or me.uid = any(coalesce(a.also_profiles, '{}'::uuid[])))

    union all
    -- 4) The photo's date falls in a visible place's visit window.
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
$$;
