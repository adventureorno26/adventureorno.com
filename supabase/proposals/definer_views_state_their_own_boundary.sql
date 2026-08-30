-- PROPOSAL — NOT A MIGRATION YET. DO NOT APPLY. DO NOT MOVE INTO supabase/migrations/
-- UNTIL THE SPACES PARTITION (§3s step 1) HAS LANDED IN THE SAME SERIES.
--
-- It lives in `supabase/proposals/` on purpose: `scripts/db-bootstrap.sh` globs
-- `supabase/migrations/*.sql` and replays every one of them from an empty schema, and this
-- file references two things that do not exist yet — `memory_subjects.space_id` /
-- `activities.space_id`, and `public.is_member(uuid)`. Dropped into the migrations folder
-- today it would fail CI on the first replay, correctly. When the partition lands, this file
-- gets the next free 0NNN number and moves, unchanged apart from the number.
--
--
-- ============================================================================
-- WHAT IS WRONG
-- ============================================================================
--
-- Migration 0266 turned the profile-only participant tables into views. All four were
-- created SECURITY DEFINER. `visible_activities` was flipped to `security_invoker` in 0271
-- after it was measured identical for every member. These three were not:
--
--   public.activity_profiles · public.activity_provenance · public.visit_profiles
--
-- A SECURITY DEFINER view runs as its OWNER (`postgres`, which owns every table in `public`
-- and is not subject to their RLS because `relforcerowsecurity` is false everywhere). So
-- these three views answer every question with every row, to anybody who can reach them.
--
-- And they CAN be reached. `authenticated` holds SELECT on all three, so PostgREST publishes
-- them at `/rest/v1/activity_profiles`, `/rest/v1/activity_provenance` and
-- `/rest/v1/visit_profiles`. The measurement below includes a fourth column, `stranger`: a
-- syntactically valid `authenticated` JWT whose `sub` matches NO row in `public.profiles`.
-- That is what a future signed-up account is before it is invited into anything, and today
-- it reads the household's entire participation history through all three views.
--
-- MEASURED 2026-08-30, per member, inside a `begin … rollback` against production. Nothing
-- was changed to measure it. `before` is today. `flip` is what a naive
-- `set (security_invoker = true)` would give — the change this proposal REJECTS.
--
--   view                  who        before    flip
--   activity_profiles     erica         628     536
--   activity_profiles     josh          628     487
--   activity_profiles     bot           628     303
--   activity_profiles     stranger      628       0
--   activity_provenance   erica         572     480
--   activity_provenance   josh          572     431
--   activity_provenance   bot           572     293
--   activity_provenance   stranger      572       0
--   visit_profiles        erica         665     362
--   visit_profiles        josh          665     303
--   visit_profiles        bot           665       0
--   visit_profiles        stranger      665       0
--
-- (Reference, unchanged by any of this: `visible_activities` and the `activities` table read
-- 480 / 431 / 293 / 0 for the same four callers, before and after.)
--
--
-- ============================================================================
-- WHY THIS IS NOT A FLIP — ERICA, 2026-08-30
-- ============================================================================
--
-- Three decisions, and they pick the shape of the fix:
--
--   1. "Does seeing a memory mean seeing who was on it?" — YES. Within a space you already
--      share, a card that hides who was there lies by omission. So the reduced row counts in
--      the `flip` column are not acceptable: Erica can read all 557 visits and would see
--      participants on 356 of them.
--   2. "Should an owner see more than an editor?" — NO. Roles govern WRITES. Visibility
--      belongs to the space boundary. Two parallel visibility systems is how this class of
--      bug gets rebuilt.
--   3. "Now, or with the partition?" — WITH THE PARTITION.
--
-- So the bypass is closed by WRITING THE RULE DOWN rather than by inheriting whatever RLS
-- happens to say. Each view keeps `security_invoker = false` and states, in its own WHERE
-- clause, the visibility it intends: **you see a participation row if you are inside the
-- space that owns the memory.** Nothing on screen changes. What changes is that the rule
-- becomes a line of SQL a reviewer can read and argue with, instead of a side effect of a
-- property nobody set deliberately.
--
--
-- ============================================================================
-- WHY `visit_profiles` GOES TO ZERO, AND WHICH POLICY DOES IT
-- ============================================================================
--
-- Confirmed, not inferred. The test account reads **557 of 557 visits** — `visits_select` is
-- `is_member()` and nothing more — and would see **0 participants on every one of them**.
--
-- The responsible policy is `memory_subjects_select`, whose whole qualifier is
-- `can_see_memory_subject(id)`, and that function is:
--
--     case s.kind
--       when 'photo'  then <the photo rule>
--       when 'outing' then public.can_see_activity(s.activity_id)
--       else false
--     end
--
-- There is no `visit` branch. `memory_subjects` holds 557 rows of `kind = 'visit'`, and for
-- every caller that CASE returns false on all of them. The only reason Erica and Josh do not
-- also go to zero is the OTHER policy on the table: `memory_subjects_write` is declared
-- `FOR ALL`, permissive policies are OR'd, and SELECT is one of ALL — so its qualifier
-- `owner_profile = auth.uid() and is_editor_or_owner()` quietly doubles as a read rule. Each
-- of them sees exactly the visit subjects they personally created:
--
--   memory_subjects, kind='visit', visible:   erica 356    josh 201    bot 0   (of 557)
--   memory_subjects, kind='outing', visible:  erica 480    josh 431    bot 293 (of 572)
--
-- `memory_people_select` has the same hole independently: `can_see_memory_subject(subject_id)
-- or person_is_mine(person_id)`, where the first half is false for every visit and the second
-- is false for anyone who owns no `people` row.
--
-- **That is a gap in the policies, not a correct answer.** It is not fixed here — the fix is
-- a `when 'visit' then …` branch expressed against the space boundary, and it belongs in the
-- partition series next to every other `is_member()` rewrite, not bolted on in front of it.
-- Measured, for the record: adding `when 'visit' then true` today (i.e. `is_member()`) and
-- flipping all three views returns visit_profiles to 665 for erica, josh AND bot, and 0 for
-- the stranger. So the gap is real, it is one line, and closing it makes invoker and definer
-- agree. It is deliberately left for the partition.
--
--
-- ============================================================================
-- WHAT THE CLAUSE DOES AND DOES NOT COVER — the one thing to argue about
-- ============================================================================
--
-- The clause below is the SPACE boundary and nothing else, because that is decision 2. It
-- therefore does NOT re-apply the §7d Strava rule — `activities_select`'s
-- "a Strava outing is yours, or shared with you by someone with share_tagged_outings on".
-- Counted, so the reviewer is deciding with a number rather than a feeling — rows each
-- member can see through these views that sit on an outing they CANNOT see in `activities`:
--
--   activity_profiles:    erica 92    josh 141    bot 325   (of 628)
--   activity_provenance:  erica 92    josh 141    bot 279   (of 572)
--
-- That exposure exists TODAY, unchanged, and this proposal preserves it exactly — which is
-- what "no row moves for Erica or Josh" means. It is stated here because writing the rule
-- down is the entire point, and a rule you can read is a rule you can disagree with. If the
-- answer is "a participation row on an outing you cannot see should not be visible either",
-- the clause becomes `and public.can_see_activity(s.activity_id)` for `activity_profiles` and
-- `and public.can_see_activity(a.id)` for `activity_provenance` — and Erica loses 92 rows,
-- Josh 141. That is a product decision and this file does not take it.
--
--
-- ============================================================================
-- WHAT THIS DOES NOT CLOSE
-- ============================================================================
--
-- The Supabase advisor's `security_definer_view` ERROR stays at 3. It is a lint for exactly
-- the pattern being kept, and keeping it is the decision. The advisor is silenced by facts
-- it cannot check — the WHERE clause below — so §6c must carry the exception with a reason
-- rather than the finding count dropping.

