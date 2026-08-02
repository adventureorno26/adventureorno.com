-- DB test for migration 0107 (integrity constraints). LOCAL disposable stack only.
-- Negative assertions use an ok-flag set inside the handler, checked outside.

begin;

-- Out-of-range coordinate is rejected.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.places (name, lat, lng, category, saved) values ('bad', 200, 0, 'beach', true);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: out-of-range place latitude was accepted'; end if;
end $$;

-- A half-coordinate activity (lat set, lng null) is rejected.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.activities (type, distance, lat, lng) values ('Run', 100, 45, null);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: half-coordinate activity was accepted'; end if;
end $$;

-- Negative distance is rejected.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.activities (type, distance, lat, lng) values ('Run', -5, null, null);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: negative distance was accepted'; end if;
end $$;

-- A coordinate-free activity (both null) with valid metrics is still allowed.
insert into public.activities (type, distance, lat, lng) values ('Run', 100, null, null);

do $$ begin raise notice 'PASS: integrity constraints (coord range, paired coords, non-negative)'; end $$;

rollback;
