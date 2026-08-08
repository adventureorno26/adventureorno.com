-- Mileage by type, optionally for one person (owner_profile). Null = both, with
-- shared outings counted once. Keeps the 2025-12-21 stats cutoff.
create or replace function mileage_by_person(p_profile uuid default null)
returns table (type text, activity_count bigint, meters double precision, miles numeric)
language sql stable security definer set search_path to public as $$
  with canon as (
    select distinct on (coalesce(shared_group_id, id)) type, distance
      from activities
     where start_date >= '2025-12-21'::date
       and (p_profile is null or owner_profile = p_profile)
     order by coalesce(shared_group_id, id), id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$$;
