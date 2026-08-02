-- Authz test for 0113 (Prompt 3). LOCAL disposable stack only.
-- A viewer must NOT be able to call dismiss_duplicate or import_file_activity;
-- an editor/owner can. Runs under SET ROLE authenticated so grants + the in-function
-- is_editor_or_owner() guard are both exercised.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000006d0001','gm-owner@example.test'),
  ('cccccccc-0000-0000-0000-0000006d0002','gm-viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-0000006d0001','owner','GM Owner'),
  ('cccccccc-0000-0000-0000-0000006d0002','viewer','GM Viewer');
insert into public.places (id,name,lat,lng,saved) values
  ('dddddddd-0000-0000-0000-0000006d0001','GM A',1,1,true),
  ('dddddddd-0000-0000-0000-0000006d0002','GM B',2,2,true);

-- VIEWER: both mutations must raise 'not authorized'.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000006d0002"}';
do $$
begin
  begin
    perform public.dismiss_duplicate('dddddddd-0000-0000-0000-0000006d0001','dddddddd-0000-0000-0000-0000006d0002');
    raise exception 'FAIL: viewer dismissed a duplicate';
  exception when others then
    if sqlerrm !~ 'not authorized' then raise exception 'FAIL: unexpected viewer error: %', sqlerrm; end if;
  end;
  begin
    perform public.import_file_activity('x','Run',null,1000,600,1,1,'2026-06-01T10:00:00Z');
    raise exception 'FAIL: viewer imported an activity';
  exception when others then
    if sqlerrm !~ 'not authorized' then raise exception 'FAIL: unexpected viewer error: %', sqlerrm; end if;
  end;
end $$;
reset role;

-- OWNER: dismiss_duplicate succeeds and records the dismissal.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000006d0001"}';
do $$
begin
  perform public.dismiss_duplicate('dddddddd-0000-0000-0000-0000006d0001','dddddddd-0000-0000-0000-0000006d0002');
  if not exists (select 1 from public.dup_dismissed
                 where place_a='dddddddd-0000-0000-0000-0000006d0001'
                   and place_b='dddddddd-0000-0000-0000-0000006d0002') then
    raise exception 'FAIL: owner dismiss_duplicate did not record';
  end if;
end $$;
reset role;

do $$ begin raise notice 'PASS: mutation RPCs deny viewer, allow owner (0113)'; end $$;

rollback;
