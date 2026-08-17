-- Uploading the same file again attaches. A different outing does not.
--
-- THIS HAPPENED, in production, to the person the app is for. Erica imported one Garmin
-- GPX at 21:50 on 2026-08-17 and the same file again at 22:01. Both said `proposed`; she
-- now has two identical "Loudoun County Walking" rows for 2024-09-26. All 267 file-sourced
-- activities carried `external_key = NULL`, so nothing could recognise a file it had
-- already seen — and she is about to upload ~184 of them.
--
-- 0216 gives a keyless upload the identity it has anyway: owner, start second, whole
-- metres, type. The second test below is the one that keeps it honest — this must never
-- become a similarity match, or it stops being safe for Tier 1 to attach on it silently.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('aaaa0216-0000-0000-0000-000000000001', 'e0216@example.invalid'),
  ('aaaa0216-0000-0000-0000-000000000002', 'j0216@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('aaaa0216-0000-0000-0000-000000000001', 'E0216', 'owner'),
  ('aaaa0216-0000-0000-0000-000000000002', 'J0216', 'editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'aaaa0216-0000-0000-0000-000000000001';
  j_id uuid := 'aaaa0216-0000-0000-0000-000000000002';
  run  uuid;
  a1 jsonb; a2 jsonb; a3 jsonb; a4 jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  run := public.begin_ingest_run('file-upload','user',null,null);
  a1 := public.ingest_activity(run,'file','garmin',null,'A keyless GPX','Walk',null,
        4321.0,1500,38.90,-77.40,'2025-05-05T14:00:00Z','Garmin Connect');
  if a1->>'disposition' <> 'inserted' then
    raise exception 'FAIL: the first upload did not insert (%)', a1->>'disposition';
  end if;

  -- ---- 1. THE SAME FILE AGAIN, in a new run, as a second visit to the page ----
  run := public.begin_ingest_run('file-upload','user',null,null);
  a2 := public.ingest_activity(run,'file','garmin',null,'A keyless GPX','Walk',null,
        4321.0,1500,38.90,-77.40,'2025-05-05T14:00:00Z','Garmin Connect');
  if a2->>'disposition' <> 'duplicate' then
    raise exception 'FAIL: re-uploading the same file gave % — this is what happened to her twice', a2->>'disposition';
  end if;
  if (a2->>'activity_id') <> (a1->>'activity_id') then
    raise exception 'FAIL: the re-upload became a second activity';
  end if;

  -- ---- 2. A DIFFERENT OUTING IS NOT SWALLOWED --------------------------------
  -- The safety argument for letting Tier 1 attach silently is that this key answers "is
  -- this the same RECORDING?", not "do these resemble each other?". Same person, same
  -- place, same day, same type — and it must still be its own activity.
  run := public.begin_ingest_run('file-upload','user',null,null);
  a3 := public.ingest_activity(run,'file','garmin',null,'A different walk','Walk',null,
        7777.0,2000,38.90,-77.40,'2025-05-05T16:30:00Z','Garmin Connect');
  if a3->>'disposition' = 'duplicate' then
    raise exception 'FAIL: a different outing was swallowed as a duplicate';
  end if;

  -- ---- 3. AND ANOTHER PERSON'S IDENTICAL RECORDING IS THEIRS -----------------
  -- The key embeds the owner because file imports have no connection to scope them and
  -- the unique index is therefore global. Two people who set off together, both uploading,
  -- must not collide into one activity — 0203's Tier 3 failure through the back door.
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  run := public.begin_ingest_run('file-upload','user',null,null);
  a4 := public.ingest_activity(run,'file','garmin',null,'His copy of the same walk','Walk',null,
        4321.0,1500,38.90,-77.40,'2025-05-05T14:00:00Z','Garmin Connect');
  if a4->>'disposition' = 'duplicate' then
    raise exception 'FAIL: his recording was swallowed into hers by the content key';
  end if;
  if (a4->>'activity_id') = (a1->>'activity_id') then
    raise exception 'FAIL: two people''s recordings collided into one activity';
  end if;

  raise notice 'PASS: the same file attaches; a different outing, and another person''s copy, do not.';
end $$;

rollback;
