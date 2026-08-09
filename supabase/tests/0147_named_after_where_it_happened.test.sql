-- DB test for 0147 — an activity is named after WHERE it happened.
--
-- Erica: "I want the names of real places, not 'morning walk'." The failure this
-- guards is the one I caused: 181 file imports named from the clock. Fixtures use
-- 2033 dates so they cannot collide with live rows (see 0141's note).
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000a147','v147@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000a147','owner','V147 Erica') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a147"}';

-- 1) THE RULE. Clock readings and export filenames are not names; a person's words are.
do $$
declare bad text; good text;
begin
  foreach bad in array array[
    'Morning Walk','Afternoon Hike','Evening Run','Lunch Ride','Night Hike',
    'Late Night Walk','morning walk','Morning Walks',
    'hiking 2018-01-14 14:34','running_2020-05-02','2018-01-14T09:12:00',
    'activity_8811','activity8811','Hike','walk','   '
  ] loop
    if not public.is_generic_activity_name(bad) then
      raise exception 'FAIL: % should be treated as generic', bad;
    end if;
  end loop;

  -- NEGATIVE CONTROL: the rule must not eat real names. "Morning Glory Trail" and
  -- "Sunday Morning Ramble with Josh" both contain a time word and must survive.
  foreach good in array array[
    'Old Rag with Josh','Seneca Regional Park','Morning Glory Trail',
    'Sunday Morning Ramble with Josh','San Clemente Walk with Josh - phone died',
    'Appalachian Trail — South Mountain, Maryland','Army Ten Miler','Eagle Rock Hike w Josh'
  ] loop
    if public.is_generic_activity_name(good) then
      raise exception 'FAIL: % is a real name and must be kept', good;
    end if;
  end loop;
  raise notice 'PASS 1: generic names detected, real names kept';
end $$;

-- 2) A GENERIC NAME BECOMES THE PLACE NAME; A REAL ONE IS UNTOUCHED.
do $$
declare p uuid; n text;
begin
  insert into public.places (name, lat, lng, saved) values ('V147 Seneca Regional Park', 39.05, -77.31, true)
    returning id into p;

  n := public.activity_display_name('Morning Hike', p, 'Hike');
  if n <> 'V147 Seneca Regional Park' then
    raise exception 'FAIL: generic name should become the place, got %', n;
  end if;

  n := public.activity_display_name('Old Rag with Josh', p, 'Hike');
  if n <> 'Old Rag with Josh' then
    raise exception 'FAIL: a written name must survive, got %', n;
  end if;

  -- No place to borrow from: fall back to the type, never to empty.
  n := public.activity_display_name('Morning Hike', null, 'Hike');
  if n <> 'Hike' then raise exception 'FAIL: placeless fallback should be the type, got %', n; end if;
  raise notice 'PASS 2: display name resolves place / person / type in that order';
end $$;

-- 3) THE IMPORT ITSELF. This is the path that produced the 181 bad names.
do $$
declare id1 uuid; id2 uuid; nm text; pl uuid;
begin
  id1 := public.import_file_activity(
    'hiking 2033-04-02 08:15', 'Hike', null, 6400, 3600, 39.0501, -77.3121,
    '2033-04-02T12:15:00Z'::timestamptz);
  select name, place_id into nm, pl from public.activities where id = id1;
  if nm ~* '^(morning|afternoon|evening|night|lunch)' or nm like 'hiking 2033%' then
    raise exception 'FAIL: import kept a clock/export name: %', nm;
  end if;
  if pl is null then
    raise exception 'FAIL: fixture did not get placed, so the test proves nothing';
  end if;
  if nm is distinct from (select name from public.places where id = pl) then
    raise exception 'FAIL: import should name the activity after its place, got %', nm;
  end if;

  -- NEGATIVE CONTROL: a descriptive name from the same path is preserved.
  id2 := public.import_file_activity(
    'Buzzard Rock with Josh', 'Hike', null, 9000, 5400, 38.9288, -78.3083,
    '2033-04-03T12:15:00Z'::timestamptz);
  select name into nm from public.activities where id = id2;
  if nm <> 'Buzzard Rock with Josh' then
    raise exception 'FAIL: import overwrote a name a person wrote, got %', nm;
  end if;
  raise notice 'PASS 3: file import names after the place, and keeps written names';
end $$;

-- 4) RENAMING A PLACE CARRIES ITS ACTIVITIES — BUT NOT THE WRITTEN ONES.
do $$
declare p uuid; a1 uuid; a2 uuid; n int; nm text;
begin
  insert into public.places (name, lat, lng, saved) values ('V147 New place', 38.10, -78.10, true)
    returning id into p;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
    values ('Hike','Morning Hike', 5000, '2033-05-01T12:00:00Z', 38.10, -78.10, p, 'file')
    returning id into a1;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source)
    values ('Hike','Strickler Knob with Josh', 5000, '2033-05-02T12:00:00Z', 38.10, -78.10, p, 'file')
    returning id into a2;

  update public.places set name = 'V147 Massanutten Trail' where id = p;
  n := public.rename_activities_for_place(p);
  if n <> 1 then raise exception 'FAIL: expected exactly 1 activity renamed, got %', n; end if;

  select name into nm from public.activities where id = a1;
  if nm <> 'V147 Massanutten Trail' then
    raise exception 'FAIL: the generic activity did not follow the place, got %', nm;
  end if;
  select name into nm from public.activities where id = a2;
  if nm <> 'Strickler Knob with Josh' then
    raise exception 'FAIL: a written name must not follow the place, got %', nm;
  end if;
  raise notice 'PASS 4: a better place name carries only the generic activities';
end $$;

do $$ begin raise notice 'PASS: 0147 an activity is named after where it happened'; end $$;
rollback;
