-- 0293 — removing someone is a decision, not an erasure.
--
-- DRAFT — NOT APPLIED. Nothing in this file has been run against production at all, not
-- even inside a rolled-back transaction, and the distinction matters enough to spell out:
--
--   REHEARSED, on a DISPOSABLE LOCAL STACK, by replaying the whole chain from an empty
--   schema with `scripts/db-test.sh`. All 293 migrations applied cleanly with this file in
--   place, which means its own `do $check$` block passed — three writers rewritten, no
--   writer still deleting a participation, both views excluding retracted rows, and 0290's
--   `is_member(space_id)` predicate intact. Every one of the ~45 existing SQL tests still
--   passed, and `0293…test.sql` proved the rule end to end, tie-breaker included.
--
--   NOT REHEARSED AGAINST PRODUCTION. The repo's usual `begin … rollback` dress rehearsal
--   executes DDL on the live database, and that was not run here. So what is proven is that
--   this migration is correct against the migration chain — NOT that the three live
--   function bodies still match what it expects. They are read at apply time and asserted
--   (see below), so a mismatch fails loudly instead of half-applying; but the person
--   applying it should run the production rehearsal first anyway.
--
-- Erica, 2026-08-30: *"we need to figure out a way to keep the stats if I approve a tag
-- someone else has made and then they defriend me or untag me."* §"AN ACCEPTED TAG IS MINE"
-- approved the shape; this is its FIRST HALF ONLY — *"`set_visit_participants` and
-- `set_activity_solo` must retract, not delete, so that removal is a decision with a record
-- rather than an erasure. Photos are already the model to copy."*
--
-- The second half — acceptance materialising the accepter's OWN activity row in the same
-- `shared_group_id` — is NOT here. It is a different change with a different risk, and
-- landing them together would make one rollback impossible without the other.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT MAKES THIS FIVE OBJECTS INSTEAD OF THIRTY-FOUR
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NOTHING FILTERS PARTICIPATION BY STATUS TODAY. Of the 41 readers of `visit_profiles` and
-- `activity_profiles`, THIRTY-FOUR never mention `claim_status` at all. So a migration that
-- marks rows `retracted` and stops there leaves a removed person counting in every
-- statistic — the exact opposite of what removal means, and the 0280 defect class again
-- (two screens, one label, different numbers).
--
-- Since 0266 those two names are VIEWS over `memory_people`, not tables. Adding one
-- predicate to each view corrects all 41 readers at once. That single line is the whole
-- reason this is tractable, and it is why the views are recreated here even though nothing
-- about their columns changes.
--
-- `memory_people`'s CHECK already allows the value —
-- ('proposed','accepted','accepted_legacy','declined','retracted') — so no constraint moves.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PREFLIGHT, RUN AGAINST PRODUCTION AND CLEAR (2026-08-30)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   npm run check:retraction-preflight        (read-only)
--
--     outing  accepted 653   accepted_legacy 88
--     visit   accepted 887   proposed 4
--     rows the view filter would hide:  NONE
--
-- So the new view predicate changes NO existing number. It only affects removals made
-- after this is applied. Had that count been non-zero, this migration would have moved
-- Erica's live statistics silently, which is why the number was taken first.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE FUNCTIONS ARE REWRITTEN FROM THE LIVE BODY RATHER THAN RETYPED
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 0266's own standard: *"every one was matched against the live definition exactly once
-- before being replaced… a generated migration that silently rewrites thirteen functions
-- and not the fourteenth compiles perfectly and means something else."*
--
-- These three bodies are ~100 lines each and 0290 has already rewritten parts of them to
-- carry `space_id`. Retyping them here would mean this file drifts from production the
-- moment anything else touches them, and a transcription slip would be invisible.
--
-- So this migration does NOT contain the function bodies. It reads each one with
-- `pg_get_functiondef`, ASSERTS the exact text it intends to change appears exactly once,
-- rewrites that fragment, and executes the result. If any function has moved on, the
-- assertion raises and the whole migration rolls back rather than half-applying. The
-- transformation is:
--
--     delete from public.memory_people mp        →  update public.memory_people mp
--      using …                                        set participation_status = 'retracted',
--                                                         decided_by = v_me, decided_at = now()
--                                                    from …
--
-- plus a leading `mp.participation_status <> 'retracted'` so re-running a removal does not
-- re-stamp `decided_at`, and `v_removed` keeps counting only rows that actually changed.
--
-- WHAT IS DELIBERATELY UNCHANGED: every predicate that decides WHO is removed. The
-- evidence carve-outs stay exactly as they are — a row evidencing somebody's own photo or
-- own recording is still protected, and taking yourself off your own recording is still
-- yours to do (0236, 0258). This migration changes what removal DOES, never who it applies
-- to.

begin;

