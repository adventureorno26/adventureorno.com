-- 0165/0166 — participants as rows, evidence that explains a visit, and reference
-- geometry that is not an outing. §0.9.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('cccc0166-0000-0000-0000-000000000001', 't0166a@example.invalid'),
  ('cccc0166-0000-0000-0000-000000000002', 't0166b@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('cccc0166-0000-0000-0000-000000000001', 'T166 Owner', 'owner'),
  ('cccc0166-0000-0000-0000-000000000002', 'T166 Editor', 'editor')
on conflict (id) do nothing;
set local request.jwt.claims = '{"sub":"cccc0166-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. A named person becomes exactly one row. NULL does not become a guess.
-- ---------------------------------------------------------------------------
do $$
declare p uuid; v_solo uuid; v_both uuid; n int; real_members int;
begin
  insert into public.places (name, lat, lng, saved) values ('T166 Place', 38.9, -77.4, true)
    returning id into p;

  -- 0188: attribution is participant rows, and set_visit_solo is how one person is named.
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-02-01', '2026-02-01', 'taken', true) returning id into v_solo;
  perform public.set_visit_solo(v_solo, 'cccc0166-0000-0000-0000-000000000002');

  -- THE CONTRACT CHANGED, 2026-08-20 (0240), and this is the same property said correctly.
  -- Naming SOMEBODY ELSE is one person's word about another, so it is exactly one QUESTION
  -- and no row: nothing filters visit_profiles by claim_status, so a pending row would
  -- already be on their statistics. "Exactly one, and NULL does not become a guess" still
  -- holds — it is now one claim, and one row the moment they agree.
  select count(*) into n from public.visit_profiles where visit_id = v_solo;
  if n <> 0 then
    raise exception 'FAIL: naming another person put % row(s) on the visit before they agreed', n;
  end if;
  select count(*) into n from public.tag_claims
   where subject_kind = 'visit' and subject_id = v_solo and status = 'proposed';
  if n <> 1 then raise exception 'FAIL: a named person must be exactly one question, got %', n; end if;

  perform set_config('request.jwt.claims',
    '{"sub":"cccc0166-0000-0000-0000-000000000002"}', true);
  perform public.respond_to_tag(
    (select id from public.tag_claims
      where subject_kind = 'visit' and subject_id = v_solo and status = 'proposed'), true);
  perform set_config('request.jwt.claims',
    '{"sub":"cccc0166-0000-0000-0000-000000000001"}', true);

  select count(*) into n from public.visit_profiles where visit_id = v_solo;
  if n <> 1 then raise exception 'FAIL: once he agrees he is exactly one row, got %', n; end if;
  if not exists (select 1 from public.visit_profiles
                  where visit_id = v_solo and profile_id = 'cccc0166-0000-0000-0000-000000000002') then
    raise exception 'FAIL: the wrong person was recorded'; end if;

  -- everyone, which a bare insert now means by default
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-02-02', '2026-02-02', 'taken', true) returning id into v_both;

  select count(*) into real_members from public.profiles
   where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)';

  -- THE DEFAULT CHANGED, 2026-08-15 (0193). This asserted that a bare insert meant BOTH
  -- real members — the "everyone by default" rule from 0188. STATE.md's "TOGETHER,
  -- DEFINED" says the opposite and always did: everyone's own data is JUST ME by default,
  -- and being together is a tag a person accepts. 0188 was the deviation, and it is what
  -- attached both people to a visit dated five years before they met.
  --
  -- So a bare insert now means the ONE person who made it.
  select count(*) into n from public.visit_profiles where visit_id = v_both;
  if real_members = 2 then
    if n <> 1 then
      raise exception 'FAIL: a bare insert should attribute to its creator alone, got % rows', n;
    end if;
  else
    -- MORE than two real members exist in this test database, so "both" is genuinely
    -- ambiguous. The rule is refuse-and-review, never invent participants.
    if n <> 0 then raise exception 'FAIL: ambiguous NULL invented % participant(s)', n; end if;
    if not exists (select 1 from public.visit_participant_review where visit_id = v_both) then
      raise exception 'FAIL: an ambiguous NULL must be sent for review, not guessed'; end if;
  end if;

  raise notice 'PASS 1: named attribution is exact; ambiguous "both" is reviewed, never guessed (% real members)', real_members;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Changing attribution keeps the rows in step.
