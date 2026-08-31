-- A space is the boundary, and an account outside it reads nothing.
--
-- 0281 replaces `is_member()` — which was, in full, "is there a row in `profiles` with your
-- id" — with `is_member(space_id)`. The test that matters is behavioural and is section 5:
-- a second account with a `profiles` row and no membership of your space must read ZERO of
-- your rows through every table and every view, including the three SECURITY DEFINER views
-- that were answering everybody with everything.
--
-- THE BACKFILL ITSELF IS NOT ASSERTED HERE, because it cannot be: on a fresh database there
-- is nothing to place. Its correctness was measured where the data is — on production,
-- inside `begin … rollback`, on 2026-08-30. A fourth account holding only a `profiles` row
-- read 557 visits, 156 places, 179 photos, 619 evidence rows, 665 `visit_profiles` and 628
-- `activity_profiles` before, and 0 of each after. Not one of the 22 numbers behind My
-- Stats, Our Stats or Settings ▸ Stats moved for Erica, Josh or Test Bot.
begin;

set local check_function_bodies = off;

-- ---- 1. EVERY SPACE-OWNED TABLE ACTUALLY CARRIES ONE -------------------------
do $$
declare t text; n int := 0;
begin
  foreach t in array array[
    'places','visits','activities','photos','videos','entries','people','memory_subjects',
    'memory_people','visit_evidence','visit_people','place_ratings','place_wishes',
    'place_membership','place_categories','settings','peak_bags','peaks','parks',
    'trail_routes','revealed_area','location_pings','activity_sources','invites']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    n := n + 1;
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = ('public.' || t)::regclass and a.attname = 'space_id'
                      and a.attnum > 0 and not a.attisdropped and a.attnotnull) then
      raise exception 'FAIL: public.%.space_id is missing or nullable', t;
    end if;
    if not exists (select 1 from pg_constraint c
                    where c.conrelid = ('public.' || t)::regclass and c.contype = 'f'
                      and c.confrelid = 'public.spaces'::regclass) then
      raise exception 'FAIL: public.% has no foreign key to spaces', t;
    end if;
  end loop;
  -- Bounded, not exact: a schema that has moved on may have renamed one of these, and this
  -- test must not become the reason a table cannot be renamed.
  if n < 20 then
    raise exception 'FAIL: only % of the space-owned tables were found', n;
  end if;
end $$;

-- ---- 2. NO POLICY ON A SPACE-OWNED TABLE STILL ASKS THE OLD QUESTION ---------
-- This is the check that catches a HALF-partitioned database, which is worse than an
-- unpartitioned one because it looks safe.
do $$
declare n int;
begin
  select count(*) into n
    from pg_policies p
    join pg_class c on c.oid = ('public.' || p.tablename)::regclass
   where p.schemaname = 'public'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'space_id'
                    and a.attnum > 0 and not a.attisdropped)
     and (coalesce(p.qual,'') || coalesce(p.with_check,''))
         ~ '\m(is_member|is_owner|is_editor_or_owner)\(\)';
  if n <> 0 then
    raise exception 'FAIL: % policy/policies on a space-owned table still use the session-wide check', n;
  end if;
end $$;

-- ---- 3. ALL SEVEN VIEWS SAY THE BOUNDARY OUT LOUD ---------------------------
do $$
declare v text;
begin
  foreach v in array array['activity_profiles','visit_profiles','activity_provenance',
                           'accepted_visits','visible_activities','place_counts','activity_mileage'] loop
    if pg_get_viewdef(('public.' || v)::regclass, true) not like '%is_member(%' then
      raise exception 'FAIL: public.% does not state its space boundary', v;
    end if;
  end loop;

  -- The three stay DEFINER on purpose (Erica, 2026-08-30: seeing a memory means seeing who
  -- was on it), and the four stay INVOKER. A view that quietly swapped is the bug.
  foreach v in array array['activity_profiles','visit_profiles','activity_provenance'] loop
    if 'security_invoker=true' = any (coalesce(
         (select reloptions from pg_class where oid = ('public.' || v)::regclass), '{}')) then
      raise exception 'FAIL: public.% became security_invoker', v;
    end if;
  end loop;
  foreach v in array array['accepted_visits','visible_activities','place_counts','activity_mileage'] loop
    if not ('security_invoker=true' = any (coalesce(
              (select reloptions from pg_class where oid = ('public.' || v)::regclass), '{}'))) then
      raise exception 'FAIL: public.% lost security_invoker', v;
    end if;
  end loop;
end $$;

-- ---- 4. can_see_memory_subject HAS A VISIT BRANCH ---------------------------
-- Without it the CASE fell through to `else false` on all 557 production visit subjects,
-- and `memory_subjects_write` — a FOR ALL policy — was quietly acting as the read rule.
do $$
begin
  if pg_get_functiondef('public.can_see_memory_subject(uuid)'::regprocedure)
     not like '%when ''visit'' then%' then
    raise exception 'FAIL: can_see_memory_subject still has no visit branch';
  end if;