-- ---------------------------------------------------------------------------
-- 1. The two views stop reporting retracted participations.
-- ---------------------------------------------------------------------------
-- Recreated from their LIVE definitions, verbatim, with one predicate added. The
-- `is_member(s.space_id)` clause is 0290's and is preserved — dropping it here would
-- silently undo the partition for these two names.
create or replace view public.activity_profiles as
  select s.activity_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status when 'declined' then 'rejected'
              else mp.participation_status end as claim_status,
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
     and public.is_member(s.space_id)
     and mp.participation_status <> 'retracted';

create or replace view public.visit_profiles as
  select s.visit_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status when 'declined' then 'rejected'
              else mp.participation_status end as claim_status,
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
     and public.is_member(s.space_id)
     and mp.participation_status <> 'retracted';

comment on view public.visit_profiles is
  'WAS A TABLE until 0266; a view over memory_people. Retracted participations are excluded '
  '(0293) — that one predicate is what lets removal become a retraction without touching the '
  '34 readers here that never look at claim_status.';
comment on view public.activity_profiles is
  'WAS A TABLE until 0266; a view over memory_people. Retracted participations are excluded '
  '(0293), for the same reason as visit_profiles.';

-- ---------------------------------------------------------------------------
-- 2. The three writers retract instead of deleting.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_fn      text;
  v_src     text;
  v_new     text;
  v_hits    int;
  v_changed int := 0;
begin
  foreach v_fn in array array[
    'public.set_visit_participants(uuid, uuid[])',
    'public.set_place_solo(uuid, uuid)',
    'public.set_activity_solo(uuid, uuid)'
  ] loop
    v_src := pg_get_functiondef(v_fn::regprocedure);

    -- THE ASSERTION THAT MAKES THIS SAFE. Exactly one delete, spelled exactly this way.
    v_hits := (length(v_src) - length(replace(v_src, 'delete from public.memory_people mp', '')))
              / length('delete from public.memory_people mp');
    if v_hits <> 1 then
      raise exception
        '0293: expected exactly ONE "delete from public.memory_people mp" in %, found % — '
        'the function has moved on since this migration was written. Re-read the live body '
        'before applying.', v_fn, v_hits;
    end if;
    if position('using public.memory_subjects s, public.people pe' in v_src) = 0 then
      raise exception '0293: % no longer joins memory_subjects/people the expected way', v_fn;
    end if;
    if position('where s.id = mp.subject_id' in v_src) = 0 then
      raise exception '0293: % no longer opens its where clause as expected', v_fn;
    end if;

    v_new := replace(
      v_src,
      'delete from public.memory_people mp',
      'update public.memory_people mp'
      || E'\n     set participation_status = ''retracted'', decided_by = v_me, decided_at = now()');
    -- `delete … using` becomes `update … from`.
    v_new := replace(v_new, E'\n   using public.memory_subjects s', E'\n   from public.memory_subjects s');
    -- Idempotent: never re-stamp a row that is already retracted, so `v_removed` counts
    -- only what actually changed.
    v_new := replace(
      v_new,
      E'\n   where s.id = mp.subject_id',
      E'\n   where mp.participation_status <> ''retracted''\n     and s.id = mp.subject_id');

    if v_new = v_src then
      raise exception '0293: rewrite produced no change for %', v_fn;
    end if;

    execute v_new;
    v_changed := v_changed + 1;
  end loop;

  if v_changed <> 3 then
    raise exception '0293: expected to rewrite 3 functions, rewrote %', v_changed;
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 3. Prove it, in the same transaction that made the change.
-- ---------------------------------------------------------------------------
do $check$
declare
  n int;
begin
  -- No writer may still delete a participation.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('set_visit_participants','set_place_solo','set_activity_solo')
     and pg_get_functiondef(p.oid) like '%delete from public.memory_people%';
  if n <> 0 then
    raise exception '0293: % writer(s) still DELETE a participation', n;
  end if;

  -- All three must now retract.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('set_visit_participants','set_place_solo','set_activity_solo')
     and pg_get_functiondef(p.oid) like '%participation_status = ''retracted''%';
  if n <> 3 then
    raise exception '0293: only % of 3 writers retract', n;
  end if;

  -- And both views must hide retracted rows, or the retraction is invisible and a removed
  -- person keeps counting — the whole point of this file.
  select count(*) into n
    from pg_views
   where schemaname = 'public'
     and viewname in ('visit_profiles','activity_profiles')
     and definition like '%<> ''retracted''%';
  if n <> 2 then
    raise exception '0293: only % of 2 views exclude retracted participations', n;
  end if;

  -- The partition predicate 0290 added must still be there on both.
  select count(*) into n
    from pg_views
   where schemaname = 'public'
     and viewname in ('visit_profiles','activity_profiles')
     and definition like '%is_member(s.space_id)%';
  if n <> 2 then
    raise exception '0293: the is_member(space_id) predicate was lost on % of 2 views', 2 - n;
  end if;
end $check$;

commit;