begin;

-- ---------------------------------------------------------------------------
-- 1. activity_profiles — participations on outings, for people who have an account.
--    Column list, order and types are byte-identical to the 0266 definition; only the
--    WHERE gains a term. `create or replace view` requires that, and `visible_activities`,
--    `activities_select` and `can_see_activity` all depend on this view.
-- ---------------------------------------------------------------------------
create or replace view public.activity_profiles as
  select s.activity_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status
           when 'declined' then 'rejected'
           else mp.participation_status
         end as claim_status,
         mp.evidence,
         mp.created_by,
         mp.tagged_by as asserted_by,
         mp.decided_by,
         mp.decided_at,
         mp.rule_id
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'outing'
    join public.people pe on pe.id = mp.person_id
   where pe.linked_profile is not null
     -- THE RULE, written down: you see who was on a memory if you are in the space that
     -- owns the memory. Before the partition this sentence had no way to be said, so the
     -- view said nothing and the definer property answered for it.
     and public.is_member(s.space_id);

-- ---------------------------------------------------------------------------
-- 2. visit_profiles — the same sentence, for visits.
-- ---------------------------------------------------------------------------
create or replace view public.visit_profiles as
  select s.visit_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status
           when 'declined' then 'rejected'
           else mp.participation_status
         end as claim_status,
         mp.evidence,
         mp.created_by,
         mp.tagged_by as asserted_by,
         mp.decided_by,
         mp.decided_at,
         mp.rule_id
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
    join public.people pe on pe.id = mp.person_id
   where pe.linked_profile is not null
     and public.is_member(s.space_id);

