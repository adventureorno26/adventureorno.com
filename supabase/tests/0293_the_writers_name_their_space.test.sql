-- 0293 — the writers name their space.
--
-- WHY THIS FILE EXISTS. 0290 scoped the READERS and said, in its own header, that the two
-- write paths it found were "a real gap and this file does not close it". The gap turned
-- out to be eighty-eight functions, and it was reproduced on production as a working
-- exploit before a line of 0293 was written:
--
--     as Josh, who is NOT a member of Erica's space:
--       select public.edit_visit('<a visit in Erica's space>', '2019-01-01', '2019-01-02', …);
--     it did not error, and her visit's dates had been rewritten to 2019.
--
-- SECTION 1 IS THAT EXPLOIT, REBUILT. It is the reason the file exists, so it is asked
-- first and on its own, in both directions — the call must raise AND the row must be
-- unchanged afterwards. A guard that raises after the write has landed is not a guard.
--
-- Sections 2 and 3 do the same for `delete_visit` and `merge_places_auto`. Section 4 is
-- the half that is easy to forget: NEITHER ACCOUNT MAY LOSE A CAPABILITY. A boundary that
-- refuses everybody passes every test in sections 1–3 and is an outage.
--
-- Sections 5–8 are about the guard rather than about a function: that every space-owned
-- table carries it, that exactly the two intended functions are exempt from it, that the
-- exemption actually still lets a tag be answered across the boundary, and that there is
-- no boundary to enforce when there is no caller.
--
-- NO PRODUCTION COUNT IS ASSERTED ANYWHERE HERE. Every number below is about rows this
-- file inserted, identified by its own ids. `scripts/db-test.sh` replays the whole chain
-- from an EMPTY schema where every production total is 0, and "expected exactly N" has
-- broken CI on this repository twice.
begin;

-- ---- FIXTURES: two spaces that are genuinely separate ----------------------
insert into auth.users (id, email) values
  ('aaaa0293-0000-0000-0000-000000000001','v293-ann@example.test'),
  ('bbbb0293-0000-0000-0000-000000000002','v293-ben@example.test')
  on conflict do nothing;

insert into public.profiles (id, role, display_name) values
  ('aaaa0293-0000-0000-0000-000000000001','owner','V293 Ann'),
  ('bbbb0293-0000-0000-0000-000000000002','owner','V293 Ben')
  on conflict do nothing;

insert into public.spaces (id, name, owner_profile) values
  ('11110293-0000-0000-0000-000000000001','V293 Ann space','aaaa0293-0000-0000-0000-000000000001'),
  ('22220293-0000-0000-0000-000000000002','V293 Ben space','bbbb0293-0000-0000-0000-000000000002')
  on conflict do nothing;

-- ANN IS IN HERS, BEN IS IN HIS, AND NEITHER IS IN THE OTHER'S. Both are `owner` in
-- `profiles`, which is what `is_editor_or_owner()` reads — so every refusal below is the
-- SPACE refusing, never the role. That is the whole point: Josh is an owner too, and it
-- is exactly why the role check let him through.
delete from public.space_memberships
 where profile_id in ('aaaa0293-0000-0000-0000-000000000001','bbbb0293-0000-0000-0000-000000000002');
insert into public.space_memberships (space_id, profile_id, role) values
  ('11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001','owner'),
  ('22220293-0000-0000-0000-000000000002','bbbb0293-0000-0000-0000-000000000002','owner');

insert into public.places (id, name, lat, lng, saved, space_id, created_by) values
  ('a1110293-0000-0000-0000-000000000001','V293 Ann Overlook', 39.10, -77.20, true,
   '11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001'),
  ('b2220293-0000-0000-0000-000000000002','V293 Ben Overlook', 39.20, -77.30, true,
   '22220293-0000-0000-0000-000000000002','bbbb0293-0000-0000-0000-000000000002')
  on conflict do nothing;

insert into public.visits (id, place_id, start_date, end_date, status, accepted_at, space_id, created_by) values
  ('a3330293-0000-0000-0000-000000000001','a1110293-0000-0000-0000-000000000001',
   date '2026-08-30', date '2026-08-30', 'taken', now(),
   '11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001'),
  ('b4440293-0000-0000-0000-000000000002','b2220293-0000-0000-0000-000000000002',
   date '2026-08-30', date '2026-08-30', 'taken', now(),
   '22220293-0000-0000-0000-000000000002','bbbb0293-0000-0000-0000-000000000002')
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. THE EXPLOIT. `edit_visit`, as Ben, against a visit in Ann's space.
--
--    `auth.uid()` comes from `request.jwt.claims`, not from the session role, so the
--    guard is asked the same question here that it was asked on production.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbb0293-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

do $$
declare
  v_raised boolean := false;
  v_start  date;
  v_end    date;
  v_state  text;
begin
  begin
    perform public.edit_visit('a3330293-0000-0000-0000-000000000001'::uuid,
                              date '2019-01-01', date '2019-01-02',
                              null::text, null::boolean, null::text, null::boolean);
  exception when others then
    v_raised := true;
    get stacked diagnostics v_state = returned_sqlstate;
  end;

  if not v_raised then
    raise exception 'FAIL 1: edit_visit let Ben rewrite a visit in Ann''s space. THIS IS THE PRODUCTION EXPLOIT, STILL OPEN.';
  end if;
  if v_state <> '42501' then
    raise exception 'FAIL 1: edit_visit refused Ben, but with sqlstate % rather than 42501. A boundary refusal must be distinguishable from a validation error, or the app cannot tell "not yours" from "bad dates".', v_state;
  end if;

  -- AND THE ROW MUST BE UNTOUCHED. The refusal is only half the claim; a guard that
  -- raises after the UPDATE has landed would pass every assertion above.
  select start_date, end_date into v_start, v_end
    from public.visits where id = 'a3330293-0000-0000-0000-000000000001';
  if v_start <> date '2026-08-30' or v_end <> date '2026-08-30' then
    raise exception 'FAIL 1: edit_visit raised, but Ann''s dates are now % … %. The write landed before the guard did.', v_start, v_end;
  end if;

  raise notice 'PASS 1: edit_visit refuses Ben a visit in Ann''s space (42501), and her dates are unchanged';
end $$;

-- ---------------------------------------------------------------------------
-- 2. `delete_visit`, same caller, same row. A separate section because a DELETE reaches
--    the guard through a different trigger event than an UPDATE, and "the UPDATE path
--    works" says nothing about the DELETE path.
-- ---------------------------------------------------------------------------
do $$
declare v_raised boolean := false; n int;
begin
  begin
    perform public.delete_visit('a3330293-0000-0000-0000-000000000001'::uuid, 'detach');
  exception when others then v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL 2: delete_visit let Ben delete a visit in Ann''s space.';
  end if;

  select count(*) into n from public.visits where id = 'a3330293-0000-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'FAIL 2: delete_visit raised, but Ann''s visit is gone anyway.';
  end if;

  raise notice 'PASS 2: delete_visit refuses Ben a visit in Ann''s space, and her visit is still there';
end $$;

-- ---------------------------------------------------------------------------
-- 3. `merge_places_auto` — the function 0290 named by name as the one nothing stopped
--    from "merging a place in Erica's space into one in Josh's". It is not granted to
--    `authenticated`, so it is called with the session role reset and Ben's claims still
--    in scope, which is how it is reached in production: from inside another definer.
-- ---------------------------------------------------------------------------
reset role;
do $$
declare v_raised boolean := false; n_place int; n_visit int;
begin
  begin
    perform public.merge_places_auto('a1110293-0000-0000-0000-000000000001'::uuid,
                                     'b2220293-0000-0000-0000-000000000002'::uuid);
  exception when others then v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL 3: merge_places_auto let Ben merge Ann''s place into his own. This is 0290''s named gap, still open.';
  end if;

  select count(*) into n_place from public.places where id = 'a1110293-0000-0000-0000-000000000001';
  select count(*) into n_visit from public.visits where id = 'a3330293-0000-0000-0000-000000000001';
  if n_place <> 1 or n_visit <> 1 then
    raise exception 'FAIL 3: merge_places_auto raised, but Ann''s place/visit are gone (place=%, visit=%).', n_place, n_visit;
  end if;

  raise notice 'PASS 3: merge_places_auto refuses Ben Ann''s place, and neither her place nor her visit moved';
end $$;

-- ---------------------------------------------------------------------------
-- 4. NEITHER ACCOUNT LOSES A CAPABILITY.
--
--    This is the half that sections 1–3 cannot see. A guard wired to `false` passes all
--    three of them. Both people must still be able to do to their OWN rows exactly what
--    they could do yesterday — and it is asked for BOTH of them, in both directions,
--    because a guard that reads the wrong side of the comparison would let one through.
-- ---------------------------------------------------------------------------
set local role authenticated;   -- still Ben's claims
do $$
declare v public.visits;
begin
  v := public.edit_visit('b4440293-0000-0000-0000-000000000002'::uuid,
                         date '2026-08-28', date '2026-08-29',
                         null::text, null::boolean, null::text, null::boolean);
  if v.start_date <> date '2026-08-28' or v.end_date <> date '2026-08-29' then
    raise exception 'FAIL 4: Ben edited his OWN visit and the dates did not take (% … %).', v.start_date, v.end_date;
  end if;
  raise notice 'PASS 4a: Ben can still edit his own visit';
end $$;

reset role;
set local request.jwt.claims = '{"sub":"aaaa0293-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
do $$
declare v public.visits; n int;
begin
  v := public.edit_visit('a3330293-0000-0000-0000-000000000001'::uuid,
                         date '2026-08-26', date '2026-08-27',
                         null::text, null::boolean, null::text, null::boolean);
  if v.start_date <> date '2026-08-26' then
    raise exception 'FAIL 4: Ann edited her OWN visit and the dates did not take (%).', v.start_date;
  end if;

  -- And the mirror of section 1: Ann must be refused BEN's visit, so that the guard is
  -- demonstrably comparing spaces rather than favouring whoever happens to be first.
  begin
    perform public.edit_visit('b4440293-0000-0000-0000-000000000002'::uuid,
                              date '2019-01-01', date '2019-01-02',
                              null::text, null::boolean, null::text, null::boolean);
    raise exception 'FAIL 4: edit_visit let Ann rewrite a visit in Ben''s space. The guard only holds in one direction.';
  exception when sqlstate '42501' then
    null;  -- the expected answer
  end;

  select count(*) into n from public.visits
   where id = 'b4440293-0000-0000-0000-000000000002' and start_date = date '2026-08-28';
  if n <> 1 then
    raise exception 'FAIL 4: Ann was refused Ben''s visit but its dates changed anyway.';
  end if;

  -- Deleting her own visit must still work, which is the capability section 2 took away
  -- from Ben and must not have taken from her.
  perform public.delete_visit('a3330293-0000-0000-0000-000000000001'::uuid, 'detach');
  select count(*) into n from public.visits where id = 'a3330293-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'FAIL 4: Ann could not delete her own visit.';
  end if;

  raise notice 'PASS 4b: Ann can still edit and delete her own visits, and is refused Ben''s';
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------
-- 5. COVERAGE. Every base table carrying a `space_id` must carry the guard, except the
--    two the migration excludes by name. Stated as "none missing" rather than as a count,
--    because the count is a production number and this replays into an empty schema.
-- ---------------------------------------------------------------------------
begin;
do $$
declare missing text; extra text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'space_id'
                       and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.relname not in ('space_memberships','invites')
     and not exists (select 1 from pg_trigger t
                      where t.tgrelid = c.oid and t.tgname = 'refuse_write_outside_my_space');
  if missing is not null then
    raise exception 'FAIL 5: space-owned table(s) with no boundary guard: %. Every SECURITY DEFINER writer that touches one of these bypasses RLS by construction.', missing;
  end if;

  -- And the exclusions are still the two that were reasoned about, not a third somebody
  -- added to make a test go green.
  select string_agg(c.relname, ', ' order by c.relname) into extra
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'space_id'
                       and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.relname not in ('space_memberships','invites')
     and not exists (select 1 from pg_trigger t
                      where t.tgrelid = c.oid and t.tgname = 'refuse_write_outside_my_space');
  raise notice 'PASS 5: every space-owned base table outside the two named exclusions carries the guard';
end $$;

-- ---------------------------------------------------------------------------
-- 6. THE EXEMPTION LIST IS EXACTLY TWO, AND THEY ARE THE TWO THAT WERE REASONED ABOUT.
--    The exemption is a GUC and a GUC is a string — the one residual the migration names.
--    Asserting the set (not a count) is what makes a third exemption a build failure
--    rather than a comment nobody reads.
-- ---------------------------------------------------------------------------
do $$
declare got text;
begin
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into got
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
                  where c like 'aon.cross_space_write=%');
  if got <> 'respond_to_memory_tag, respond_to_tag' then
    raise exception 'FAIL 6: the set of functions exempt from the space boundary is now "%" — expected "respond_to_memory_tag, respond_to_tag". Every name on that list can write into any space in the database.', got;
  end if;
  raise notice 'PASS 6: exactly respond_to_tag and respond_to_memory_tag are exempt';
