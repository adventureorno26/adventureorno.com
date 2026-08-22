-- Everything you did with one person: counted once, kept apart, and only what you may see.
--
-- §8b-i: "retrieve everything they did with one or several people, and use that same
-- selection for statistics." Three properties make that answer trustworthy rather than
-- merely present, and each has a way of quietly failing:
--
--   1. AN OUTING COUNTS ONCE. Her Garmin original and Strava's copy are one run. A person
--      page that counts participant ROWS says she did the same thing twice.
--   2. A PHOTOGRAPH IS NOT AN OUTING. §8b-i names this one. Being in a picture taken during
--      a run must put nothing on anybody's mileage.
--   3. IT SHOWS ONLY WHAT THE ASKER MAY SEE. A per-person view is exactly where an
--      authorization rule gets skipped, because the question feels like it is about a person
--      rather than about records.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0253-0000-0000-0000-000000000001','e0253@example.invalid'),
  ('eeee0253-0000-0000-0000-000000000002','j0253@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role, share_tagged_outings) values
  ('eeee0253-0000-0000-0000-000000000001','E0253','owner', false),
  ('eeee0253-0000-0000-0000-000000000002','J0253','editor', false)
on conflict (id) do update set role = excluded.role,
                               share_tagged_outings = excluded.share_tagged_outings;

do $$
declare
  e_id uuid := 'eeee0253-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0253-0000-0000-0000-000000000002';
  pl uuid; ph uuid; a1 uuid; a2 uuid; secret uuid; him uuid; n int; m double precision;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0253', 39.6, -77.6, true) returning id into pl;

  him := public.add_contact('J0253', j_id);

  -- ---- ONE OUTING, TWO RECORDINGS -----------------------------------------
  -- The same run out of Garmin and out of Strava, linked as one outing. He is on both,
  -- which is exactly what an import produces.
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Run','Ours 0253',10000,'2026-07-01T12:00:00Z',39.6,-77.6,
          j_id,'file','file',pl)
  returning id into a1;
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id,
     shared_group_id)
  values (gen_random_uuid(),'Run','Ours 0253 (the other copy)',10100,'2026-07-01T12:00:00Z',
          39.6,-77.6,j_id,'file','file',pl,a1)
  returning id into a2;
  update public.activities set shared_group_id = a1 where id = a1;
  -- The owner is already on their own recording (0256 makes the trigger follow
  -- owner_profile), so this only fills in the shape the assertions read.
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (a1, j_id, 'accepted', 'own_recording', 'import'),
         (a2, j_id, 'accepted', 'own_recording', 'import')) t(activity_id, profile_id, claim_status, evidence, created_by)
  on conflict (subject_id, person_id) do nothing;

  select count(*) into n from public.person_memories(him) where kind = 'outing';
  if n <> 1 then
    raise exception 'FAIL: two recordings of one run counted as % outings', n;
  end if;

  -- ---- A PHOTOGRAPH IS NOT AN OUTING ---------------------------------------
  insert into public.photos (id, place_id, taken_at, r2_key, thumb_key, sha256, uploaded_by)
  values (gen_random_uuid(), pl, '2026-07-01T12:30:00Z', 'k0253/p', 'k0253/t', 'sha0253', e_id)
  returning id into ph;
  perform public.tag_person_on_photo(ph, him);

  select count(*) into n from public.person_memories(him) where kind = 'outing';
  if n <> 1 then
    raise exception 'FAIL: tagging him in a photo changed his outing count to %', n;
  end if;
  select count(*) into n from public.person_memories(him) where kind = 'photo';
  if n <> 1 then raise exception 'FAIL: the photo is not on his page, got %', n; end if;

  -- …and the photo carries no distance to be summed into miles by accident.
  select distance into m from public.person_memories(him) where kind = 'photo';
  if m is not null then raise exception 'FAIL: a photograph reported a distance of %', m; end if;

  -- ---- A PENDING TAG IS LABELLED, NOT COUNTED AS AGREED ---------------------
  if not exists (select 1 from public.person_memories(him)
                  where kind = 'photo' and status = 'proposed') then
    raise exception 'FAIL: a tag he has not answered is shown as settled';
  end if;

  -- ---- AND ONLY WHAT SHE MAY SEE -------------------------------------------
  -- His own Strava recording, which he has not chosen to share (0228). It is HIS memory and
  -- it is not hers to read, even on a page about him.
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Run','His alone 0253',5000,'2026-07-02T12:00:00Z',39.6,-77.6,
          j_id,'strava','strava',pl)
  returning id into secret;
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (secret, j_id, 'accepted', 'own_recording', 'import')) t(activity_id, profile_id, claim_status, evidence, created_by)
  on conflict (subject_id, person_id) do nothing;

  if exists (select 1 from public.person_memories(him) where id = secret) then
    raise exception 'FAIL: his page handed her a recording he has not shared';
  end if;
