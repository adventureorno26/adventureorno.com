-- DB test for 0148 — a machine may only propose.
--
-- The rule this guards is Erica's: "make sure after a user approves it in the
-- application, nothing overwrites it." Every check below has a negative control,
-- because a lock that locks EVERYTHING would be just as broken as one that locks
-- nothing. Fixtures use 2033 dates / a148 uuids so they cannot collide with live
-- rows (see 0141's note).
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000a148','v148@example.test'),
  ('bbbb7777-0000-0000-0000-00000000a148','v148-outsider@example.test')
  on conflict do nothing;
-- Note the asymmetry: the first gets a profiles row (a member), the second does
-- NOT. That second user is the whole point of test 3.
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000a148','owner','V148 Erica') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a148"}';

-- 1) THE GUARD. True before a decision, false after — and false for THAT FIELD ONLY.
do $$
declare p uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('V148 Somewhere', 39.05, -77.31, true)
    returning id into p;

  if not public.may_autowrite('place', p, 'name') then
    raise exception 'FAIL: nothing is decided yet, a machine should be free to write';
  end if;

  insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
  values ('place', p, 'name', to_jsonb('Lake of the Red Rocks'::text),
          'aaaa7777-0000-0000-0000-00000000a148', 'inbox');

  if public.may_autowrite('place', p, 'name') then
    raise exception 'FAIL: the name was decided — no machine may write it again';
  end if;

  -- NEGATIVE CONTROL 1: deciding the name must not freeze the whole row. A lock is
  -- per FIELD; freezing everything would stop legitimate placement forever.
  if not public.may_autowrite('place', p, 'is_trail') then
    raise exception 'FAIL: an unrelated field on the same subject must stay writable';
  end if;

  -- NEGATIVE CONTROL 2: nor may it leak across subjects of the same type.
  if not public.may_autowrite('place', gen_random_uuid(), 'name') then
    raise exception 'FAIL: the lock leaked to a different place';
  end if;

  -- NEGATIVE CONTROL 3: nor across subject TYPES sharing an id.
  if not public.may_autowrite('activity', p, 'name') then
    raise exception 'FAIL: the lock leaked across subject types';
  end if;

  raise notice 'PASS 1: may_autowrite refuses exactly one decided field, and nothing else';
end $$;

-- 2) NEVER PROPOSE THE SAME THING TWICE.
do $$
declare a uuid; dup boolean := false;
begin
  insert into public.places (name, lat, lng, saved) values ('V148 Route', 38.10, -78.10, true)
    returning id into a;

  insert into public.suggestions
    (subject_type, subject_id, field, proposed_value, label, source, group_key, status)
  values ('place', a, 'name', to_jsonb('Camp Fraser'::text),
          'Call this Camp Fraser', 'maptiler', 'v148-card-1', 'rejected');

  -- She turned it down. Offering it again is the behaviour this index exists to stop.
  begin
    insert into public.suggestions
      (subject_type, subject_id, field, proposed_value, label, source, group_key, status)
    values ('place', a, 'name', to_jsonb('Camp Fraser'::text),
            'Call this Camp Fraser', 'osm', 'v148-card-2', 'pending');
  exception when unique_violation then
    dup := true;
  end;
  if not dup then
    raise exception 'FAIL: a rejected suggestion was offered again';
  end if;

  -- NEGATIVE CONTROL: a DIFFERENT proposal for the same field is still allowed —
  -- the point is to stop repeats, not to stop the suggester from doing better.
  insert into public.suggestions
    (subject_type, subject_id, field, proposed_value, label, source, group_key, status)
  values ('place', a, 'name', to_jsonb('Potomac Heritage Trail'::text),
          'Call this Potomac Heritage Trail', 'osm', 'v148-card-2', 'pending');

  raise notice 'PASS 2: a rejected proposal cannot return; a better one can';
end $$;

-- 3) A LOGGED-IN NON-MEMBER READS NOTHING. Rule #8 — a session alone is not access.
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbb7777-0000-0000-0000-00000000a148"}';

  select (select count(*) from public.suggestions)
       + (select count(*) from public.approved_fields)
       + (select count(*) from public.ingest_runs)
    into n;

  if n <> 0 then
    raise exception 'FAIL: a logged-in non-member read % rows from the ledger', n;
  end if;
  raise notice 'PASS 3: the ledger is invisible without a profiles row';
end $$;

reset role;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a148"}';

-- 3b) NEGATIVE CONTROL for test 3: a MEMBER must actually be able to read, or test 3
--     would pass just as well against three permanently empty tables.
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a148"}';
  select count(*) into n from public.approved_fields;
  if n = 0 then
    raise exception 'FAIL: a member sees nothing — test 3 proved only that the table is empty';
  end if;
  raise notice 'PASS 3b: a member reads the ledger (% rows)', n;
end $$;

reset role;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a148"}';

