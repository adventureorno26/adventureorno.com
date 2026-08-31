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

    -- 0299. MATERIALISING AN ACCEPTED TAG, and it is on this list for the same reason
    -- 0293 exempts `respond_to_memory_tag` from the cross-space WRITE guard: the whole
    -- point of the function is to reach a row in a space the caller is NOT in.
    --
    -- It copies the outing somebody tagged you on into your own space. The source lives in
    -- THEIR space, so `visible_activities` — which is space-scoped since 0290 — returns
    -- nothing for the accepter and the copy could never be made. What authorises it is not
    -- membership but the accepted tag itself: `respond_to_memory_tag` has already proved
    -- the caller is the person named on it before calling here, and this function is
    -- reachable from nowhere else (revoked from public, anon and authenticated).
    --
    -- It shows the caller NOTHING. It writes one row and returns its id; no body of it
    -- reaches a screen. The §7d Strava rule is untouched because the copy deliberately
    -- carries no `strava_id`, no `athlete_id` and no `summary_polyline` — their recording
    -- stays theirs, and what lands in your space is the facts you were tagged on.
    'materialise_accepted_outing',

    -- 0283. THE PUBLIC PROFILE, and the one entry here that shows a person something.
    -- It cannot use `visible_activities`, and the reason is not convenience: that view
    -- answers "what may the VIEWER see", and a public profile answers "what did the OWNER
    -- choose to publish". A stranger reading Erica's profile through the view would see
    -- none of HER OWN Strava recordings, which are precisely the ones she is entitled to
    -- publish. So the function applies the §7d rule itself, transposed to the profile
    -- owner rather than the caller:
    --     and (lower(coalesce(a.original_source,'')) <> 'strava' or a.owner_profile = pr.id)
    -- Their own Strava recordings are theirs to publish; somebody else's are not ours to
    -- republish to the world. Publication is opt-in (`profile_visibility` defaults to
    -- private), and the function reads nothing for a profile that has not opted in.
    -- OPEN, and it needs Erica: a NON-Strava outing that Josh recorded and Erica is
    -- accepted on WILL appear on Erica's public profile, because she said a profile shows
    -- "their whole public stats, including the stats of our combined cards". Josh does not
    -- separately consent to that publication. If that is wrong, restrict this to
    -- `a.owner_profile = pr.id` and the exemption gets narrower, not wider.
    'public_profile',

    -- MACHINE JOBS. auth.uid() is NULL for all of them; they compute facts and show
    -- nobody anything.
    'apply_inbox_field',
    'dedupe_joint_outings',
    'dedupe_shared_outings',
    'group_duplicate_activities',
    'rebuild_place_visits',
    'rebuild_revealed_area',
    'recompute_place_stats',
    -- 0205. Compares one person's own recordings to find the same outing logged twice, and
    -- writes SUGGESTIONS — it shows nobody anything. It runs as a maintenance job where
    -- `auth.uid()` is null, so through `visible_activities` it would see no Strava rows at
    -- all and quietly propose nothing for the very activities that need it most.
    'propose_source_duplicates',

    -- WRITERS. A person naming, moving, importing or reassigning specific rows they are
    -- acting on deliberately.
    --
    -- `ingest_activity` (0203) is here for a reason worth stating: its Tier 3 step looks for
    -- ANOTHER person's recording of the same outing so the two can be LINKED as a joint
    -- outing. Through `visible_activities` that row is invisible — a Strava activity of
    -- Erica's is hidden from Josh, correctly — and the link would never be made, so two
    -- recordings of one run would count twice. Linking exposes nothing: it writes a
    -- shared_group_id and reads no attributes back to the caller.
    'ingest_activity',
    -- 0211. Accepts the caller's OWN pending import-duplicate proposals in one press. It
    -- reads the table only to enforce `owner_profile = auth.uid()` — a scope strictly
    -- NARROWER than `visible_activities`, which would also return other people's
    -- non-Strava rows. Reading the view here would widen what a bulk "accept all" can
    -- reach, which is the opposite of what this function needs.
    'approve_import_duplicates',
    'add_activity_to_visit',
    'apply_naming_rule',
    'assign_activity_to_race',
    'import_file_activity',
    'learn_rule',
    'move_visit_to_place',
    'reassign_activity',
    'set_activity_solo',
    -- Exposed by widening the regex above, not by any change to them. Each writes rows a
    -- person has named — merging two places or two visits, renaming what happened at a
    -- place, marking a race, editing one activity — and none returns activity attributes
    -- to a caller who could not already see them.
    'merge_places',
    'merge_places_auto',
    'merge_visits',
    'rename_activities_for_place',
    'set_activity_race',
    'update_activity',
    -- 0213/0214. The tagged person answering a tag. On DECLINE it removes his membership
    -- from every recording of that one outing, which means reading `activities` to find
    -- the siblings — including the hidden one, because "I was not there" is about the day
    -- and not about which file it came out of. It shows him nothing; `my_tags_to_confirm`
    -- is the reader, and that one goes through the view.
    'respond_to_tag',
    'respond_to_all_tags',

    -- DELIBERATE READERS, unchanged by 0196 because both were already correct.
    --   data_health   — row COUNTS for diagnostics. A total is not an athlete's data, and
    --                   a health check that under-reports is a broken health check.
    --   shared_outings — counts only activities carrying the CALLER'S OWN
    --                   activity_profiles row, and returns `restricted_rows`: an honest
    --                   "there are N more here we may not show you" rather than a
    --                   silently short number. It is the model the others now follow.
    'data_health',
    -- 0230. Returns an ID, never an attribute: "is there a recording of MINE that starts
    -- within 60 seconds of this one?" It must read the table because the question is about
    -- the caller's own rows, and a Strava row of theirs is one they may always see. Scoped
    -- to a single owner passed in by the importer, which only ever passes the run's owner.
    'same_recording_of',
    -- 0231. Returns COUNTS AND MILES and nothing else — no id, no name, no route, no date,
    -- nothing joinable back to a recording. It reads the table on purpose: a total that
    -- silently omits 799 miles because the reader may not open one recording is a broken
    -- total, which is the same argument `data_health` is listed for. "Erica has run 1,968
    -- miles" is a fact about Erica; the route she took on the 4th stays behind 0228.
    'person_totals',
    -- 0291. Both read `activities` for EXACTLY ONE COLUMN — `shared_group_id` — to map a
    -- `peak_bags.activity_id` onto its canonical outing key. Nothing from that row is
    -- returned and nothing is filtered by it; what the caller may see is still decided
    -- entirely by `visible_activities` and `people_memory_keys`.
    --
    -- They must, because a peak bag's own `space_id` is a denormalisation that goes stale
    -- the moment an outing is copied into a second space, and 0292 copies 56 of them. All
    -- six of Josh's summits hang off a both-tagged activity whose bag has profile_id NULL,
    -- so 0292's `where profile_id = josh` moves none of them and his copies arrive with no
    -- bags attached. Resolving through the canonical outing is what keeps his 6 at 6.
    'peaks_bagged',
    'peaks_bagged_for_people',
    -- 0214. Returns an ID, never an attribute. It must read the CLAIMED row's
    -- shared_group_id even when that row is hidden — that is the whole job: find the
    -- recording of the same outing that the caller IS allowed to see. Every id it can
    -- return comes out of `visible_activities`, so nothing about a hidden recording
    -- reaches anybody. 44 of Josh's tags name a recording he may not see, and without
    -- this they are unanswerable.
    'visible_recording_of',
    -- 0211. Returns a COUNT and a date range for the banner that offers to link them all,
    -- over the caller's own activities only (`owner_profile = auth.uid()`). It shows no
    -- attribute of anybody else's activity, and the same narrower-than-the-view argument
    -- as `approve_import_duplicates` applies: the pair must agree about what "all" means,
    -- or she is told one number and a different set is acted on.
    'import_duplicates_pending',
    -- 0240. WRITERS, and what they read the table for is a single EXISTS: "is this piece of
    -- visit evidence an activity THAT PERSON recorded?". No column of an activity leaves
    -- either function — the answer is whether somebody's own evidence protects their row on
    -- a visit from being deleted by a person saying "I was here alone". It must see every
    -- activity, not `visible_activities`: the question is about who OWNS the evidence, and
    -- reading through a visibility view would mean that a recording the caller may not see
    -- stops protecting its owner — the caller could delete exactly the rows they cannot see.
    'set_place_solo',
    'set_visit_participants',
    -- 0265. Reads ONE COLUMN of one row — `owner_profile`, to decide who owns the registry
    -- entry it is about to make — and returns a subject id. No attribute of an activity
    -- leaves it. Reading through `visible_activities` would be wrong for the same reason it
    -- is wrong in the two above: a recording the caller cannot see still needs its registry
    -- entry, and a subject that silently fails to exist is a participation that silently
    -- does not get written.
    'subject_for_activity',
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
     -- `from|join` ALONE MISSED SEVEN FUNCTIONS. 0214 added a `delete … using
     --  public.activities`, and the guard said nothing: a DELETE…USING and an UPDATE read
     --  the table exactly as a SELECT does. Widening it exposed six more that had been
     --  reading it unnamed since long before — merge_places, merge_places_auto,
     --  merge_visits, rename_activities_for_place, set_activity_race, update_activity.
     --  None is a leak (every one is a writer acting on rows a person named), but "not
     --  named because the regex could not see it" is not an exemption, and the next one
     --  might not be a writer.
     and pg_get_functiondef(p.oid) ~* '(from|join|using|update)[[:space:]]+(public\.)?activities'
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