end $$;

-- ---- Somebody else's private contact answers nothing at all -----------------
do $$
declare
  e_id uuid := 'eeee0253-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0253-0000-0000-0000-000000000002';
  mum uuid; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  mum := public.add_contact('Mum 0253');

  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  select count(*) into n from public.person_memories(mum);
  if n <> 0 then
    raise exception 'FAIL: he read % memories through her private contact', n;
  end if;
end $$;

-- ---- ONE OR SEVERAL PEOPLE, ALL OR ANY (0255) -------------------------------
-- §8b-i: "Together is a people query with ALL selected." The property that makes ALL usable
-- is the one that is easy to get wrong: an outing must collapse to ONE before the people on
-- it are counted. Count participants per RECORDING and an outing both of them were on looks
-- like two half-matches — so an ALL query silently drops exactly the outings they did
-- together, which is the only thing anybody asked it for.
do $$
declare
  e_id uuid := 'eeee0253-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0253-0000-0000-0000-000000000002';
  pl uuid; a1 uuid; a2 uuid; solo uuid; me uuid; him uuid; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0255', 39.7, -77.7, true) returning id into pl;
  me  := public.add_contact('Me 0255', e_id);
  him := public.add_contact('J0255', j_id);

  -- ONE outing, TWO recordings, BOTH of them on it.
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Hike','Together 0255',8000,'2026-07-05T12:00:00Z',39.7,-77.7,
          e_id,'file','file',pl)
  returning id into a1;
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id,
     shared_group_id)
  values (gen_random_uuid(),'Hike','Together 0255 (his copy)',8100,'2026-07-05T12:00:00Z',
          39.7,-77.7,j_id,'file','file',pl,a1)
  returning id into a2;
  update public.activities set shared_group_id = a1 where id = a1;
  -- She is on her recording; he is on his. Two rows, two recordings, one outing.
  -- …which the importer trigger may already have written for the owner of each recording.
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (a1, e_id, 'accepted', 'own_recording', 'import'),
         (a2, j_id, 'accepted', 'own_recording', 'import')) t(activity_id, profile_id, claim_status, evidence, created_by)
  on conflict (subject_id, person_id) do nothing;

  -- And one she did alone.
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Run','Hers alone 0255',4000,'2026-07-06T12:00:00Z',39.7,-77.7,
          e_id,'file','file',pl)
  returning id into solo;
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (solo, e_id, 'accepted', 'own_recording', 'import')) t(activity_id, profile_id, claim_status, evidence, created_by)
  on conflict (subject_id, person_id) do nothing;

  -- Scoped to THIS section's fixtures by name: the block above built outings for the same
  -- two profiles, and an assertion that counts everything in the transaction is measuring
  -- the test rather than the function.
  -- ALL: only the one they were both on, and it counts ONCE.
  select count(*) into n from public.memories_with_people(array[me, him], 'all')
   where kind = 'outing' and coalesce(title,'') like '%0255%';
  if n <> 1 then
    raise exception 'FAIL: "together" over two people returned % outings, not 1', n;
  end if;
  if not exists (select 1 from public.memories_with_people(array[me, him], 'all')
                  where kind = 'outing' and coalesce(title,'') like 'Together 0255%') then
    raise exception 'FAIL: the outing they actually did together is the one missing';
  end if;

  -- ANY: both of hers and his copy of the shared one, still collapsed to one outing each.
  select count(*) into n from public.memories_with_people(array[me, him], 'any')
   where kind = 'outing' and coalesce(title,'') like '%0255%';
  if n <> 2 then
    raise exception 'FAIL: "any of them" returned % outings, not 2', n;
  end if;

  -- And one person through the general door is the same answer as through the wrapper.
  if (select count(*) from public.person_memories(him) where kind = 'outing')
     <> (select count(*) from public.memories_with_people(array[him], 'any') where kind = 'outing') then
    raise exception 'FAIL: person_memories and memories_with_people disagree about one person';
  end if;
end $$;

do $$ begin raise notice 'PASS 0253: an outing counts once, a photograph is not an outing, a pending tag is labelled, and a page about a person shows only what the asker may see'; end $$;

rollback;