-- 4) NO CLIENT MAY WRITE THE LEDGER. Every write goes through a SECDEF RPC.
do $$
declare blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a148"}';
  begin
    insert into public.approved_fields (subject_type, subject_id, field, value, approved_by)
    values ('place', gen_random_uuid(), 'name', to_jsonb('anything'::text),
            'aaaa7777-0000-0000-0000-00000000a148');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: a member wrote approved_fields directly — decisions must be audited';
  end if;
  raise notice 'PASS 4: approved_fields takes no direct client write';
end $$;

reset role;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a148"}';

-- 5) THE BACKFILL CONVERTED THE RIGHT THINGS — asserted as invariants, not counts.
--
--    This block used to assert "exactly 61 place names and 12 manual visits", which
--    were the live production numbers. CI applies the migration chain to an EMPTY
--    disposable database, where the correct answer is 0, so the test failed there and
--    passed on prod — the exact opposite of useful. A test that only holds against one
--    database is not a test. These invariants hold in both.
do $$
declare n_place int; n_visit int; n_other int; n_photo int; n_activity int; n_missing int;
begin
  select count(*) into n_place from public.approved_fields
   where via = 'backfill' and subject_type = 'place' and field = 'name';
  select count(*) into n_visit from public.approved_fields
   where via = 'backfill' and subject_type = 'visit' and field = 'place_id';
  select count(*) into n_photo from public.approved_fields
   where via = 'backfill' and subject_type = 'photo';
  select count(*) into n_activity from public.approved_fields
   where via = 'backfill' and subject_type = 'activity';
  select count(*) into n_other from public.approved_fields
   where via = 'backfill'
     and not (subject_type = 'place' and field = 'name')
     and not (subject_type = 'visit' and field = 'place_id');

  -- Every place that was locked has a decision recorded for its name — whether the
  -- backfill wrote it or a later edit did. Vacuously true on an empty database,
  -- meaningful on a populated one, correct on both.
  -- Excluding this test's OWN fixtures: inserting a named place trips a trigger that
  -- sets name_locked, so the V148 rows above are locked-without-an-approval by
  -- construction. The invariant is about data that existed before this transaction.
  select count(*) into n_missing
    from public.places p
   where p.name_locked and nullif(btrim(p.name), '') is not null
     and p.name not like 'V148%'
     and not exists (select 1 from public.approved_fields af
                      where af.subject_type = 'place' and af.subject_id = p.id
                        and af.field = 'name');
  if n_missing <> 0 then
    raise exception 'FAIL: % locked places have no recorded name decision', n_missing;
  end if;

  -- Same for the manual visits the backfill was supposed to convert.
  select count(*) into n_missing
    from public.visits v
    join public.places pl on pl.id = v.place_id
   where v.manual and pl.name not like 'V148%'
     and not exists (select 1 from public.approved_fields af
                      where af.subject_type = 'visit' and af.subject_id = v.id
                        and af.field = 'place_id');
  if n_missing <> 0 then
    raise exception 'FAIL: % manual visits have no recorded place decision', n_missing;
  end if;
  -- Keep the shape visible in the log so a surprising environment is obvious.
  raise notice '  (backfilled: % place names, % manual visits)', n_place, n_visit;
  -- There were 0 of 168 photos on a visit, so a photo row here means the backfill
  -- invented one. And the 328 renamed activities stay UNLOCKED on purpose — locking
  -- them would freeze in the machine-written names the route scorer should improve.
  if n_photo <> 0 then
    raise exception 'FAIL: photos were backfilled (%) — there was nothing to migrate', n_photo;
  end if;
  if n_activity <> 0 then
    raise exception 'FAIL: % activities were locked — they must stay open to a better name', n_activity;
  end if;
  if n_other <> 0 then
    raise exception 'FAIL: the backfill wrote % rows it was not asked to write', n_other;
  end if;
  raise notice 'PASS 5: every lock is recorded, and nothing else was backfilled';
end $$;

-- 6) EVERY BACKFILLED LOCK MATCHES THE RECORD IT CAME FROM. A ledger that disagrees
--    with the row it describes is worse than no ledger.
do $$
declare n int;
begin
  select count(*) into n
    from public.approved_fields af
    join public.places p on p.id = af.subject_id
   where af.via = 'backfill' and af.subject_type = 'place' and af.field = 'name'
     and af.value is distinct from to_jsonb(p.name);
  if n <> 0 then
    raise exception 'FAIL: % backfilled place names disagree with the place', n;
  end if;

  select count(*) into n
    from public.approved_fields af
   where af.via = 'backfill' and af.subject_type = 'place'
     and not exists (select 1 from public.places p where p.id = af.subject_id and p.name_locked);
  if n <> 0 then
    raise exception 'FAIL: % backfilled locks point at places that were never locked', n;
  end if;
  raise notice 'PASS 6: every backfilled lock matches its row';
end $$;

do $$ begin raise notice 'PASS: 0148 a machine may only propose'; end $$;
rollback;
