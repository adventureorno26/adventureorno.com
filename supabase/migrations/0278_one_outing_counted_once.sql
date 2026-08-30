-- 0278 — six readers that counted the same outing twice.
--
-- THE RULE, which this database has held since 0140/0141: when two people record the same
-- outing, the two `activities` rows are tied together by `shared_group_id`, and the canonical
-- key of an outing is therefore `coalesce(shared_group_id, id)` — not `id`. Every reader that
-- answers "how many" or "how far" has to collapse to that key first, or it reports the number
-- of RECORDINGS while the screen says OUTINGS.
--
-- Some readers do. `mileage_by_person_for_people` has collapsed since it was written:
--
--     select distinct on (coalesce(a.shared_group_id, a.id)) ...
--       from public.visible_activities a
--      where ...
--      order by coalesce(a.shared_group_id, a.id), a.id
--
-- Six did not, and 0261 carried five of them across to the people-aware variants verbatim —
-- its own note says *"the bodies are otherwise untouched"*, which was true and is exactly how
-- the defect propagated. Every one of the six is fixed here to the pattern above, tie-break
-- `a.id`, so that the readers agree with each other rather than each being defensible alone.
--
--     activities_of_type_for_people(text, uuid[], text)
--     race_stats_for_people(uuid[], text)
--     races_list_for_people(uuid[], text)
--     activities_of_type(text, uuid)          -- the older profile-scoped siblings, same defect
--     race_stats(uuid)
--     races_list(uuid)
--
-- MEASURED, not assumed. Production today holds 572 activities; 91 carry a `shared_group_id`;
-- 31 of those groups have more than one member; so 57 rows are second recordings of an outing
-- already in the set. By type:
--
--     type      rows   canonical   over-count
--     Run        279         247        +32
--     Hike       152         137        +15
--     Walk       130         121         +9
--     Ride         9           9          0
--     Swim         1           1          0
--     Workout      1           1          0
--
-- The readers were then called as each of the three accounts inside a rolled-back transaction,
-- before and after, because a table of row counts in `activities` is not the same claim as a
-- table of rows a person actually sees — `visible_activities` is per-viewer.
--
--   activities_of_type_for_people(type, '{}', 'all')   rows returned, before -> after
--
--     account      Run           Hike          Walk
--     Erica     216 -> 200    139 -> 134    115 -> 106
--     Josh      248 -> 216     71 ->  56    105 ->  98
--     Test bot  168 -> 165     41 ->  41     79 ->  74
--
--   activities_of_type(type, <that account>)   — what everything outside the map filter uses
--
--     account      Run           Hike          Walk
--     Erica     143 -> 128    139 -> 134    115 -> 106
--     Josh      163 -> 145     30 ->  20     26 ->  26
--     Test bot    0 ->   0      0 ->   0      0 ->   0
--
--   activities_of_type(type, null)   — the "both of them" view, via is_shared_activity
--
--     account      Run           Hike          Walk
--     Erica      27 ->  26     17 ->  17     11 ->  11
--     Josh       27 ->  26     17 ->  17     11 ->  11
--     Test bot   10 ->  10      0 ->   0      0 ->   0
--
-- Every one of those either fell or held. None rose, and no other reader moved at all:
-- `mileage_by_person_for_people` still counts 450/376/285 outings and `activity_lines*` still
-- draws 480/431/293 lines, identical to the digit before and after.
--
-- THE RACE READERS ARE FIXED WITH ZERO EFFECT TODAY, and that is worth saying plainly rather
-- than dressing up as a win. Four activities in production qualify as races and none of them
-- is in a multi-member group, so `race_stats*` and `races_list*` return exactly what they
-- returned before — 4 / 2 / 1 races and 66.650 / 30.037 / 10.105 miles for Erica, Josh and the
-- test bot, unchanged to the thousandth. The defect was in the code and not yet in the data.
-- Fixing it now is what stops the first jointly-recorded race from quietly counting as two,
-- which is the sort of thing nobody notices because a race count of 2 looks like a race count
-- of 2.
--
-- DELIBERATE EXCEPTION, NOT AN OVERSIGHT: `activity_lines` and `activity_lines_for_people` are
-- left non-deduping. Their own body says why — the representative of a group may be the copy
-- WITHOUT a route, and a missing line on the map is a worse error than two drawn on top of
-- each other. They draw every recorded route line on purpose. The assertions below check that
-- they are still the way they are meant to be, so a later pass that "finishes the job" has to
-- argue with a raise rather than slip through.
--
-- Each of the six keeps its RETURNS TABLE signature, LANGUAGE sql, STABLE, SECURITY DEFINER
-- and `SET search_path TO 'public'` unchanged; only the FROM clause collapses. CREATE OR
-- REPLACE keeps existing grants, but 0274's lesson is that a definer function's anon grant is
-- asserted, never assumed — so all eight are checked at the bottom.