-- ---------------------------------------------------------------------------
-- 3. activity_provenance — one row per outing, saying where it came from. Not a
--    participant view at all: it aggregates `activities` + `activity_sources`. The boundary
--    is therefore the ACTIVITY's space, not a subject's.
-- ---------------------------------------------------------------------------
create or replace view public.activity_provenance as
  select a.id as activity_id,
         a.owner_profile,
         count(s.id) as source_count,
         array_agg(distinct s.provider order by s.provider) as providers,
         array_agg(distinct s.origin order by s.origin) as origins,
         bool_or(lower(s.provider) = 'strava') as has_strava_source
    from public.activities a
    left join public.activity_sources s on s.activity_id = a.id
   where public.is_member(a.space_id)
   group by a.id, a.owner_profile;

-- ---------------------------------------------------------------------------
-- 4. Say the definer property out loud. It was never chosen — 0266 simply did not write
--    `security_invoker`, and the default is false. From here it is deliberate, and a later
--    `create or replace view` that drops the WHERE has an assertion waiting for it.
-- ---------------------------------------------------------------------------
alter view public.activity_profiles   set (security_invoker = false);
alter view public.visit_profiles      set (security_invoker = false);
alter view public.activity_provenance set (security_invoker = false);

-- ---------------------------------------------------------------------------
-- 5. Assert what changed, in the transaction that changed it. Every check below is
--    structural, so it holds on an empty schema replayed by scripts/db-test.sh as well as
--    on production. No "expected exactly N rows" anywhere.
-- ---------------------------------------------------------------------------
do $$
declare v text; n int;
begin
  -- 5a. All three still definer, and all three now name the boundary.
  foreach v in array array['activity_profiles','visit_profiles','activity_provenance'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname = v and c.relkind = 'v'
    ) then
      raise exception 'view public.% is missing', v;
    end if;

    if 'security_invoker=true' = any (
      coalesce((select c.reloptions from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                 where ns.nspname = 'public' and c.relname = v), '{}')
    ) then
      raise exception 'public.% is security_invoker; this file deliberately keeps it definer', v;
    end if;

    if pg_get_viewdef(('public.' || v)::regclass, true) not like '%is_member(%' then
      raise exception 'public.% does not state its space boundary', v;
    end if;
  end loop;

  -- 5b. `anon` must never reach any of them. (It does not today; this pins it.)
  select count(*) into n
    from unnest(array['activity_profiles','visit_profiles','activity_provenance']) as t(v)
   where has_table_privilege('anon', ('public.' || t.v)::regclass, 'SELECT');
  if n <> 0 then
    raise exception '% of the three views is readable by anon', n;
  end if;

  -- 5c. Regression guard on the one view 0271 already fixed. Replacing `activity_profiles`
  --     rewrites a view `visible_activities` depends on, and a dependent view is exactly
  --     the kind of thing that silently loses an option.
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'visible_activities'
       and 'security_invoker=true' = any(c.reloptions)
  ) then
    raise exception 'visible_activities lost its security_invoker option';
  end if;

  -- 5d. No SECURITY DEFINER function is created or replaced by this file, so there is no
  --     default EXECUTE-to-PUBLIC to revoke. Asserted rather than assumed, because the one
  --     thing this repo has been bitten by three times is a SECDEF function appearing
  --     without its revoke (0101, 0273).
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not like 'st\_%';
  if n <> 0 then
    raise exception '% anon-executable SECURITY DEFINER function(s) — lockdown regression', n;
  end if;
