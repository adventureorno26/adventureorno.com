-- Unified activity attribution: solo_profile null = joint (shows under "Both"),
-- else that person's own (shows only under their toggle).
alter table activities add column if not exists solo_profile uuid references profiles(id);

-- Pre-cutoff activities are Erica's own history (not joint, not in "Both").
update activities set solo_profile = (select id from profiles where role='owner' limit 1)
  where start_date < '2025-12-21'::date and solo_profile is null;

-- The Yuengling Shamrock Marathon (Virginia Beach, Mar 22) was just Erica.
update activities set solo_profile = (select id from profiles where role='owner' limit 1)
  where name ilike '%shamrock%' or (place_id = (select id from places where name ilike 'Virginia Beach' limit 1) and start_date::date = '2026-03-22');

-- "Both" (p null) = joint only; a person = joint + their own.
create or replace function mileage_by_person(p_profile uuid default null)
returns table (type text, activity_count bigint, meters double precision, miles numeric)
language sql stable security definer set search_path to public as $$
  with canon as (
    select distinct on (coalesce(shared_group_id, id)) type, distance
      from activities
     where (p_profile is null and solo_profile is null)
        or (p_profile is not null and (solo_profile is null or solo_profile = p_profile))
     order by coalesce(shared_group_id, id), id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$$;