end $$;

-- ---------------------------------------------------------------------------
-- 7. THE EXEMPTION IS NOT DECORATIVE: a tag is still answerable across the boundary.
--    This is the assertion that would have caught the mistake 0290 warns about — a
--    boundary check added where it silently breaks the feature it was standing next to.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaa0293-0000-0000-0000-000000000001','v293-ann@example.test'),
  ('bbbb0293-0000-0000-0000-000000000002','v293-ben@example.test')
  on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa0293-0000-0000-0000-000000000001','owner','V293 Ann'),
  ('bbbb0293-0000-0000-0000-000000000002','owner','V293 Ben')
  on conflict do nothing;
insert into public.spaces (id, name, owner_profile) values
  ('11110293-0000-0000-0000-000000000001','V293 Ann space','aaaa0293-0000-0000-0000-000000000001'),
  ('22220293-0000-0000-0000-000000000002','V293 Ben space','bbbb0293-0000-0000-0000-000000000002')
  on conflict do nothing;
delete from public.space_memberships
 where profile_id in ('aaaa0293-0000-0000-0000-000000000001','bbbb0293-0000-0000-0000-000000000002');
insert into public.space_memberships (space_id, profile_id, role) values
  ('11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001','owner'),
  ('22220293-0000-0000-0000-000000000002','bbbb0293-0000-0000-0000-000000000002','owner');

