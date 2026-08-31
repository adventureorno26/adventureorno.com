-- 0293 — the writers name their space.
--
-- DRAFT — REHEARSED, NOT APPLIED. Nothing in this file has been run against production
-- outside a transaction that was rolled back.
--
-- 0290 closed the READERS and said, in its own header, exactly what it was leaving open:
--
--     "⚠️ THE TWO WRITE PATHS ARE A REAL GAP AND THIS FILE DOES NOT CLOSE IT. Both are
--      SECURITY DEFINER, so the partition's rewritten policies do not constrain them
--      either — a writer bypasses RLS exactly as a definer reader does. After the split,
--      nothing in the database stops `merge_nearby_dupes` from merging a place in Erica's
--      space into one in Josh's. That is a WRITER audit, it is a different question with a
--      different answer... It is named here so it cannot be lost."
--
-- This is that audit. It is not two write paths. It is eighty-eight.
--
--
-- ============================================================================
-- THE EXPLOIT, REPRODUCED ON PRODUCTION AND ROLLED BACK
-- ============================================================================
--
-- Two spaces exist after 0292: Erica's (Erica owner, Test Bot editor) and Josh's (Josh
-- owner). Josh is NOT a member of Erica's space. Run as Josh, against a visit that lives
-- in Erica's space:
--
--     set local request.jwt.claims = '{"sub":"<josh>","role":"authenticated"}';
--     set local role authenticated;
--     select public.edit_visit('4d2f0605-2a01-4b82-8a5a-92171dd4b9b7'::uuid,
--                              '2019-01-01'::date,'2019-01-02'::date,
--                              null,null,null,null);
--
-- It did not error. Read back as superuser, her visit's dates had been rewritten to 2019.
-- Production is intact — the transaction was rolled back and `2026-08-30` verified still
-- there — but the hole is open until this file lands.
--
-- WHY IT WORKS. `edit_visit` is SECURITY DEFINER, which bypasses RLS by construction. Its
-- only authorisation check is `public.is_editor_or_owner()`, which asks WHAT ROLE the
-- caller has and never asks WHICH SPACE the row is in. Josh is an owner — of his own
-- space — so the check passes and the UPDATE lands on somebody else's row.
--
-- Every writer in this database has the same shape. The readers were scoped in 0290. The
-- writers never were. This was harmless while everyone shared one household; 0292 — the
-- fork — is what turned it into a vulnerability.
--
--
-- ============================================================================
-- WHAT WAS MEASURED, ON PRODUCTION, 2026-08-30 — not guessed from filenames
-- ============================================================================
--
-- Every count below comes from `pg_proc` on project aanfyhsjbtnqzphuoiem, read through the
-- Management API. A "writer" is: SECURITY DEFINER, in `public`, and its body contains an
-- INSERT, UPDATE or DELETE naming one of the 48 tables that carry a `space_id`.
--
--     238  SECURITY DEFINER functions in `public`
--      96  of them write to a space-owned table
--       8  of those 96 are TRIGGER functions (they write as a consequence of another
--          write, and the write that provoked them is itself guarded here)
--      88  are callable functions — the RPC surface
--      83  of the 88 do not contain the string `space_id`, `my_space_ids` or `is_member(`
--          ANYWHERE in their body. They cannot be refusing a cross-space write, because
--          they have no expression in them capable of noticing one.
--      57  of the 88 never reference `auth.uid()` at all — they do not know who is
--          calling, so no per-function predicate could be written into them without first
--          teaching each one to ask.
--       2  are legitimately cross-space by design and are exempted below, with reasons.
--
-- (The brief said 62 writers, 55 unscoped. This file's regex is wider than that one: it
-- counts trigger functions and it matches an `update <t>` anywhere in a body rather than
-- only at a statement head. The wider number is the one guarded, because the narrower one
-- being right would still leave the difference unguarded. Nothing here depends on which
-- count is correct — the mechanism does not enumerate.)
--
--
-- ============================================================================
-- THE MECHANISM: ONE SENTENCE PER TABLE, NOT ONE PREDICATE PER FUNCTION
-- ============================================================================
--
-- The obvious fix — a `public.assert_my_space(...)` helper, called from the top of each
-- writer — was DISCARDED, and the reason is the 57 above. Fifty-seven of the eighty-eight
-- writers never mention `auth.uid()`; a good half of them (`recompute_place_stats`,
-- `subject_for_visit`, `person_for_profile`, `rebuild_place_visits`) are called only from
-- inside other writers and take an id rather than a caller. Writing a predicate into each
-- means rewriting 187KB of function bodies, byte-perfect, in one migration — and 0290
-- records what happens when bodies are copied from the wrong source: two of its sixty-two
-- would have silently REVERTED ghost mode, because production was behind the chain.
--
-- Worse, it does not finish the job. `merge_nearby_dupes` and `move_visit_to_place` — the
-- two 0290 named — write nothing themselves; they call `merge_places_auto`,
-- `set_visit_place` and `reassign_activity`. An enumeration of writers has to notice that
-- callers of writers are writers too, and then that callers of those are as well. The next
-- SECURITY DEFINER function anyone adds starts unguarded by default.
--
-- So the boundary is written where the rows are, ONCE PER TABLE: a BEFORE ROW trigger on
-- every space-owned base table, all 46 of them running the same function. It is the same
-- argument 0290 made for a view over a hand-written WHERE clause, one level down:
--
--   1. IT CANNOT BE MISSED. A writer nobody enumerated, a writer added next month, a
--      writer reached three calls deep from another writer — all of them go through the
--      table, and the table is where the check is. There is no list to keep up to date.
--   2. THE RULE IS WRITTEN ONCE. A reviewer checks one function and one exclusion list,
--      instead of eighty-eight hand-written predicates at eighty-eight sites.
--   3. IT IS INERT FOR EVERY WRITE THAT IS ALREADY LEGAL. Direct table writes from
--      PostgREST are governed by the partition's policies, which already say
--      `is_member(space_id)`; the guard re-states what the policy already enforced and
--      changes nothing for them.
--
-- WHY `exists (select 1 from space_memberships …)` AND NOT `my_space_ids()`. 0290 measured
-- the cost of asking this question per row: `is_member(space_id)` was 429 / 386 / 401 ms on
-- three screens against 34 / 19 / 15 for `my_space_ids()`, a twentyfold regression, because
-- a SECURITY DEFINER call taking the row's id as an argument must be made once per row.
-- A ROW TRIGGER IS PER ROW BY CONSTRUCTION, so neither form helps: `my_space_ids()` cannot
-- be hoisted out of a trigger body the way a planner hoists it out of a query. The guard
-- therefore skips the wrapper entirely and does the index lookup itself, against
-- `space_memberships_pkey` on `(space_id, profile_id)` — one unique-index probe, no nested
-- SECURITY DEFINER call, no per-row function resolution. Measured cost is in §"WHAT IT
-- COSTS" below.
--
--
-- ============================================================================
-- WHAT MUST NOT BE GUARDED, AND WHY — the part that is not a list of tables
-- ============================================================================
--
-- 0290's most useful finding was an exclusion: `same_recording_of` runs in the importer
-- where `auth.uid()` is NULL, so a caller-boundary clause there "would have been a bug that
-- looked like a fix". The same trap is here, three times, and each is written into the
-- guard rather than left to be rediscovered.
--
--   1. THERE IS NO CALLER. `auth.uid() is null` means service_role, a cron, a migration
--      replay, or `scripts/db-bootstrap.sh` rebuilding the chain into an empty schema.
--      `workers/photo-gateway/src/supa.ts` says it outright: "All DB writes use the
--      service_role key (bypasses RLS) via PostgREST". A boundary check where there is no
--      caller does not refuse an intruder; it refuses EVERY row the importer and the
--      photo gateway have ever written, and `bash scripts/db-test.sh` — which runs as
--      `postgres` with no JWT — would fail on its first insert. The guard stands down.
--      This is the same sentence 0290 wrote about `same_recording_of`, applied to writes.
--
--      NOTE, so it is not mistaken for a hole: the importer RPCs that DO run under a user
--      JWT (`ingest_activity`, `begin_ingest_run`, `record_import_artifact`) are NOT
--      covered by this stand-down. They call `is_editor_or_owner()` and `auth.uid()`, they
--      run as a signed-in person, and they are guarded like everything else — correctly,
--      because they write into the caller's own space.
--
--   2. A TAG IS ANSWERED FROM THE OTHER SIDE OF THE BOUNDARY. This is the category 0290
--      did not have to think about, because reading someone else's card is not a thing you
--      do TO their space. Answering a tag is.
--
--      `respond_to_tag` exists so that Josh — in Josh's space — can answer a claim Erica
--      made about him. The `tag_claims` row is in ERICA's space, because she asserted it;
--      the `memory_people` rows it accepts or withdraws are in her space too. Its
--      authorisation is not a space at all, it is an identity: `if c.profile_id <>
--      auth.uid() then raise 'only the tagged person can answer a tag'`. That check is
--      strictly narrower than a space check — it admits exactly one person — and a space
--      check layered on top of it would refuse every tag that crosses a household, which
--      is the only kind of tag the feature is for. `supabase/tests/0213_josh_gets_asked.
--      test.sql` is that feature. `respond_to_memory_tag` is the same shape, keyed on
--      `people.linked_profile = auth.uid()`.
--
--      These two are exempted BY DECLARATION, not by editing their bodies — see §3.
--
--   3. YOU JOIN A SPACE YOU ARE NOT YET IN. `space_memberships` is the row that makes the
--      guard pass; guarding the write that creates it is a closed loop with nobody inside
--      it. `ensure_profile_space()` inserts it from a trigger on `profiles`, and
--      `claim_invite()` — running as a brand-new user with no space at all — updates an
--      `invites` row that lives in the INVITER's space. Both tables stand out of the
--      guard, named in §2 with this reason attached.
--
-- WHAT IS NOT EXCLUDED, checked one at a time and recorded because "I looked and it was
-- fine" is worth as much as an exclusion: `set_visit_participants`, `set_activity_solo`,
-- `set_place_solo` and `set_visit_solo` all write tags ABOUT other people, but they write
-- them into the caller's own space (the owner asserting who was there), so the guard is
-- inert for them. `memory_people_refuse_a_blocked_tag` — 0290's safety exclusion — reads
-- `people` and writes nothing, so it is not a writer and is untouched here.
--
--
-- ============================================================================
-- WHAT THIS FILE DOES NOT CLOSE
-- ============================================================================
--
--   * THE EXEMPTION IS A STACK PATTERN, AND A PATTERN CAN FAIL OPEN. If
--     `respond_to_tag` is renamed or its signature changes, the `like` in
--     `answering_a_tag_across_the_boundary()` stops matching, the exemption silently
--     stops applying, and answering a tag across a household starts refusing with a 42501
--     nobody can trace back here. §3 asserts both signatures exist at apply time, and
--     §7 of the test exercises the path end to end, so the failure is a red build rather
--     than a support ticket — but the pattern is still a pattern, and it is named.
--
--   * THE GUARD IS PER ROW, BECAUSE A ROW TRIGGER IS. `merge_places_auto` re-points
--     `location_pings` — 17,207 rows on production — and every one of them now costs an
--     index probe into `space_memberships` it did not cost before. Measured in the PR
--     body. If it ever matters, the answer is a statement-level trigger with transition
--     tables, which asks the same question once per statement; that is a tuning change
--     and it is not made here, because a `for each statement` trigger cannot see
--     `space_id` on a table where the statement touched no rows and the extra machinery
--     is not worth buying before it is needed.
--
--   * THE GUARD ASKS ABOUT MEMBERSHIP, NOT ABOUT ROLE. A viewer in Erica's space passes
--     it. That is correct here — `is_editor_or_owner()` is the role check and it already
--     runs first in every writer that needs one — but it means this file is not an
--     authorisation review. It is a boundary.
--
--   * `photos.space_id` IS NOT NULL WITH DEFAULT `default_space()`, AND
--     `default_space()` RETURNS NULL WHEN `auth.uid()` IS NULL. The photo gateway writes
--     with service_role and does not set `space_id` (grepped: no occurrence in
--     `workers/photo-gateway/src/`). That is a pre-existing consequence of 0289/0292 and
--     not of this file — the guard stands down for exactly that caller — but it is
--     written here because the audit found it and it should not be lost twice.
--
--
-- ============================================================================
-- WHAT IT COSTS, MEASURED ON PRODUCTION INSIDE `begin … rollback`
-- ============================================================================
--
-- A row trigger costs one index probe per row written, so the bill lands entirely on the
-- bulkiest write path there is. That is `merge_places_auto`, which re-points every
-- `location_pings` row belonging to a place. Signed in as Erica, updating all 17,118 of
-- her pings in one statement:
--
--     without the guard   1156 ms
--     with the guard      2967 ms      2.6x, +1.8 s
--
-- THAT IS THE WHOLE COST AND IT IS ON THE WORST CASE. Every other write in the
-- application touches one row to a few dozen: the same rehearsal measured `edit_visit`
-- end to end at 63 ms including the refusal. A merge is an occasional, deliberate,
-- already-slow administrative action, and 1.8 s on it is the price of the boundary
-- holding for the other eighty-seven writers without any of them being edited.
--
-- IF IT EVER MATTERS, the answer is a statement-level trigger with transition tables,
-- which asks the same question once per statement instead of once per row — the same
-- hoisting 0290 got from `my_space_ids()` in a query. It is not done here because it is
-- a tuning change, it is materially more machinery, and 1.8 s on a merge is not yet a
-- problem anyone has.
--
-- ⚠️ THE REAL APPLY NEEDS A `vacuum analyze` AFTER IT — same as 0289 and 0290. Adding 46
-- triggers does not invalidate statistics, but the measurements above were taken inside a
-- transaction that had just created them, and nothing here has been observed on a
-- warmed-up committed schema.

