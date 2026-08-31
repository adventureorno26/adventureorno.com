-- 0300 — a tag finds the person it is about.
--
-- LOCAL disposable stack only (scripts/db-test.sh). Two spaces that stay apart, so this file
-- must NOT call test_support.share_one_space(). Production's `default_space()` is installed
-- below for the reason 0295/0297 give.
--
--   1. Ben SEES a tag Ann made about him, from a space he is not in. Before 0300 this was
--      zero rows for ever, and the whole of 7b is unobservable behind it.
--   2. He sees it with the tagger NAMED — an inbox that cannot say who is asking is not an
--      inbox.
--   3. HE SEES ONLY HIS OWN. Ann's own proposed tag about herself is not in his inbox. This
--      is the assertion that matters: the space check was doing real work and identity has
--      to do the same work, not less.
--   4. Ann does not see Ben's either. The boundary holds in both directions.
--   5. Answering it works end to end — the door and the handle are now both reachable, and
--      0299 materialises his own record.
--   6. The test can fail: with the space-scoped body restored, section 1 goes to zero.

begin;

create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select public.current_space();
$fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0300000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ann0300@x.test','x',now(),now()),
       ('a0300000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben0300@x.test','x',now(),now());

insert into public.profiles (id, display_name, role) values ('a0300000-0000-0000-0000-000000000001','Ann 0300','owner');
insert into public.spaces (name, owner_profile) values ('0300 spare', null);
insert into public.profiles (id, display_name, role) values ('a0300000-0000-0000-0000-000000000002','Ben 0300','editor');

do $$
declare
  v_ann uuid := 'a0300000-0000-0000-0000-000000000001';
  v_ben uuid := 'a0300000-0000-0000-0000-000000000002';
  v_a_space uuid; v_b_space uuid;
  v_act uuid; v_subject uuid; v_ben_person uuid; v_ann_person uuid;
  v_act2 uuid; v_subject2 uuid;
  v_n integer; v_who text; v_mine uuid;
begin
  v_a_space := public.home_space_of(v_ann);
  v_b_space := public.home_space_of(v_ben);
  if v_a_space is null or v_b_space is null or v_a_space = v_b_space then
    raise exception 'FAIL: needed two distinct spaces';
  end if;

  -- ANN'S OUTING, in Ann's space, with Ben tagged on it and not yet answered.
  insert into public.activities (type, name, distance, start_date, owner_profile, space_id, source)
  values ('Run','0300 shared run',10.0, now(), v_ann, v_a_space, 'file') returning id into v_act;
  v_subject := public.subject_for_activity(v_act);

  insert into public.people (display_name, kind, owner_profile, linked_profile, created_by, space_id)
  values ('Ben 0300','person', v_ann, v_ben, v_ann, v_a_space) returning id into v_ben_person;
  insert into public.memory_people (subject_id, person_id, participation_status, tagged_by, space_id)
  values (v_subject, v_ben_person, 'proposed', v_ann, v_a_space);

  -- A SECOND, UNRELATED proposed tag: Ann about HERSELF, in her own space. Ben must never
  -- see this one, and without it section 1 could pass by showing everybody everything.
  insert into public.activities (type, name, distance, start_date, owner_profile, space_id, source)
  values ('Hike','0300 ann alone',3.0, now(), v_ann, v_a_space, 'file') returning id into v_act2;
  v_subject2 := public.subject_for_activity(v_act2);
  select id into v_ann_person from public.people where linked_profile = v_ann and space_id = v_a_space limit 1;
  insert into public.memory_people (subject_id, person_id, participation_status, tagged_by, space_id)
  values (v_subject2, v_ann_person, 'proposed', v_ann, v_a_space)
  on conflict do nothing;

  -- 1 + 2 + 3. Ben's inbox.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0300000-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) into v_n from public.my_memory_tags_to_confirm();
  select tagged_by into v_who from public.my_memory_tags_to_confirm() limit 1;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);   -- claims are TRANSACTION-scoped

  if v_n = 0 then
    raise exception 'FAIL: Ben cannot see a tag Ann made about him — the inbox is still space-scoped';
  end if;
  raise notice 'PASS 0300/1: a tag from a space he is not in reaches the person it names';

  if v_who is distinct from 'Ann 0300' then
    raise exception 'FAIL: the inbox does not say who tagged him (got %)', coalesce(v_who,'<null>');
  end if;
  raise notice 'PASS 0300/2: and it says who is asking';

  if v_n <> 1 then
    raise exception 'FAIL: Ben sees % tags — he should see exactly HIS OWN, not Ann''s about herself', v_n;
  end if;
  raise notice 'PASS 0300/3: he sees only the tag about him, not every proposed tag in the database';

  -- 4. The other direction.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0300000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) into v_n from public.my_memory_tags_to_confirm() t where t.subject_id = v_subject;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if v_n <> 0 then raise exception 'FAIL: Ann sees the tag she made ABOUT BEN in her own inbox'; end if;
  raise notice 'PASS 0300/4: an inbox holds questions addressed to you, not ones you asked';

  -- 5. End to end: he can now find it AND answer it, and 0299 gives him his own record.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0300000-0000-0000-0000-000000000002","role":"authenticated"}';
  perform public.respond_to_memory_tag(v_subject, true);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select id into v_mine from public.activities where space_id = v_b_space;
  if v_mine is null then
    raise exception 'FAIL: he answered the tag and got no record of his own (0299)';
  end if;
  if (select count(distinct coalesce(a.shared_group_id, a.id)) from public.activities a
       where a.id in (v_act, v_mine)) <> 1 then
    raise exception 'FAIL: his copy is a second canonical outing — 10 miles would count as 20';
  end if;
  raise notice 'PASS 0300/5: found, answered, and materialised as his own — still one outing';
end $$;

-- 6. THE TEST CAN FAIL. Put the space-scoped body back and Ben's inbox empties.
do $$
declare v_n integer;
begin
  -- The OLD, space-scoped body. It carries the CURRENT column list (0301 added `card`)
  -- because the thing under test is the `in_space_*` joins, not the shape of the row —
  -- and `create or replace` refuses a changed return type, so this drops first. Rolled
  -- back with the rest of the transaction.
  drop function if exists public.my_memory_tags_to_confirm();
  create function public.my_memory_tags_to_confirm()
  returns table(subject_id uuid, kind text, photo_id uuid, tagged_by text,
                created_at timestamptz, card text)
  language sql stable security definer set search_path to 'public' as $old$
    select s.id, s.kind, s.photo_id, who.display_name, mp.created_at, null::text
      from public.in_space_memory_people mp
      join public.in_space_memory_subjects s on s.id = mp.subject_id
      join public.in_space_people pe on pe.id = mp.person_id
      left join public.profiles who on who.id = mp.tagged_by
     where pe.linked_profile = auth.uid() and mp.participation_status = 'proposed'
     order by mp.created_at desc;
  $old$;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0300000-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) into v_n from public.my_memory_tags_to_confirm();
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  if v_n <> 0 then
    raise exception 'FAIL: the OLD body still showed him % row(s), so section 1 proves nothing', v_n;
  end if;
  raise notice 'PASS 0300/6: with the space-scoped body restored his inbox is empty — the test is real';
end $$;

rollback;
