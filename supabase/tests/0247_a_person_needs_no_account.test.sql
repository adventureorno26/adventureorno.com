-- A person needs no account, a subject cannot point at nothing, and being in a photograph is
-- not being on a run.
--
-- §8b-i: "A user can tag any person… there is no privileged Partner data type." Before 0247 a
-- participant had to be one of the two people who could SIGN IN — `activity_profiles` and
-- `visit_profiles` both point at `profiles` — so a friend, a parent or a child could not be
-- recorded at all, and 178 photos had no participants of any kind.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0247-0000-0000-0000-000000000001','e0247@example.invalid'),
  ('eeee0247-0000-0000-0000-000000000002','j0247@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0247-0000-0000-0000-000000000001','E0247','owner'),
  ('eeee0247-0000-0000-0000-000000000002','J0247','editor')
on conflict (id) do update set role = excluded.role;

-- ---- 1. THE REGISTRY CANNOT POINT AT NOTHING --------------------------------
-- §8b-i asked for "an enforceable subject registry rather than an unchecked polymorphic
-- foreign key". These are the four ways the old shape would have let somebody lie.
do $$
declare pl uuid; ph uuid; ok boolean;
begin
  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0247', 39.3, -77.3, true) returning id into pl;
  insert into public.photos (id, place_id, taken_at, r2_key, thumb_key, sha256, uploaded_by)
  values (gen_random_uuid(), pl, '2026-06-01T12:00:00Z', 'k0247/p', 'k0247/t', 'sha0247',
          'eeee0247-0000-0000-0000-000000000001')
  returning id into ph;

  -- a kind with no target
  begin
    insert into public.memory_subjects (kind, owner_profile)
    values ('photo', 'eeee0247-0000-0000-0000-000000000001');
    raise exception 'FAIL: a subject with no target was accepted';
  exception when check_violation then null; end;

  -- a kind whose target is a different kind's column
  begin
    insert into public.memory_subjects (kind, owner_profile, place_id)
    values ('photo', 'eeee0247-0000-0000-0000-000000000001', pl);
    raise exception 'FAIL: a photo subject pointing at a place was accepted';
  exception when check_violation then null; end;

  -- two targets at once
  begin
    insert into public.memory_subjects (kind, owner_profile, photo_id, place_id)
    values ('photo', 'eeee0247-0000-0000-0000-000000000001', ph, pl);
    raise exception 'FAIL: a subject standing for two things at once was accepted';
  exception when check_violation then null; end;

  -- a target that does not exist
  begin
    insert into public.memory_subjects (kind, owner_profile, photo_id)
    values ('photo', 'eeee0247-0000-0000-0000-000000000001', gen_random_uuid());
    raise exception 'FAIL: a subject pointing at a photo that does not exist was accepted';
  exception when foreign_key_violation then null; end;

  -- AND IT DOES NOT OUTLIVE WHAT IT STANDS FOR
  insert into public.memory_subjects (kind, owner_profile, photo_id)
  values ('photo', 'eeee0247-0000-0000-0000-000000000001', ph);
  delete from public.photos where id = ph;
  if exists (select 1 from public.memory_subjects where photo_id = ph) then
    raise exception 'FAIL: the subject survived the photo it stands for';
  end if;
end $$;

