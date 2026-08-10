-- DB test for 0151 — it learns what you call a place, and stops asking.
--
-- The danger of this feature is obvious: a rule is automation, and silent automation
-- is what produced every bug this rebuild exists to fix. So the tests care as much
-- about what a rule must NOT do — reach past its radius, or overwrite a decision —
-- and about the audit trail it must leave behind.
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000a151','v151@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000a151','owner','V151 Erica') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a151"}';

-- Three approved activities in one area, all called the same thing. 2033 dates and a
-- deliberately remote spot (mid-Atlantic) so nothing can collide with live rows.
do $$
declare p uuid; a uuid; i int;
begin
  insert into public.places (name, lat, lng, saved) values ('V151 Area', 31.0, -41.0, true)
    returning id into p;
  for i in 1..3 loop
    insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
      values ('Run','V151 The Usual Loop', 5000,
              ('2033-07-0' || i || 'T12:00:00Z')::timestamptz, 31.0, -41.0, p, 'file')
      returning id into a;
    perform public.update_activity(a, 'V151 The Usual Loop', null);  -- her edit = approval
  end loop;
end $$;

-- 1) IT OFFERS ONLY AFTER A HABIT, NOT A COINCIDENCE.
do $$
declare a uuid; o jsonb;
begin
  -- A fourth, unapproved, in the same spot — this is the one the card would be about.
  insert into public.activities (type, name, distance, start_date, lat, lng, source)
    values ('Run','V151 The Usual Loop', 5000, '2033-07-09T12:00:00Z', 31.0, -41.0, 'file')
    returning id into a;

  o := public.rule_offer(a);
  if (o ->> 'offer')::boolean is not true then
    raise exception 'FAIL: three approvals in one area should offer a rule, got %', o;
  end if;
  if (o ->> 'learned_from')::int < 3 then
    raise exception 'FAIL: learned_from should count the approvals, got %', o;
  end if;

  -- NEGATIVE CONTROL: somewhere she has approved nothing must not offer.
  insert into public.activities (type, name, distance, start_date, lat, lng, source)
    values ('Run','V151 Somewhere Else', 5000, '2033-07-10T12:00:00Z', 32.5, -42.5, 'file')
    returning id into a;
  if (public.rule_offer(a) ->> 'offer')::boolean then
    raise exception 'FAIL: offered a rule where nothing was ever approved';
  end if;
  raise notice 'PASS 1: offered on a habit, not on a coincidence';
end $$;

-- 2) LEARNING IT, THEN APPLYING IT — WITH THE AUDIT TRAIL.
do $$
declare a_new uuid; res jsonb; nm text; n_appr int; n_aud int;
begin
  perform public.learn_rule(
    (select id from public.activities where name = 'V151 The Usual Loop' limit 1),
    null, 1500);

  -- A brand-new activity in that area, badly named, never seen before.
  insert into public.activities (type, name, distance, start_date, lat, lng, source)
    values ('Run','Loudoun County Running', 5000, '2033-07-11T12:00:00Z', 31.001, -41.001, 'file')
    returning id into a_new;

  res := public.apply_naming_rule(a_new);
  if (res ->> 'applied')::boolean is not true or (res ->> 'changed')::boolean is not true then
    raise exception 'FAIL: the rule did not apply, got %', res;
  end if;

  select name into nm from public.activities where id = a_new;
  if nm <> 'V151 The Usual Loop' then
    raise exception 'FAIL: the rule did not rename it, got %', nm;
  end if;

  -- It must LOCK it, or the next machine undoes the rule.
  select count(*) into n_appr from public.approved_fields
   where subject_type='activity' and subject_id=a_new and field='name' and via='rule';
  if n_appr <> 1 then
    raise exception 'FAIL: a rule-applied name was not recorded as a decision';
  end if;

  -- And it must SHOW ITS WORKING. Silent automation is the thing being fixed.
  select count(*) into n_aud from public.suggestions
   where subject_id = a_new and source = 'rule' and status = 'approved';
  if n_aud <> 1 then
    raise exception 'FAIL: no audit row for an automatic rename (found %)', n_aud;
  end if;
  raise notice 'PASS 2: the rule applied, locked it, and left a trail';
end $$;

-- 3) A RULE MUST NOT REACH PAST ITS RADIUS.
do $$
declare a uuid; res jsonb; nm text;
begin
  -- ~40 km away: well outside the 1500 m fence.
  insert into public.activities (type, name, distance, start_date, lat, lng, source)
    values ('Run','Something Far Away', 5000, '2033-07-12T12:00:00Z', 31.4, -41.4, 'file')
    returning id into a;
  res := public.apply_naming_rule(a);
  if (res ->> 'applied')::boolean then
    raise exception 'FAIL: the rule reached %s outside its radius', res;
  end if;
  select name into nm from public.activities where id = a;
  if nm <> 'Something Far Away' then
    raise exception 'FAIL: a distant activity was renamed, got %', nm;
  end if;
  raise notice 'PASS 3: a rule stays inside its fence';
end $$;

-- 4) A RULE MUST NOT OVERWRITE A DECISION — not even hers.
do $$
declare a uuid; res jsonb; nm text;
begin
  insert into public.activities (type, name, distance, start_date, lat, lng, source)
    values ('Run','Placeholder', 5000, '2033-07-13T12:00:00Z', 31.0005, -41.0005, 'file')
    returning id into a;
  perform public.update_activity(a, 'Race day with Josh', null);   -- she decided

  res := public.apply_naming_rule(a);
  if (res ->> 'applied')::boolean then
    raise exception 'FAIL: a rule overrode a name she chose, got %', res;
  end if;
  select name into nm from public.activities where id = a;
  if nm <> 'Race day with Josh' then
    raise exception 'FAIL: her name was replaced by a rule, got %', nm;
  end if;
  raise notice 'PASS 4: her decision outranks her own rule';
end $$;

-- 5) IT STOPS ASKING. That is the entire point of the step.
do $$
declare a uuid; o jsonb;
begin
  select id into a from public.activities where name = 'V151 The Usual Loop' limit 1;
  o := public.rule_offer(a);
  if (o ->> 'offer')::boolean then
    raise exception 'FAIL: still offering to learn a rule that already exists';
  end if;
  raise notice 'PASS 5: once learned, it stops asking';
end $$;

-- 6) SHE CAN CHANGE HER MIND.
do $$
declare rid uuid; a uuid; res jsonb;
begin
  select id into rid from public.naming_rules where name = 'V151 The Usual Loop' limit 1;
  perform public.forget_rule(rid);
  if exists (select 1 from public.naming_rules where id = rid) then
    raise exception 'FAIL: the rule survived being forgotten';
  end if;

  insert into public.activities (type, name, distance, start_date, lat, lng, source)
    values ('Run','Still Badly Named', 5000, '2033-07-14T12:00:00Z', 31.0002, -41.0002, 'file')
    returning id into a;
  res := public.apply_naming_rule(a);
  if (res ->> 'applied')::boolean then
    raise exception 'FAIL: a forgotten rule still applied';
  end if;
  raise notice 'PASS 6: forgetting a rule really forgets it';
end $$;

-- 7) NON-MEMBERS SEE NO RULES.
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbb7777-0000-0000-0000-00000000a151"}';
  select count(*) into n from public.naming_rules;
  if n <> 0 then raise exception 'FAIL: a non-member read % rules', n; end if;
  raise notice 'PASS 7: rules are members-only';
end $$;
reset role;

do $$ begin raise notice 'PASS: 0151 it learns what you call places'; end $$;
rollback;
