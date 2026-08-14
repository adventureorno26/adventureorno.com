-- 0180 — canonical state is read-only to a browser, and stays that way.
--
-- This has now been the same bug four times: visit_evidence (0166), activity_options
-- (0164), activity_profiles and place_membership (0173/earlier). Each table was created
-- before 0174 fixed the default grants, each migration wrote `grant select ... to
-- authenticated` believing that was the whole story, and Supabase's default ACL had
-- already handed `authenticated` INSERT, UPDATE and DELETE at CREATE TABLE.
--
-- So this is a LIST, not four separate assertions. Adding a table that holds canonical
-- state means adding it here, and forgetting to close it fails the build.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. THE LIST. Every table here is written by a trigger or a SECURITY DEFINER
--    RPC, never by the browser.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
  bad text[] := '{}';
  canonical text[] := array[
    -- the visit and everything that says what it was
    'visits', 'visit_profiles', 'visit_people', 'visit_evidence',
    -- who did an activity, and the vocabulary of the dropdown
    'activity_profiles',
    -- the MIRROR of places.part_of — writing it directly is silently undone (§8)
    'place_membership',
    -- queues a human still has to settle; a browser must not be able to empty them
    'visit_participant_review', 'activity_participant_review', 'activity_visit_review'
  ];
begin
  foreach t in array canonical loop
    if to_regclass('public.' || t) is null then
      raise exception 'FAIL: % is in the canonical list but does not exist', t; end if;

    foreach p in array array['INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('authenticated', 'public.' || t, p) then
        bad := bad || (t || '.' || p);
      end if;
    end loop;

    -- the card still has to READ all of it
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'FAIL: authenticated can no longer read %', t; end if;

    -- and anon reaches none of it
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'FAIL: anon can read %', t; end if;
  end loop;

  if array_length(bad,1) > 0 then
    raise exception 'FAIL: a browser can still write canonical state directly: %',
      array_to_string(bad, ', ');
  end if;

  raise notice 'PASS 1: all % canonical tables are read-only to a browser',
    array_length(canonical,1);
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE VIEW IS NOT A BACK DOOR. `accepted_visits` is auto-updatable and shows
--    up in the grant listing as writable; 0170's security_invoker is what makes
--    base-table permissions apply to the CALLER. If that option is ever lost,
--    every revoke above becomes decorative.
-- ---------------------------------------------------------------------------
do $$
declare v_opts text;
begin
  select array_to_string(c.reloptions, ',') into v_opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'accepted_visits';

  if coalesce(v_opts,'') not like '%security_invoker=true%' then
    raise exception
      'FAIL: accepted_visits lost security_invoker — writes through the view would '
      'bypass every revoke on visits (got %)', coalesce(v_opts, '(none)');
  end if;

  raise notice 'PASS 2: the view checks base-table permissions as the caller';
end $$;

-- ---------------------------------------------------------------------------
-- 3. And the writers still work, so this is one door rather than none.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid; p uuid; v public.visits; n int;
begin
  insert into auth.users (id, email) values
    ('bbbb0180-0000-0000-0000-000000000001', 'a0180@example.invalid')
  on conflict do nothing;
  insert into public.profiles (id, display_name, role) values
    ('bbbb0180-0000-0000-0000-000000000001', 'A0180', 'owner')
  on conflict (id) do update set role = 'owner';
  a_id := 'bbbb0180-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claims', '{"sub":"bbbb0180-0000-0000-0000-000000000001"}', true);

  insert into public.places (name, lat, lng, saved) values ('T180 Place', 38.6, -77.3, true)
    returning id into p;
  v := public.create_visit(p, '2026-10-20', null, null, array[a_id]::uuid[]);

  select count(*) into n from public.visit_profiles where visit_id = v.id;
  if n <> 1 then raise exception 'FAIL: participants are written through the RPC, got %', n; end if;

  perform public.set_visit_participants(v.id, array[a_id]::uuid[]);
  perform public.attach_visit_evidence(v.id, 'photo', gen_random_uuid(), '2026-10-20', 'k0180');
  select count(*) into n from public.visit_evidence where visit_id = v.id;
  if n <> 1 then raise exception 'FAIL: evidence is written through the RPC, got %', n; end if;

  raise notice 'PASS 3: the RPCs still write what the browser no longer can';
end $$;

rollback;
