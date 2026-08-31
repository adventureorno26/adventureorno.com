-- Draft-linked leak RLS test for 0112 (Prompt 3). LOCAL disposable stack only.
-- Runs SELECTs under SET ROLE authenticated (real RLS, not superuser) to prove
-- entries/videos/ratings on an UNSAVED (draft) place are hidden from members who
-- can't see that place, while content on SAVED places stays visible.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-00000000d101','dl-owner@example.test'),
  ('cccccccc-0000-0000-0000-00000000d102','dl-editor@example.test'),
  ('cccccccc-0000-0000-0000-00000000d103','dl-viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-00000000d101','owner','DL Owner'),
  ('cccccccc-0000-0000-0000-00000000d102','editor','DL Editor'),
  ('cccccccc-0000-0000-0000-00000000d103','viewer','DL Viewer');
-- 0298: these actors used to share a space because `ensure_profile_space()` put any
-- new non-owner into the only one that existed. That heuristic is gone; the fixture
-- says what it needs instead. See supabase/tests/_prelude.sql.
select test_support.share_one_space();


-- A SAVED place and an UNSAVED (draft) place, both authored by the owner.
insert into public.places (id,name,lat,lng,saved,created_by) values
  ('dddddddd-0000-0000-0000-00000000d101','DL Saved',1,1,true, 'cccccccc-0000-0000-0000-00000000d101'),
  ('dddddddd-0000-0000-0000-00000000d102','DL Draft',2,2,false,'cccccccc-0000-0000-0000-00000000d101');

-- One entry on each place (owner-authored).
insert into public.entries (id,place_id,kind,title,created_by) values
  ('eeeeeeee-0000-0000-0000-00000000d101','dddddddd-0000-0000-0000-00000000d101','dining','Saved note','cccccccc-0000-0000-0000-00000000d101'),
  ('eeeeeeee-0000-0000-0000-00000000d102','dddddddd-0000-0000-0000-00000000d102','dining','Draft note','cccccccc-0000-0000-0000-00000000d101');

-- One rating on each place by the owner.
insert into public.place_ratings (place_id,profile_id,rating) values
  ('dddddddd-0000-0000-0000-00000000d101','cccccccc-0000-0000-0000-00000000d101',5),
  ('dddddddd-0000-0000-0000-00000000d102','cccccccc-0000-0000-0000-00000000d101',5);

-- VIEWER: sees only the saved-place entry + rating; the draft ones are hidden.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000d103"}';
do $$
begin
  if exists (select 1 from public.entries where id='eeeeeeee-0000-0000-0000-00000000d102') then
    raise exception 'FAIL: viewer can read the draft-place entry';
  end if;
  if not exists (select 1 from public.entries where id='eeeeeeee-0000-0000-0000-00000000d101') then
    raise exception 'FAIL: viewer cannot read the saved-place entry';
  end if;
  if exists (select 1 from public.place_ratings where place_id='dddddddd-0000-0000-0000-00000000d102') then
    raise exception 'FAIL: viewer can read the draft-place rating';
  end if;
  if not exists (select 1 from public.place_ratings where place_id='dddddddd-0000-0000-0000-00000000d101') then
    raise exception 'FAIL: viewer cannot read the saved-place rating';
  end if;
end $$;
reset role;

-- EDITOR (not the author, not owner): also cannot see the owner's draft entry
-- (consistent with photos_select), but sees the saved-place entry.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000d102"}';
do $$
begin
  if exists (select 1 from public.entries where id='eeeeeeee-0000-0000-0000-00000000d102') then
    raise exception 'FAIL: editor can read another user''s draft-place entry';
  end if;
  if not exists (select 1 from public.entries where id='eeeeeeee-0000-0000-0000-00000000d101') then
    raise exception 'FAIL: editor cannot read the saved-place entry';
  end if;
end $$;
reset role;

-- OWNER (author): sees their own draft entry (created_by = self).
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000d101"}';
do $$
begin
  if not exists (select 1 from public.entries where id='eeeeeeee-0000-0000-0000-00000000d102') then
    raise exception 'FAIL: author/owner cannot read their own draft entry';
  end if;
end $$;
reset role;

do $$ begin raise notice 'PASS: draft-linked entries/ratings hidden from non-visible members (0112)'; end $$;

rollback;