begin;

-- ---------------------------------------------------------------------------
-- 1. THE GUARD. One function, read by every trigger in §2.
--
--    SECURITY DEFINER so it can read `space_memberships` when it fires under a plain
--    RLS-governed statement; `search_path` pinned; EXECUTE revoked from every client role
--    (a new SECURITY DEFINER function default-grants EXECUTE to PUBLIC, which is how 0101
--    reopened what the 0093/0105 lockdown closed — `scripts/db-test.sh` fails the build
--    on it).
-- ---------------------------------------------------------------------------

-- THE TWO THAT CROSS ON PURPOSE, recognised by being ON THE CALL STACK rather than by
-- anything they say about themselves. `get diagnostics … pg_context` is the PL/pgSQL call
-- stack: you appear in it by having actually been called, and there is no way to put
-- yourself there from outside. That matters more than it sounds:
--
--   * THE FIRST DRAFT USED A GUC — `alter function respond_to_tag(…) set
--     aon.cross_space_write = 'allow'` — and it does not work here. `postgres` is not a
--     superuser on this project (checked: `usesuper = f`, on production and on the local
--     stack alike) and ALTER FUNCTION … SET on a custom parameter needs SET privilege on
--     it, which for a placeholder is superuser-only. It failed with "permission denied to
--     set parameter" on the first rehearsal.
--   * SO MUCH THE BETTER, because a GUC is a string and a string is a claim. The draft's
--     own header had to carry a residual saying so. A stack frame is not a claim; it is
--     the fact. There is nothing left to name as a residual.
--   * AND IT TOUCHES NO BODIES. 0290 found two of its sixty-two functions where
--     production was BEHIND the merged chain, and regenerating them from production
--     "would have shipped a migration that silently REVERTED both". `respond_to_tag` is
--     110 lines of participation logic. Not retyping it is the only way to be certain
--     this file changes nothing about what answering a tag DOES.
--
-- THE EXEMPTION IS INHERITED by everything these two call — `subject_for_visit`,
-- `person_for_profile`, `visible_recording_of` — because those frames sit ABOVE the
-- caller's on the same stack. That is required, not incidental: those are where the
-- `memory_subjects` and `people` rows in the tagger's space actually get written.
--
-- The signatures are matched whole, anchored on the `PL/pgSQL function ` prefix that
-- Postgres writes in front of every frame, so a function called `my_respond_to_tag` does
-- not inherit an exemption by having a longer name.
create or replace function public.answering_a_tag_across_the_boundary()
returns boolean
language plpgsql
stable
as $fn$
declare v_stack text;
begin
  get diagnostics v_stack = pg_context;
  return v_stack like '%PL/pgSQL function respond_to_tag(uuid,boolean) line %'
      or v_stack like '%PL/pgSQL function respond_to_memory_tag(uuid,boolean) line %';
