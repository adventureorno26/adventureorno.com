-- Draft-privacy RLS test. LOCAL disposable stack only.
-- Runs SELECTs under SET ROLE authenticated with fictional owner/editor/viewer JWTs,
-- so it exercises the REAL grants + RLS policies (not superuser, which bypasses RLS).
--
-- Rewritten by migration 0137. It used to assert draft privacy on `trips` and
-- `trip_stops`, which are gone. The RULE still exists and still matters — it just
-- lives where it always really lived, in `places_select`:
--
--   (deleted_at is null) and is_member()
--   and (saved or created_by = auth.uid() or (created_by is null and is_owner()))
--
-- One subtlety worth writing down, because it is easy to assume otherwise and this
-- test proved it the hard way: `places_write` is a PERMISSIVE policy `for all` with
-- `is_editor_or_owner()`, and a permissive ALL policy also permits SELECT. So owner
-- and editor read every place regardless of the draft clause; the clause is what
-- keeps drafts away from a VIEWER. That is the rule being protected here.

begin;

-- Fictional identities (as superuser): owner, editor, viewer.
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000000000a1','owner@example.test'),
  ('cccccccc-0000-0000-0000-0000000000a2','viewer@example.test'),
  ('cccccccc-0000-0000-0000-0000000000a3','editor@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-0000000000a1','owner','Owner'),
  ('cccccccc-0000-0000-0000-0000000000a2','viewer','Viewer'),
  ('cccccccc-0000-0000-0000-0000000000a3','editor','Editor');

-- A SAVED place, an UNSAVED draft the EDITOR created, and an unsaved draft with no
-- creator at all (the shape the map's drop-a-pin flow used to leave behind).
insert into public.places (id,name,lat,lng,saved,created_by) values
  ('dddddddd-0000-0000-0000-0000000000a1','DP Saved Place',   1,1,true,  null),
  ('dddddddd-0000-0000-0000-0000000000a2','DP Editor Draft',  2,2,false,'cccccccc-0000-0000-0000-0000000000a3'),
  ('dddddddd-0000-0000-0000-0000000000a3','DP Ownerless Draft',3,3,false, null);

-- OWNER and EDITOR can write, so they read everything — including each other's
-- drafts. Asserted so the ALL-policy interaction is documented, not discovered.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from public.places
   where id in ('dddddddd-0000-0000-0000-0000000000a1',
                'dddddddd-0000-0000-0000-0000000000a2',
                'dddddddd-0000-0000-0000-0000000000a3');
  if n <> 3 then raise exception 'FAIL: owner should read all 3 places, got %', n; end if;
  raise notice 'PASS: owner reads saved places and drafts alike';
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from public.places
   where id in ('dddddddd-0000-0000-0000-0000000000a1',
                'dddddddd-0000-0000-0000-0000000000a2',
                'dddddddd-0000-0000-0000-0000000000a3');
  if n <> 3 then raise exception 'FAIL: editor should read all 3 places, got %', n; end if;
  raise notice 'PASS: editor reads saved places and drafts alike';
end $$;
reset role;

-- VIEWER sees ONLY the saved place. This is the assertion that matters: a draft
-- must never leak to a member who did not create it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$
declare n int;
begin
  if not exists (select 1 from public.places where id='dddddddd-0000-0000-0000-0000000000a1') then
    raise exception 'FAIL: viewer cannot see a saved place';
  end if;
  select count(*) into n from public.places
   where id in ('dddddddd-0000-0000-0000-0000000000a2','dddddddd-0000-0000-0000-0000000000a3');
  if n <> 0 then
    raise exception 'FAIL: viewer saw % draft place(s)', n;
  end if;
  raise notice 'PASS: viewer sees only the saved place';
end $$;
reset role;

-- NEGATIVE CONTROL: saving the editor's draft makes it visible to the viewer. If
-- the policy stopped keying on `saved`, the viewer would have seen it above and
-- this would prove nothing — so it is asserted both ways.
update public.places set saved = true where id='dddddddd-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$
begin
  if not exists (select 1 from public.places where id='dddddddd-0000-0000-0000-0000000000a2') then
    raise exception 'FAIL: a SAVED place is still hidden from the viewer';
  end if;
  raise notice 'PASS: saving the draft reveals it';
end $$;
reset role;

do $$ begin raise notice 'PASS: draft-privacy RLS (owner, editor, viewer)'; end $$;

rollback;
