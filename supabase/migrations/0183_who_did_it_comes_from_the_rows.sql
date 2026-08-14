-- 0183 — §0.8 phase 8, step 3a: the card reads WHO from the participant rows.
--
-- Step 3 removes `solo_profile` from `visits` and `activities`. It cannot be dropped
-- while the card still reads it, so the frontend moves first — this migration gives it
-- the replacement.
--
-- WHY THE COLUMN HAS TO GO, beyond tidiness. `solo_profile uuid NULL` has exactly two
-- meanings: "this one person" or "everybody". For a household of two that is enough by
-- accident. For three it cannot express "Erica and Sam but not Josh" AT ALL — there is
-- no value that means it. Every statistic in the app is scoped by that column, so the
-- limit is not cosmetic: it is the reason a third person cannot meaningfully join, which
-- is the entire point of the flok work.
--
-- `card_view` already returns `people` for each VISIT row. It did not for each ROUTE,
-- so `PlacePanel` still read `activities.solo_profile` directly for the who-control on
-- an activity row. Now it does, and the card has no reason to look at either column.
--
-- Parity is already proven and was measured again before this: participant rows and the
-- column disagree on ZERO visits and ZERO activities.
--
-- `version` goes to 3 so a stale client can tell.
--
-- ROLLBACK: recreate card_view from 0177.

begin;

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
           (select count(*) from public.activities a where a.visit_id = r.id) as routes,
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
      from public.activities a
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
end $function$

;

comment on function public.card_view(uuid, uuid) is
  'THE card read model (§0.6), version 3. Every row carries its own participants from '
  'visit_profiles/activity_profiles — never from a nullable solo_profile, which can '
  'only ever mean "one person" or "everyone" and cannot describe three.';

revoke all on function public.card_view(uuid, uuid) from public, anon;
grant execute on function public.card_view(uuid, uuid) to authenticated;

commit;
