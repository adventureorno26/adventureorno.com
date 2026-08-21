-- Having an account makes you a person, and the provenance survives the move.
--
-- 0262 records participation against a person's OWN contact row — the `people` row whose
-- owner and linked profile are the same — so that one account is one person however many
-- contact lists they appear in. Everything downstream depends on that row existing, so it is
-- created with the account rather than by a migration that ran once.
--
-- THE BACKFILL ITSELF IS NOT ASSERTED HERE, because it cannot be: on a fresh database there
-- is nothing to back-fill, and its correctness was checked where the data is — the migration
-- raises if a single participation fails to arrive, is invented, or changes its answer on the
-- way across, and it moved 623 outing and 655 visit rows on production with none of the three.
begin;

set local check_function_bodies = off;

-- ---- 1. AN ACCOUNT COMES WITH A PERSON --------------------------------------
insert into auth.users (id, email) values
  ('eeee0262-0000-0000-0000-000000000001','e0262@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role)
values ('eeee0262-0000-0000-0000-000000000001','E0262','editor')
on conflict (id) do update set display_name = excluded.display_name;

do $$
declare n int;
begin
  select count(*) into n from public.people
   where owner_profile = 'eeee0262-0000-0000-0000-000000000001'
     and linked_profile = 'eeee0262-0000-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'FAIL: a new account got % self-contacts, expected exactly 1', n;
  end if;
  if not exists (select 1 from public.people
                  where owner_profile = 'eeee0262-0000-0000-0000-000000000001'
                    and linked_profile = 'eeee0262-0000-0000-0000-000000000001'
                    and display_name = 'E0262') then
    raise exception 'FAIL: the self-contact is not named after the account';
  end if;
end $$;

-- ---- 2. AND ONLY ONE, however many times the account is touched -------------
do $$
declare n int;
begin
  update public.profiles set display_name = 'E0262 renamed'
   where id = 'eeee0262-0000-0000-0000-000000000001';
  select count(*) into n from public.people
   where owner_profile = 'eeee0262-0000-0000-0000-000000000001'
     and linked_profile = 'eeee0262-0000-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'FAIL: touching the account produced % self-contacts', n;
  end if;
end $$;

-- ---- 3. THE PROVENANCE THE OLD TABLES CARRY HAS SOMEWHERE TO GO -------------
-- `evidence` is what 0236 and 0240 key "not yours to delete" on, and `rule_id` is what
-- respond_to_tag scopes a decline by. A move that dropped either would carry the rows and
-- leave the rules behind.
do $$
declare pl uuid; a uuid; s uuid; me uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','eeee0262-0000-0000-0000-000000000001','role','authenticated')::text, true);
  select id into me from public.people
   where owner_profile = 'eeee0262-0000-0000-0000-000000000001'
     and linked_profile = 'eeee0262-0000-0000-0000-000000000001';

  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0262', 39.2, -77.2, true) returning id into pl;
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Run','A0262',5000,'2026-07-30T12:00:00Z',39.2,-77.2,
          'eeee0262-0000-0000-0000-000000000001','file','file',pl)
  returning id into a;

  insert into public.memory_subjects (kind, owner_profile, activity_id)
  values ('outing','eeee0262-0000-0000-0000-000000000001', a)
  on conflict (activity_id) do nothing;
  select id into s from public.memory_subjects where activity_id = a;

  insert into public.memory_people
    (subject_id, person_id, participation_status, verification_status, evidence, created_by)
  values (s, me, 'accepted', 'confirmed_by_person', 'own_recording', 'import')
  on conflict (subject_id, person_id) do update
    set evidence = excluded.evidence, created_by = excluded.created_by;

  if not exists (select 1 from public.memory_people
                  where subject_id = s and person_id = me
                    and evidence = 'own_recording' and created_by = 'import') then
    raise exception 'FAIL: the provenance did not survive being written';
  end if;
end $$;

do $$ begin raise notice 'PASS 0262: an account comes with exactly one person, once, and the new store can hold the provenance the old tables carry'; end $$;

rollback;
