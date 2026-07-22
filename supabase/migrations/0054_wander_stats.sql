-- 0054_wander_stats.sql — §4 counting layer. ONE function computes the headline
-- numbers per person, all from VISIT-level attribution, one cutoff everywhere.
--
-- Attribution convention (visits.solo_profile): null = Both. Because every
-- pre-cutoff visit was set to Erica, "Both" (null) naturally means post-cutoff.
--   Both view  (p_profile null): visits with solo_profile IS NULL (= post-cutoff)
--   A person   (p_profile = X) : their solo visits + the joint (null) ones
--
-- count each place once (distinct place with a qualifying visit); count miles and
-- trips every time.

create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count int, miles double precision, trips_count int)
language sql stable security definer set search_path = public as $$
  with qv as (   -- qualifying visits for this view
    select v.place_id, v.start_date, v.end_date
    from public.visits v
    where case when p_profile is null
               then v.solo_profile is null
               else (v.solo_profile is null or v.solo_profile = p_profile) end
  )
  select
    -- places: distinct counting places that have a qualifying visit, each once
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place)                                              as places_count,
    -- miles: activity distance attributed through its own visit's view
    (select coalesce(sum(a.distance),0)/1609.344
       from public.activities a
      where a.place_id is not null
        and case when p_profile is null
                 then a.solo_profile is null
                 else (a.solo_profile is null or a.solo_profile = p_profile) end)
                                                                            as miles,
    -- trips: every trip place with a qualifying visit (per occurrence)
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.category = 'trip')                                           as trips_count;
$$;
grant execute on function public.wander_stats(uuid) to authenticated;
