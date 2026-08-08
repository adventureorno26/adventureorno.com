-- DB test for 0124 — atomic Trip linking in create_experience (Phase 2).
-- LOCAL disposable stack only.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-00000000a001', 'ce124-owner@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-00000000a001', 'owner', 'CE124 Owner') on conflict do nothing;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000a001"}';

-- 1) Place + planned stop land in ONE call.
do $$
declare t uuid; r jsonb; p uuid;
begin
  insert into public.trips (name, start_date, end_date)
  values ('CE124 Trip', '2026-09-01', '2026-09-10') returning id into t;

  r := public.create_experience('ce124-planned',
    jsonb_build_object('name','CE124 Planned Stop','lat',10.0,'lng',20.0,
                       'trip', jsonb_build_object('id', t::text)),
    '{}'::jsonb);
  p := (r->>'place_id')::uuid;

  if not exists (select 1 from public.trip_stops
                  where trip_id=t and place_id=p and status='planned' and visit_id is null) then
    raise exception 'FAIL: planned stop not created';
  end if;
  raise notice 'PASS 1: place + planned stop created atomically';
end $$;

-- 2) A visit in the SAME call promotes that stop to completed. This is only
--    possible because promote runs AFTER the stop insert (the 0124 reordering).
do $$
declare t uuid; r jsonb; p uuid; v uuid;
begin
  insert into public.trips (name, start_date, end_date)
  values ('CE124 Promote', '2026-09-01', '2026-09-10') returning id into t;

  r := public.create_experience('ce124-promote',
    jsonb_build_object('name','CE124 Promoted','lat',11.0,'lng',21.0,
                       'trip', jsonb_build_object('id', t::text)),
    jsonb_build_object('date','2026-09-05'));
  p := (r->>'place_id')::uuid; v := (r->>'visit_id')::uuid;

  if not exists (select 1 from public.trip_stops
                  where trip_id=t and place_id=p and status='completed' and visit_id=v) then
    raise exception 'FAIL: in-window visit did not promote the stop created in the same call';
  end if;
  raise notice 'PASS 2: same-call visit promotes the same-call stop';
end $$;

-- 3) An explicit 'completed' status requires a visit in the same call.
do $$
declare t uuid; ok boolean := false;
begin
  insert into public.trips (name) values ('CE124 NoVisit') returning id into t;
  begin
    perform public.create_experience('ce124-completed-novisit',
      jsonb_build_object('name','CE124 Bad','lat',12.0,'lng',22.0,
                         'trip', jsonb_build_object('id', t::text, 'status','completed')),
      '{}'::jsonb);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: completed stop accepted without a visit'; end if;
  raise notice 'PASS 3: completed stop without a visit rejected';
end $$;

-- 4) A dangling trip id fails loudly rather than silently dropping the link.
do $$
declare ok boolean := false;
begin
  begin
    perform public.create_experience('ce124-bad-trip',
      jsonb_build_object('name','CE124 Orphan','lat',13.0,'lng',23.0,
                         'trip', jsonb_build_object('id','99999999-9999-9999-9999-999999999999')),
      '{}'::jsonb);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: dangling trip id accepted'; end if;
  raise notice 'PASS 4: dangling trip id rejected';
end $$;

-- 5) ATOMICITY — the whole point. A trip link that violates a constraint must roll
--    back the PLACE too, leaving nothing behind for a retry to trip over.
do $$
declare before_places int; after_places int; ok boolean := false;
begin
  select count(*) into before_places from public.places;
  begin
    perform public.create_experience('ce124-atomic',
      jsonb_build_object('name','CE124 Must Not Persist','lat',14.0,'lng',24.0,
                         'trip', jsonb_build_object('id','99999999-9999-9999-9999-999999999999')),
      '{}'::jsonb);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: expected the call to fail'; end if;
  select count(*) into after_places from public.places;
  if after_places <> before_places then
    raise exception 'FAIL: the place survived a failed trip link (% -> %)', before_places, after_places;
  end if;
  if exists (select 1 from public.places where name = 'CE124 Must Not Persist') then
    raise exception 'FAIL: orphan place left behind';
  end if;
  raise notice 'PASS 5: a failed trip link rolls the place back too';
end $$;

-- 6) Retrying the same key does NOT create a second place or a second stop —
--    the exact bug addPlaceToTrip had (a fresh key per attempt duplicated places).
do $$
declare t uuid; r1 jsonb; r2 jsonb;
begin
  insert into public.trips (name) values ('CE124 Retry') returning id into t;
  r1 := public.create_experience('ce124-retry',
    jsonb_build_object('name','CE124 Retry Place','lat',15.0,'lng',25.0,
                       'trip', jsonb_build_object('id', t::text)), '{}'::jsonb);
  r2 := public.create_experience('ce124-retry',
    jsonb_build_object('name','CE124 Retry Place','lat',15.0,'lng',25.0,
                       'trip', jsonb_build_object('id', t::text)), '{}'::jsonb);

  if (r1->>'place_id') <> (r2->>'place_id') then
    raise exception 'FAIL: retry produced a different place'; end if;
  if (r2->>'idempotent')::boolean is not true then
    raise exception 'FAIL: retry not reported idempotent'; end if;
  if (select count(*) from public.places where name='CE124 Retry Place') <> 1 then
    raise exception 'FAIL: retry duplicated the place'; end if;
  if (select count(*) from public.trip_stops where trip_id=t) <> 1 then
    raise exception 'FAIL: retry duplicated the stop'; end if;
  raise notice 'PASS 6: retry duplicates neither place nor stop';
end $$;

-- 7) BACKWARD COMPATIBILITY — a payload with no `trip` behaves exactly as before,
--    including promote still running for an in-window pre-existing planned stop.
do $$
declare t uuid; p uuid; r jsonb;
begin
  insert into public.trips (name, start_date, end_date)
  values ('CE124 Legacy', '2026-10-01', '2026-10-10') returning id into t;

  -- pre-existing planned stop, created the OLD way
  p := (public.create_experience('ce124-legacy-place',
        jsonb_build_object('name','CE124 Legacy Place','lat',16.0,'lng',26.0),
        '{}'::jsonb)->>'place_id')::uuid;
  insert into public.trip_stops (trip_id, place_id, status) values (t, p, 'planned');

  -- a later visit with NO trip key must still promote it
  r := public.create_experience('ce124-legacy-visit',
    jsonb_build_object('id', p::text), jsonb_build_object('date','2026-10-05'));

  if not exists (select 1 from public.trip_stops
                  where trip_id=t and place_id=p and status='completed'
                    and visit_id=(r->>'visit_id')::uuid) then
    raise exception 'FAIL: legacy promotion path regressed';
  end if;
  raise notice 'PASS 7: pre-0124 behaviour unchanged';
end $$;

do $$ begin raise notice 'PASS: 0124 atomic trip linking'; end $$;

rollback;
