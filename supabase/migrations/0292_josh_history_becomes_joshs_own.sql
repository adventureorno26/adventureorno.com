-- 0292 — the data fork: Josh's history becomes Josh's own.
--
-- APPLIED TO PRODUCTION. Corrected 2026-08-30 — this header said the opposite and had
-- gone stale on merge (PR #208, "The fork is applied — Josh's history is his own").
-- Comments only; not one line of SQL below is touched, because a file production has
-- already replayed must stay byte-identical in its statements.
--
-- IT USED TO SAY: "DRAFT — REHEARSED, NOT APPLIED. Nothing in this file has been run
-- against production outside a transaction that was rolled back."
--
-- Caught by `scripts/check-draft-migrations.mjs`, which compares every not-applied claim in
-- a header against production's ledger — the same guard that caught 0290 saying this on the
-- day it was written. Twice in two days is why the check exists rather than a convention.
--
-- This is the half `0289` deliberately left behind. Its header says so in as many words:
--
--     "It does not move Josh's rows into Josh's space. Every existing row is backfilled
--      into Erica's space and Josh is an editor of it, exactly as he is today. Josh's own
--      space is created, owned by him, and starts empty."
--
-- and it names what had to land first — `0290`, the space-aware readers — so that the fork
-- "lands into readers that already know which copy is theirs, instead of doubling every
-- shared number the moment it runs." Both are applied. This is the third and last step.
--
--
-- ============================================================================
-- THE RULE, WHICH IS HERS AND IS NOT REDESIGNED HERE
-- ============================================================================
--
-- STATE.md §"THE PARTITION — decided 2026-08-30":
--
--     "a row goes to the space of whoever is tagged on it, and a row tagged with both is
--      materialised into both spaces"
--
-- and, for places specifically:
--
--     "A place carries personal judgements — rating, review, categories, favourite,
--      bucket, is_home. Those are not facts about the world, they are one person's opinion
--      of it. So each space gets its own place row."
--
-- So places ARE duplicated, deliberately. Nothing below "optimises" that into a shared row.
--
--
-- ============================================================================
-- THE SPLIT, RE-MEASURED ON PRODUCTION 2026-08-30 INSIDE `begin … rollback`
-- ============================================================================
--
-- STATE.md's table was measured when the database held 557 visits. It now holds 558. Every
-- figure below is re-derived, and the drift is stated rather than smoothed over:
--
--                      Erica-only   Josh-only   tagged BOTH   unattributed   total
--     visits (STATE)      349          100          108            0          557
--     visits (now)        349          100          107            2          558
--     activities (STATE)  351          165           56            0          572
--     activities (now)    352          165           56            0          573
--     photos (STATE)      146           34            —            0          180
--     photos (now)        149           34            —            0          183
--     places (STATE)       85            7           76            0          168
--     places (now)         86            7           76            0          169
--
-- THE ONE-ROW DIFFERENCE, RECONCILED. Counting the visits Josh is ACCEPTED on gives 207,
-- against STATE.md's 100 + 108 = 208. The missing row is not missing; two visits moved:
--
--   * `4d2f0605…` "The Parlor", created 2026-08-30 22:14 — a NEW visit. 557 → 558.
--   * `05878ac7…` "New place", created 2026-08-28, whose `memory_people` rows were
--     DELETED AND REWRITTEN at 2026-08-30 22:54 as `proposed`. It was one of the 108
--     both-tagged visits when STATE.md was measured; it is now unattributed. 108 → 107.
--
-- Both carry `tagged_by IS NULL`, `evidence = 'unknown'`, `decided_by IS NULL` — the exact
-- shape STATE.md finding #15 describes: not a person-to-person tag at all, but the app's
-- own guess that both members were present, parked in `proposed` where the asking screen
-- can never surface it. `0279` swept the 15 that existed then; these two were created
-- after it ran, so the generator that made them is still running. THAT IS A FINDING AND
-- THIS FILE DOES NOT FIX IT — it is a write-path question, and inventing an answer for it
-- inside the fork is how a migration stops being reviewable.
--
-- What this file does with them: NOTHING. They stay in Erica's space, exactly where they
-- are. Josh has not accepted them, so they are not his; and moving or deleting them would
-- change a number on Erica's screen, which is the abort criterion. Arithmetic:
-- 349 + 100 + 107 + 2 = 558, and 100 + 107 = 207, which is the count that started this.
--
--
-- ============================================================================
-- THE TRAP: THE SAME RUN COUNTED TWICE
-- ============================================================================
--
-- Erica, verbatim: *"we ran 15 miles together, but for each of us and for Our Stats that
-- should only increase our milage by 15 miles not 30."*
--
-- `wander_stats_for_people` collapses outings with
--
--     select distinct on (coalesce(a.shared_group_id, a.id)) …
--
-- and `people_memory_keys` emits the outing key as `coalesce(act.shared_group_id, act.id)`.
-- So the canonical identity of an outing is its shared group, falling back to its own id.
-- A materialised copy gets a FRESH id. If its `shared_group_id` were left NULL, the copy
-- and its original would be two different canonical keys and the same run would count
-- twice for anybody who can see both.
--
-- THEREFORE, and this is the load-bearing sentence of the file: every copied activity
-- carries a `shared_group_id` that ties it to its original. Measured on production, of the
-- 56 both-tagged activities:
--
--     33 already carry a shared_group_id  → the copy inherits it unchanged
--     23 carry NULL                       → BOTH rows are set to the ORIGINAL'S OWN id
--
-- Setting the original's `shared_group_id` from NULL to its own id CANNOT move a number,
-- because every reader reads `coalesce(shared_group_id, id)` and that expression is
-- unchanged by the write. Checked, not assumed: `pg_proc` was searched for any reader
-- testing the column for nullness, and exactly one function does —
-- `dedupe_shared_outings`, which is a SUGGESTION generator, not a reader, and whose own
-- proposal is literally `to_jsonb(coalesce(m.shared_group_id, m.id))`. It uses this file's
-- convention already. No reader on any screen filters on `shared_group_id IS NOT NULL`.
--
--
-- ============================================================================
-- WHY JOSH'S EDITOR MEMBERSHIP OF ERICA'S SPACE HAS TO END HERE, AND IT IS MEASURED
-- ============================================================================
--
-- This is the decision in this file that a reviewer should attack first.
--
-- `0289` left Josh an editor of Erica's space so that "nothing they can see today changes
-- by one row". That was correct while the fork had not run. It stops being correct the
-- instant it does, and the reason is that the dedupe above EXISTS FOR OUTINGS ONLY:
--
--     outings   `coalesce(shared_group_id, id)`  — a copy can be tied to its original ✅
--     visits    the key is `v.id`, and there is NO shared_group_id column on `visits` ❌
--     places    `count(distinct p.id)`, and there is no such column on `places` either ❌
--
-- So for a person inside BOTH spaces, every shared VISIT and every shared PLACE is two
-- rows with two ids and nothing in the schema says they are the same memory. Josh's
-- My Stats places would count his 76 shared places twice. That is precisely the failure
-- Erica named, in the two shapes the schema cannot dedupe.
--
-- The alternative — adding a `shared_group_id` to `visits` and `places` and teaching every
-- reader to collapse on it — is a schema and reader change across ~60 functions, i.e. a
-- third migration, not a clause in this one.
--
-- Ending the membership is also what she asked for, and it is the only line in this file
-- that is a policy choice rather than an arithmetic consequence. STATE.md, her decisions,
-- 2026-08-30: *"Everyone uses the tagging system — including Erica and Josh. Nothing is
-- shared by being in the same household, because there is no household."*
--
-- ⚠️ IT CHANGES TWO NUMBERS AND NEITHER IS ERICA'S OWN. After this runs:
--     * Erica's view of "Josh's own" stats falls to the shared rows only, because Josh's
--       165 private outings and 100 private visits are no longer in her space. That is the
--       fork working, not a regression, and it is the one number of hers that moves.
--     * Josh's view of "Erica's own" falls the same way, for the same reason.
--   Erica's OWN Stats, Our Stats, trips and races are untouched — every row behind them
--   stays in her space. Section 10 asserts it; the PR carries the before/after table.
--
--
-- ============================================================================
-- WHAT THIS FILE DOES NOT DO — NAMED, NOT HIDDEN
-- ============================================================================
--
-- 1. FIVE REFERENCE TABLES CANNOT BE FORKED AND ARE LEFT IN ERICA'S SPACE, because their
--    keys are GLOBAL and have no `space_id` in them:
--
--        place_categories  primary key (slug)
--        activity_options  primary key (slug)
--        settings          primary key (key)
--        peaks             unique (name, lat, lng)
--        parks             unique (name)
--
--    A second space physically cannot hold a second copy of `slug='trail'`. Giving them
--    per-space keys is a schema change to five tables and every reader of them; doing it
--    inside the fork is exactly the "inventing an answer" `0290` refuses to do. The
--    consequence is REAL and is measured in the PR: Josh's space has no category
--    vocabulary and no peaks, so his Peaks number goes to 0. It is a follow-up migration,
--    and it is named here so it cannot be lost.
--
-- 2. THE TWO SECURITY DEFINER WRITE PATHS `0290` named — `merge_nearby_dupes` and
--    `move_visit_to_place` — are still unscoped and can still merge across the boundary.
--    `0290` called that "a WRITER audit, a different question with a different answer".
--    It is now a LIVE risk rather than a theoretical one, because there are finally two
--    spaces with rows in them. Unchanged here; escalated in the PR.
--
-- 3. THE GENERATOR THAT WRITES `proposed` TAGS WITH NO TAGGER is still running (the two
--    visits above). Not fixed here; it is a write-path change.
--
-- 4. PHOTOS ARE NOT DUPLICATED. A photo has one uploader, and STATE.md's table gives
--    photos no "both" column. Josh's 34 move; Erica's 149 stay. The consequence is that
--    33 place rows destined for Josh have a `cover_photo_id` pointing at a photo of
--    Erica's, which would be a reference across the boundary — so those copies get
--    `cover_photo_id = NULL`. Josh's shared place cards lose their cover image. Stated
--    rather than discovered later.

begin;

-- ---------------------------------------------------------------------------
-- Everything below runs inside ONE DO block, and that is deliberate. The fork is not a
-- schema change with a backfill after it; it is a single act that is either wholly done
-- or wholly not. A half-forked database is worse than an unforked one because it looks
-- safe — STATE.md §"How it will be done", point 3.
--
-- IT NO-OPS UNLESS IT FINDS EXACTLY THE SITUATION IT WAS WRITTEN FOR. `scripts/db-test.sh`
-- replays this chain from an EMPTY schema where every count is 0, and "expected exactly N"
-- has broken CI on this repository twice. So there is not one absolute assertion anywhere
-- in this file. Every guard is a shape check ("is there a second space, and is it empty"),
-- and every check in section 10 is conditional on the fork having actually run.
-- ---------------------------------------------------------------------------
do $fork$
declare
  v_owner       uuid;   -- Erica, by ROLE, never by id — this file carries no production uuid
  v_second      uuid;   -- Josh
  v_e_space     uuid;
  v_j_space     uuid;
  v_j_person    uuid;   -- Josh, as a person, inside Josh's space
  v_e_person    uuid;   -- Erica, as a person, inside Josh's space
  v_e_self      uuid;   -- Erica, as a person, inside Erica's space
  v_e_josh      uuid;   -- Josh, as a person, inside Erica's space
  n_moved       int;
  n_copied      int;
  n             int;
begin
  -- ---- 1. WHO AND WHERE ----------------------------------------------------
  -- Identified exactly as 0289 identifies them, so the two files cannot disagree about
  -- who the anchor is.
  select id into v_owner from public.profiles where role = 'owner' order by created_at limit 1;

  select id into v_second from public.profiles
   where id is distinct from v_owner and role in ('owner','editor')
     and coalesce(display_name, '') !~* '(test|bot)'
   order by created_at limit 1;

  if v_owner is null or v_second is null then
    raise notice '0292: fewer than two people — nothing to fork.';
    return;
  end if;

  select id into v_e_space from public.spaces where owner_profile = v_owner  order by created_at limit 1;
  select id into v_j_space from public.spaces where owner_profile = v_second order by created_at limit 1;

  if v_e_space is null or v_j_space is null or v_e_space = v_j_space then
    raise notice '0292: the two spaces 0289 makes are not both here — nothing to fork.';
    return;
  end if;

  -- Refuse to run twice. The fork is not idempotent — running it again would materialise a
  -- second copy of every shared row — so the guard is that Josh's space is still EMPTY.
  select count(*) into n from public.visits where space_id = v_j_space;
  if n > 0 then
    raise notice '0292: Josh''s space already holds % visit(s) — already forked, nothing to do.', n;
    return;
  end if;

  -- Nothing to fork in an empty schema either. This is the branch CI takes.
  select count(*) into n from public.visits where space_id = v_e_space;
  if n = 0 then
    raise notice '0292: no visits to fork — structure only.';
    return;
  end if;

  -- ---- 2. CLASSIFY, BY PROFILE RATHER THAN BY PERSON ROW -------------------
  -- `people` holds FIVE rows for three humans: Erica and Josh each have two, one owned by
  -- each of them, and only one of each pair carries any tags. Classifying on a person id
  -- would therefore silently depend on WHICH duplicate happened to be used.
  --
  -- So classification keys on `people.linked_profile`, which is what the readers already
  -- do: `visit_profiles` and `activity_profiles` both select `pe.linked_profile AS
  -- profile_id`, and `people_memory_keys` joins them on it. Same question, same answer,
  -- and immune to the duplicates.
  --
  -- THE ORDER OF THE FOUR TABLES BELOW IS THE DEPENDENCY ORDER AND IT MATTERS: an outing
  -- and a photograph are classified from their own evidence, a visit from its tags plus the
  -- outings and photographs attached to it, and a place from all three.
  --
  -- An activity is reachable from a person three ways, and all three count. `owner_profile`
  -- and `also_profiles` are the Strava import's record of who recorded it; the tag is the
  -- app's. Using only the tag gives 12 both-tagged outings; using all three gives 56, which
  -- is STATE.md's number and the one finding #2 also arrives at from the other direction.
  create temporary table _fork_act on commit drop as
  select a.id,
         (a.owner_profile = v_owner or v_owner = any (a.also_profiles)
          or exists (select 1 from public.memory_subjects s
                       join public.memory_people mp on mp.subject_id = s.id
                       join public.people pe on pe.id = mp.person_id
                      where s.kind = 'outing' and s.activity_id = a.id
                        and pe.linked_profile = v_owner
                        and mp.participation_status = 'accepted')) as in_e,
         (a.owner_profile = v_second or v_second = any (a.also_profiles)
          or exists (select 1 from public.memory_subjects s
                       join public.memory_people mp on mp.subject_id = s.id
                       join public.people pe on pe.id = mp.person_id
                      where s.kind = 'outing' and s.activity_id = a.id
                        and pe.linked_profile = v_second
                        and mp.participation_status = 'accepted')) as in_j
    from public.activities a where a.space_id = v_e_space;

  -- A photo has exactly one uploader and is not duplicated.
  create temporary table _fork_photo on commit drop as
  select p.id, (p.uploaded_by = v_owner) as in_e, (p.uploaded_by = v_second) as in_j
    from public.photos p where p.space_id = v_e_space;

  -- A VISIT FOLLOWS ITS TAGS *AND* THE OUTINGS AND PHOTOGRAPHS ATTACHED TO IT, and the
  -- second half of that sentence was added because the assertions in section 10 refused the
  -- version without it: 8 activities and their visit ended up on opposite sides of the
  -- boundary. An activity IS an outing at that visit — the schema says so with
  -- `activities.visit_id` — so a person who was on the outing was at the visit, whatever
  -- the visit's own tags do or do not say.
  --
  -- Resolving it the other way, by cutting the link on whichever side lost the visit, would
  -- have silently detached 8 outings from their visit on somebody's screen. Widening the
  -- classification instead means the visit is shared, so EACH side keeps a whole copy and
  -- nothing is severed. It is also the same rule places already use, applied one level down.
  create temporary table _fork_visit on commit drop as
  select v.id,
         (exists (select 1 from public.memory_subjects s
                    join public.memory_people mp on mp.subject_id = s.id
                    join public.people pe on pe.id = mp.person_id
                   where s.kind = 'visit' and s.visit_id = v.id
                     and pe.linked_profile = v_owner
                     and mp.participation_status = 'accepted')
          or exists (select 1 from public.activities a join _fork_act c on c.id = a.id
                      where a.visit_id = v.id and c.in_e)
          or exists (select 1 from public.photos ph join _fork_photo c on c.id = ph.id
                      where ph.visit_id = v.id and c.in_e)) as in_e,
         (exists (select 1 from public.memory_subjects s
                    join public.memory_people mp on mp.subject_id = s.id
                    join public.people pe on pe.id = mp.person_id
                   where s.kind = 'visit' and s.visit_id = v.id
                     and pe.linked_profile = v_second
                     and mp.participation_status = 'accepted')
          or exists (select 1 from public.activities a join _fork_act c on c.id = a.id
                      where a.visit_id = v.id and c.in_j)
          or exists (select 1 from public.photos ph join _fork_photo c on c.id = ph.id
                      where ph.visit_id = v.id and c.in_j)) as in_j
    from public.visits v where v.space_id = v_e_space;

  -- A place follows whoever made it or whoever has been there — by visit, by outing or by
  -- photograph. All four routes, because a place reached by only one of them is still a
  -- place that person has a judgement about.
  create temporary table _fork_place on commit drop as
  select p.id,
         (coalesce(p.created_by = v_owner, false)
          or exists (select 1 from public.visits v join _fork_visit c on c.id = v.id
                      where v.place_id = p.id and c.in_e)
          or exists (select 1 from public.activities a join _fork_act c on c.id = a.id
                      where a.place_id = p.id and c.in_e)
          or exists (select 1 from public.photos ph join _fork_photo c on c.id = ph.id
                      where ph.place_id = p.id and c.in_e)) as in_e,
         (coalesce(p.created_by = v_second, false)
          or exists (select 1 from public.visits v join _fork_visit c on c.id = v.id
                      where v.place_id = p.id and c.in_j)
          or exists (select 1 from public.activities a join _fork_act c on c.id = a.id
                      where a.place_id = p.id and c.in_j)
          or exists (select 1 from public.photos ph join _fork_photo c on c.id = ph.id
                      where ph.place_id = p.id and c.in_j)) as in_j
    from public.places p where p.space_id = v_e_space;

  -- ---- 3. THE MAP: one new id per row that has to exist in both spaces -----
  -- Only the BOTH rows appear here. A Josh-only row keeps its id and simply changes space;
  -- an Erica-only row is never touched at all.
  create temporary table _fork_map (kind text, src uuid primary key, dst uuid not null)
    on commit drop;

  insert into _fork_map select 'place',    id, gen_random_uuid() from _fork_place where in_e and in_j;
  insert into _fork_map select 'visit',    id, gen_random_uuid() from _fork_visit where in_e and in_j;
  insert into _fork_map select 'activity', id, gen_random_uuid() from _fork_act   where in_e and in_j;

  -- ---- 4. THE PEOPLE EACH SPACE KEEPS -------------------------------------
  -- `my_people()` reads `in_space_people WHERE owner_profile = auth.uid()`, so Josh's space
  -- needs a row for him and a row for Erica, or his people picker is empty and every
  -- `_for_people` reader is asked about a person it cannot see.
  --
  -- THESE ARE NOT NEW ROWS, AND THEY CANNOT BE. `people` carries
  --
  --     unique (owner_profile, linked_profile)   -- people_one_link_per_owner
  --
  -- with no `space_id` in it, so Josh physically cannot have a second row pointing at
  -- himself. Discovered by the rehearsal refusing to run, which is the rehearsal doing its
  -- job — it is not a constraint any reading of the schema would have suggested mattered.
  --
  -- It also turns out nothing has to be invented. `people` already holds FIVE rows for
  -- three humans, in exactly the 2×2 this needs: Erica and Josh each own a row for
  -- themselves AND a row for the other, and only the two rows owned by the person they
  -- describe carry any tags. So the pair Josh already owns moves to Josh's space, and the
  -- pair Erica already owns stays in hers. Test Bot stays with Erica, per her decision.
  select id into v_j_person from public.people
   where space_id = v_e_space and owner_profile = v_second and linked_profile = v_second limit 1;
  select id into v_e_person from public.people
   where space_id = v_e_space and owner_profile = v_second and linked_profile = v_owner  limit 1;
  select id into v_e_self   from public.people
   where space_id = v_e_space and owner_profile = v_owner  and linked_profile = v_owner  limit 1;
  select id into v_e_josh   from public.people
   where space_id = v_e_space and owner_profile = v_owner  and linked_profile = v_second limit 1;

  if v_j_person is null or v_e_person is null or v_e_self is null or v_e_josh is null then
    raise exception '0292: the four person rows the fork needs are not all present '
                    '(josh/josh %, josh/erica %, erica/erica %, erica/josh %) — '
                    'refusing to guess which person a tag means',
                    v_j_person, v_e_person, v_e_self, v_e_josh;
  end if;

  -- Josh's pair crosses. Erica's pair does not move and is not edited.
  update public.people set space_id = v_j_space where id in (v_j_person, v_e_person);

  -- Every tag LEFT BEHIND in Erica's space that names one of the two rows that just left
  -- is repointed at Erica's own row for the same human. This is value-preserving by
  -- construction and not by hope: `visit_profiles` and `activity_profiles` both project
  -- `pe.linked_profile AS profile_id`, and `people_memory_keys` joins them on that, so a
  -- swap between two rows with the SAME `linked_profile` cannot change a single answer.
  -- What it does change is that Erica's space stops referencing a person who now lives on
  -- the other side of the boundary.
  --
  -- The delete guards the primary key `(subject_id, person_id)`: if a subject somehow
  -- already carried both rows, the update below would collide. In production today
  -- Erica's two rows carry no tags at all, so this removes nothing.
  delete from public.memory_people mp
   where mp.space_id = v_e_space and mp.person_id in (v_e_josh, v_e_self)
     and exists (select 1 from public.memory_people o
                  where o.subject_id = mp.subject_id
                    and o.person_id = case when mp.person_id = v_e_josh then v_j_person else v_e_person end);

  update public.memory_people set person_id = v_e_josh
   where space_id = v_e_space and person_id = v_j_person;
  update public.memory_people set person_id = v_e_self
   where space_id = v_e_space and person_id = v_e_person;

  -- ---- 5. THE ROWS THAT ARE ONLY JOSH'S SIMPLY CHANGE SPACE ---------------
  -- No copy, no new id, nothing to remap: the row was always his, it was merely filed in
  -- the only space that existed. Order does not matter — `space_id` is not a foreign key
  -- to anything these rows point at.
  update public.places     set space_id = v_j_space where id in (select id from _fork_place where in_j and not in_e);
  update public.visits     set space_id = v_j_space where id in (select id from _fork_visit where in_j and not in_e);
  update public.activities set space_id = v_j_space where id in (select id from _fork_act   where in_j and not in_e);
  update public.photos     set space_id = v_j_space where id in (select id from _fork_photo where in_j and not in_e);

  -- The dependents follow their parent, identified by the parent having just moved. This
  -- is why the four statements above run first.
  update public.memory_subjects s set space_id = v_j_space
   where s.space_id = v_e_space
     and (exists (select 1 from public.visits     v where v.id = s.visit_id     and v.space_id = v_j_space)
       or exists (select 1 from public.activities a where a.id = s.activity_id  and a.space_id = v_j_space)
       or exists (select 1 from public.photos     p where p.id = s.photo_id     and p.space_id = v_j_space));

  update public.memory_people mp set space_id = v_j_space
   where mp.space_id = v_e_space
     and exists (select 1 from public.memory_subjects s where s.id = mp.subject_id and s.space_id = v_j_space);

  -- A tag row that has just moved into Josh's space must name a person who is IN Josh's
  -- space, or `people_memory_keys` resolves it against a row on the far side of the
  -- boundary. The readers key on `linked_profile`, so this substitution is value-preserving
  -- by construction: same profile, same answer, no reference across the line.
  update public.memory_people mp set person_id = v_j_person
   where mp.space_id = v_j_space
     and exists (select 1 from public.people pe where pe.id = mp.person_id and pe.linked_profile = v_second);
  update public.memory_people mp set person_id = v_e_person
   where mp.space_id = v_j_space
     and exists (select 1 from public.people pe where pe.id = mp.person_id and pe.linked_profile = v_owner);

  update public.visit_evidence e set space_id = v_j_space
   where e.space_id = v_e_space
     and exists (select 1 from public.visits v where v.id = e.visit_id and v.space_id = v_j_space);
  update public.activity_sources t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.activities a where a.id = t.activity_id and a.space_id = v_j_space);
  update public.activity_participant_review t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.activities a where a.id = t.activity_id and a.space_id = v_j_space);
  update public.activity_visit_review t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.activities a where a.id = t.activity_id and a.space_id = v_j_space);
  update public.activity_reactions t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.activities a where a.id = t.activity_id and a.space_id = v_j_space);
  update public.visit_participant_review t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.visits v where v.id = t.visit_id and v.space_id = v_j_space);
  update public.visit_people t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.visits v where v.id = t.visit_id and v.space_id = v_j_space);
  update public.photo_reactions t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.photos p where p.id = t.photo_id and p.space_id = v_j_space);
  update public.entries t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.places p where p.id = t.place_id and p.space_id = v_j_space);
  update public.naming_rules t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.places p where p.id = t.place_id and p.space_id = v_j_space);
  update public.videos t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.places p where p.id = t.place_id and p.space_id = v_j_space);
  update public.place_membership t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.places p where p.id = t.child_id  and p.space_id = v_j_space)
     and exists (select 1 from public.places p where p.id = t.parent_id and p.space_id = v_j_space);
  update public.dup_dismissed t set space_id = v_j_space
   where t.space_id = v_e_space
     and exists (select 1 from public.places p where p.id = t.place_a and p.space_id = v_j_space)
     and exists (select 1 from public.places p where p.id = t.place_b and p.space_id = v_j_space);

  -- Rows keyed on the PERSON rather than on a memory. These are his by definition.
  update public.location_pings     set space_id = v_j_space where space_id = v_e_space and profile_id   = v_second;
  update public.source_connections set space_id = v_j_space where space_id = v_e_space and owner_profile = v_second;
  update public.place_ratings      set space_id = v_j_space where space_id = v_e_space and profile_id   = v_second;
  update public.peak_bags          set space_id = v_j_space where space_id = v_e_space and profile_id   = v_second;

  get diagnostics n_moved = row_count;

  -- ---- 6. THE ROWS THAT ARE BOTH ARE MATERIALISED INTO JOSH'S SPACE -------
  -- A real second row, not a shared one. Each copy takes its new id from `_fork_map` and
  -- every reference it carries is rewritten to the copy on ITS side of the boundary, so a
  -- Josh-space row never points at an Erica-space row.
  --
  -- Order is FK order: places, then visits (place_id), then activities (place_id and
  -- visit_id), then the subjects that hang off them, then the tags on the subjects.

  -- ⚠️ TWO TRIGGERS ON `activities` ARE TURNED OFF FOR THE LENGTH OF THE COPY, AND BOTH
  -- WERE FOUND BY THE REHEARSAL REFUSING TO PRODUCE THE RIGHT ANSWER RATHER THAN BY
  -- READING THE SCHEMA.
  --
  --   `activities_sync_visit` calls `rebuild_place_visits(new.place_id)`, which DERIVES the
  --   visits for a place from its activities and photos — deleting the ones it no longer
  --   believes in. Inserting the 56 copied outings rebuilt the places they sit at and
  --   destroyed 18 of the 107 visits this file had just materialised. Measured: 107 mapped,
  --   107 inserted, 89 still present one statement later. A derived-data maintainer is
  --   exactly right in normal operation and exactly wrong in the middle of a fork, because
  --   here the copies ARE the truth and it has no way to know that.
  --
  --   `activities_default_participants` calls `subject_for_activity(new.id)` and writes a
  --   `memory_people` row of its own invention. The real tags are copied below, with their
  --   evidence and their decider intact.
  --
  -- They are turned off with `alter table ... disable trigger`, not with
  -- `session_replication_role = replica`. Replica mode would have silenced these two AND
  -- every foreign key in the database, so a copy that pointed at nothing would have been
  -- committed without complaint — and referential integrity is the one thing a fork must
  -- not lose. Two named triggers, off for one section, back on before section 7.
  --   `photos_sync_visit` is the same maintainer reached from the other side: touching a
  --   photo's `place_id` or `visit_id` rebuilds that place's visits too, and section 6b
  --   touches both on every photo of Josh's that sits at a shared place. Same trigger, same
  --   destruction, found the same way.
  execute 'alter table public.activities disable trigger activities_sync_visit';
  execute 'alter table public.activities disable trigger activities_default_participants';
  execute 'alter table public.photos     disable trigger photos_sync_visit';
  execute 'alter table public.photos     disable trigger photos_pin_marks_visit';
  execute 'alter table public.visits     disable trigger visits_default_participants';

  -- PLACES. `cover_photo_id` is dropped on the copy — see gap 4 in the header: photos are
  -- not duplicated, so 33 of these covers live in Erica's space and pointing at one would
  -- be a reference across the boundary.
  insert into public.places (
    -- `geom` and `counts_as_place` are GENERATED ALWAYS and are therefore absent from this
    -- list: Postgres recomputes them for the copy from the same lat/lng and the same
    -- category, so they cannot drift from the original.
    id, name, country, admin1, lat, lng, first_visit, last_visit, created_by, created_at,
    cover_photo_id, auto, needs_geocode, geocoded_at, visit_count, rating, review, is_home,
    categories, activity_categories, cover_pos_y, address, bucket, website, is_trail, saved,
    favorite, part_of, city, suggested, kind, category, holds_children, boundary, park,
    deleted_at, name_locked, named_by, name_scope, space_id)
  select m.dst, p.name, p.country, p.admin1, p.lat, p.lng, p.first_visit, p.last_visit,
         p.created_by, p.created_at,
         case when ph.id is not null and ph.space_id = v_j_space then p.cover_photo_id end,
         p.auto, p.needs_geocode, p.geocoded_at, p.visit_count, p.rating, p.review, p.is_home,
         p.categories, p.activity_categories, p.cover_pos_y, p.address, p.bucket, p.website,
         p.is_trail, p.saved, p.favorite, p.part_of, p.city, p.suggested, p.kind, p.category,
         p.holds_children, p.boundary, p.park, p.deleted_at, p.name_locked, p.named_by,
         p.name_scope, v_j_space
    from _fork_map m
    join public.places p on p.id = m.src
    left join public.photos ph on ph.id = p.cover_photo_id
   where m.kind = 'place';

  -- VISITS. `parent_visit_id` is remapped through the map like any other reference; it is
  -- NULL on every row in production today, and this is written so that it stays correct
  -- when it is not.
  insert into public.visits (
    id, place_id, start_date, end_date, note, created_by, created_at, solo_override, manual,
    status, decided_at, parent_visit_id, trip_marked, source, accepted_at, accepted_by,
    updated_at, client_key, space_id)
  select m.dst,
         coalesce(mp.dst, v.place_id),
         v.start_date, v.end_date, v.note, v.created_by, v.created_at, v.solo_override,
         v.manual, v.status, v.decided_at,
         (select mv.dst from _fork_map mv where mv.kind = 'visit' and mv.src = v.parent_visit_id),
         v.trip_marked, v.source, v.accepted_at, v.accepted_by, v.updated_at,
         -- `client_key` is the app's idempotency handle for "this exact visit". Two rows
         -- in two spaces are two visits, so the copy must not carry the original's.
         null,
         v_j_space
    from _fork_map m
    join public.visits v on v.id = m.src
    left join _fork_map mp on mp.kind = 'place' and mp.src = v.place_id
   where m.kind = 'visit';

  -- ACTIVITIES, and the shared_group_id rule the header is about.
  --
  --   * `strava_id` is UNIQUE across the table, so the copy CANNOT carry it and is NULL.
  --     `original_source` and `source_id` are kept, so the copy still says where it came
  --     from; only the globally-unique handle is surrendered.
  --   * `shared_group_id` is `coalesce(a.shared_group_id, a.id)` — the original's own
  --     canonical key. For the 33 that have one this is a no-op inheritance; for the 23
  --     that do not it is the original's id, and section 7 writes the same value back onto
  --     the original so both rows agree.
  --   * `visit_id` is remapped, and falls to NULL when the visit did not come across. That
  --     happens exactly once in production — see section 10's note.
  insert into public.activities (
    -- `geom` and `local_date` are GENERATED ALWAYS; Postgres recomputes both for the copy.
    id, strava_id, type, name, distance, moving_time, elapsed_time, start_date, lat, lng,
    place_id, created_at, summary_polyline, trailhead, athlete_id, shared_group_id, source,
    owner_profile, also_profiles, elevation_gain, source_id, is_race, elevation_profile,
    start_date_local, visit_id, original_source, space_id)
  select m.dst, null, a.type, a.name, a.distance, a.moving_time, a.elapsed_time, a.start_date,
         a.lat, a.lng,
         coalesce(mp.dst, a.place_id),
         a.created_at, a.summary_polyline, a.trailhead, a.athlete_id,
         coalesce(a.shared_group_id, a.id),
         a.source, a.owner_profile, a.also_profiles, a.elevation_gain, a.source_id, a.is_race,
         a.elevation_profile, a.start_date_local,
         mv.dst,
         a.original_source, v_j_space
    from _fork_map m
    join public.activities a on a.id = m.src
    left join _fork_map mp on mp.kind = 'place' and mp.src = a.place_id
    left join _fork_map mv on mv.kind = 'visit' and mv.src = a.visit_id
   where m.kind = 'activity';

  -- MEMORY SUBJECTS for the copied visits and outings. A copy with no subject has no
  -- participants, and `people_memory_keys` would return nothing for it — the memory would
  -- be in Josh's space and invisible to every stat he has.
  --
  -- ⚠️ AND THE INSERTS ABOVE HAVE ALREADY MADE SOME OF THEM. `activities` and `visits` both
  -- carry an AFTER trigger, `default_participants`, which the rehearsal found the hard way:
  --
  --   * for an ACTIVITY it calls `subject_for_activity(new.id)` — which CREATES the subject
  --     — and then writes a `memory_people` row for the owner, `accepted` / `own_recording`.
  --     So all 56 copied outings already have a subject, and a manufactured tag on it.
  --   * for a VISIT it does nothing at all, because it is guarded by `auth.uid() is not
  --     null` and a migration has no caller. So none of the 107 copied visits has one.
  --
  --   Two different behaviours from one trigger, neither of them what this file wants. The
  --   subjects it did make are filed in ERICA's space, because they were made with no
  --   caller and `default_space()` still falls back to the biggest space until section 8
  --   removes it — a subject describing a Josh-space outing, filed in Erica's.
  --
  --   (This trigger is also, for the record, the generator the header names: a machine
  --   writing participation rows with no `tagged_by`. It is not changed here.)
  --
  -- So: make the ones that are missing, adopt the ones that exist, and then throw the
  -- manufactured tags away and copy the real ones. `on conflict do nothing` is what makes
  -- the first step indifferent to which of the two the trigger did.
  create temporary table _fork_subject (src uuid primary key, dst uuid not null) on commit drop;

  insert into public.memory_subjects (kind, owner_profile, visit_id, created_at, space_id)
  select 'visit', s.owner_profile, m.dst, s.created_at, v_j_space
    from _fork_map m
    join public.memory_subjects s on s.kind = 'visit' and s.visit_id = m.src
   where m.kind = 'visit'
  on conflict do nothing;

  insert into public.memory_subjects (kind, owner_profile, activity_id, created_at, space_id)
  select 'outing', s.owner_profile, m.dst, s.created_at, v_j_space
    from _fork_map m
    join public.memory_subjects s on s.kind = 'outing' and s.activity_id = m.src
   where m.kind = 'activity'
  on conflict do nothing;

  -- Whoever made it, a subject describing a copy belongs in the copy's space.
  update public.memory_subjects d set space_id = v_j_space
   where exists (select 1 from _fork_map m where m.kind = 'visit'    and m.dst = d.visit_id)
      or exists (select 1 from _fork_map m where m.kind = 'activity' and m.dst = d.activity_id);

  -- Recover the pairing. `memory_subjects` has no natural key, so a copy is matched back to
  -- its original through the memory it describes — which is unique per kind, by the four
  -- `memory_subjects_one_per_*` indexes.
  insert into _fork_subject (src, dst)
  select s.id, d.id from _fork_map m
    join public.memory_subjects s on s.kind = 'visit' and s.visit_id = m.src
    join public.memory_subjects d on d.kind = 'visit' and d.visit_id = m.dst
   where m.kind = 'visit';

  insert into _fork_subject (src, dst)
  select s.id, d.id from _fork_map m
    join public.memory_subjects s on s.kind = 'outing' and s.activity_id = m.src
    join public.memory_subjects d on d.kind = 'outing' and d.activity_id = m.dst
   where m.kind = 'activity';

  -- THE MANUFACTURED TAGS GO. The record of who was on a memory is the original's tags,
  -- copied below with their evidence, their decider and their timestamps intact — not a
  -- trigger's guess written a moment ago during this migration.
  delete from public.memory_people where subject_id in (select dst from _fork_subject);

  -- THE TAGS. `person_id` is rewritten to Josh's space's own person rows, for the reason
  -- given in section 5: the readers key on `linked_profile`, so this preserves the answer
  -- exactly while keeping the reference inside the space.
  insert into public.memory_people (
    subject_id, person_id, tagged_by, participation_status, verification_status,
    sharing_status, decided_by, decided_at, created_at, evidence, created_by, rule_id, space_id)
  select fs.dst,
         case when pe.linked_profile = v_second then v_j_person
              when pe.linked_profile = v_owner  then v_e_person
              else mp.person_id end,
         mp.tagged_by, mp.participation_status, mp.verification_status, mp.sharing_status,
         mp.decided_by, mp.decided_at, mp.created_at, mp.evidence, mp.created_by, mp.rule_id,
         v_j_space
    from public.memory_people mp
    join _fork_subject fs on fs.src = mp.subject_id
    join public.people pe on pe.id = mp.person_id
   where mp.space_id = v_e_space
     -- A person who exists only in Erica's space (Test Bot, and the unused mirrors) has no
     -- row on Josh's side to point at, so their tag does not cross. Dropping it is correct:
     -- it is Erica's record of who was there, in Erica's space.
     and pe.linked_profile in (v_owner, v_second);

  -- The dependents of the copied roots.
  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key, created_at, space_id)
  select m.dst, e.evidence_type, e.evidence_id, e.evidence_date, e.source_key, e.created_at, v_j_space
    from public.visit_evidence e join _fork_map m on m.kind = 'visit' and m.src = e.visit_id
   where e.space_id = v_e_space;

  insert into public.activity_sources (activity_id, ingest_item_id, connection_id, provider, origin, external_key, device_name, is_primary, confidence, created_at, space_id)
  select m.dst, t.ingest_item_id, t.connection_id, t.provider, t.origin,
         -- `external_key` identifies the recording at the provider; two spaces holding the
         -- same recording is the point of the fork, but the key is not re-asserted here.
         null, t.device_name, t.is_primary, t.confidence, t.created_at, v_j_space
    from public.activity_sources t join _fork_map m on m.kind = 'activity' and m.src = t.activity_id
   where t.space_id = v_e_space;

  -- `place_ratings` is NOT copied here. Josh's rating of a shared place is HIS rating, and
  -- section 5 has already moved it into his space; the remap below repoints it at his copy
  -- of the place. Copying as well would have inserted a second row on the same
  -- `(place_id, profile_id)` key.

  insert into public.place_membership (child_id, parent_id, created_at, relationship_type, space_id)
  select mc.dst, mp2.dst, t.created_at, t.relationship_type, v_j_space
    from public.place_membership t
    join _fork_map mc  on mc.kind  = 'place' and mc.src  = t.child_id
    join _fork_map mp2 on mp2.kind = 'place' and mp2.src = t.parent_id
   where t.space_id = v_e_space;

  get diagnostics n_copied = row_count;

  -- ---- 6b. THE ROWS THAT MOVED NOW POINT AT THEIR OWN SIDE'S COPY --------
  -- Section 5 moved Josh's private rows before the copies existed, so a moved row that
  -- referenced a SHARED place or a SHARED visit is still pointing at the original — which
  -- stayed in Erica's space. 93 of his visits were in exactly that state, and section 10
  -- caught it.
  --
  -- The rule is one sentence applied everywhere: for any row now in Josh's space, a
  -- reference to something that was materialised becomes a reference to the materialised
  -- copy. A reference to something that merely MOVED needs nothing, because moving does not
  -- change an id — which is why only `_fork_map` appears here.
  update public.visits t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.visits t set parent_visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.parent_visit_id and t.space_id = v_j_space;
  update public.activities t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.activities t set visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.visit_id and t.space_id = v_j_space;
  update public.photos t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.photos t set visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.visit_id and t.space_id = v_j_space;
  update public.videos t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.videos t set visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.visit_id and t.space_id = v_j_space;
  update public.entries t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.naming_rules t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.location_pings t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.place_ratings t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.peak_bags t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;
  update public.peak_bags t set activity_id = m.dst
    from _fork_map m where m.kind = 'activity' and m.src = t.activity_id and t.space_id = v_j_space;
  update public.visit_evidence t set visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.visit_id and t.space_id = v_j_space;
  update public.activity_sources t set activity_id = m.dst
    from _fork_map m where m.kind = 'activity' and m.src = t.activity_id and t.space_id = v_j_space;
  update public.activity_participant_review t set activity_id = m.dst
    from _fork_map m where m.kind = 'activity' and m.src = t.activity_id and t.space_id = v_j_space;
  update public.activity_visit_review t set activity_id = m.dst
    from _fork_map m where m.kind = 'activity' and m.src = t.activity_id and t.space_id = v_j_space;
  update public.activity_reactions t set activity_id = m.dst
    from _fork_map m where m.kind = 'activity' and m.src = t.activity_id and t.space_id = v_j_space;
  update public.visit_participant_review t set visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.visit_id and t.space_id = v_j_space;
  update public.visit_people t set visit_id = m.dst
    from _fork_map m where m.kind = 'visit' and m.src = t.visit_id and t.space_id = v_j_space;
  update public.place_membership t set child_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.child_id and t.space_id = v_j_space;
  update public.place_membership t set parent_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.parent_id and t.space_id = v_j_space;
  update public.dup_dismissed t set place_a = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_a and t.space_id = v_j_space;
  update public.dup_dismissed t set place_b = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_b and t.space_id = v_j_space;
  update public.memory_subjects t set place_id = m.dst
    from _fork_map m where m.kind = 'place' and m.src = t.place_id and t.space_id = v_j_space;

  -- COVER PHOTOS THAT NOW CROSS THE BOUNDARY, IN BOTH DIRECTIONS.
  --
  -- Photos are not duplicated (header gap 4): each one goes to whoever took it. So a place
  -- whose cover was taken by the OTHER person now points across the line. The copies were
  -- handled where they were copied; this catches the rest, and the measurement says the
  -- remaining 10 are on ERICA's side — her place row, Josh's photograph, which went with
  -- him.
  --
  -- ⚠️ THIS IS THE ONE THING ON ERICA'S SCREEN THAT CHANGES BESIDES HER VIEW OF JOSH.
  -- 10 of her place cards lose their cover image. It is not a count: `cover_photo_id`
  -- feeds no stat, no place total, no mileage, no trip and no race — every one of those is
  -- asserted unchanged in the PR's before/after table. It is a picture, and the picture
  -- belonged to Josh. The alternatives were to duplicate his photographs into her space,
  -- which contradicts the rule that a photo has one owner, or to pick her a different cover,
  -- which is inventing. Neither is better than saying so.
  update public.places t set cover_photo_id = null
   where t.cover_photo_id is not null
     and not exists (select 1 from public.photos ph
                      where ph.id = t.cover_photo_id and ph.space_id = t.space_id);

  execute 'alter table public.activities enable trigger activities_sync_visit';
  execute 'alter table public.activities enable trigger activities_default_participants';
  execute 'alter table public.photos     enable trigger photos_sync_visit';
  execute 'alter table public.photos     enable trigger photos_pin_marks_visit';
  execute 'alter table public.visits     enable trigger visits_default_participants';

  -- ---- 7. THE ORIGINAL IS TOLD ABOUT ITS COPY -----------------------------
  -- The 23 both-tagged activities whose `shared_group_id` was NULL now get their own id
  -- written into it, which is the value their copy already carries. `coalesce(sgid, id)`
  -- is IDENTICAL before and after, so no reader can see this; what changes is that the
  -- copy in Josh's space now collapses onto the same key instead of counting again.
  update public.activities a
     set shared_group_id = a.id
   where a.space_id = v_e_space
     and a.shared_group_id is null
     and a.id in (select src from _fork_map where kind = 'activity');

  -- ---- 8. THE FALLBACK 0289 ASKED THIS FILE TO REMOVE ---------------------
  -- `default_space()` falls back to "the space with the most members" when there is no
  -- caller. 0289's own comment: *"⚠️ THE SPLIT MIGRATION MUST DELETE THIS FALLBACK. The
  -- moment Josh's space holds rows, 'the biggest space' stops being a fact and becomes a
  -- guess, and a guess that files a row in the wrong space is exactly the failure this
  -- whole change exists to prevent."* Josh's space now holds rows, so it goes.
  --
  -- REPLACED INSIDE THE BRANCH THAT ACTUALLY FORKED, and that is not fussiness. A schema
  -- replayed from empty seeds `activity_options`, `place_categories`, `peaks`, `parks` and
  -- `settings` BEFORE any profile exists, and those inserts reach `default_space()` with
  -- no caller. Removing the fallback unconditionally would leave them with no space and
  -- break the bootstrap CI runs on every push.
  execute $ddl$
    create or replace function public.default_space()
    returns uuid language sql stable security definer set search_path to 'public' as $fn$
      -- The caller's own space, and nothing else. There is no longer a single occupied
      -- space to guess at, so a guess is now a way of filing a row in the wrong person's
      -- history (0289 §"default_space", 0292 §8). A write that reaches here with no caller
      -- must name its space itself.
      select public.current_space();
    $fn$
  $ddl$;
  revoke all on function public.default_space() from public, anon, authenticated;
  grant execute on function public.default_space() to authenticated, service_role;

  -- ---- 9. THE MEMBERSHIP ENDS --------------------------------------------
  -- The header argues this at length; it is one statement. Josh keeps his own space, which
  -- he owns. Test Bot stays where Erica put him.
  delete from public.space_memberships
   where space_id = v_e_space and profile_id = v_second;

  -- ---- 10. WHAT MUST BE TRUE, CHECKED RATHER THAN ASSUMED ----------------
  -- Not one of these is an absolute count. Each is a SHAPE: a relationship that has to hold
  -- whatever the data happens to be, so it says the same thing on production and on the
  -- empty schema CI replays.

  -- (a) Nothing points across the boundary. This is the assertion the whole file is for:
  --     if a single row in one space references a row in another, the fork has produced a
  --     database that looks partitioned and is not.
  select count(*) into n from public.visits v join public.places p on p.id = v.place_id
   where v.space_id is distinct from p.space_id;
  if n > 0 then raise exception '0292: % visit(s) reference a place in another space', n; end if;

  select count(*) into n from public.activities a join public.places p on p.id = a.place_id
   where a.space_id is distinct from p.space_id;
  if n > 0 then raise exception '0292: % activity/ies reference a place in another space', n; end if;

  select count(*) into n from public.activities a join public.visits v on v.id = a.visit_id
   where a.space_id is distinct from v.space_id;
  if n > 0 then raise exception '0292: % activity/ies reference a visit in another space', n; end if;

  select count(*) into n from public.photos ph join public.places p on p.id = ph.place_id
   where ph.space_id is distinct from p.space_id;
  if n > 0 then raise exception '0292: % photo(s) reference a place in another space', n; end if;

  select count(*) into n from public.places p join public.photos ph on ph.id = p.cover_photo_id
   where p.space_id is distinct from ph.space_id;
  if n > 0 then raise exception '0292: % place(s) have a cover photo in another space', n; end if;

  select count(*) into n from public.memory_people mp join public.memory_subjects s on s.id = mp.subject_id
   where mp.space_id is distinct from s.space_id;
  if n > 0 then raise exception '0292: % tag(s) sit in a different space from their subject', n; end if;

  select count(*) into n from public.memory_people mp join public.people pe on pe.id = mp.person_id
   where mp.space_id is distinct from pe.space_id;
  if n > 0 then raise exception '0292: % tag(s) name a person in another space', n; end if;

  select count(*) into n from public.memory_subjects s join public.visits v on v.id = s.visit_id
   where s.space_id is distinct from v.space_id;
  if n > 0 then raise exception '0292: % subject(s) describe a visit in another space', n; end if;

  select count(*) into n from public.memory_subjects s join public.activities a on a.id = s.activity_id
   where s.space_id is distinct from a.space_id;
  if n > 0 then raise exception '0292: % subject(s) describe an outing in another space', n; end if;

  -- (b) THE MILEAGE RULE. Every copied outing collapses onto the same canonical key as the
  --     original. If this fails, the same run counts twice, which is the one failure Erica
  --     named in her own words.
  select count(*) into n
    from _fork_map m
    join public.activities src on src.id = m.src
    join public.activities dst on dst.id = m.dst
   where m.kind = 'activity'
     and coalesce(src.shared_group_id, src.id) is distinct from coalesce(dst.shared_group_id, dst.id);
  if n > 0 then
    raise exception '0292: % copied outing(s) do not share a canonical key with their original — '
                    'the same run would count twice', n;
  end if;

  -- (c) Every copy is in Josh's space and every original stayed in Erica's. A copy filed on
  --     the wrong side would be invisible to him and doubled for her.
  select count(*) into n from _fork_map m
   where (m.kind = 'place'    and not exists (select 1 from public.places     x where x.id = m.dst and x.space_id = v_j_space))
      or (m.kind = 'visit'    and not exists (select 1 from public.visits     x where x.id = m.dst and x.space_id = v_j_space))
      or (m.kind = 'activity' and not exists (select 1 from public.activities x where x.id = m.dst and x.space_id = v_j_space));
  if n > 0 then raise exception '0292: % materialised row(s) did not land in Josh''s space', n; end if;

  -- (d) Both spaces are occupied and Josh is out of Erica's. If either is false the fork
  --     did not happen and everything above was a very expensive no-op.
  if not exists (select 1 from public.visits where space_id = v_j_space) then
    raise exception '0292: Josh''s space still holds no visits';
  end if;
  if exists (select 1 from public.space_memberships where space_id = v_e_space and profile_id = v_second) then
    raise exception '0292: Josh is still a member of Erica''s space';
  end if;

  -- (e) Nothing is homeless, and nothing gained a space it should not have.
  select count(*) into n from public.visits where space_id not in (v_e_space, v_j_space);
  if n > 0 then raise exception '0292: % visit(s) are in a third space', n; end if;

  raise notice '0292: forked. % dependent row(s) moved on the last move statement, '
               '% on the last copy statement. Josh''s space: % place(s), % visit(s), '
               '% outing(s), % photo(s).',
    n_moved, n_copied,
    (select count(*) from public.places     where space_id = v_j_space),
    (select count(*) from public.visits     where space_id = v_j_space),
    (select count(*) from public.activities where space_id = v_j_space),
    (select count(*) from public.photos     where space_id = v_j_space);
end
$fork$;

commit;
