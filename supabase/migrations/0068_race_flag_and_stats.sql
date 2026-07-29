-- 0068_race_flag_and_stats.sql — Phase C (race stats). Strava gives us no race
-- marker, so a race is a MANUAL per-activity flag (Erica's call). Adds:
--   activities.is_race        — the flag (default false)
--   set_activity_race(id,bool)— editor/owner toggle
--   race_stats(profile)       — count + miles per distance bucket, per person
-- Plus a conservative pre-tag of clearly-named races so she starts ahead.

alter table public.activities
  add column if not exists is_race boolean not null default false;

create or replace function public.set_activity_race(p_activity uuid, p_is_race boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.activities set is_race = coalesce(p_is_race, false) where id = p_activity;
end $$;
grant execute on function public.set_activity_race(uuid, boolean) to authenticated;

-- Classify a race by distance (miles) into the standard buckets. 'Other' holds
-- 8Ks, 5-milers, ultras — anything off the common distances.
create or replace function public.race_bucket(p_miles double precision)
returns text language sql immutable as $$
  select case
    when p_miles between 2.8  and 3.5  then '5K'
    when p_miles between 5.6  and 6.8  then '10K'
    when p_miles between 9.4  and 10.6 then '10 Mile'
    when p_miles between 12.4 and 13.8 then 'Half'
    when p_miles between 25.0 and 27.5 then 'Full'
    else 'Other' end;
$$;

-- Per-person race stats: one row per bucket that has races, plus the ordering
-- key so the UI can list 5K → 10K → 10 Mile → Half → Full → Other.
create or replace function public.race_stats(p_profile uuid default null)
returns table(bucket text, n integer, miles double precision, ord integer)
language sql stable security definer set search_path = public as $$
  select b.bucket, count(*)::int as n, coalesce(sum(a.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from public.activities a
  cross join lateral (select public.race_bucket(a.distance/1609.344) as bucket) b
  where a.is_race
    and case when p_profile is null then a.solo_profile is null
             else (a.solo_profile is null or a.solo_profile = p_profile) end
  group by b.bucket
  order by ord;
$$;
grant execute on function public.race_stats(uuid) to authenticated;

-- Conservative pre-tag: only clearly race-named runs (marathon, half, a "miler",
-- turkey trot, shamrock, an explicit 5K/10K, or the word "race"). Deliberately
-- skips generic "Morning Run" / "Loudoun County Running" — Erica tags the rest.
update public.activities set is_race = true
where type = 'Run' and not is_race and (
     name ilike '%marathon%'
  or name ilike '%miler%'
  or name ilike '%ten miler%'
  or name ilike '%turkey trot%'
  or name ilike '%shamrock%'
  or name ilike '%half marathon%'
  or name ilike '% 5k%' or name ilike '5k %' or name ilike '%-5k%'
  or name ilike '% 10k%' or name ilike '10k %' or name ilike '%-10k%'
  or name ~* '(^|[^a-z])race([^a-z]|$)'
);
