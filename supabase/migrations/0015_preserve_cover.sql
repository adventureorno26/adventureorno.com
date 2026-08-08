-- 0015_preserve_cover.sql — let a manually-chosen cover photo persist.
-- recompute_place_stats() previously reset cover_photo_id to the newest photo on
-- every run, clobbering a user's pick. Now it KEEPS the current cover if that
-- photo still belongs to the place; only picks a new one when there's no valid
-- cover (new place, or the cover photo was deleted).
create or replace function public.recompute_place_stats(p_place uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_first date;
  v_last  date;
  v_count integer;
  v_cover uuid;
begin
  with days as (
    select taken_at::date as d from public.photos
      where place_id = p_place and taken_at is not null
    union
    select recorded_at::date from public.location_pings where place_id = p_place
    union
    select start_date::date from public.activities where place_id = p_place and start_date is not null
  )
  select min(d), max(d), count(*) into v_first, v_last, v_count from days;

  -- Keep the existing cover if it still belongs to this place (manual choice).
  select cover_photo_id into v_cover from public.places where id = p_place;
  if v_cover is not null
     and not exists (select 1 from public.photos where id = v_cover and place_id = p_place) then
    v_cover := null;
  end if;
  if v_cover is null then
    select id into v_cover from public.photos
      where place_id = p_place and is_landscape order by taken_at desc nulls last limit 1;
    if v_cover is null then
      select id into v_cover from public.photos
        where place_id = p_place order by taken_at desc nulls last limit 1;
    end if;
  end if;

  update public.places
     set first_visit = least(first_visit, v_first),
         last_visit  = greatest(last_visit, v_last),
         visit_count = coalesce(v_count, visit_count),
         cover_photo_id = v_cover,
         activity_categories = coalesce(
           (select array_agg(distinct public.activity_category(type))
              from public.activities where place_id = p_place and type is not null), '{}')
   where id = p_place;
end;
$function$;
