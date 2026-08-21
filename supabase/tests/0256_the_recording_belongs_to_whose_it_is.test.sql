-- A recording's first participant is whose recording it is.
--
-- `default_participants` credited `auth.uid()` and never looked at `owner_profile`, which
-- `set_activity_owner` has already decided in a BEFORE trigger. So inserting an activity on
-- somebody else's behalf put YOU on their run — the 0039 shape, arrived at by an attribution
-- nobody stated. Measured before it was fixed: zero rows on production came from this, and
-- the twelve non-owner rows that exist were written by a backfill on 2026-08-14. Latent, not
-- realised — and the kind that stays latent until the first time somebody adds an activity
-- for another person, which this app is now heading towards.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0256-0000-0000-0000-000000000001','e0256@example.invalid'),
  ('eeee0256-0000-0000-0000-000000000002','j0256@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0256-0000-0000-0000-000000000001','E0256','owner'),
  ('eeee0256-0000-0000-0000-000000000002','J0256','editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'eeee0256-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0256-0000-0000-0000-000000000002';
  pl uuid; his uuid; hers uuid;
begin
  -- SIGNED IN AS HER, THE WHOLE WAY THROUGH.
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0256', 39.8, -77.8, true) returning id into pl;

  -- ---- HIS recording, entered by her --------------------------------------
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Run','His 0256',5000,'2026-07-10T12:00:00Z',39.8,-77.8,
          j_id,'file','file',pl)
  returning id into his;

  if exists (select 1 from public.activity_profiles where activity_id = his and profile_id = e_id) then
    raise exception 'FAIL: entering HIS recording put HER on it';
  end if;
  if not exists (select 1 from public.activity_profiles where activity_id = his and profile_id = j_id) then
    raise exception 'FAIL: the owner is not on their own recording';
  end if;
  -- AND IT SAYS SO. 0236 protects a participant row from somebody else's "Just me" precisely
  -- by asking whether it evidences their OWN recording. A row left at the column default says
  -- `unknown`, and the protection silently does not apply to it (0257).
  if not exists (select 1 from public.activity_profiles
                  where activity_id = his and profile_id = j_id and evidence = 'own_recording') then
    raise exception 'FAIL: the owner''s row does not say it is their own recording, so "Just me" could delete it';
  end if;

  -- ---- HER recording, entered by her: unchanged ---------------------------
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source,place_id)
  values (gen_random_uuid(),'Run','Hers 0256',5000,'2026-07-11T12:00:00Z',39.8,-77.8,
          e_id,'file','file',pl)
  returning id into hers;

  if not exists (select 1 from public.activity_profiles where activity_id = hers and profile_id = e_id) then
    raise exception 'FAIL: her own recording lost its participant';
  end if;
  if exists (select 1 from public.activity_profiles where activity_id = hers and profile_id = j_id) then
    raise exception 'FAIL: her recording credited him as well';
  end if;

  -- ---- A VISIT IS STILL THE PERSON MAKING IT ------------------------------
  -- "A person creating a visit is saying they were there" — true for a thing made by hand,
  -- and untouched by this. A recording is not made by hand; it is imported.
  perform public.rebuild_place_visits(pl);
end $$;

do $$ begin raise notice 'PASS 0256: a recording is credited to whose it is, not to whoever entered it'; end $$;

rollback;