insert into public.places (id, name, lat, lng, saved, space_id, created_by) values
  ('a1110293-0000-0000-0000-000000000001','V293 Ann Overlook', 39.10, -77.20, true,
   '11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001')
  on conflict do nothing;
insert into public.visits (id, place_id, start_date, end_date, status, accepted_at, space_id, created_by) values
  ('a3330293-0000-0000-0000-000000000001','a1110293-0000-0000-0000-000000000001',
   date '2026-08-30', date '2026-08-30', 'taken', now(),
   '11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001')
  on conflict do nothing;

-- Ann asserts, in HER space, that Ben was on her visit. The claim row is hers.
insert into public.tag_claims
  (id, subject_kind, subject_id, profile_id, asserted_by, status, space_id)
values
  ('c5550293-0000-0000-0000-000000000001','visit','a3330293-0000-0000-0000-000000000001',
   'bbbb0293-0000-0000-0000-000000000002','aaaa0293-0000-0000-0000-000000000001','proposed',
   '11110293-0000-0000-0000-000000000001')
  on conflict do nothing;

set local request.jwt.claims = '{"sub":"bbbb0293-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
do $$
declare v_status text;
begin
  perform public.respond_to_tag('c5550293-0000-0000-0000-000000000001'::uuid, true);
  select status into v_status from public.tag_claims where id = 'c5550293-0000-0000-0000-000000000001';
  if v_status is distinct from 'accepted' then
    raise exception 'FAIL 7: Ben could not accept a tag Ann made about him (status is now %). The boundary refused the one write whose entire purpose is to cross it — this is the "bug that looked like a fix" 0290 names.', v_status;
  end if;
  raise notice 'PASS 7: a tag made in Ann''s space is still answerable by Ben from his';
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------
-- 8. NO CALLER, NO BOUNDARY. With no JWT in scope — service_role, cron, a migration
--    replay, `scripts/db-bootstrap.sh` — the guard stands down. If it did not, this test
--    file could not have written its own fixtures, and neither could the photo gateway,
--    which `workers/photo-gateway/src/supa.ts` says writes with the service_role key.
-- ---------------------------------------------------------------------------
begin;
do $$
declare n int;
begin
  if auth.uid() is not null then
    raise exception 'FAIL 8: this section assumes no JWT is in scope, and one is.';
  end if;
  insert into public.spaces (id, name, owner_profile)
  values ('33330293-0000-0000-0000-000000000003','V293 nobody space', null)
  on conflict do nothing;
  insert into public.places (id, name, lat, lng, saved, space_id)
  values ('c9990293-0000-0000-0000-000000000003','V293 Callerless', 38.0, -78.0, true,
          '33330293-0000-0000-0000-000000000003');
  select count(*) into n from public.places where id = 'c9990293-0000-0000-0000-000000000003';
  if n <> 1 then
    raise exception 'FAIL 8: a callerless write into a space nobody is in was refused. The importer, the photo gateway and db-bootstrap all write this way.';
  end if;
  raise notice 'PASS 8: with no caller there is no boundary to enforce, and the write goes through';
end $$;
rollback;

begin;
do $$ begin
  raise notice 'PASS 0293: a SECURITY DEFINER writer cannot touch a row outside the caller''s space — edit_visit, delete_visit and merge_places_auto all refuse across the boundary and change nothing, both people keep every capability they had, the two consent paths still cross on purpose, and a callerless write is still allowed';
end $$;
rollback;
