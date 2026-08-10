-- DB test for 0150 — the machines are behind the guard, and stay there.
--
-- The point of this file is the LAST block: it reads every function body in the
-- database and fails if any of them overwrites an Inbox-owned field without either
-- recording the person's decision or asking may_autowrite first. That is what stops
-- this design decaying the moment someone adds a function next month.
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000a150','v150@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000a150','owner','V150 Erica') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a150"}';

-- 1) HER EDIT IS AN APPROVAL. Renaming an activity locks the name, and locks NOTHING
--    else on it.
do $$
declare p uuid; a uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('V150 Place', 39.0, -77.5, true)
    returning id into p;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
    values ('Hike','Morning Hike', 5000, '2033-06-01T12:00:00Z', 39.0, -77.5, p, 'file')
    returning id into a;

  if not public.may_autowrite('activity', a, 'name') then
    raise exception 'FAIL: a fresh activity name should be open to suggestion';
  end if;

  perform public.update_activity(a, 'Old Rag with Josh', null);

  if public.may_autowrite('activity', a, 'name') then
    raise exception 'FAIL: she named it — no machine may write that name again';
  end if;
  if not exists (select 1 from public.approved_fields
                  where subject_type='activity' and subject_id=a and field='name' and via='edit') then
    raise exception 'FAIL: her edit was not recorded as an approval';
  end if;
  -- NEGATIVE CONTROL: naming it must not freeze WHERE it happened.
  if not public.may_autowrite('activity', a, 'place_id') then
    raise exception 'FAIL: naming an activity also locked its placement';
  end if;
  raise notice 'PASS 1: an edit is an approval, and locks only what was edited';
end $$;

-- 2) CHANGING ONLY THE TYPE MUST NOT LOCK THE NAME.
--    Otherwise a stray "this was a Ride, not a Run" silently ends all future naming.
do $$
declare p uuid; a uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('V150 Place 2', 39.1, -77.6, true)
    returning id into p;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
    values ('Run','Evening Run', 3000, '2033-06-02T12:00:00Z', 39.1, -77.6, p, 'file')
    returning id into a;

  perform public.update_activity(a, null, 'Ride');

  if not public.may_autowrite('activity', a, 'name') then
    raise exception 'FAIL: a type-only edit locked the name';
  end if;
  raise notice 'PASS 2: a type edit is not a naming decision';
end $$;

-- 3) THE HEADLINE. A place getting a better name carries its generic activities —
--    but never one she has decided.
do $$
declare p uuid; a_generic uuid; a_hers uuid; n int; nm text;
begin
  insert into public.places (name, lat, lng, saved) values ('V150 New place', 38.5, -78.5, true)
    returning id into p;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
    values ('Hike','Morning Hike', 5000, '2033-06-03T12:00:00Z', 38.5, -78.5, p, 'file')
    returning id into a_generic;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
    values ('Hike','Morning Hike', 5000, '2033-06-04T12:00:00Z', 38.5, -78.5, p, 'file')
    returning id into a_hers;

  -- She decides one of them is called something else.
  perform public.update_activity(a_hers, 'Old Rag with Josh', null);

  update public.places set name = 'V150 Massanutten Trail' where id = p;
  n := public.rename_activities_for_place(p);

  select name into nm from public.activities where id = a_generic;
  if nm <> 'V150 Massanutten Trail' then
    raise exception 'FAIL: the generic activity did not follow the place, got %', nm;
  end if;
  select name into nm from public.activities where id = a_hers;
  if nm <> 'Old Rag with Josh' then
    raise exception 'FAIL: an APPROVED name was overwritten by the renamer, got %', nm;
  end if;
  if n <> 1 then
    raise exception 'FAIL: expected exactly 1 rename, got %', n;
  end if;
  raise notice 'PASS 3: a rename carries the guesses and leaves her decisions alone';
end $$;