end $$;

commit;

-- ============================================================================
-- EVERY READER OF THE THREE VIEWS — searched, not remembered
-- ============================================================================
--
-- Sources: `app/src` + `workers` + `scripts` by grep; `pg_proc.prosrc` over every function
-- in `public`; `pg_views.definition` over every view; `pg_policies` over every policy.
--
-- APPLICATION CODE (app/src, workers, scripts): **ZERO readers.** Nothing anywhere selects
-- these views over PostgREST. The only hits are `app/src/lib/database.types.ts` (generated
-- types), two explanatory comments in `app/src/lib/data.ts` and `app/src/lib/memoryPeople.ts`,
-- and three comments in `scripts/export-data.sh` / `scripts/export-restore-roundtrip.sh`.
-- Every screen reaches this data through a SECURITY DEFINER RPC instead. That is why
-- `authenticated`'s SELECT grant on all three is pure attack surface: it is published and
-- unused.
--
-- VIEWS (1): `public.visible_activities` — its EXISTS subquery reads `activity_profiles`.
--   Already `security_invoker = true` since 0271, so §5c above guards it.
--
-- POLICIES (1): `activities_select` on `public.activities` — its EXISTS subquery reads
--   `activity_profiles`. No policy reads `visit_profiles` or `activity_provenance`.
--
-- FUNCTIONS (36). `AP` = reads activity_profiles, `VP` = visit_profiles. **No function
-- anywhere reads `activity_provenance`** — its only consumers are the REST surface and
-- generated types, which is worth knowing before anyone hardens it.
--
--   SECURITY DEFINER (30) — owned by `postgres`, which owns every table and is not subject
--   to their RLS, so a `security_invoker` flip would NOT have changed one row for any of
--   these. They carry the CALLER's JWT though, so the WHERE clause below DOES apply to them:
--
--     AP    activities_of_type · activity_lines · can_see_activity · climbing_stats
--           import_file_activity · match_photo · mileage_by_person · person_totals
--           propose_tagging_rule · race_stats · races_list
--     VP    add_activity_to_visit · add_place_to_visit · attach_child_visit · delete_visit
--           merge_visits · occasion_count · place_attribution · place_ids_for_view
--           place_visit_counts · place_visit_people · rebuild_place_visits · settings_stats
--           trips_list · visit_people_all
--     both  card_view · people_memory_keys · shared_outings · visit_detail · wander_stats
--
--   SECURITY INVOKER (6) — the only ones a flip would have moved, and the reason the flip
--   was never as harmless as it looked:
--
--     AP+VP export_manifest, export_section  — called from the BROWSER as the signed-in user
--           (`app/src/lib/exports.ts`). Their `visit_people` and `activity_people` sections
--           read these views directly. Under a flip Erica's export would have silently
--           dropped from 665 participation rows to 362. Under this proposal: unchanged.
--     AP    is_shared_activity     — called only from 11 SECDEF functions; carries their JWT.
--     VP    is_shared_visit        — same.
--     VP    visits_check_parent    — TRIGGER on `public.visits`. See the risk note below.
--     VP    visit_profiles_check_children — **attached to no trigger at all.** Verified
--           against `pg_trigger`: zero. It is a guard that is not guarding, and it has been
--           dead since 0266 renamed what it reads. Reported, not fixed here.
--
-- NOT REACHED BY ANY SCHEDULED OR SERVICE-ROLE PATH. Checked with a recursive call-graph
-- walk (depth 4) from all four `cron.job` entry points (`dedupe_joint_outings`,
-- `purge_trash`, `rebuild_revealed_area`, `prune_service_health`) and from the three RPCs
-- the Cloudflare workers call with the service-role key (`recompute_place_stats`,
-- `cron_health`, `assign_activity_place`): none of them reaches any of the three views.
--
--
-- ============================================================================
-- WHAT MAKES THE PARTITION HARDER — plan item 9 with these in mind
-- ============================================================================
--
-- 1. **`auth.uid()` is null for anything without a user JWT, and this clause turns that into
--    "no rows" where it used to mean "all rows".** Today the definer property answers even
--    when nobody is asking. `is_member(space_id)` cannot. The audit above says nothing
--    scheduled or service-role reaches these views TODAY — but `visits_check_parent` is a
--    TRIGGER on `public.visits` that reads `visit_profiles` twice to enforce *"everyone on
--    the child must have been on the parent"*. Fire that trigger from any JWT-less writer —
--    a backfill in a migration, a future service-role path — and the view goes empty and the
--    guard SILENTLY PASSES. It does not error; it approves. **The partition should stop that
--    trigger reading a compatibility VIEW at all**: it is asking an integrity question, not
--    a visibility question, and it should read `memory_people` + `memory_subjects` directly.
--    Same for `visit_profiles_check_children` if it is ever wired up.
--
-- 2. **The backfill must put EVERY existing profile in the one space, not just Erica and
--    Josh.** §3s says *"one space with Erica as owner and Josh as editor"*. There is a third
--    profile — `Test Bot`, `3c7c467b-…` — and today `is_member()` is "you have a profile
--    row", so it is a member of everything. Leave it out of `space_memberships` and its
--    reads go from 628/572/665 to 0 the moment this clause lands. That is either intended or
--    an accident; it must not be discovered by the migration.
--
-- 3. **`memory_subjects` needs `space_id`, and it is the subject registry — the thing every
--    future memory kind hangs off.** Two of the three clauses below key off
--    `memory_subjects.space_id`, not off the activity's or visit's. That is the right choice
--    (the subject is the memory) but it means the partition must decide the subject's space
--    at the moment a subject is created, in all three get-or-create helpers from 0265.
--
-- 4. **`can_see_memory_subject` has no `visit` branch** (see above). Its CASE is the single
--    definition of "can you see this memory", it is referenced by `memory_subjects_select`,
--    `memory_people_select` and `person_on_visible_memory`, and it is silently false for 557
--    of 1,129 subjects. The partition rewrites that function anyway to take a space; that is
--    the moment to add the branch, and the moment `memory_subjects_write`'s accidental
--    double life as a READ policy (`FOR ALL` includes SELECT) should be split in two.
--
-- 5. **`activity_provenance` has no in-database reader at all.** If the partition wants one
--    fewer definer view to carry, this is the one to consider dropping outright rather than
--    gating — but that is a separate decision and needs the generated types regenerated.
