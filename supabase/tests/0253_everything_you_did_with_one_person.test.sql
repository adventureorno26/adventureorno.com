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
  insert into public.activity_profiles (activity_id, profile_id, claim_status, evidence, created_by)
  values (a1, j_id, 'accepted', 'own_recording', 'import'),
         (a2, j_id, 'accepted', 'own_recording', 'import');

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
  insert into public.activity_profiles (activity_id, profile_id, claim_status, evidence, created_by)
  values (secret, j_id, 'accepted', 'own_recording', 'import');

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

do $$ begin raise notice 'PASS 0253: an outing counts once, a photograph is not an outing, a pending tag is labelled, and a page about a person shows only what the asker may see'; end $$;

rollback;
