-- 0069_race_as_place.sql — Phase C (races, refined per Erica). A race is a NAMED
-- repeatable thing: run "Turkey Trot" every year → one race, many runnings. That
-- is the place model ("count each race once, count every running"), so a race is
-- its own leaf place with category='race'; each running is an activity under it.
-- Opening the race place card then lists every running for free.
--
--   assign_activity_to_race(activity, name, race_place?) — find-or-create by name,
--        move the running under it (rebuild old + new), mark is_race.
--   races_list(profile)  — one row per race: name, times run, miles, distance bucket
--   race_stats(profile)  — runnings per distance bucket (so "51 5Ks" = 51 runnings)
-- Both keyed off place.category='race' now, not the raw is_race flag.

-- Move an activity under a race place (creating the race by name if needed).
create or replace function public.assign_activity_to_race(
  p_activity uuid, p_race_name text, p_race_place uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_place uuid; v_old uuid; v_lat double precision; v_lng double precision;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  select place_id, lat, lng into v_old, v_lat, v_lng from public.activities where id = p_activity;

  if p_race_place is not null then
    v_place := p_race_place;
  else
    select id into v_place from public.places
      where category = 'race' and lower(btrim(name)) = lower(btrim(p_race_name)) limit 1;
    if v_place is null then
      insert into public.places (name, lat, lng, saved, auto, categories, kind)
        values (coalesce(nullif(btrim(p_race_name), ''), 'Race'), v_lat, v_lng,
                true, false, array['race'], 'leaf')
        returning id into v_place;
    end if;
  end if;

  update public.activities set place_id = v_place, is_race = true where id = p_activity;
  if v_old is not null and v_old <> v_place then
    perform public.recompute_place_stats(v_old);
    perform public.rebuild_place_visits(v_old);
  end if;
  perform public.recompute_place_stats(v_place);
  perform public.rebuild_place_visits(v_place);
  return v_place;
end $$;
grant execute on function public.assign_activity_to_race(uuid, text, uuid) to authenticated;

-- One row per race place: how many times run, total miles, and the distance
-- bucket (from the average running's distance — same race ≈ same distance).
create or replace function public.races_list(p_profile uuid default null)
returns table(id uuid, name text, times integer, miles double precision, bucket text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, count(a.*)::int as times,
    coalesce(sum(a.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(a.distance),0)/1609.344) / nullif(count(a.*),0)) as bucket
  from public.places p
  join public.activities a on a.place_id = p.id
  where p.category = 'race'
    and case when p_profile is null then a.solo_profile is null
             else (a.solo_profile is null or a.solo_profile = p_profile) end
  group by p.id, p.name
  having count(a.*) > 0
  order by p.name;
$$;
grant execute on function public.races_list(uuid) to authenticated;

-- Runnings per distance bucket (each running counts), keyed off race places.
create or replace function public.race_stats(p_profile uuid default null)
returns table(bucket text, n integer, miles double precision, ord integer)
language sql stable security definer set search_path = public as $$
  select b.bucket, count(*)::int as n, coalesce(sum(a.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from public.activities a
  join public.places p on p.id = a.place_id
  cross join lateral (select public.race_bucket(a.distance/1609.344) as bucket) b
  where p.category = 'race'
    and case when p_profile is null then a.solo_profile is null
             else (a.solo_profile is null or a.solo_profile = p_profile) end
  group by b.bucket
  order by ord;
$$;

-- Migrate the pre-tagged is_race activities into race places (grouped by name).
do $$
declare r record; v_place uuid;
begin
  for r in
    select coalesce(nullif(btrim(name), ''), 'Race') as nm,
           avg(lat) as lat, avg(lng) as lng, array_agg(id) as ids,
           array_agg(distinct place_id) as old_places
    from public.activities
    where is_race and place_id in (select id from public.places where coalesce(category,'') <> 'race')
    group by coalesce(nullif(btrim(name), ''), 'Race')
  loop
    select id into v_place from public.places
      where category = 'race' and lower(btrim(name)) = lower(r.nm) limit 1;
    if v_place is null then
      insert into public.places (name, lat, lng, saved, auto, categories, kind)
        values (r.nm, r.lat, r.lng, true, false, array['race'], 'leaf')
        returning id into v_place;
    end if;
    update public.activities set place_id = v_place where id = any(r.ids);
    -- rebuild any place that lost a running to this race
    perform public.recompute_place_stats(op), public.rebuild_place_visits(op)
      from unnest(r.old_places) op where op is not null and op <> v_place;
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end loop;
end $$;
