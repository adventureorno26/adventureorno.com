-- 0186 — §0.8 phase 8, step 3d: the last two screens get participants.
--
-- `solo_profile` cannot be dropped while anything reads it. After 0183 (the card) and
-- the client switch onto 0184's readers (the type lists and the map), three consumers
-- were left, all of them UI affordances asking "who was on this?":
--
--   VisitPage      the who-control, reading visit_detail's `visit.solo_profile`
--   PlacesEditor   the per-visit who-column, and the union of people at a place
--
-- `visit_detail` now returns the visit's participants alongside it, and
-- `place_visit_people` answers the same question for every visit at a place in one
-- request — PlacesEditor lists many places at once, so asking per visit would be a
-- request per row.
--
-- ROLLBACK: recreate visit_detail from 0173; drop place_visit_people.

begin;

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
               'place_id', a.place_id, 'solo_profile', a.solo_profile,
               'people', coalesce((select jsonb_agg(pr.display_name order by pr.display_name)
                                     from public.activity_profiles ap
                                     join public.profiles pr on pr.id = ap.profile_id
                                    where ap.activity_id = a.id), '[]'::jsonb))
               order by a.start_date)
        from public.activities a
       where a.visit_id = v.id
         -- one row per outing: a duplicate recorded twice is still one thing you did
         and a.id = (select a2.id from public.activities a2
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
$function$

;

create or replace function public.place_visit_people(p_place uuid)
returns table(visit_id uuid, profile_id uuid, display_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select vp.visit_id, vp.profile_id, pr.display_name
    from public.visits v
    join public.visit_profiles vp on vp.visit_id = v.id
    join public.profiles pr on pr.id = vp.profile_id
   where v.place_id = p_place
   order by vp.visit_id, pr.display_name;
$function$;

comment on function public.place_visit_people(uuid) is
  'Who was on each visit to this place, as rows. One request for a whole place, because '
  'the editor lists many at once and per-visit would be a request per row.';

do $$
declare f text;
begin
  foreach f in array array['visit_detail(uuid)','place_visit_people(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
