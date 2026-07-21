-- Co-attribution: an activity can also "belong" to companions (we did it
-- together). Post-Dec-21-2025 activities Erica recorded were joint → also Josh's.
alter table activities add column if not exists also_profiles uuid[] not null default '{}';

update activities
   set also_profiles = array[(select id from profiles where display_name = 'Josh' limit 1)]
 where owner_profile = (select id from profiles where role = 'owner' limit 1)
   and start_date >= '2025-12-21'::date
   and (select id from profiles where display_name = 'Josh' limit 1) <> all(also_profiles);

-- place_people now includes co-owners.
create or replace function place_people()
returns table (place_id uuid, profile_id uuid)
language sql stable security definer set search_path to public as $$
  select id, created_by from places where created_by is not null
  union
  select place_id, owner_profile from activities where place_id is not null and owner_profile is not null
  union
  select a.place_id, unnest(a.also_profiles) from activities a
    where a.place_id is not null and array_length(a.also_profiles, 1) is not null
  union
  select place_id, uploaded_by from photos where place_id is not null and uploaded_by is not null
$$;

-- Mileage counts an activity for a person if they own it OR are a companion.
create or replace function mileage_by_person(p_profile uuid default null)
returns table (type text, activity_count bigint, meters double precision, miles numeric)
language sql stable security definer set search_path to public as $$
  with canon as (
    select distinct on (coalesce(shared_group_id, id)) type, distance
      from activities
     where (p_profile is null or owner_profile = p_profile or p_profile = any(also_profiles))
       and (p_profile is not null or start_date >= '2025-12-21'::date)
     order by coalesce(shared_group_id, id), id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$$;
