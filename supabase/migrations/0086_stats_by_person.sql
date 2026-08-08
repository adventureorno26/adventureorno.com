-- Person-aware Settings stats: every stat pill can show Me / Josh / Both.
-- p_profile null keeps the EXACT current "Both/Together" numbers; a profile id
-- filters to that person (their solo + joint, matching the map + climbing_stats).
--
-- Also adds peak_bags (which hike/person/place bagged each summit) so the peaks
-- list can be person-filtered and each summit can open its place card.

-- Replace the no-arg versions with a p_profile overload (drop first to avoid an
-- ambiguous 0-arg vs default-arg call).
drop function if exists public.settings_stats();
create or replace function public.settings_stats(p_profile uuid default null)
returns table (trails_taken bigint, camping bigint, dining bigint, winery bigint)
language sql stable security definer set search_path = public as $$
  with myplaces as (
    select distinct place_id from public.place_people()
    where p_profile is null or profile_id = p_profile
  )
  select
    (select count(*) from (
        select distinct on (coalesce(shared_group_id, id)) id
          from activities
         where type in ('Hike','Walk','Run','Ride')
           and case when p_profile is null then solo_profile is null
                    else (solo_profile = p_profile or solo_profile is null) end
         order by coalesce(shared_group_id, id), id
      ) t)
    + (select count(*) from places p where not bucket and 'jeeping' = any(categories)
         and (p_profile is null or exists(select 1 from myplaces m where m.place_id = p.id))) as trails_taken,
    (select count(*) from places p where not bucket and 'camping' = any(categories)
       and (p_profile is null or exists(select 1 from myplaces m where m.place_id = p.id))) as camping,
    (select count(*) from places p where not bucket and 'dining' = any(categories)
       and (p_profile is null or exists(select 1 from myplaces m where m.place_id = p.id))) as dining,
    (select count(*) from places p where not bucket and 'winery' = any(categories)
       and (p_profile is null or exists(select 1 from myplaces m where m.place_id = p.id))) as winery;
$$;
grant execute on function public.settings_stats(uuid) to authenticated;

drop function if exists public.geo_coverage();
create or replace function public.geo_coverage(p_profile uuid default null)
returns table (us_states text[], us_state_count integer, countries text[], country_count integer, has_dc boolean)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.* from public.places p
    where saved and not coalesce(bucket, false)
      and (p_profile is null
           or exists(select 1 from public.place_people() pp
                     where pp.place_id = p.id and pp.profile_id = p_profile))
  ),
  us as (
    select distinct admin1 from base
    where country = 'United States' and admin1 is not null and admin1 <> 'District of Columbia'
  ),
  co as (select distinct country from base where country is not null)
  select (select array_agg(admin1 order by admin1) from us), (select count(*)::int from us),
         (select array_agg(country order by country) from co), (select count(*)::int from co),
         exists(select 1 from base where admin1 = 'District of Columbia');
$$;
grant execute on function public.geo_coverage(uuid) to authenticated;

-- Which hike/person/place bagged each summit (populated by a matching pass).
create table if not exists public.peak_bags (
  peak_id     uuid not null references public.peaks (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  profile_id  uuid references public.profiles (id) on delete set null, -- null = joint
  place_id    uuid references public.places (id) on delete set null,
  primary key (peak_id, activity_id)
);
alter table public.peak_bags enable row level security;
drop policy if exists peak_bags_select on public.peak_bags;
create policy peak_bags_select on public.peak_bags for select using (public.is_member());

drop function if exists public.peaks_bagged();
create or replace function public.peaks_bagged(p_profile uuid default null)
returns table (id uuid, name text, ele_ft integer, place_id uuid)
language sql stable security definer set search_path = public as $$
  select pk.id, pk.name, round(pk.ele_m * 3.28084)::int as ele_ft,
         (select pb.place_id from public.peak_bags pb
           where pb.peak_id = pk.id and pb.place_id is not null limit 1) as place_id
  from public.peaks pk
  where p_profile is null
     or exists(select 1 from public.peak_bags pb
               where pb.peak_id = pk.id and (pb.profile_id = p_profile or pb.profile_id is null))
  order by pk.ele_m desc nulls last, pk.name;
$$;
grant execute on function public.peaks_bagged(uuid) to authenticated;
