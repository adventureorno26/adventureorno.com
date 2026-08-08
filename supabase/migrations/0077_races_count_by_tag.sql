-- 0077_races_count_by_tag.sql — a race should count if EITHER the activity is
-- flagged is_race OR its place is tagged "race" (categories @> {race}). The
-- earlier version only looked at the singular place.category = 'race', so a race
-- that's ALSO a trail/hike (e.g. "Mammoth March", a hiking challenge tagged
-- trail+hiking+race) never counted — its singular category stays 'trail'.
-- Recognizing the tag makes marking a place "race" work for any activity type.

create or replace function public.race_stats(p_profile uuid default null)
returns table(bucket text, n integer, miles double precision, ord integer)
language sql stable security definer set search_path = public as $$
  select b.bucket, count(*)::int as n, coalesce(sum(a.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from public.activities a
  join public.places p on p.id = a.place_id
  cross join lateral (select public.race_bucket(a.distance/1609.344) as bucket) b
  where (a.is_race or p.categories @> array['race'])
    and case when p_profile is null then a.solo_profile is null
             else (a.solo_profile is null or a.solo_profile = p_profile) end
  group by b.bucket
  order by ord;
$$;

create or replace function public.races_list(p_profile uuid default null)
returns table(id uuid, name text, times integer, miles double precision, bucket text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, count(a.*)::int as times,
    coalesce(sum(a.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(a.distance),0)/1609.344) / nullif(count(a.*),0)) as bucket
  from public.places p
  join public.activities a on a.place_id = p.id
  where (a.is_race or p.categories @> array['race'])
    and case when p_profile is null then a.solo_profile is null
             else (a.solo_profile is null or a.solo_profile = p_profile) end
  group by p.id, p.name
  having count(a.*) > 0
  order by p.name;
$$;
