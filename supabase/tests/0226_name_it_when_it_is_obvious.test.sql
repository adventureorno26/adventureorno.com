-- Name it when it is obvious; ask only when it is not. And a renamed place takes its
-- activities with it.
--
-- Erica, 2026-08-18: *"it should populate … the Name of the activity from the source or the
-- location of the source, then ask me to approve it only if there is some doubt."*
--
-- The failure this pins is a NAME THAT ASKS A QUESTION IT DOES NOT NEED TO ASK. 58 rows in
-- production were called "<X> County Running" — Garmin's administrative-area default — while
-- sitting at a properly named place. Each one was a card waiting to be raised about
-- something nobody was in doubt about.
--
-- And the second half, which is quieter and worse: 411 activities are named after their
-- place BY VALUE. Rename the place and every one of them kept the old text.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values ('bbbb0226-0000-0000-0000-000000000001','e0226@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0226-0000-0000-0000-000000000001','E0226','owner')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'bbbb0226-0000-0000-0000-000000000001';
  pl   uuid;
  a1 uuid; a2 uuid; a3 uuid;
begin
  -- ---- 1. WHAT COUNTS AS A MACHINE'S WORDS -------------------------------
  if not public.is_generic_activity_name('Loudoun County Running') then
    raise exception 'FAIL: Garmin''s "<X> County Running" is not a name a person chose';
  end if;
  if not public.is_generic_activity_name('Morning Hike') then
    raise exception 'FAIL: Strava''s clock reading is not a name';
  end if;
  -- NARROW ON PURPOSE. "Bay Lake Running" is Garmin-shaped too, but its place in production
  -- is recorded as "Cake Bake Shop Restaurant" — renaming it would be a loss, so a bare
  -- "<place> <gerund>" must NOT be treated as generic.
  if public.is_generic_activity_name('Bay Lake Running') then
    raise exception 'FAIL: a bare "<place> Running" was treated as generic — that renames things into worse names';
  end if;
  if public.is_generic_activity_name('Training Run - 14 miles') then
    raise exception 'FAIL: a name a person typed was treated as generic';
  end if;

  -- ---- 2. THE NAME COMES FROM THE PLACE, WITHOUT ASKING -------------------
  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Bear''s Den', 39.11, -77.85, true)
  returning id into pl;

  if public.activity_display_name('Clarke County Running', pl, 'Run') <> 'Bear''s Den' then
    raise exception 'FAIL: a machine-named activity at a named place was not named after the place (got %)',
      public.activity_display_name('Clarke County Running', pl, 'Run');
  end if;
  -- …and a real name is never overwritten by the place.
  if public.activity_display_name('Training Run - 14 miles', pl, 'Run') <> 'Training Run - 14 miles' then
    raise exception 'FAIL: her own words were replaced by the place name';
  end if;

  -- ---- 3. RENAMING THE PLACE TAKES ITS ACTIVITIES WITH IT ----------------
  insert into public.activities (id, type, name, distance, start_date, lat, lng, place_id, owner_profile)
  values (gen_random_uuid(),'Hike','Bear''s Den',5000,'2026-04-01T13:00:00Z',39.11,-77.85,pl,e_id)
  returning id into a1;
  insert into public.activities (id, type, name, distance, start_date, lat, lng, place_id, owner_profile)
  values (gen_random_uuid(),'Hike','Morning Hike',5100,'2026-04-02T13:00:00Z',39.11,-77.85,pl,e_id)
  returning id into a2;
  insert into public.activities (id, type, name, distance, start_date, lat, lng, place_id, owner_profile)
  values (gen_random_uuid(),'Hike','Sunrise with Josh',5200,'2026-04-03T13:00:00Z',39.11,-77.85,pl,e_id)
  returning id into a3;

  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  perform public.apply_inbox_field('place', pl, 'name', to_jsonb('Bears Den Overlook'::text));

  if (select name from public.activities where id = a1) <> 'Bears Den Overlook' then
    raise exception 'FAIL: an activity following the place name kept the old text — rename the place and the card still lies';
  end if;
  if (select name from public.activities where id = a2) <> 'Bears Den Overlook' then
    raise exception 'FAIL: a machine-named activity did not take the place''s new name';
  end if;
  -- HERS IS HERS. A name a person typed never moves.
  if (select name from public.activities where id = a3) <> 'Sunrise with Josh' then
    raise exception 'FAIL: renaming a place overwrote a name she typed herself';
  end if;

  raise notice 'PASS: machine names give way to the place, her own words never do, and a renamed place takes its activities with it.';
end $$;

rollback;
