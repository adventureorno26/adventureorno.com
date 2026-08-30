-- Settings ▸ Stats and Insights must not answer the same question with two numbers.
--
-- They did: 17 and 56, live, at the same moment, for the same account. Not because either
-- was miscounting but because `null` and "empty" are opposites across the two generations
-- of reader — the old one means "only what we were BOTH on", the new one means "no filter".
--
-- This pins the equivalence the fix depends on: GIVEN THE SAME SCOPE the two generations
-- return the same thing. If that ever stops being true, moving a screen from one to the
-- other silently changes a number she has been reading for months, which is the class of
-- error nobody reports because it looks like data.
--
-- NO "EXPECTED EXACTLY N" ASSERTIONS. This replays against an empty schema in CI, where
-- every one of these numbers is zero, and a fixture count is a hostage to whatever seeds
-- run next. Every check below is a RELATION between two answers, so it is as meaningful on
-- an empty database as on production.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0280-0000-0000-0000-000000000001','e0280@example.invalid'),
  ('eeee0280-0000-0000-0000-000000000002','j0280@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0280-0000-0000-0000-000000000001','E0280','owner'),
  ('eeee0280-0000-0000-0000-000000000002','J0280','editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'eeee0280-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0280-0000-0000-0000-000000000002';
  me uuid; him uuid; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  me  := public.add_contact('Me 0280', e_id);
  him := public.add_contact('J0280', j_id);

  -- ---- TRIPS: the number that disagreed ------------------------------------
  -- Our Stats — the old `null`, and the new ALL over both of us.
  select count(*) into n from (
    select visit_id from public.trips_list(null)
    except select visit_id from public.trips_list_for_people(array[me, him], 'all')
    union all
    select visit_id from public.trips_list_for_people(array[me, him], 'all')
    except select visit_id from public.trips_list(null)) t;
  if n <> 0 then
    raise exception 'FAIL: Our Stats trips changed meaning — % differ', n;
  end if;

  -- My Stats — the old profile argument, and the new list of one.
  select count(*) into n from (
    select visit_id from public.trips_list(e_id)
    except select visit_id from public.trips_list_for_people(array[me], 'all')
    union all
    select visit_id from public.trips_list_for_people(array[me], 'all')
    except select visit_id from public.trips_list(e_id)) t;
  if n <> 0 then
    raise exception 'FAIL: My Stats trips changed meaning — % differ', n;
  end if;

  -- ---- THE FOUR CATEGORY PILLS BESIDE IT -----------------------------------
  -- Trips and the pills sit in the same row; half a conversion is that row
  -- describing two different sets of places.
  if (select row(trails_taken, camping, dining, winery) from public.settings_stats(null))
     is distinct from
     (select row(trails_taken, camping, dining, winery)
        from public.settings_stats_for_people(array[me, him], 'all')) then
    raise exception 'FAIL: the Our Stats category pills changed';
  end if;
  if (select row(trails_taken, camping, dining, winery) from public.settings_stats(e_id))
     is distinct from
     (select row(trails_taken, camping, dining, winery)
        from public.settings_stats_for_people(array[me], 'all')) then
    raise exception 'FAIL: the My Stats category pills changed';
  end if;

  -- ---- THE TWO THAT ARE DELIBERATELY NOT COPIES ----------------------------
  -- `geo_coverage_for_people` scopes by the places you were on a VISIT to — the set the
  -- map draws pins for — where the old one scoped by who touched the place record. So the
  -- equivalence above would be false, and asserting it would be asserting the bug. What
  -- must hold is that naming people can only ever narrow: a scope is a filter.
  if (select us_state_count from public.geo_coverage_for_people(array[me], 'all'))
     > (select us_state_count from public.geo_coverage_for_people('{}', 'all')) then
    raise exception 'FAIL: one person covered more states than everybody';
  end if;
  if (select country_count from public.geo_coverage_for_people(array[me, him], 'all'))
     > (select country_count from public.geo_coverage_for_people(array[me], 'all')) then
    raise exception 'FAIL: Our Stats covered more countries than My Stats';
  end if;

  -- `climbing_stats`'s OWN null never meant "shared" — unlike the eleven readers that
  -- do, it applied no filter at all. So this pair is the equivalence that must hold,
  -- and it is the evidence that the old generation disagreed with ITSELF about what a
  -- null means: on one Settings screen Trips meant "us" and Vertical meant "everybody".
  if (select total_ft from public.climbing_stats(null))
     is distinct from
     (select total_ft from public.climbing_stats_for_people('{}', 'all')) then
    raise exception 'FAIL: the unscoped vertical changed';
  end if;

  -- Same rule for the summits and the vertical: the overlap of two people cannot be
  -- larger than one of them, and neither can be larger than everything.
  if (select count(*) from public.peaks_bagged_for_people(array[me, him], 'all'))
     > (select count(*) from public.peaks_bagged_for_people(array[me], 'all')) then
    raise exception 'FAIL: Our Stats bagged more peaks than My Stats';
  end if;
  if (select count(*) from public.peaks_bagged_for_people(array[me], 'all'))
     > (select count(*) from public.peaks_bagged_for_people('{}', 'all')) then
    raise exception 'FAIL: one person bagged more peaks than everybody';
  end if;
  if (select total_ft from public.climbing_stats_for_people(array[me, him], 'all'))
     > (select total_ft from public.climbing_stats_for_people(array[me], 'all')) then
    raise exception 'FAIL: Our Stats climbed higher than My Stats';
  end if;
  if (select total_ft from public.climbing_stats_for_people(array[me], 'all'))
     > (select total_ft from public.climbing_stats_for_people('{}', 'all')) then
    raise exception 'FAIL: one person climbed higher than everybody';
  end if;

  -- ---- AND AN EMPTY LIST IS NOT A PERSON -----------------------------------
  -- The whole fault in one line: whatever "no people named" means, it must not be
  -- narrower than naming somebody. The old readers had it the other way round.
  if (select trails_taken from public.settings_stats_for_people('{}', 'all'))
     < (select trails_taken from public.settings_stats_for_people(array[me], 'all')) then
    raise exception 'FAIL: naming nobody returned less than naming somebody';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER function is EXECUTE-to-PUBLIC unless it is taken away, and
-- PUBLIC reaches the signed-out `anon` role.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.settings_stats_for_people(uuid[], text)',
    'public.geo_coverage_for_people(uuid[], text)',
    'public.climbing_stats_for_people(uuid[], text)',
    'public.peaks_bagged_for_people(uuid[], text)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'FAIL: authenticated cannot execute %', fn;
    end if;
  end loop;
end $$;

do $$ begin raise notice 'PASS 0280: the same scope gives the same number in both generations of reader, naming people only ever narrows, and anon cannot execute any of the four new readers'; end $$;

rollback;
