-- A proposal nobody can accept is not a proposal.
--
-- THE BUG THIS PINS. `ingest_activity` proposed `duplicate_of`. The card rendered in the
-- Inbox, so everything looked finished — but `apply_inbox_field` has no branch for that
-- field, so pressing approve raised `22023: the inbox does not write activity.duplicate_of`.
-- Erica's Garmin walk and her Strava copy of the same walk therefore stayed unlinked, and
-- every reader that does not group counted that day twice. The de-duplication had not
-- failed loudly; it had queued a double-count and put a badge on it.
--
-- Two tests, because two different things went wrong:
--   1. the specific case — a file that duplicates an existing outing can be ACCEPTED, and
--      accepting it makes the day count once while keeping both recordings
--   2. the general rule — the importer may only ever propose a field the Inbox can write.
--      Test 2 is the one that matters in a year: it fails for a field nobody has thought of
--      yet, which is exactly how `duplicate_of` got in.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('dddd0210-0000-0000-0000-000000000001', 'e0210@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('dddd0210-0000-0000-0000-000000000001', 'E0210', 'owner')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id    uuid := 'dddd0210-0000-0000-0000-000000000001';
  run     uuid;
  r1 jsonb; r2 jsonb;
  card    text;
  sug     uuid;
  field   text;
  outings int;
  kept    int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  run := public.begin_ingest_run('strava','user',null,null);

  -- her Strava copy of a walk
  r1 := public.ingest_activity(run,'strava','garmin','strava:210001',
        'Lake of the Red Rocks','Walk',null,1254.0,900,39.0505,-77.3033,
        '2024-09-26T12:13:22Z','Garmin fenix 6S Pro');

  -- the Garmin GPX of the SAME walk, 18 seconds and 2.3% apart — her real numbers
  r2 := public.ingest_activity(run,'file','garmin',null,
        'Loudoun County Walking','Walk',null,1225.0,900,39.0505,-77.3033,
        '2024-09-26T12:13:40Z','Garmin Connect');

  if r2->>'disposition' <> 'proposed' then
    raise exception 'FAIL: the second recording should have been created and proposed, got %',
      r2->>'disposition';
  end if;

  -- ---- 1. THE FIELD MUST BE ONE THE INBOX CAN WRITE ----------------------
  select s.field, s.id, s.group_key into field, sug, card
    from public.suggestions s
   where s.subject_id = (r2->>'activity_id')::uuid and s.status = 'pending'
   limit 1;
  if field is null then
    raise exception 'FAIL: no proposal was raised at all';
  end if;
  if field = 'duplicate_of' then
    raise exception 'FAIL: proposed duplicate_of — the Inbox cannot write that field, so nobody can accept it';
  end if;

  -- ---- 2. AND ACCEPTING IT MUST ACTUALLY MAKE IT COUNT ONCE --------------
  perform public.approve_card(card,
    jsonb_build_object(field, jsonb_build_object('suggestion_id', sug::text)));

  select count(distinct coalesce(a.shared_group_id, a.id)), count(*)
    into outings, kept
    from public.activities a
   where a.id in ((r1->>'activity_id')::uuid, (r2->>'activity_id')::uuid);

  if outings <> 1 then
    raise exception 'FAIL: after accepting, one walk still counts as % outings', outings;
  end if;
  -- BOTH are kept. Two recordings of one walk are two pieces of evidence for one outing;
  -- accepting must never be a delete.
  if kept <> 2 then
    raise exception 'FAIL: accepting destroyed a recording — % left of 2', kept;
  end if;

  raise notice 'PASS: the duplicate was proposed, accepted, counted once, and both recordings kept.';
end $$;

-- ---------------------------------------------------------------------------
-- THE GENERAL RULE, checked without importing anything.
-- ---------------------------------------------------------------------------
-- Whatever `ingest_activity` proposes, `apply_inbox_field` must be able to write. This is
-- the test that would have caught `duplicate_of` the day it was written, and it will catch
-- the next invented field too.
do $$
declare
  src  text := pg_get_functiondef('public.ingest_activity(uuid,text,text,text,text,text,text,double precision,integer,double precision,double precision,timestamptz,text,uuid)'::regprocedure);
  app  text := pg_get_functiondef('public.apply_inbox_field(text,uuid,text,jsonb)'::regprocedure);
  fld  text;
begin
  -- every literal the importer inserts into suggestions.field
  for fld in
    select distinct m[1]
      from regexp_matches(src, '''activity''\s*,\s*v_id\s*,\s*''([a-z_]+)''', 'g') as m
  loop
    if position('p_field = ''' || fld || '''' in app) = 0 then
      raise exception
        'FAIL: ingest_activity proposes "%" but apply_inbox_field cannot write it — nobody could ever accept that card', fld;
    end if;
    raise notice 'ok: proposals of "%" can be accepted', fld;
  end loop;
end $$;

rollback;
