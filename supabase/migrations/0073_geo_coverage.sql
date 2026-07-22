-- 0073_geo_coverage.sql — "% of US states / world countries" coverage. First
-- normalize the country/state spellings that would split the counts (US vs
-- United States; the mis-tagged "Columbia" → District of Columbia), then a
-- geo_coverage() RPC returning the distinct states + countries visited.

update public.places set country = 'United States' where country = 'US';
update public.places set admin1 = 'District of Columbia' where admin1 = 'Columbia';

-- Distinct US states (real 50 — DC/territories excluded from the state count but
-- returned separately) and distinct countries, from saved places with a visit.
create or replace function public.geo_coverage()
returns table(
  us_states text[], us_state_count integer,
  countries text[], country_count integer,
  has_dc boolean
) language sql stable security definer set search_path = public as $$
  with us as (
    select distinct admin1 from public.places
      where saved and country = 'United States' and admin1 is not null
        and admin1 <> 'District of Columbia'
        and exists (select 1 from public.visits v where v.place_id = places.id)
  ),
  co as (
    select distinct country from public.places
      where saved and country is not null
        and exists (select 1 from public.visits v where v.place_id = places.id)
  )
  select
    (select array_agg(admin1 order by admin1) from us),
    (select count(*)::int from us),
    (select array_agg(country order by country) from co),
    (select count(*)::int from co),
    exists (select 1 from public.places
       where saved and admin1 = 'District of Columbia'
         and exists (select 1 from public.visits v where v.place_id = places.id));
$$;
grant execute on function public.geo_coverage() to authenticated;
