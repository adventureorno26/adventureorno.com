-- DB test for migration 0102 (home-zone removal). LOCAL disposable stack only.
-- Asserts the setting is gone, no place is flagged is_home, and neither the
-- clustering job nor activity placement references the home zone anymore.

begin;

-- The setting is deleted.
do $$
begin
  if exists (select 1 from public.settings where key = 'home_zone') then
    raise exception 'FAIL: home_zone setting still present';
  end if;
end $$;

-- No place remains flagged as the single "home" place.
do $$
begin
  if exists (select 1 from public.places where is_home) then
    raise exception 'FAIL: an is_home place still exists after 0102';
  end if;
end $$;

-- cluster_unassigned() no longer reads the home zone or deletes in-zone points.
do $$
begin
  if pg_get_functiondef('public.cluster_unassigned()'::regprocedure) ilike '%home_zone%' then
    raise exception 'FAIL: cluster_unassigned still references home_zone';
  end if;
end $$;

-- assign_activity_place() places normally and never creates an is_home place.
do $$
declare v_place uuid;
begin
  if pg_get_functiondef('public.assign_activity_place(float8,float8)'::regprocedure) ilike '%is_home%' then
    raise exception 'FAIL: assign_activity_place still references is_home';
  end if;
  -- Placing an activity at the old home center yields a NORMAL place.
  v_place := public.assign_activity_place(39.1157, -77.5636);
  if v_place is null then raise exception 'FAIL: assign_activity_place returned null'; end if;
  if (select is_home from public.places where id = v_place) then
    raise exception 'FAIL: assign_activity_place created an is_home place';
  end if;
end $$;

do $$ begin raise notice 'PASS: home zone removed (settings, cluster, activity placement)'; end $$;

rollback;
