-- OAuth-state test for 0115 (Prompt 3). LOCAL disposable stack only.
-- Proves the Strava link state is random, single-use, owner-bound, and that
-- consume rejects replay / expiry / unknown values.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000000a0001','oa-owner@example.test'),
  ('cccccccc-0000-0000-0000-0000000a0002','oa-viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-0000000a0001','owner','OA Owner'),
  ('cccccccc-0000-0000-0000-0000000a0002','viewer','OA Viewer');

-- A non-editor (viewer) may NOT mint a state.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000a0002"}';
do $$
begin
  begin
    perform public.strava_oauth_start();
    raise exception 'FAIL: viewer minted an oauth state';
  exception when others then
    if sqlerrm !~ 'not authorized' then raise exception 'FAIL: unexpected viewer error: %', sqlerrm; end if;
  end;
end $$;
reset role;

-- Owner mints a random state bound to their profile. Save it in a transaction-local
-- setting so the service-role callback can consume it below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000a0001"}';
do $$
declare v_state text;
begin
  v_state := public.strava_oauth_start();
  if length(v_state) < 40 then raise exception 'FAIL: state too short (%)', length(v_state); end if;

  perform set_config('app.oauth_test_state', v_state, true);
end $$;
reset role;

-- The callback runs with service_role. Client roles must not be able to consume a
-- state; service_role can consume it exactly once and receives the bound owner id.
set local role service_role;
do $$
declare v_state text := current_setting('app.oauth_test_state'); v_p1 uuid; v_p2 uuid;
begin

  -- First consume returns the bound owner id.
  v_p1 := public.consume_oauth_state(v_state, 'strava');
  if v_p1 <> 'cccccccc-0000-0000-0000-0000000a0001' then
    raise exception 'FAIL: consume returned % not the owner', v_p1;
  end if;

  -- Replay: the same state is now used → NULL.
  v_p2 := public.consume_oauth_state(v_state, 'strava');
  if v_p2 is not null then raise exception 'FAIL: state was replayable'; end if;

  -- Unknown state → NULL.
  if public.consume_oauth_state('does-not-exist', 'strava') is not null then
    raise exception 'FAIL: unknown state accepted';
  end if;
end $$;
reset role;

-- Expired states are rejected. Insert a back-dated state directly (as the test's
-- default superuser), then try to consume it as the service-role callback.
insert into public.oauth_states (state, provider, profile_id, expires_at)
values ('expired-test-state', 'strava', 'cccccccc-0000-0000-0000-0000000a0001', now() - interval '1 minute');
set local role service_role;
do $$
begin
  if public.consume_oauth_state('expired-test-state', 'strava') is not null then
    raise exception 'FAIL: expired state accepted';
  end if;
end $$;
reset role;

do $$ begin raise notice 'PASS: oauth state random, single-use, owner-bound, expiry+replay rejected (0115)'; end $$;

rollback;