end
$fn$;

revoke all on function public.answering_a_tag_across_the_boundary() from public;
revoke all on function public.answering_a_tag_across_the_boundary() from anon, authenticated;

comment on function public.answering_a_tag_across_the_boundary() is
  '0293. True when the PL/pgSQL call stack contains respond_to_tag or '
  'respond_to_memory_tag — the two writers whose whole purpose is to cross a space '
  'boundary, because a tag is answered by the person it is about and they are in their '
  'own space. Read only by refuse_write_outside_my_space(), and only after the '
  'membership check has already failed.';

create or replace function public.refuse_write_outside_my_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_new uuid;
begin
  -- NO CALLER, NO BOUNDARY TO CHECK. service_role, cron, migration replay, db-bootstrap.
  -- Refusing here would refuse the importer and the photo gateway, not an intruder
  -- (header §"WHAT MUST NOT BE GUARDED", 1).
  if v_uid is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op <> 'INSERT' then v_old := old.space_id; end if;
  if tg_op <> 'DELETE' then v_new := new.space_id; end if;

  -- THE ROW YOU ARE TOUCHING must be in a space you are in. This is the exploit: for
  -- `edit_visit` as Josh against Erica's visit, v_old is her space and he is not in it.
  if v_old is not null
     and not exists (select 1 from public.space_memberships m
                      where m.space_id = v_old and m.profile_id = v_uid)
     and not public.answering_a_tag_across_the_boundary() then
    raise exception 'that row is not in a space you are in'
      using errcode = '42501',
            detail  = format('%s on public.%s: row space %s, caller %s',
                             tg_op, tg_table_name, v_old, v_uid),
            hint    = 'a space is the boundary (0289); a writer names it (0293)';
  end if;

  -- AND THE ROW YOU ARE LEAVING BEHIND. Checked separately so that neither writing a new
  -- row into someone else's space, nor pushing one of yours across into theirs, is a way
  -- around the clause above.
  if v_new is not null and v_new is distinct from v_old
     and not exists (select 1 from public.space_memberships m
                      where m.space_id = v_new and m.profile_id = v_uid)
     and not public.answering_a_tag_across_the_boundary() then
    raise exception 'that row would land in a space you are not in'
      using errcode = '42501',
            detail  = format('%s on public.%s: target space %s, caller %s',
                             tg_op, tg_table_name, v_new, v_uid),
            hint    = 'a space is the boundary (0289); a writer names it (0293)';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$fn$;