-- 4) THE GREP TEST. No function may overwrite an Inbox-owned field unguarded.
--
--    Statements are split on ';' and only the part of an UPDATE between `set` and
--    `where` is examined, so a field mentioned in a WHERE clause is not mistaken for
--    a write. Each allowlist entry below states WHY it is allowed.
do $$
declare
  r record;
  stmt text;
  setpart text;
  bad text := '';
  -- Group 4.1: these ARE the person deciding. They must record an approval, which is
  -- asserted separately below rather than assumed.
  person_initiated text[] := array[
    'set_place_name','update_activity','reassign_activity',
    'set_visit_place','set_visit_is_trip','set_photo_visit'];
  -- The Inbox's own machinery: apply_inbox_field writes what she just chose, and
  -- approve_card/undo_approval drive it.
  inbox_internals text[] := array['apply_inbox_field','approve_card','undo_approval'];
  -- Group 4.3 and structural moves, each for a stated reason:
  --   rebuild_place_visits / recompute_place_stats / ensure_visit — derived rows.
  --   merge_places / merge_places_auto — repointing rows off a place being merged
  --     away; refusing per-activity would strand them on a place that no longer
  --     exists, which is worse than the thing the guard protects against.
  --   cluster_unassigned / import_file_activity — these place things that were never
  --     placed. There is no prior decision to overwrite.
  --   assign_activity_to_race / dedupe_shared_outings / group_duplicate_activities /
  --     tag_place_from_entry — reviewed 2026-08-09: none writes name/place_id over an
  --     existing decided value.
  structural text[] := array[
    'rebuild_place_visits','recompute_place_stats','ensure_visit',
    'merge_places','merge_places_auto','cluster_unassigned','import_file_activity',
    'assign_activity_to_race','dedupe_shared_outings','group_duplicate_activities',
    'tag_place_from_entry','restore_place','restore_photo',
    'soft_delete_place','soft_delete_photo'];
begin
  for r in
    select p.proname, lower(pg_get_functiondef(p.oid)) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    if r.proname = any(person_initiated) or r.proname = any(inbox_internals)
       or r.proname = any(structural) then
      continue;
    end if;
    if r.def ~ 'may_autowrite' then
      continue;  -- it asks. That is the whole requirement.
    end if;

    foreach stmt in array regexp_split_to_array(r.def, ';') loop
      if stmt !~ 'update\s+(public\.)?(activities|places|visits|photos)\y' then
        continue;
      end if;
      setpart := split_part(substring(stmt from 'set\y(.*)$'), ' where ', 1);
      if setpart is null then continue; end if;

      if (stmt ~ 'update\s+(public\.)?activities\y' and setpart ~ '\y(name|place_id)\s*=')
      or (stmt ~ 'update\s+(public\.)?places\y'     and setpart ~ '\y(name|is_trail)\s*=')
      or (stmt ~ 'update\s+(public\.)?visits\y'     and setpart ~ '\y(place_id|is_trip)\s*=')
      or (stmt ~ 'update\s+(public\.)?photos\y'     and setpart ~ '\yvisit_id\s*=') then
        bad := bad || r.proname || ' ';
      end if;
    end loop;
  end loop;

  if bad <> '' then
    raise exception 'FAIL: these write an Inbox-owned field with no approval and no may_autowrite: %', bad;
  end if;
  raise notice 'PASS 4: every unguarded writer is accounted for';
end $$;

-- 5) NEGATIVE CONTROL FOR THE GREP TEST ITSELF.
--    A test that cannot fail proves nothing, so plant a function that breaks the rule
--    and require the same scan to catch it.
do $$
declare bad text := ''; r record; stmt text; setpart text;
begin
  create or replace function public.v150_rogue_renamer(p_id uuid) returns void
  language plpgsql as $rogue$
  begin
    update public.activities set name = 'whatever' where id = p_id;
  end $rogue$;

  for r in
    select p.proname, lower(pg_get_functiondef(p.oid)) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'v150_rogue_renamer'
  loop
    foreach stmt in array regexp_split_to_array(r.def, ';') loop
      if stmt !~ 'update\s+(public\.)?activities\y' then continue; end if;
      setpart := split_part(substring(stmt from 'set\y(.*)$'), ' where ', 1);
      if setpart ~ '\y(name|place_id)\s*=' then bad := bad || r.proname; end if;
    end loop;
  end loop;

  drop function public.v150_rogue_renamer(uuid);

  if bad = '' then
    raise exception 'FAIL: the scan did not catch a function that plainly breaks the rule';
  end if;
  raise notice 'PASS 5: the scan catches a real violation';
end $$;

-- 6) EVERY PERSON-INITIATED FUNCTION ACTUALLY RECORDS AN APPROVAL.
--    Allowlisting them in test 4 is only safe if this holds.
do $$
declare missing text := ''; f text;
begin
  foreach f in array array['set_place_name','update_activity','reassign_activity',
                           'set_visit_place','set_visit_is_trip','set_photo_visit'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = f
         and pg_get_functiondef(p.oid) ~ 'record_approval') then
      missing := missing || f || ' ';
    end if;
  end loop;
  if missing <> '' then
    raise exception 'FAIL: person-initiated but records no approval: %', missing;
  end if;
  raise notice 'PASS 6: every person-initiated writer records the decision';
end $$;

do $$ begin raise notice 'PASS: 0150 the machines are behind the guard'; end $$;
rollback;