end $$;

-- ---- 5. THE BEHAVIOUR. Two accounts, two spaces, and nothing crosses. --------
insert into auth.users (id, email) values
  ('aaaa0281-0000-0000-0000-000000000001','owner0281@example.invalid'),
  ('bbbb0281-0000-0000-0000-000000000002','stranger0281@example.invalid')
on conflict do nothing;

-- The first `owner` claims the space the seeded reference rows already live in.
insert into public.profiles (id, display_name, role)
values ('aaaa0281-0000-0000-0000-000000000001','Owner0281','owner')
on conflict (id) do nothing;

do $$
declare v_place uuid; v_visit uuid; v_space uuid; n int;
begin
  select m.space_id into v_space from public.space_memberships m
   where m.profile_id = 'aaaa0281-0000-0000-0000-000000000001';
  if v_space is null then
    raise exception 'FAIL: the first owner profile was not placed in a space';
  end if;

  insert into public.places (name, lat, lng, saved, created_by, space_id)
  values ('Space Test Place', 38.9, -77.0, true, 'aaaa0281-0000-0000-0000-000000000001', v_space)
  returning id into v_place;

  insert into public.visits (place_id, start_date, end_date, status, accepted_at,
                             created_by, space_id)
  values (v_place, current_date, current_date, 'taken', now(),
          'aaaa0281-0000-0000-0000-000000000001', v_space)
  returning id into v_visit;

  -- 5a. The owner reads their own rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub','aaaa0281-0000-0000-0000-000000000001','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.visits where id = v_visit;
  reset role;
  if n <> 1 then raise exception 'FAIL: the owner cannot see their own visit'; end if;

  -- 5b. A SECOND ACCOUNT, invited into nothing, reads none of it — not through the table,
  --     not through the invoker views, and not through the SECURITY DEFINER views that
  --     used to answer every question with every row.
  insert into public.profiles (id, display_name, role)
  values ('bbbb0281-0000-0000-0000-000000000002','Stranger0281','viewer')
  on conflict (id) do nothing;
  -- The trigger gives a new profile a space of its own when there is more than one, or
  -- joins the only one when there is exactly one — which is the invite path. Remove the
  -- membership to model the account that has been invited nowhere at all.
  delete from public.space_memberships
   where profile_id = 'bbbb0281-0000-0000-0000-000000000002';

  perform set_config('request.jwt.claims',
    json_build_object('sub','bbbb0281-0000-0000-0000-000000000002','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.visits where id = v_visit;
  if n <> 0 then reset role; raise exception 'FAIL: an uninvited account read the visit'; end if;

  select count(*) into n from public.places where id = v_place;
  if n <> 0 then reset role; raise exception 'FAIL: an uninvited account read the place'; end if;

  select count(*) into n from public.accepted_visits where id = v_visit;
  if n <> 0 then reset role; raise exception 'FAIL: an uninvited account read accepted_visits'; end if;

  select count(*) into n from public.visit_profiles where visit_id = v_visit;
  if n <> 0 then reset role; raise exception 'FAIL: visit_profiles still answers an uninvited account'; end if;

  select count(*) into n from public.activity_profiles;
  if n <> 0 then reset role; raise exception 'FAIL: activity_profiles still answers an uninvited account'; end if;

  select count(*) into n from public.activity_provenance;
  if n <> 0 then reset role; raise exception 'FAIL: activity_provenance still answers an uninvited account'; end if;

  -- 5c. …and cannot get at it sideways through the helper either.
  if public.is_member(v_space) then
    reset role; raise exception 'FAIL: is_member() is true for an uninvited account';
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---- 6. THE NEW DEFINER FUNCTIONS ARE NOT REACHABLE BY anon ------------------
do $$
declare sig text;
begin
  foreach sig in array array['public.is_member(uuid)','public.is_editor_or_owner(uuid)',
                             'public.is_owner(uuid)','public.my_space_ids()',
                             'public.current_space()','public.default_space()',
                             'public.is_member()','public.can_see_memory_subject(uuid)'] loop
    if has_function_privilege('anon', sig, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', sig;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.spaces', 'SELECT')
     or has_table_privilege('anon', 'public.space_memberships', 'SELECT') then
    raise exception 'FAIL: anon can read the boundary tables';
  end if;
end $$;

do $$ begin
  raise notice 'PASS 0281: every space-owned table carries a space, no policy still asks the old question, all seven views state the boundary, a visit subject can be seen, and an account invited nowhere reads nothing — through the tables, the invoker views and the definer views alike';
end $$;

rollback;
