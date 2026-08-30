-- 0279 — the 15 proposed participations become accepted, because they are already history.
--
-- Erica, 2026-08-30: *"I do not want you to go back and ask permission for the 55 he is
-- already included on — just mark it that he accepted the tag."*
--
-- WHAT THESE ROWS ACTUALLY ARE, checked before changing them rather than assumed. They are
-- NOT one person tagging another and waiting for an answer:
--
--   * `tagged_by` is NULL on all 15 — no person raised them; the app created them;
--   * `rule_id` is NULL on all 15 — they did not come from a tagging rule either;
--   * `evidence` is 'unknown' on all 15;
--   * all 15 are `kind='visit'`, 8 naming Erica and 7 naming Josh;
--   * the places are 934 South Denver Street, Red Iguana, Wolf Gap Campground and three
--     still called "New place".
--
-- So they are the app's own guess that both members were on a visit, left in `proposed`
-- where nobody would ever answer them — the asking path only surfaces claims a PERSON made.
-- They would have sat there forever, and meanwhile they COUNT: `people_memory_keys` returns
-- them, so six of the 164 shared keys between the two of them are unanswered guesses.
--
-- Accepting them is the owner's call and she has made it. What this file does NOT do is
-- pretend a decision was made by the person: `decided_by` stays NULL, and `evidence` stays
-- 'unknown', so the record still says these were never actually confirmed by Josh or Erica.
-- `participation_status` changes and nothing else. The undo is the same predicate: set any row
-- with `tagged_by is null` and `evidence = 'unknown'` back to 'proposed'.
--
-- SCOPE: only rows that are `proposed` today, only for people linked to a profile. A future
-- proposal raised by a real person is untouched and still has to be answered.

begin;

-- `memory_people` has no surrogate key; it is keyed by (subject_id, person_id).
create temp table accepted_now as
  select mp.subject_id, mp.person_id
    from public.memory_people mp
    join public.people pe on pe.id = mp.person_id
   where mp.participation_status = 'proposed'
     and pe.linked_profile is not null
     and mp.tagged_by is null;

do $$
declare n int;
begin
  select count(*) into n from accepted_now;
  -- Bounded, not exact: an empty schema replay has none of these, and CI replays this file
  -- from nothing. What must never happen is accepting a bigger set than was inspected.
  if n > 15 then
    raise exception 'expected at most 15 machine-proposed participations, found % — inspect before accepting', n;
  end if;
end $$;

update public.memory_people mp
   set participation_status = 'accepted'
  from accepted_now a
 where mp.subject_id = a.subject_id
   and mp.person_id  = a.person_id;

do $$
declare n int;
begin
  -- No machine-proposed participation may survive.
  select count(*) into n
    from public.memory_people mp
    join public.people pe on pe.id = mp.person_id
   where mp.participation_status = 'proposed'
     and pe.linked_profile is not null
     and mp.tagged_by is null;
  if n <> 0 then raise exception '% machine-proposed participation(s) left', n; end if;

  -- And a claim a PERSON raised must still be waiting. This is the line that keeps the
  -- asking path meaningful: accepting history is not the same as abolishing consent.
  if exists (
    select 1 from public.memory_people
     where participation_status = 'proposed' and tagged_by is not null
  ) then
    raise notice 'person-raised proposals remain, as intended';
  end if;
end $$;

commit;
