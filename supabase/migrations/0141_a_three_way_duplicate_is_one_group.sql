-- Close duplicate chains transitively, or a three-way duplicate still counts twice.
--
-- 0140's grouper assigned shared_group_id pair by pair in ONE update statement. A
-- single UPDATE sees a consistent snapshot, so `coalesce(k.shared_group_id, k.id)`
-- always read the PRE-update value and chains never merged. The 2026-03-07 run —
-- three records of one 45-mile run, connected as A–B, B–C, A–C — came out as two
-- groups instead of one, so it would still have been counted twice. Caught by
-- verifying the result instead of trusting the write.
--
-- This computes connected components: every record reachable through the pair graph
-- lands in the SAME group. Still non-destructive; still only writes shared_group_id.
--
-- The readers also now prefer the RICHEST record of a group (a Strava row with a
-- route over a bare file import), so the distance a group reports is the best one
-- recorded rather than whichever row happened to sort first.

begin;

create or replace function public.group_duplicate_activities(
  p_minutes int default 20,
  p_pct numeric default 0.10,
  p_apply boolean default false
)
returns table(kept uuid, dropped uuid, kept_name text, dropped_name text,
              minutes_apart numeric, pct_diff numeric, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_changed int;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  create temp table _pairs on commit drop as
  select
    case when (a.summary_polyline is not null, a.source = 'strava', -extract(epoch from a.start_date))
            >= (b.summary_polyline is not null, b.source = 'strava', -extract(epoch from b.start_date))
         then a.id else b.id end as keep_id,
    case when (a.summary_polyline is not null, a.source = 'strava', -extract(epoch from a.start_date))
            >= (b.summary_polyline is not null, b.source = 'strava', -extract(epoch from b.start_date))
         then b.id else a.id end as drop_id,
    round((abs(extract(epoch from (a.start_date - b.start_date)))/60)::numeric, 1) as mins,
    round((abs(a.distance - b.distance) / nullif(greatest(a.distance, b.distance),0) * 100)::numeric, 1) as pct,
    case when a.owner_profile is distinct from b.owner_profile then 'joint outing'
         when a.source is distinct from b.source              then 'same outing from two sources'
         else 'imported twice' end as why
  from public.activities a
  join public.activities b
    on a.id < b.id
   and a.type = b.type
   and a.distance > 0 and b.distance > 0
   and abs(extract(epoch from (a.start_date - b.start_date))) <= p_minutes * 60
   and abs(a.distance - b.distance) <= greatest(a.distance, b.distance) * p_pct;

  if p_apply then
    -- Undirected edge list, then relax every member to the smallest id it can reach.
    create temp table _edge on commit drop as
      select keep_id as a, drop_id as b from _pairs
      union all
      select drop_id as a, keep_id as b from _pairs;

    create temp table _comp on commit drop as
      select id, id as root from (select a as id from _edge union select b from _edge) s;

    -- Iterate to a fixed point. Bounded: each pass strictly lowers at least one
    -- root, and there are finitely many ids, so it terminates.
    loop
      update _comp c
         set root = least(c.root, o.root)
        from _edge e
        join _comp o on o.id = e.b
       where c.id = e.a
         and o.root < c.root;
      get diagnostics v_changed = row_count;
      exit when v_changed = 0;
    end loop;

    update public.activities t
       set shared_group_id = c.root
      from _comp c
     where t.id = c.id
       and t.shared_group_id is distinct from c.root;
  end if;

  return query
    select p.keep_id, p.drop_id, ka.name, da.name, p.mins, p.pct, p.why
      from _pairs p
      join public.activities ka on ka.id = p.keep_id
      join public.activities da on da.id = p.drop_id
     order by da.start_date;
end $function$;

-- The group's reported distance should be the best record's, not an arbitrary one.
create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count integer, miles double precision, trips_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qv as (
    select v.place_id, v.is_trip
      from public.visits v
     where case when p_profile is null
                then v.solo_profile is null
                else (v.solo_profile is null or v.solo_profile = p_profile) end
       and v.status = 'taken'
  ),
  qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.activities a
     where a.place_id is not null
       and case when p_profile is null
                then a.solo_profile is null
                else (a.solo_profile is null or a.solo_profile = p_profile) end
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place)                                     as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    (select count(*)::int from qv where qv.is_trip)                as trips_count;
$function$;

commit;