begin;

-- ---------------------------------------------------------------------------
-- 1. activities_of_type_for_people — the map filter's type lists.
-- ---------------------------------------------------------------------------
create or replace function public.activities_of_type_for_people(p_type text, p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(id uuid, type text, name text, distance double precision, start_date timestamp with time zone, place_id uuid, place_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once: the same run recorded by two people shares a
    -- shared_group_id (0140/0141). Tie-break a.id, matching mileage_by_person_for_people.
    select distinct on (coalesce(a.shared_group_id, a.id))
           a.id, a.type, a.name, a.distance, a.start_date, a.place_id
      from public.visible_activities a
     where a.type = p_type
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  -- The place join happens after the collapse so it cannot re-multiply the rows, and the
  -- caller's ordering is restored here — DISTINCT ON owns the ORDER BY of its own subquery.
  select c.id, c.type, c.name, c.distance, c.start_date, c.place_id, p.name
    from canon c
    left join public.places p on p.id = c.place_id
   order by c.start_date desc nulls last;
$function$
;

-- ---------------------------------------------------------------------------
-- 2. race_stats_for_people — race count and miles per distance bucket.
-- ---------------------------------------------------------------------------
create or replace function public.race_stats_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(bucket text, n integer, miles double precision, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- The race predicate stays INSIDE the collapse. If only one recording of a joint race
    -- carries is_race, that is the one that must survive — deduping first and filtering
    -- afterwards could drop the race entirely.
    select distinct on (coalesce(a.shared_group_id, a.id)) a.distance
      from public.visible_activities a
      join public.places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select b.bucket, count(*)::int as n, coalesce(sum(c.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from canon c
  cross join lateral (select public.race_bucket(c.distance/1609.344) as bucket) b
  group by b.bucket
  order by ord;
$function$
;

-- ---------------------------------------------------------------------------
-- 3. races_list_for_people — one row per race place, with how many times.
-- ---------------------------------------------------------------------------
create or replace function public.races_list_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(id uuid, name text, times integer, miles double precision, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.place_id, a.distance
      from public.visible_activities a
      join public.places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  -- `times` is the count that was doubled, and `bucket` divides miles BY times — so an
  -- uncollapsed set got the count wrong and the average distance right, which is why this
  -- never looked broken.
  select p.id, p.name, count(c.*)::int as times,
    coalesce(sum(c.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(c.distance),0)/1609.344) / nullif(count(c.*),0)) as bucket
  from public.places p
  join canon c on c.place_id = p.id
  group by p.id, p.name
  having count(c.*) > 0
  order by p.name;
$function$
;

-- ---------------------------------------------------------------------------
-- 4-6. The older profile-scoped siblings. 0261 kept them deliberately — "they take a
-- profile, they are what everything outside the map filter uses" — so they carry the same
-- defect and get the same collapse. Their CASE predicate is reproduced exactly.
-- ---------------------------------------------------------------------------
create or replace function public.activities_of_type(p_type text, p_profile uuid default null::uuid)
 RETURNS TABLE(id uuid, type text, name text, distance double precision, start_date timestamp with time zone, place_id uuid, place_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id))
           a.id, a.type, a.name, a.distance, a.start_date, a.place_id
      from public.visible_activities a
     where a.type = p_type
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select c.id, c.type, c.name, c.distance, c.start_date, c.place_id, p.name
    from canon c
    left join public.places p on p.id = c.place_id
   order by c.start_date desc nulls last;
$function$
;

create or replace function public.race_stats(p_profile uuid default null::uuid)
 RETURNS TABLE(bucket text, n integer, miles double precision, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.distance
      from public.visible_activities a
      join public.places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select b.bucket, count(*)::int as n, coalesce(sum(c.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from canon c
  cross join lateral (select public.race_bucket(c.distance/1609.344) as bucket) b
  group by b.bucket
  order by ord;
$function$
;

create or replace function public.races_list(p_profile uuid default null::uuid)
 RETURNS TABLE(id uuid, name text, times integer, miles double precision, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.place_id, a.distance
      from public.visible_activities a
      join public.places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select p.id, p.name, count(c.*)::int as times,
    coalesce(sum(c.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(c.distance),0)/1609.344) / nullif(count(c.*),0)) as bucket
  from public.places p
  join canon c on c.place_id = p.id
  group by p.id, p.name
  having count(c.*) > 0
  order by p.name;
$function$
;

-- ---------------------------------------------------------------------------
-- STRUCTURE. True on an empty schema and on production alike: these check the function
-- definitions, which this migration just wrote, not the data they would return.
-- ---------------------------------------------------------------------------
do $$
declare
  fn   text;
  n    int;
  sig  text;
  sigs text[] := array[
    'public.activities_of_type_for_people(text,uuid[],text)',
    'public.race_stats_for_people(uuid[],text)',
    'public.races_list_for_people(uuid[],text)',
    'public.activities_of_type(text,uuid)',
    'public.race_stats(uuid)',
    'public.races_list(uuid)'];
begin
  foreach fn in array array['activities_of_type_for_people','race_stats_for_people',
                            'races_list_for_people','activities_of_type','race_stats','races_list']
  loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn
       and pg_get_functiondef(p.oid) like '%distinct on (coalesce(a.shared_group_id, a.id))%'
       and pg_get_functiondef(p.oid) like '%order by coalesce(a.shared_group_id, a.id), a.id%';
    if n <> 1 then
      raise exception '% does not collapse to coalesce(shared_group_id, id) with the a.id tie-break (matched % definition(s))', fn, n;
    end if;

    -- The signature, the definer bit and the pinned search_path all have to survive a
    -- CREATE OR REPLACE. A changed argument list would create a SECOND overload instead of
    -- replacing anything, which the count above would already have caught.
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn
       and p.prosecdef
       and p.proconfig @> array['search_path=public'];
    if n <> 1 then
      raise exception '% is not exactly one SECURITY DEFINER function with search_path=public', fn;
    end if;
  end loop;

  -- The deliberate exception (see the header). If a later pass makes these dedupe, it has
  -- to delete this check and say why in its own migration.
  foreach fn in array array['activity_lines','activity_lines_for_people'] loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn
       and pg_get_functiondef(p.oid) like '%distinct on%';
    if n <> 0 then
      raise exception '% now dedupes; it is meant to draw EVERY recorded route line (0278)', fn;
    end if;
  end loop;

  -- 0274/0277's lesson: a definer function's anon grant is asserted, never assumed.
  foreach sig in array sigs || array['public.activity_lines(uuid)','public.activity_lines_for_people(uuid[],text)']
  loop
    if has_function_privilege('anon', sig, 'EXECUTE') then
      raise exception 'anon can execute %', sig;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- BEHAVIOUR. Calls the readers for real and checks that what comes back is one row per
-- canonical outing. This needs a member to be, so on a freshly replayed schema — where
-- `profiles` is empty and `assert_member()` would raise 'members only' — there is nothing
-- to ask and the block says so and returns. No "expected exactly N" anywhere: every
-- comparison is against a count derived from the same empty tables.
-- ---------------------------------------------------------------------------
do $$
declare
  v_member uuid;
  v_type   text;
  n_rows   int;
  n_canon  int;
begin
  select p.id into v_member from public.profiles p order by p.id limit 1;
  if v_member is null then
    raise notice '0278: no profile exists, so no reader can be called — structural checks only.';
    return;
  end if;

  -- visible_activities is a security_invoker view keyed on auth.uid(); the readers answer
  -- as whoever is asking, so the comparison counts have to be taken as the same person.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

  foreach v_type in array array['Run','Hike','Walk','Ride','Swim','Workout'] loop
    select count(*) into n_rows
      from public.activities_of_type_for_people(v_type, '{}'::uuid[], 'all');
    select count(distinct coalesce(a.shared_group_id, a.id)) into n_canon
      from public.visible_activities a where a.type = v_type;
    if n_rows <> n_canon then
      raise exception 'activities_of_type_for_people(%) returned % row(s) for % canonical outing(s)',
        v_type, n_rows, n_canon;
    end if;

    select count(*) into n_rows from public.activities_of_type(v_type, null);
    select count(distinct coalesce(a.shared_group_id, a.id)) into n_canon
      from public.visible_activities a
     where a.type = v_type and public.is_shared_activity(a.id);
    if n_rows <> n_canon then
      raise exception 'activities_of_type(%, null) returned % row(s) for % canonical outing(s)',
        v_type, n_rows, n_canon;
    end if;

    select count(*) into n_rows from public.activities_of_type(v_type, v_member);
    select count(distinct coalesce(a.shared_group_id, a.id)) into n_canon
      from public.visible_activities a
     where a.type = v_type
       and exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id and ap.profile_id = v_member);
    if n_rows <> n_canon then
      raise exception 'activities_of_type(%, member) returned % row(s) for % canonical outing(s)',
        v_type, n_rows, n_canon;
    end if;
  end loop;

  -- The race readers count races, not rows. Both must agree with the canonical race set,
  -- which today is 4 rows in 4 groups and so proves nothing on its own — it will the first
  -- time a race is recorded by two people, which is the case this migration exists for.
  select count(distinct coalesce(a.shared_group_id, a.id)) into n_canon
    from public.visible_activities a
    join public.places p on p.id = a.place_id
   where (a.is_race or p.categories @> array['race']);

  select coalesce(sum(r.n), 0) into n_rows from public.race_stats_for_people('{}'::uuid[], 'all') r;
  if n_rows <> n_canon then
    raise exception 'race_stats_for_people counted % race(s) against % canonical', n_rows, n_canon;
  end if;

  select coalesce(sum(r.times), 0) into n_rows from public.races_list_for_people('{}'::uuid[], 'all') r;
  if n_rows <> n_canon then
    raise exception 'races_list_for_people counted % race(s) against % canonical', n_rows, n_canon;
  end if;

  -- Same for the profile-scoped pair, against the is_shared_activity half of their CASE.
  select count(distinct coalesce(a.shared_group_id, a.id)) into n_canon
    from public.visible_activities a
    join public.places p on p.id = a.place_id
   where (a.is_race or p.categories @> array['race'])
     and public.is_shared_activity(a.id);

  select coalesce(sum(r.n), 0) into n_rows from public.race_stats(null) r;
  if n_rows <> n_canon then
    raise exception 'race_stats(null) counted % race(s) against % canonical', n_rows, n_canon;
  end if;

  select coalesce(sum(r.times), 0) into n_rows from public.races_list(null) r;
  if n_rows <> n_canon then
    raise exception 'races_list(null) counted % race(s) against % canonical', n_rows, n_canon;
  end if;

  -- Leave the session as it was found; the ledger insert that follows is nobody's request.
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;
