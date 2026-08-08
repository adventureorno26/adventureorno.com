-- Cutoff (2025-12-21) applies ONLY to the combined "Both" view. A single
-- person's toggle shows their FULL history, including before the cutoff.
create or replace function mileage_by_person(p_profile uuid default null)
returns table (type text, activity_count bigint, meters double precision, miles numeric)
language sql stable security definer set search_path to public as $$
  with canon as (
    select distinct on (coalesce(shared_group_id, id)) type, distance
      from activities
     where (p_profile is null or owner_profile = p_profile)
       and (p_profile is not null or start_date >= '2025-12-21'::date)
     order by coalesce(shared_group_id, id), id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$$;