-- ---- 2. A PERSON NEEDS NO ACCOUNT -------------------------------------------
do $$
declare
  e_id uuid := 'eeee0247-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0247-0000-0000-0000-000000000002';
  pl uuid; ph uuid; mum uuid; him uuid; me uuid; r jsonb; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0247b', 39.4, -77.4, true) returning id into pl;
  insert into public.photos (id, place_id, taken_at, r2_key, thumb_key, sha256, uploaded_by)
  values (gen_random_uuid(), pl, '2026-06-02T12:00:00Z', 'k0247b/p', 'k0247b/t', 'sha0247b', e_id)
  returning id into ph;

  -- SOMEBODY WITH NO ACCOUNT AT ALL. This is the whole point.
  mum := public.add_contact('Mum 0247');
  him := public.add_contact('J0247', j_id);
  me  := public.add_contact('Me 0247', e_id);

  -- ---- her own presence: hers to state -------------------------------------
  r := public.tag_person_on_photo(ph, me);
  if r->>'participation' <> 'accepted' or r->>'verification' <> 'confirmed_by_person' then
    raise exception 'FAIL: tagging herself asked somebody, got % / %',
      r->>'participation', r->>'verification';
  end if;

  -- ---- someone with no account: the owner's statement, and it says so -------
  r := public.tag_person_on_photo(ph, mum);
  if r->>'participation' <> 'accepted' then
    raise exception 'FAIL: a person with no account cannot be recorded (%)', r->>'participation';
  end if;
  if r->>'verification' <> 'unverified' then
    raise exception 'FAIL: nobody confirmed it and the record says %', r->>'verification';
  end if;

  -- ---- someone who CAN answer: a question ----------------------------------
  r := public.tag_person_on_photo(ph, him);
  if r->>'participation' <> 'proposed' or (r->>'asked')::boolean is not true then
    raise exception 'FAIL: tagging a person with an account asserted instead of asking (%)',
      r->>'participation';
  end if;

  -- ---- HE ANSWERS, and only he may ----------------------------------------
  begin
    perform public.respond_to_memory_tag((r->>'subject')::uuid, true);
    raise exception 'FAIL: she answered a tag about him';
  exception when others then
    if position('no tag of yours' in sqlerrm) = 0 then raise; end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  perform public.respond_to_memory_tag((r->>'subject')::uuid, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  select count(*) into n from public.photo_people(ph);
  if n <> 3 then raise exception 'FAIL: the photo should name three people, got %', n; end if;
  if not exists (select 1 from public.photo_people(ph)
                  where display_name = 'J0247' and participation_status = 'accepted'
                    and verification_status = 'confirmed_by_person') then
    raise exception 'FAIL: his answer was not recorded as his';
  end if;

  -- ---- removing retracts, and re-tagging asks again -------------------------
  perform public.untag_person_on_photo(ph, mum);
  select count(*) into n from public.photo_people(ph);
  if n <> 2 then raise exception 'FAIL: untagging left her on the photo, got %', n; end if;
  if not exists (select 1 from public.memory_people mp
                  join public.memory_subjects s on s.id = mp.subject_id
                 where s.photo_id = ph and mp.person_id = mum
                   and mp.participation_status = 'retracted') then
    raise exception 'FAIL: untagging deleted the record instead of retracting it';
  end if;

  -- ---- AND BEING IN A PHOTOGRAPH IS NOT BEING ON A RUN ----------------------
  -- §8b-i names this one: "photo presence not silently promoted to outing participation".
  if exists (select 1 from public.memory_subjects where kind = 'outing') then
    raise exception 'FAIL: tagging a photo registered an outing subject';
  end if;
end $$;

-- ---- 3. A CONTACT IS PRIVATE, EXCEPT WHERE HIDING IT WOULD LIE --------------
do $$
declare
  e_id uuid := 'eeee0247-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0247-0000-0000-0000-000000000002';
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  select count(*) into n from public.my_people() where display_name = 'Mum 0247';
  if n <> 0 then raise exception 'FAIL: her private contact appeared in HIS people list'; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  select count(*) into n from public.my_people() where display_name = 'Mum 0247';
  if n <> 1 then raise exception 'FAIL: her own contact is missing from her people list'; end if;
end $$;

-- ---- 4. THE TABLES CAN ACTUALLY BE READ (0250) ------------------------------
-- 0247 gave `people` a policy that consults `memory_people` and `memory_people` a policy that
-- consults `people`. Both clauses are right and both had to stay; what could not stay is a
-- policy answering a question by asking the other one, because Postgres stops at 42P17. It
-- was invisible for an hour because everything reads through SECURITY DEFINER functions,
-- which evaluate no policies at all — so the model worked and the table underneath it did
-- not. Nothing but a direct read as the browser role finds that.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','eeee0247-0000-0000-0000-000000000001','role','authenticated')::text, true);

do $$
declare n int;
begin
  begin
    select count(*) into n from public.people;
    select count(*) into n from public.memory_people;
    select count(*) into n from public.memory_subjects;
  exception when others then
    raise exception 'FAIL: a signed-in browser cannot read the people tables at all: %', sqlerrm;
  end;
end $$;

reset role;

do $$ begin raise notice 'PASS 0247: a person needs no account, a subject cannot point at nothing, a tag about somebody with an account is a question, and a photo is not an outing'; end $$;

rollback;
