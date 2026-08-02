-- Test for 0116 (Prompt 3): create_manual_activity no longer writes the generated
-- geom column (it threw before), enforces editor/owner, and validates coordinates.
-- LOCAL disposable stack only.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000000ma001','ma-owner@example.test'),
  ('cccccccc-0000-0000-0000-0000000ma002','ma-viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-0000000ma001','owner','MA Owner'),
  ('cccccccc-0000-0000-0000-0000000ma002','viewer','MA Viewer');

-- Viewer denied.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000ma002"}';
do $$
begin
  begin
    perform public.create_manual_activity('x','Hike',null,null,1000,1,1,'2026-05-01T10:00:00Z');
    raise exception 'FAIL: viewer created a manual activity';
  exception when others then
    if sqlerrm !~ 'not authorized' then raise exception 'FAIL: unexpected viewer error: %', sqlerrm; end if;
  end;
end $$;
reset role;

-- Owner: bad coordinates rejected; a valid call succeeds with geom auto-computed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000ma001"}';
do $$
declare v_id uuid;
begin
  begin
    perform public.create_manual_activity('x','Hike',null,null,1000,999,1,'2026-05-01T10:00:00Z');
    raise exception 'FAIL: out-of-range coordinates accepted';
  exception when others then
    if sqlerrm !~ 'invalid coordinates' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
  end;

  -- Previously threw ("cannot insert a non-DEFAULT value into column geom").
  v_id := public.create_manual_activity('MA Hike','Hike',null,null,1609.34,38.9,-77.0,'2026-05-01T10:00:00Z');
  if v_id is null then raise exception 'FAIL: null id'; end if;
  if (select geom from public.activities where id = v_id) is null then
    raise exception 'FAIL: geom not auto-computed from lat/lng';
  end if;
end $$;
reset role;

do $$ begin raise notice 'PASS: create_manual_activity works (geom generated), guards enforced (0116)'; end $$;

rollback;
