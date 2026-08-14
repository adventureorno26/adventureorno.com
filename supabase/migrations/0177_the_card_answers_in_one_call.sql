-- 0177 — the card's read model returns everything the card draws.
--
-- 0171 built `card_view` so the header and the list could not disagree, and the card
-- still does not use it: `PlacePanel` runs its own queries and counts some of them
-- again in JSX. Three things were missing before it could, and one of them was wrong.
--
-- 1. PHOTO COUNTS PER VISIT CAME FROM `place_visit_stats`, WHICH INFERS FROM DATES:
--
--        where ph.place_id = v.place_id
--          and ph.taken_at::date between v.start_date and v.end_date
--
--    It never looks at `photos.visit_id`, so a photo you deliberately pinned to one
--    visit is counted for every visit at that place whose range covers its date, and a
--    photo pinned to a visit outside its own dates is not counted at all. §0.1 again.
--
--    Measured on production before changing it: 175 of 177 photos are pinned to a
--    visit; the date rule totals 169 against the canonical 175; 10 visits disagree; and
--    ZERO visits would drop to showing no photos. The canonical count is strictly
--    better here, not merely different.
--
-- 2. VIDEOS COULD NOT BE COUNTED CANONICALLY AT ALL — `videos` had no `visit_id`.
--    Photos have been pinnable to a visit for a long time; videos never were, so the
--    card's "N videos" had no honest source. The column is added and backfilled by the
--    same rule 0167 used for activities: same place, date inside the visit, and
--    EXACTLY ONE candidate visit. Production has 6 videos, all dated, 5 matching
--    exactly one visit and none ambiguous, so nothing is guessed.
--
-- 3. A TRIP'S CONTENTS were a separate `trip_contents` call per trip — N+1 requests
--    from the browser, and the "N places" line could disagree with the list it opened.
--    Each visit row now carries its own contents.
--
-- `version` goes to 2 so a stale client can tell.
--
-- ROLLBACK: recreate card_view from 0171; drop column videos.visit_id.

begin;

-- ---------------------------------------------------------------------------
-- 1. A video belongs to a visit, like a photo does
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists visit_id uuid references public.visits(id) on delete set null;

comment on column public.videos.visit_id is
  'The visit this video belongs to (§0.3). Photos have always had this; videos did '
  'not, so the card had to guess a video''s visit from its date.';

create index if not exists videos_visit_idx on public.videos(visit_id);

-- Backfill: same place, date inside the visit, and exactly one candidate. Anything
-- ambiguous is left null rather than guessed.
update public.videos vd
   set visit_id = c.only_visit
  from (
    select v0.id,
           (select v.id from public.visits v
             where v.place_id = v0.place_id
               and v0.taken_at::date between v.start_date and v.end_date
             limit 1) as only_visit,
           (select count(*) from public.visits v
             where v.place_id = v0.place_id
               and v0.taken_at::date between v.start_date and v.end_date) as n
      from public.videos v0
     where v0.taken_at is not null and v0.visit_id is null
  ) c
 where vd.id = c.id and c.n = 1;

-- ---------------------------------------------------------------------------
-- 2. card_view v2 — the whole card, in one answer
-- ---------------------------------------------------------------------------
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
    'version', 2,
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

comment on function public.card_view(uuid, uuid) is
  'THE card read model (§0.6), version 2. One call returns the whole card: header, '
  'ratings, visits with participants, evidence counts and their contents, routes, '
  'photos, member places and totals — with the totals computed from the very rows '
  'returned. Counts photos and videos by visit_id, never by date (§0.1).';

revoke all on function public.card_view(uuid, uuid) from public, anon;
grant execute on function public.card_view(uuid, uuid) to authenticated;

commit;
