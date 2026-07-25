-- Timeline photo-matching engine.
--
-- Given a photo's timestamp (and optional GPS), propose the place it belongs to —
-- WITHOUT the user having to look up dates. It cross-references the photo's time
-- against the movement history we already store (location pings + Strava
-- activities) plus each place's visit window, so a photo with no GPS at all can
-- still be placed from "where were you at that moment".
--
-- Returns ranked candidate places, each with a plain-language reason and a score.

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
  with photo as (
    select
      p_taken_at as t,
      case
        when p_lat is not null and p_lng is not null
        then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
      end as g
  ),
  -- The single ping closest in time to the photo (within 3h) ≈ where you were.
  near_ping as (
    select lp.geom as pg,
           abs(extract(epoch from (lp.recorded_at - photo.t))) as dt
    from location_pings lp, photo
    where photo.t is not null
      and lp.recorded_at between photo.t - interval '3 hours' and photo.t + interval '3 hours'
    order by dt asc
    limit 1
  ),
  cand as (
    -- 1) The photo's OWN GPS lands near a saved place.
    select pl.id, pl.name,
           st_distance(pl.geom, photo.g) as meters,
           'photo location'::text as reason,
           greatest(0, 100 - st_distance(pl.geom, photo.g) / 30) as score
    from places pl, photo
    where photo.g is not null and pl.saved and pl.geom is not null
      and st_dwithin(pl.geom, photo.g, 5000)

    union all
    -- 2) A GPS ping near the photo's time puts you near a place (no photo GPS needed).
    select pl.id, pl.name,
           st_distance(pl.geom, np.pg) as meters,
           'you were here then'::text as reason,
           greatest(0, 95 - st_distance(pl.geom, np.pg) / 40 - np.dt / 900) as score
    from places pl, near_ping np
    where pl.saved and pl.geom is not null
      and st_dwithin(pl.geom, np.pg, 5000)

    union all
    -- 3) A Strava activity around that time is already attached to a place.
    select pl.id, pl.name,
           0::double precision as meters,
           ('same time as ' || coalesce(a.name, a.type))::text as reason,
           greatest(0, 85 - abs(extract(epoch from (a.start_date - photo.t))) / 3600) as score
    from activities a
    join places pl on pl.id = a.place_id, photo
    where a.place_id is not null and a.start_date is not null and photo.t is not null
      and a.start_date between photo.t - interval '6 hours' and photo.t + interval '6 hours'

    union all
    -- 4) The photo's date falls inside a place's visit window (loosest signal).
    select pl.id, pl.name,
           0::double precision as meters,
           'on your visit dates'::text as reason,
           55::double precision as score
    from places pl, photo
    where photo.t is not null and pl.saved and pl.first_visit is not null
      and photo.t::date between pl.first_visit - 1
                            and coalesce(pl.last_visit, pl.first_visit) + 1
  )
  -- Best reason per place, then best places first.
  select place_id, name, meters, reason, score
  from (
    select distinct on (c.id)
      c.id as place_id, c.name, c.meters, c.reason, c.score
    from cand c
    order by c.id, c.score desc
  ) best
  order by score desc
  limit 6;
$$;

grant execute on function public.match_photo(timestamptz, double precision, double precision)
  to authenticated;
