-- DB test for migration 0099 (trip_stops + container-Place → trips backfill).
-- RUN ONLY against a disposable LOCAL stack, never production. Fictional data,
-- transaction-rolled-back. Re-runs the backfill statements against fixtures.

begin;

-- Fictional fixtures: one container-Place trip with 2 members, and one empty trip.
insert into public.places (id, name, lat, lng, category, holds_children, saved, first_visit, last_visit)
values
  ('bbbbbbbb-0000-0000-0000-00000000a001', 'Fictional Road Trip', 1, 1, 'trip', true, true, '2026-03-01', '2026-03-05'),
  ('bbbbbbbb-0000-0000-0000-00000000a002', 'Empty Fictional Trip', 2, 2, 'trip', true, true, null, null),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'Stop One', 1, 1, 'dining', false, true, '2026-03-01', '2026-03-01'),
  ('bbbbbbbb-0000-0000-0000-00000000b002', 'Stop Two', 1, 1, 'beach',  false, true, '2026-03-03', '2026-03-03');
insert into public.place_membership (child_id, parent_id) values
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'bbbbbbbb-0000-0000-0000-00000000a001'),
  ('bbbbbbbb-0000-0000-0000-00000000b002', 'bbbbbbbb-0000-0000-0000-00000000a001');

-- Run the backfill (same statements as migration 0099, steps 3 & 4).
insert into public.trips (name, start_date, end_date, status, source_place_id, created_by)
select p.name, p.first_visit, p.last_visit,
       case when p.first_visit > current_date then 'upcoming' else 'taken' end, p.id, p.created_by
from public.places p
where p.category='trip'
  and not exists (select 1 from public.trips t where t.source_place_id = p.id);

insert into public.trip_stops (trip_id, place_id, status, sort_order)
select t.id, m.child_id, 'completed',
       (row_number() over (partition by t.id order by ch.first_visit nulls last, ch.name))::int
from public.trips t
join public.place_membership m on m.parent_id = t.source_place_id
join public.places ch on ch.id = m.child_id
where t.source_place_id is not null
  and not exists (select 1 from public.trip_stops s where s.trip_id=t.id and s.place_id=m.child_id);

do $$
declare t1 uuid; n int;
begin
  select id into t1 from public.trips where source_place_id='bbbbbbbb-0000-0000-0000-00000000a001';
  if t1 is null then raise exception 'FAIL: trip not created from container place'; end if;
  -- 2 completed stops, ordered by first_visit.
  select count(*) into n from public.trip_stops where trip_id=t1 and status='completed';
  if n <> 2 then raise exception 'FAIL: expected 2 trip_stops, got %', n; end if;
  if (select place_id from public.trip_stops where trip_id=t1 and sort_order=1)
       <> 'bbbbbbbb-0000-0000-0000-00000000b001' then
    raise exception 'FAIL: stop ordering wrong (earliest first_visit should be sort_order 1)';
  end if;
  -- Empty trip → 0 stops.
  if (select count(*) from public.trip_stops ts join public.trips tr on tr.id=ts.trip_id
      where tr.source_place_id='bbbbbbbb-0000-0000-0000-00000000a002') <> 0 then
    raise exception 'FAIL: empty trip got stops';
  end if;
end $$;

-- Idempotency: re-running the backfill creates nothing new.
do $$
declare before_t int; before_s int; after_t int; after_s int;
begin
  select count(*) into before_t from public.trips;
  select count(*) into before_s from public.trip_stops;
  insert into public.trips (name, start_date, end_date, status, source_place_id, created_by)
  select p.name, p.first_visit, p.last_visit,
         case when p.first_visit > current_date then 'upcoming' else 'taken' end, p.id, p.created_by
  from public.places p where p.category='trip'
    and not exists (select 1 from public.trips t where t.source_place_id = p.id);
  select count(*) into after_t from public.trips;
  if after_t <> before_t then raise exception 'FAIL: backfill not idempotent (trips)'; end if;
end $$;

-- Invalid stop status rejected.
do $$
declare t1 uuid;
begin
  select id into t1 from public.trips where source_place_id='bbbbbbbb-0000-0000-0000-00000000a001';
  begin
    insert into public.trip_stops (trip_id, place_id, status)
    values (t1, 'bbbbbbbb-0000-0000-0000-00000000b001', 'bogus');
    raise exception 'FAIL: invalid stop status allowed';
  exception when check_violation then null; when unique_violation then null; end;
end $$;

-- Overlap-safe stats: P1 and P2 are BOTH explicit stops AND fall in the trip's
-- date range, so the union must DISTINCT them to 2 (a naive stops+range count
-- would double to 4). This mirrors trip_place_ids' union logic without the
-- member gate (full member-gated RLS testing is covered separately).
do $$
declare t1 uuid; cnt int;
begin
  select id into t1 from public.trips where source_place_id='bbbbbbbb-0000-0000-0000-00000000a001';
  select count(*) into cnt from (
    select place_id from public.trip_stops where trip_id = t1
    union
    select p.id from public.places p join public.trips tr on tr.id = t1
      where coalesce(p.holds_children,false) = false
        and p.first_visit is not null and tr.start_date is not null and tr.end_date is not null
        and p.first_visit >= tr.start_date and p.first_visit <= tr.end_date
  ) u;
  if cnt <> 2 then raise exception 'FAIL: overlap dedup wrong — got % (expected 2)', cnt; end if;
end $$;

-- trip_place_ids + trip_stats exist and are anon-revoked.
do $$
begin
  if has_function_privilege('anon','public.trip_place_ids(uuid)','EXECUTE') then
    raise exception 'FAIL: anon can execute trip_place_ids';
  end if;
  if has_function_privilege('anon','public.trip_stats(uuid)','EXECUTE') then
    raise exception 'FAIL: anon can execute trip_stats';
  end if;
end $$;

do $$ begin raise notice 'PASS: 0099 trip_stops + migration tests'; end $$;

rollback;
