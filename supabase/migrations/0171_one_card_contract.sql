-- 0171 — §0.6. ONE read model for the card, whichever mode it is in.
--
-- "Add a versioned experience_card/visit_card read RPC or equivalent typed query
--  returning the complete mode-specific view model. Avoid dozens of browser requests and
--  frontend joins. Header totals and list rows come from the same returned dataset so
--  labels cannot disagree. Every row has stable IDs and explicit can_edit."
--
-- WHY THE HEADER AND THE ROWS MUST COME FROM ONE PAYLOAD. Today the card asks for its
-- visits, its photos, its activities, its members and its stats separately, then counts
-- some of them again in JSX. That is how a card ends up saying "Visits (1)" above a list
-- of two, and it is why the trail said 32 while its sections held 30 more. One query, one
-- answer, and the count is `jsonb_array_length` of the very rows underneath it.
--
-- MODE is derived, not passed: a visit id means the visit card, a trail place means the
-- trail card, any other place means the destination card. The caller cannot ask for a
-- mode that contradicts the data.
--
-- EVERYTHING COUNTS THE CANONICAL WAY. Visits come from `accepted_visits`, trips from
-- `counts_as_trip`, participants from `visit_profiles`, membership from
-- `place_membership`, routes from `activities.visit_id`. No date-overlap inference
-- anywhere (§0.1).
--
-- `version` is in the payload so a stale client can tell it is stale.
--
-- ROLLBACK: drop function public.card_view(uuid, uuid).

begin;

create or replace function public.card_view(
  p_place uuid default null,
  p_visit uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
  -- One row per visit, carrying who was there, what it holds, and where.
  visit_rows as (
    select r.id, r.place_id, r.start_date, r.end_date, r.note,
           r.is_trip_qualified, r.is_headline, r.parent_visit_id,
           -- the SEGMENT NAME on a trail card: the section this visit was logged at
           case when v_mode = 'trail' and r.place_id <> v_place.id
                then (select p.name from public.places p where p.id = r.place_id) end as segment,
           coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                      order by pr.display_name)
                       from public.visit_profiles vp
                       join public.profiles pr on pr.id = vp.profile_id
                      where vp.visit_id = r.id), '[]'::jsonb) as people,
           (select count(*) from public.photos ph
             where ph.visit_id = r.id and ph.deleted_at is null) as photos,
           (select count(*) from public.activities a where a.visit_id = r.id) as routes,
           (select count(*) from public.visits c where c.parent_visit_id = r.id) as children
      from rows_v r
  ),
  route_rows as (
    select a.id, a.name, a.type, a.distance,
           coalesce(a.local_date, a.start_date::date) as day, a.summary_polyline
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
  -- The category sections: places INSIDE this one, grouped the way the card shows them.
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
    'version', 1,
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
    -- THE HEADER COUNTS ARE COMPUTED FROM THE ROWS ABOVE, not queried separately.
    -- This is the entire point: a label cannot disagree with the list under it.
    'totals', jsonb_build_object(
       'visits',  (select count(*) from visit_rows),
       'trips',   (select count(*) from visit_rows where is_trip_qualified and is_headline),
       'photos',  (select count(*) from photo_rows),
       'routes',  (select count(*) from route_rows),
       'miles',   coalesce((select sum(distance) from route_rows), 0) / 1609.344,
       'members', (select count(*) from member_rows))
  ) into v_result;

  return v_result;
end $function$;

comment on function public.card_view(uuid, uuid) is
  'THE card read model (§0.6). One call returns the whole card: header, ratings, visits '
  'with participants and evidence counts, routes, photos, member places and totals — and '
  'the totals are computed from the very rows returned, so a label cannot disagree with '
  'the list beneath it. Mode is derived from the arguments, never passed.';

revoke all on function public.card_view(uuid, uuid) from public, anon;
grant execute on function public.card_view(uuid, uuid) to authenticated;

commit;