revoke all on function public.refuse_write_outside_my_space() from public;
revoke all on function public.refuse_write_outside_my_space() from anon, authenticated;

comment on function public.refuse_write_outside_my_space() is
  '0293. Refuses a write to a row outside the caller''s space. Stands down when there is '
  'no caller (auth.uid() is null: service_role, cron, migration replay) and when '
  'respond_to_tag / respond_to_memory_tag are on the call stack. Attached by 0293 to every '
  'base table carrying a space_id except space_memberships and invites.';

-- ---------------------------------------------------------------------------
-- 2. THE TRIGGERS. Discovered, not listed — every base table that carries a `space_id`,
--    minus the two named exclusions. Discovery rather than a literal list because
--    `scripts/db-test.sh` replays this file into an EMPTY schema built by the whole chain,
--    and a literal list would have to be right about a table set this file does not own;
--    and because a table added by 0294 should arrive guarded rather than arrive forgotten.
--
--    Trigger order is immaterial: the guard raises, and a raise takes the whole statement
--    with it including whatever another BEFORE trigger already did.
-- ---------------------------------------------------------------------------

do $do$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_namespace nsp on nsp.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'space_id'
                         and a.attnum > 0 and not a.attisdropped
     where nsp.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname not in (
         -- YOU JOIN A SPACE YOU ARE NOT YET IN (header §"WHAT MUST NOT BE GUARDED", 3).
         -- `space_memberships` is the row that makes the guard pass, so guarding its own
         -- creation is a closed loop with nobody inside it: `ensure_profile_space()` writes
         -- it from a trigger on `profiles` for a person who is, at that instant, in no
         -- space at all.
         'space_memberships',
         -- `claim_invite()` runs as a brand-new user with no space and updates an
         -- `invites` row that lives in the INVITER's space — the one write whose whole
         -- purpose is to cross a boundary the caller has not been let through yet. Its
         -- authorisation is the email on the invite matching the JWT's, which is narrower
         -- than a space check, not looser.
         'invites'
       )
     order by c.relname
  loop
    execute format(
      'drop trigger if exists refuse_write_outside_my_space on public.%I', r.tbl);
    execute format(
      'create trigger refuse_write_outside_my_space
         before insert or update or delete on public.%I
         for each row execute function public.refuse_write_outside_my_space()', r.tbl);
    n := n + 1;
  end loop;

  raise notice '0293: guarded % space-owned table(s)', n;

  -- AT MOST, NEVER EXACTLY. `scripts/db-test.sh` replays from an empty schema where a
  -- production count is meaningless, and an "expected exactly N" assertion has broken CI
  -- in this repository twice. The only thing worth asserting here is the direction that
  -- would be a bug: a table carrying a space_id that ended up with no trigger on it.
  if exists (
    select 1
      from pg_class c
      join pg_namespace nsp on nsp.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'space_id'
                         and a.attnum > 0 and not a.attisdropped
     where nsp.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname not in ('space_memberships', 'invites')
       and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid
                          and t.tgname = 'refuse_write_outside_my_space')
  ) then
    raise exception '0293: a space-owned table was left unguarded';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3. THE TWO THAT CROSS ON PURPOSE — asserted, so the reason is not only a comment.
