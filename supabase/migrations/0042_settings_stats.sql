-- Stats for the Settings page. Trails Taken = unique JOINT hikes/walks/runs/rides
-- (deduped by shared outing) PLUS jeeping-tagged places. The rest = tagged places.
create or replace function settings_stats()
returns table (trails_taken bigint, camping bigint, dining bigint, winery bigint)
language sql stable security definer set search_path to public as $$
  select
    (select count(*) from (
        select distinct on (coalesce(shared_group_id, id)) id
          from activities
         where solo_profile is null and type in ('Hike','Walk','Run','Ride')
         order by coalesce(shared_group_id, id), id
      ) t)
    + (select count(*) from places where not bucket and 'jeeping' = any(categories)) as trails_taken,
    (select count(*) from places where not bucket and 'camping' = any(categories)) as camping,
    (select count(*) from places where not bucket and 'dining'  = any(categories)) as dining,
    (select count(*) from places where not bucket and 'winery'  = any(categories)) as winery;
$$;
