-- Let the grouper run more than once in a transaction.
--
-- Its temp tables are `on commit drop`, which means they outlive the function CALL
-- and only vanish at COMMIT. A second call in the same transaction failed with
-- `relation "_pairs" already exists`. The nightly job only calls once so production
-- never hit it, but the review screen and the tests call it repeatedly — and a
-- function that cannot be re-run is a function that cannot be verified.

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

  -- Temp tables live until COMMIT, not until the function returns, so a second
  -- call inside one transaction used to fail with "relation _pairs already
  -- exists". Clear them first; the nightly job only calls once, but the review
  -- screen and the tests call repeatedly.
  drop table if exists _pairs;
  drop table if exists _edge;
  drop table if exists _comp;

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

commit;
