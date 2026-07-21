-- Link outings BOTH athletes recorded (same time ±30min, <200m apart, distance
-- ±15%) so combined stats count them once. No-op while only one athlete exists.
create or replace function dedupe_shared_outings() returns integer
language plpgsql security definer set search_path to public as $$
declare v_count int := 0; r record; m record; gid uuid;
begin
  for r in
    select id, athlete_id, lat, lng, distance, start_date
      from activities
     where shared_group_id is null and lat is not null and start_date is not null
  loop
    if (select shared_group_id from activities where id = r.id) is not null then continue; end if;
    select a2.id as id, a2.shared_group_id as shared_group_id into m
      from activities a2
     where a2.id <> r.id
       and a2.athlete_id is distinct from r.athlete_id
       and a2.lat is not null and a2.start_date is not null
       and abs(extract(epoch from (a2.start_date - r.start_date))) < 1800
       and abs(a2.distance - r.distance) <= 0.15 * greatest(r.distance, 1)
       and (6371000*acos(least(1, cos(radians(r.lat))*cos(radians(a2.lat))
             *cos(radians(a2.lng - r.lng)) + sin(radians(r.lat))*sin(radians(a2.lat))))) < 200
     order by abs(extract(epoch from (a2.start_date - r.start_date)))
     limit 1;
    if m.id is not null then
      gid := coalesce(m.shared_group_id, gen_random_uuid());
      update activities set shared_group_id = gid where id in (r.id, m.id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Mileage counts one row per shared outing (still cutoff at 2025-12-21).
create or replace view activity_mileage as
  with canon as (
    select distinct on (coalesce(shared_group_id, id)) type, distance
      from activities
     where start_date >= '2025-12-21'::date
     order by coalesce(shared_group_id, id), id
  )
  select type, count(*) as activity_count, coalesce(sum(distance), 0::float8) as meters,
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1) as miles
  from canon group by type;

create or replace view place_counts as
  select p.id as place_id,
    (select count(*) from photos ph where ph.place_id = p.id) as photo_count,
    (select count(*) from activities a where a.place_id = p.id) as route_count,
    (select round((coalesce(sum(c.distance), 0::float8) / 1609.344::float8)::numeric, 1)
       from (select distinct on (coalesce(a.shared_group_id, a.id)) a.distance
               from activities a
              where a.place_id = p.id and a.start_date >= '2025-12-21'::date
              order by coalesce(a.shared_group_id, a.id), a.id) c) as miles
  from places p;
