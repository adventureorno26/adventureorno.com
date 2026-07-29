-- DB test for migration 0097 (trips table + trip_stats RPC).
-- RUN ONLY against a disposable LOCAL stack, never production:
--   psql "$LOCAL_DB" -f supabase/tests/0097_trips.test.sql   (or via docker exec)
-- Transaction-wrapped + rolled back; fictional data only.

begin;

-- Insert a fictional trip.
insert into public.trips (name, start_date, end_date, status)
values ('Fictional Trip', '2026-01-01', '2026-01-05', 'taken');

-- Status check constraint rejects bad values.
do $$
begin
  begin
    insert into public.trips (name, status) values ('Bad', 'bogus');
    raise exception 'FAIL: invalid status was allowed';
  exception when check_violation then null; -- expected
  end;
end $$;

-- Default status is 'taken'.
do $$
begin
  insert into public.trips (name) values ('Undated draft');
  if (select status from public.trips where name='Undated draft') <> 'taken' then
    raise exception 'FAIL: default status is not taken';
  end if;
end $$;

-- trip_stats executes without error (member-gated → null outside a member session).
do $$
declare r json;
begin
  select public.trip_stats((select id from public.trips where name='Fictional Trip')) into r;
  -- No assertion on the value (depends on session membership); it must simply run.
end $$;

-- trip_stats is not executable by anon.
do $$
begin
  if has_function_privilege('anon', 'public.trip_stats(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute trip_stats';
  end if;
end $$;

do $$ begin raise notice 'PASS: 0097 trips tests'; end $$;

rollback;
