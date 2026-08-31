-- 0301 — a tag says what it is about.
--
-- LOCAL disposable stack only. Two spaces that stay apart, so no share_one_space(); and
-- production's `default_space()` for the reason 0295/0297/0299 give.
--
-- Erica, 2026-08-31: *"I don't want anything to say somewhere you were. You can see the full
-- card if you add someone."* The second sentence is the rule under test.
--
--   1. NOT added, not in the space: he is told a tag exists and NOT what it is about.
--   2. ADDED: the card is named. This is her rule, and it is the reason the file exists.
--   3. A MACHINE-MADE tag names nobody, so there is nobody to have added and the card stays
--      unnamed. An assertion nobody made is not somebody sharing something with you.
--   4. In your OWN space nothing changed — the card was always named there.
--   5. A DECLINED add does not open it. Only 'accepted' counts.

begin;

create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select public.current_space();
$fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0301000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ann0301@x.test','x',now(),now()),
       ('a0301000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben0301@x.test','x',now(),now());
insert into public.profiles (id, display_name, role) values ('a0301000-0000-0000-0000-000000000001','Ann 0301','owner');
insert into public.spaces (name, owner_profile) values ('0301 spare', null);
insert into public.profiles (id, display_name, role) values ('a0301000-0000-0000-0000-000000000002','Ben 0301','editor');

do $$
declare
  v_ann uuid := 'a0301000-0000-0000-0000-000000000001';
  v_ben uuid := 'a0301000-0000-0000-0000-000000000002';
  v_a_space uuid; v_b_space uuid;
  v_act uuid; v_subject uuid; v_ben_person uuid;
  v_act2 uuid; v_subject2 uuid;
  v_card text; v_n integer;
begin
  v_a_space := public.home_space_of(v_ann);
  v_b_space := public.home_space_of(v_ben);

  insert into public.activities (type, name, distance, start_date, owner_profile, space_id, source)
  values ('Run','Purcellville Running',12.0, now(), v_ann, v_a_space, 'file') returning id into v_act;
  v_subject := public.subject_for_activity(v_act);
  insert into public.people (display_name, kind, owner_profile, linked_profile, created_by, space_id)
  values ('Ben 0301','person', v_ann, v_ben, v_ann, v_a_space) returning id into v_ben_person;
  insert into public.memory_people (subject_id, person_id, participation_status, tagged_by, space_id)
  values (v_subject, v_ben_person, 'proposed', v_ann, v_a_space);

  -- 1. NOT ADDED.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0301000-0000-0000-0000-000000000002","role":"authenticated"}';
  select card, count(*) over () into v_card, v_n from public.my_memory_tags_to_confirm() limit 1;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  if v_n < 1 then raise exception 'FAIL: he cannot see the tag at all (0300 regressed)'; end if;
  if v_card is not null then
    raise exception 'FAIL: he is not added and was told the card is "%"', v_card;
  end if;
  raise notice 'PASS 0301/1: not added — he is told a tag exists, not what it is about';

  -- 5. A DECLINED add is not an add.
  insert into public.connection_adds (profile_low, profile_high, requested_by, status, decided_by, decided_at)
  values (least(v_ann,v_ben), greatest(v_ann,v_ben), v_ann, 'declined', v_ben, now());
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0301000-0000-0000-0000-000000000002","role":"authenticated"}';
  select card into v_card from public.my_memory_tags_to_confirm() limit 1;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  if v_card is not null then raise exception 'FAIL: a DECLINED add named the card'; end if;
  raise notice 'PASS 0301/5: a declined add is not an add';

  -- 2. ADDED. Her rule.
  update public.connection_adds set status = 'accepted'
   where profile_low = least(v_ann,v_ben) and profile_high = greatest(v_ann,v_ben);
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0301000-0000-0000-0000-000000000002","role":"authenticated"}';
  select card into v_card from public.my_memory_tags_to_confirm() limit 1;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  if v_card is distinct from 'Purcellville Running' then
    raise exception 'FAIL: added, but the card came back as % — "you can see the full card if you add someone"',
                    coalesce(v_card,'<null>');
  end if;
  raise notice 'PASS 0301/2: added — the card is named';

  -- 3. A MACHINE-MADE tag has no tagger to have added.
  insert into public.activities (type, name, distance, start_date, owner_profile, space_id, source)
  values ('Hike','Old Rag',5.0, now(), v_ann, v_a_space, 'file') returning id into v_act2;
  v_subject2 := public.subject_for_activity(v_act2);
  insert into public.memory_people (subject_id, person_id, participation_status, tagged_by, space_id)
  values (v_subject2, v_ben_person, 'proposed', null, v_a_space);
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0301000-0000-0000-0000-000000000002","role":"authenticated"}';
  select card into v_card from public.my_memory_tags_to_confirm() t where t.subject_id = v_subject2;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  if v_card is not null then
    raise exception 'FAIL: a tag nobody made named the card as "%"', v_card;
  end if;
  raise notice 'PASS 0301/3: a tag nobody made names nothing — there is nobody to have added';

  -- 4. In your OWN space, unchanged.
  -- Set up as superuser: `authenticated` has no INSERT policy on memory_people at all —
  -- every write goes through a SECURITY DEFINER function — so doing this under the role
  -- fails with "permission denied", which is the policies working, not a bug.
  -- `activities_default_participants` already made Ann's own row on this outing, accepted,
  -- when the insert above fired. Flip it to proposed rather than inserting a duplicate.
  update public.memory_people mp
     set participation_status = 'proposed', tagged_by = v_ben
    from public.people pe
   where pe.id = mp.person_id and mp.subject_id = v_subject2 and pe.linked_profile = v_ann;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0301000-0000-0000-0000-000000000001","role":"authenticated"}';
  select card into v_card from public.my_memory_tags_to_confirm() t where t.subject_id = v_subject2;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  if v_card is distinct from 'Old Rag' then
    raise exception 'FAIL: in her own space the card came back as %', coalesce(v_card,'<null>');
  end if;
  raise notice 'PASS 0301/4: inside your own space the card is named, exactly as before';
end $$;

rollback;