--
--    The mechanism is `public.answering_a_tag_across_the_boundary()` above; this section
--    exists so that the two signatures it names are checked to EXIST with exactly those
--    argument types. A `like` pattern against a call stack fails open if the function it
--    names was renamed or its signature changed: the pattern would simply never match,
--    the exemption would silently stop applying, and answering a tag across a household
--    would start refusing with a 42501 that nobody could trace back to here.
--
--    Josh, in Josh's space, answers a claim Erica made about him. The claim row and the
--    `memory_people` rows it accepts are in HERS. Authorisation is an identity, not a
--    space: `if c.profile_id <> auth.uid() then raise 'only the tagged person can answer
--    a tag'` — which admits exactly one person and is strictly narrower than a space
--    check, not looser. `supabase/tests/0213_josh_gets_asked.test.sql` is that feature.
--    `respond_to_memory_tag` is the same shape, keyed on `people.linked_profile =
--    auth.uid()`.
-- ---------------------------------------------------------------------------

do $do$
declare missing text;
begin
  select string_agg(sig, ', ' order by sig) into missing
    from unnest(array['public.respond_to_tag(uuid,boolean)',
                      'public.respond_to_memory_tag(uuid,boolean)']) sig
   where to_regprocedure(sig) is null;
  if missing is not null then
    raise exception '0293: the cross-space exemption names %, which does not exist with that signature. The stack pattern would never match and answering a tag across a household would start refusing.', missing;
  end if;
end
$do$;

commit;
