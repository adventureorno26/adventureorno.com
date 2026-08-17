-- One press for a library — and it must not reach past its owner.
--
-- WHY THIS EXISTS. Reloading a Garmin library re-records outings Strava already has, and
-- 0210 raises one `shared_group_id` card per match. At ~184 activities, one press per card
-- is a data-entry job rather than a review, and the predictable end is that she stops
-- halfway and the rest stay double-counted — the system right about every one of them and
-- wrong overall. `approve_import_duplicates` is one press for the batch.
--
-- The dangerous part is not the linking, it is the WORD "all". A function whose job is
-- "accept everything pending" is exactly the one that later gets pointed at somebody else's
-- data. Test 3 is the one that matters.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0211-0000-0000-0000-000000000001', 'e0211@example.invalid'),
  ('eeee0211-0000-0000-0000-000000000002', 'j0211@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0211-0000-0000-0000-000000000001', 'E0211', 'owner'),
  ('eeee0211-0000-0000-0000-000000000002', 'J0211', 'editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'eeee0211-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0211-0000-0000-0000-000000000002';
  run  uuid;
  a1 jsonb; a2 jsonb; a3 jsonb; a4 jsonb;
  res  jsonb; undone jsonb;
  pend jsonb;
  hers_linked int; his_pending int; kept int;
begin
  -- ---- Erica records two outings via Strava, then re-imports both as files ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  run := public.begin_ingest_run('strava','user',null,null);
  a1 := public.ingest_activity(run,'strava','garmin','strava:211001',
        'Morning A','Run',null,10000.0,3000,39.10,-77.50,'2026-04-01T12:00:00Z','Garmin');
  a2 := public.ingest_activity(run,'strava','garmin','strava:211002',
        'Morning B','Run',null,12000.0,3600,39.20,-77.60,'2026-04-02T12:00:00Z','Garmin');

  run := public.begin_ingest_run('file-upload','user',null,null);
  a3 := public.ingest_activity(run,'file','garmin',null,
        'A from the watch','Run',null,10050.0,3000,39.10,-77.50,'2026-04-01T12:00:30Z','Garmin Connect');
  a4 := public.ingest_activity(run,'file','garmin',null,
        'B from the watch','Run',null,12050.0,3600,39.20,-77.60,'2026-04-02T12:00:30Z','Garmin Connect');

  if a3->>'disposition' <> 'proposed' or a4->>'disposition' <> 'proposed' then
    raise exception 'FAIL: the file copies were not proposed as duplicates (% / %)',
      a3->>'disposition', a4->>'disposition';
  end if;

  -- ---- Josh has one of his own waiting, which must not be touched ------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  run := public.begin_ingest_run('strava','user',null,null);
  perform public.ingest_activity(run,'strava','garmin','strava:211003',
        'His own','Run',null,8000.0,2400,40.10,-78.50,'2026-04-05T12:00:00Z','Garmin');
  run := public.begin_ingest_run('file-upload','user',null,null);
  perform public.ingest_activity(run,'file','garmin',null,
        'His own from the watch','Run',null,8050.0,2400,40.10,-78.50,'2026-04-05T12:00:30Z','Garmin Connect');

  -- ---- 1. she sees the size of it before agreeing to it ---------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  pend := public.import_duplicates_pending();
  if (pend->>'count')::int <> 2 then
    raise exception 'FAIL: she was told % were waiting, not 2', pend->>'count';
  end if;

  select count(*) into kept from public.activities
   where owner_profile in (e_id, j_id);

  -- ---- 2. one press links hers ---------------------------------------------
  res := public.approve_import_duplicates();
  if (res->>'linked')::int <> 2 then
    raise exception 'FAIL: one press linked %, not 2', res->>'linked';
  end if;

  select count(*) into hers_linked
    from public.activities
   where id in ((a3->>'activity_id')::uuid, (a4->>'activity_id')::uuid)
     and shared_group_id is not null;
  if hers_linked <> 2 then
    raise exception 'FAIL: % of her 2 recordings ended up linked', hers_linked;
  end if;

  -- both recordings survive: two records of one outing, not a winner and a loser
  if kept <> (select count(*) from public.activities where owner_profile in (e_id, j_id)) then
    raise exception 'FAIL: linking destroyed a recording';
  end if;

  -- ---- 3. IT DID NOT REACH INTO JOSH'S ---------------------------------------
  select count(*) into his_pending
    from public.suggestions s
    join public.activities a on a.id = s.subject_id
   where s.status = 'pending' and s.field = 'shared_group_id' and s.source = 'import'
     and a.owner_profile = j_id;
  if his_pending <> 1 then
    raise exception 'FAIL: her bulk approval decided % of HIS cards — it must only touch her own', 1 - his_pending;
  end if;

  -- ---- 4. and ONE undo puts every one of hers back --------------------------
  undone := public.undo_approval((res->>'undo_token')::uuid);
  if (undone->>'restored')::int <> 2 then
    raise exception 'FAIL: one undo restored %, not 2', undone->>'restored';
  end if;

  -- Restored means BOTH halves: the value put back AND the card returned to pending.
  -- Undo used to match suggestions by the undo row's single group_key, which for a batch
  -- would revert every activity while returning only one card — approved but not applied.
  if (select count(*) from public.activities
       where id in ((a3->>'activity_id')::uuid, (a4->>'activity_id')::uuid)
         and shared_group_id is not null) <> 0 then
    raise exception 'FAIL: undo left an activity still linked';
  end if;
  if ((public.import_duplicates_pending())->>'count')::int <> 2 then
    raise exception 'FAIL: undo did not put both cards back on the pile';
  end if;

  raise notice 'PASS: 2 linked in one press, Josh untouched, both recordings kept, one undo put it all back.';
end $$;

rollback;
