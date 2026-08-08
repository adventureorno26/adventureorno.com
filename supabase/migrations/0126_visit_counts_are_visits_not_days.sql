-- 0126 — The visit count means VISITS, not days, and it respects the
-- Just me / Just Josh / Both view (place-model Slice 3).
--
-- TWO DEFECTS, both confirmed against live data.
--
-- 1. It counted DAYS. `recompute_place_stats` set
--        visit_count = count(*) from days
--    where `days` is the set of distinct dates with a photo/ping/activity. Cape Cod
--    showed 5 because there were photos on Aug 2,3,5,6,7 — it was never the number
--    of times you went. Erica: "instead of the number of days spent at a place
--    showing up on the map, I want the number of times we have been to that place."
--    The number was not even self-consistent: Potomac Station showed 67 with 39
--    visit rows, Appalachian Trail 11 with 38.
--
-- 2. It was GLOBAL, so the map badge read identically in all three views:
--        Potomac Station        badge 67 | Both 0  | Erica 0  | Josh 39
--        Lake of the Red Rocks  badge 52 | Both 2  | Erica 41 | Josh 0
--    In "Just Erica", Potomac Station advertised 67 visits to a place she has never
--    been to — every one of them is Josh's.
--
-- FIX
--   * visit_count now counts VISIT ROWS. After 0125 a stay inside a trip window is
--     one row, so Cape Cod reads 1, and going back next year reads 2.
--   * place_visit_counts(p_profile) returns the per-place count FOR A VIEW. Its
--     filter is copied verbatim from place_ids_for_view so the badge can never
--     disagree with which pins are shown:
--         p_profile IS NULL -> visits attributed to BOTH  (solo_profile is null)
--         otherwise         -> that person's visits PLUS Both
--     visit_count stays as the view-independent total for callers that want it
--     (place cards, smart albums' visit_count > 1).

create or replace function public.recompute_place_stats(p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first date; v_last date; v_count integer; v_cover uuid;
begin
  with days as (
    select taken_at::date as d from public.photos
      where place_id = p_place and deleted_at is null and taken_at is not null
    union
    select recorded_at::date from public.location_pings where place_id = p_place
    union
    select start_date::date from public.activities where place_id = p_place and start_date is not null
  )
  select min(d), max(d) into v_first, v_last from days;

  -- TIMES WE WENT, not days spent. One multi-day stay is one visit.
  select count(*) into v_count from public.visits where place_id = p_place;

  select cover_photo_id into v_cover from public.places where id = p_place;
  if v_cover is not null
     and not exists (select 1 from public.photos where id = v_cover and place_id = p_place and deleted_at is null) then
    v_cover := null;
  end if;
  if v_cover is null then
    select id into v_cover from public.photos
      where place_id = p_place and deleted_at is null and is_landscape order by taken_at desc nulls last limit 1;
    if v_cover is null then
      select id into v_cover from public.photos
        where place_id = p_place and deleted_at is null order by taken_at desc nulls last limit 1;
    end if;
  end if;

  update public.places
     set first_visit = least(first_visit, v_first),
         last_visit  = greatest(last_visit, v_last),
         visit_count = coalesce(v_count, 0),
         cover_photo_id = v_cover,
         activity_categories = coalesce(
           (select array_agg(distinct public.activity_category(type))
              from public.activities where place_id = p_place and type is not null), '{}')
   where id = p_place;
end;
$function$;

-- Per-place visit counts FOR A VIEW. The where-clause is intentionally identical
-- to place_ids_for_view so the badge and the visible pins always agree.
create or replace function public.place_visit_counts(p_profile uuid default null)
returns table (place_id uuid, visits integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select v.place_id, count(*)::integer as visits
    from public.visits v
    join public.places p on p.id = v.place_id
   where case when p_profile is null
              then v.solo_profile is null
              else (v.solo_profile is null or v.solo_profile = p_profile) end
   group by v.place_id;
$function$;

revoke all on function public.place_visit_counts(uuid) from public;
revoke all on function public.place_visit_counts(uuid) from anon;
grant execute on function public.place_visit_counts(uuid) to authenticated;
grant execute on function public.place_visit_counts(uuid) to service_role;

-- Bring every existing place in line with the new meaning in one pass.
update public.places p
   set visit_count = (select count(*) from public.visits v where v.place_id = p.id);
