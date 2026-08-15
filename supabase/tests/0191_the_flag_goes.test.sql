-- 0191 — the mark still works, and the trigger kept the jobs that were not the mirror.
--
-- The risk in this migration is not the column drop. It is that
-- `visits_sync_trip_flags` did THREE things and only one of them was the mirror: it also
-- accepts a person-created visit immediately, and without that every new visit arrives
-- unaccepted, counts_as_trip() rejects it, and Erica logs a visit that vanishes from
-- every statistic. These tests are mostly about that.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0191-0000-0000-0000-000000000001', 'a0191@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0191-0000-0000-0000-000000000001', 'A0191', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0191-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. The column is gone.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'visits' and column_name = 'is_trip'
  ) then
    raise exception 'FAIL: visits.is_trip is still there';
  end if;
  raise notice 'PASS 1: visits.is_trip is gone';
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE ONE THAT MATTERS. A visit a person creates is still accepted at once.
--    This is the job the trigger did that had nothing to do with the mirror.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0191-0000-0000-0000-000000000001';
  p uuid; v public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T191 Accepted', 38.9, -77.4, true)
    returning id into p;
  v := public.create_visit(p, '2026-04-02', '2026-04-02', null, array[a_id]::uuid[]);

  if v.accepted_at is null then
    raise exception
      'FAIL: a visit a person created arrived UNACCEPTED. counts_as_trip() will reject '
      'it and it will be missing from every statistic.';
  end if;
  raise notice 'PASS 2: a person-created visit is accepted immediately';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Marking a visit still makes it a trip, through the same RPC the card calls.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0191-0000-0000-0000-000000000001';
  p uuid; v public.visits; after public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T191 Marked', 39.2, -77.5, true)
    returning id into p;
  v := public.create_visit(p, '2026-05-04', '2026-05-04', null, array[a_id]::uuid[]);

  if public.counts_as_trip(v.*) then
    raise exception 'FAIL: a single unmarked day counted as a trip before it was marked';
  end if;

  after := public.set_visit_is_trip(v.id, true);
  if not after.trip_marked then raise exception 'FAIL: the mark did not stick'; end if;
  if not public.counts_as_trip(after.*) then
    raise exception 'FAIL: a marked visit does not count as a trip';
  end if;

  -- and unmarking reverses it
  after := public.set_visit_is_trip(v.id, false);
  if public.counts_as_trip(after.*) then
    raise exception 'FAIL: unmarking left it counting as a trip';
  end if;

  raise notice 'PASS 3: set_visit_is_trip marks and unmarks through trip_marked';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Multi-day still counts WITHOUT anybody marking it (§0.4's other half),
--    and that is what makes the column redundant rather than merely unused.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0191-0000-0000-0000-000000000001';
  p uuid; v public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T191 Week', 41.9, 12.5, true)
    returning id into p;
  v := public.create_visit(p, '2026-03-27', '2026-04-02', null, array[a_id]::uuid[]);

  if v.trip_marked then raise exception 'FAIL: nobody marked this one'; end if;
  if not public.counts_as_trip(v.*) then
    raise exception 'FAIL: 27 March to 2 April is seven days and is a trip';
  end if;
  raise notice 'PASS 4: a multi-day visit is a trip with no mark at all';
end $$;

-- ---------------------------------------------------------------------------
-- 5. A person's judgement is still recorded, so automation cannot undo it.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0191-0000-0000-0000-000000000001';
  p uuid; v public.visits; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T191 Approval', 40.1, -74.9, true)
    returning id into p;
  v := public.create_visit(p, '2026-06-06', '2026-06-06', null, array[a_id]::uuid[]);
  perform public.set_visit_is_trip(v.id, true);

  select count(*) into n from public.approved_fields
   where subject_type = 'visit' and subject_id = v.id and field = 'is_trip';
  if n = 0 then
    raise exception 'FAIL: marking a trip no longer records the approval';
  end if;
  raise notice 'PASS 5: the mark is still recorded as a decision';
end $$;

-- ---------------------------------------------------------------------------
-- 6. No function mentions the column any more. `apply_inbox_field` is allowed
--    to, because it keeps the inbox FIELD NAME 'is_trip' — renaming that would
--    strand rows already sitting in the inbox.
-- ---------------------------------------------------------------------------
do $$
declare offender text;
begin
  select string_agg(p.proname, ', ') into offender
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname <> 'apply_inbox_field'
     -- Comments and string literals stripped first. Without that this matches the
     -- 'is_trip' that record_approval records under, and the word in ordinary prose —
     -- naming four functions that never touch the column. That is what it did first.
     and regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'),
           '''[^'']*''', '''''', 'g'
         ) ~ '\mis_trip\M'
     and pg_get_functiondef(p.oid) !~ 'is_trip_qualified';
  if offender is not null then
    raise exception 'FAIL: % still reference is_trip', offender;
  end if;
  raise notice 'PASS 6: nothing reads or writes the column';
end $$;

rollback;