-- ---------------------------------------------------------------------------
do $$
declare p uuid; v uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T166 Sync', 38.9, -77.4, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-02-03', '2026-02-03', 'taken', true) returning id into v;
  perform public.set_visit_solo(v, 'cccc0166-0000-0000-0000-000000000001');

  -- REATTRIBUTING REPLACES THE ROWS. Since 0240 the second half of that is a question:
  -- she is taken off immediately, and he goes on when he agrees. The property being tested —
  -- the rows follow the change and do not accumulate — is unchanged.
  perform public.set_visit_solo(v, 'cccc0166-0000-0000-0000-000000000002');
  select count(*) into n from public.visit_profiles where visit_id = v;
  if n <> 0 then
    raise exception 'FAIL: reattributing left % row(s) behind, or wrote one nobody agreed to', n;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"cccc0166-0000-0000-0000-000000000002"}', true);
  perform public.respond_to_tag(
    (select id from public.tag_claims
      where subject_kind = 'visit' and subject_id = v and status = 'proposed'), true);
  perform set_config('request.jwt.claims',
    '{"sub":"cccc0166-0000-0000-0000-000000000001"}', true);

  select count(*) into n from public.visit_profiles where visit_id = v;
  if n <> 1 then raise exception 'FAIL: expected one participant after the change, got %', n; end if;
  if not exists (select 1 from public.visit_profiles
                  where visit_id = v and profile_id = 'cccc0166-0000-0000-0000-000000000002') then
    raise exception 'FAIL: the participant row did not follow the change'; end if;

  raise notice 'PASS 2: changing attribution moves the participant rows with it';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Evidence explains a visit — and deleting evidence does not erase the decision.
-- ---------------------------------------------------------------------------
do $$
declare p uuid; v uuid; a uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T166 Evidence', 39.1, -77.5, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-02-04', '2026-02-04', 'taken', true) returning id into v;

  a := (public.add_activity_to_visit(v, 'run', 'Evening run', 5000, 'ev-key-1')).id;

  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  values (v, 'activity', a, '2026-02-04', 'ev-key-1') on conflict do nothing;

  -- re-importing the same thing must not create a second evidence row
  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  values (v, 'activity', a, '2026-02-04', 'ev-key-1') on conflict do nothing;
  select count(*) into n from public.visit_evidence where visit_id = v;
  if n <> 1 then raise exception 'FAIL: evidence must be idempotent, got % rows', n; end if;

  -- deleting the evidence must NOT delete the accepted visit (§0.9)
  delete from public.activities where id = a;
  if not exists (select 1 from public.visits where id = v) then
    raise exception 'FAIL: deleting evidence erased an accepted visit'; end if;

  raise notice 'PASS 3: evidence is idempotent, and an accepted visit survives losing it';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Drawing a trail adds zero visits and zero miles (§0.5).
-- ---------------------------------------------------------------------------
do $$
declare trail uuid; v_before int; m_before double precision; v_after int; m_after double precision;
begin
  insert into public.places (name, lat, lng, saved, is_trail)
    values ('T166 Long Trail', 44.5, -72.8, true, true) returning id into trail;

  select count(*) into v_before from public.visits;
  select coalesce(sum(distance),0) into m_before from public.activities;

  insert into public.trail_routes (trail_place_id, name, polyline, distance_m, source)
  values (trail, 'Full length', 'abc_fake_polyline', 438000, 'drawn');

  select count(*) into v_after from public.visits;
  select coalesce(sum(distance),0) into m_after from public.activities;

  if v_after <> v_before then raise exception 'FAIL: reference geometry created a visit'; end if;
  if m_after <> m_before then raise exception 'FAIL: reference geometry added mileage'; end if;

  raise notice 'PASS 4: a drawn trail adds no visit and no miles';
end $$;

-- ---------------------------------------------------------------------------
-- 5. trail_section is allowed; nonsense is not. anon reaches none of it.
-- ---------------------------------------------------------------------------
do $$
declare parent uuid; child uuid;
begin
  insert into public.places (name, lat, lng, saved, is_trail, holds_children)
    values ('T166 Trail', 39.3, -77.7, true, true, true) returning id into parent;
  insert into public.places (name, lat, lng, saved)
    values ('T166 Section', 39.31, -77.71, true) returning id into child;

  insert into public.place_membership (child_id, parent_id, relationship_type)
  values (child, parent, 'trail_section');

  begin
    insert into public.place_membership (child_id, parent_id, relationship_type)
    values (child, parent, 'nonsense');
    raise exception 'FAIL: an unknown relationship_type was accepted';
  exception when check_violation then null;
  end;

  if has_table_privilege('anon','public.visit_profiles','SELECT')
  or has_table_privilege('anon','public.visit_evidence','SELECT')
  or has_table_privilege('anon','public.trail_routes','SELECT')
  or has_table_privilege('anon','public.visit_participant_review','SELECT') then
    raise exception 'FAIL: anon can read the new tables';
  end if;

  raise notice 'PASS 5: trail_section accepted, nonsense rejected, anon locked out';
end $$;

rollback;
