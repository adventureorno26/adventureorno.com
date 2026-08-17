-- The Strava rule stays enforced — for readers that DO NOT EXIST YET.
--
-- 0196's test asks the question the only way that means anything: it signs in as one
-- person and looks for the other's Strava-origin activity in what comes back. That is the
-- right test and it must stay. But it can only ask about the readers it names, and the
-- failure this repository actually had was not a reader behaving badly — it was
-- THIRTY-ONE readers that nobody had thought about.
--
-- 0193 built `can_see_activity()`, `visible_activities` and a correct policy, and every
-- piece was right. Of the 32 SECURITY DEFINER functions reading `public.activities`,
-- exactly one used the guard: the guard itself. SECURITY DEFINER bypasses RLS, so the
-- lock looked perfect in psql and changed nothing a person could see. §"THE STRAVA RULE
-- CANNOT BE DONE WITH RLS" predicted it in those words, and the migration walked into it
-- anyway. **Writing a trap down does not disarm it.**
--
-- So this test is structural, and it is deliberately annoying: every SECURITY DEFINER
-- function that reads `public.activities` DIRECTLY must be named below with a reason. Add
-- a new display reader and this fails until you either point it at `visible_activities`
-- or come here and say why it belongs on the list. That is the point — the next reader is
-- written by someone who has not read any of this, and the test is what talks to them.
--
-- WHY NOT JUST BAN THE TABLE. Three groups genuinely need it, and 0196 spells out why:
--
--   * MACHINE JOBS — the view filters on `auth.uid()`, which is NULL under pg_cron and in
--     every trigger. A rebuild reading the view would silently process non-Strava rows
--     only and corrupt exactly what it rebuilt. This is the subtle one.
--   * WRITERS — they act on one person's explicit instruction about specific rows.
--   * TWO READERS that were already right, and are more honest than the view would be.
begin;

do $$
declare
  -- Every function allowed to read `public.activities` directly, and why. Sorted, so a
  -- diff on this list reads cleanly.
  allowed constant text[] := array[
    -- The guard itself. It must read the table to answer questions about it.
    'can_see_activity',

    -- MACHINE JOBS. auth.uid() is NULL for all of them; they compute facts and show
    -- nobody anything.
    'apply_inbox_field',
    'dedupe_joint_outings',
    'dedupe_shared_outings',
    'group_duplicate_activities',
    'rebuild_place_visits',
    'rebuild_revealed_area',
    'recompute_place_stats',

    -- WRITERS. A person naming, moving, importing or reassigning specific rows they are
    -- acting on deliberately.
    'add_activity_to_visit',
    'apply_naming_rule',
    'assign_activity_to_race',
    'import_file_activity',
    'learn_rule',
    'move_visit_to_place',
    'reassign_activity',
    'set_activity_solo',

    -- DELIBERATE READERS, unchanged by 0196 because both were already correct.
    --   data_health   — row COUNTS for diagnostics. A total is not an athlete's data, and
    --                   a health check that under-reports is a broken health check.
    --   shared_outings — counts only activities carrying the CALLER'S OWN
    --                   activity_profiles row, and returns `restricted_rows`: an honest
    --                   "there are N more here we may not show you" rather than a
    --                   silently short number. It is the model the others now follow.
    'data_health',
    'shared_outings'
  ];
  unexpected text;
  missing    text;
begin
  -- 1. NOTHING NEW MAY READ THE TABLE. This is the assertion that catches the reader
  --    written six months from now by someone who has never heard of Strava's terms.
  select string_agg(p.proname, ', ' order by p.proname) into unexpected
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prosecdef
     and pg_get_functiondef(p.oid) ~* '(from|join)[[:space:]]+(public\.)?activities'
     and not (p.proname = any(allowed));

  if unexpected is not null then
    raise exception
      'These SECURITY DEFINER functions read public.activities directly and are not on the allowlist: %.
       SECURITY DEFINER BYPASSES RLS, so a policy on the table will not save you.
       If it SHOWS activities to a person, read public.visible_activities instead — same columns, one word.
       If it is a machine job or a writer, add it to `allowed` in this test WITH A REASON.',
      unexpected;
  end if;

  -- 2. THE LIST ITSELF MUST STAY HONEST. A name left behind after its function is renamed
  --    or deleted is a hole that looks like a rule: the next function to take that name
  --    inherits an exemption nobody granted it.
  select string_agg(a, ', ' order by a) into missing
    from unnest(allowed) a
   where not exists (
     select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = a
   );

  if missing is not null then
    raise exception
      'The allowlist names functions that no longer exist: %. Remove them — a stale entry is an exemption waiting for whoever next uses that name.',
      missing;
  end if;

  -- 3. THE VIEW MUST STILL FILTER. If `visible_activities` ever loses its WHERE clause,
  --    all fifteen readers 0196 moved become leaks again in a single edit — and every
  --    behavioural test would still pass on a database containing one person's data.
  --
  --    ASSERT THE PREDICATE, NOT THE FUNCTION NAME. The first draft of this checked for
  --    `can_see_activity` in the definition and failed against the real schema, because
  --    the view INLINES the same logic instead of calling the helper per row. Testing for
  --    the name would have been a guard that fails when nothing is wrong — which gets a
  --    guard deleted, and that is worse than not having written it.
  --
  --    Both halves have to be there: `original_source` is what the rule is written
  --    against, and `auth.uid()` is what makes the answer depend on who is asking. A view
  --    missing either one is not filtering, whatever else it says.
  if not exists (
    select 1 from pg_views
     where schemaname = 'public' and viewname = 'visible_activities'
       and definition ilike '%original_source%'
       and definition ilike '%auth.uid()%'
  ) then
    raise exception
      'public.visible_activities is missing or no longer filters on original_source AND auth.uid(). Every reader 0196 moved onto it depends on that predicate.';
  end if;

  raise notice 'PASS: % readers of public.activities, all accounted for; visible_activities still filters.',
    array_length(allowed, 1);
end $$;

rollback;
