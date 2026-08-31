-- 0300 — a tag finds the person it is about.
--
-- APPLIED TO PRODUCTION 2026-08-31, through `apply-migration.mjs`. Rehearsed against
-- production first in a transaction forced to abort, with the rollback proven (the body
-- back to reading `in_space_*`, no ledger row).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- IT HAD AN EFFECT ON THE FIRST DAY, which was not expected — the assumption was that this
-- was infrastructure for item 7b with no live case. Measured immediately after applying:
--
--     Erica 0 tags · Josh 2 tags · Test Bot 0 tags
--
-- **Josh has two questions waiting that he could never see.** Both are `visit` tags in
-- Erica's space, created 2026-08-30 22:14 and 22:54, and both were made by NOBODY —
-- `tagged_by` is null and `evidence` is `unknown`, so they are the app's own guess that he
-- was there. That is the shape §finding 15 named: *"parked where the asking screen could
-- never surface them"*. They are surfaced now.
--
-- ⚠️ HOW THOSE TWO SHOULD BE TREATED IS ERICA'S CALL, not this file's. `0279` set a
-- precedent for the previous fifteen of exactly this kind — *"I do not want you to go back
-- and ask permission for the 55 he is already included on — just mark it that he accepted
-- the tag"* — but that was an instruction about a specific set, not a standing rule, so
-- nothing here decides for her. They simply stopped being invisible.
--
-- Every capability measurement is byte-identical to the morning baseline across 0293–0300.
--
-- The first step of item 7b, and the smallest one: without it nothing else in 7b can be
-- observed, because the person being tagged cannot see that they have been.
--
-- ---------------------------------------------------------------------------
-- THE DOOR OPENS AND NOBODY CAN FIND THE HANDLE
-- ---------------------------------------------------------------------------
--
-- `0290` rewrote the tag inbox to read the space-scoped views:
--
--     from public.in_space_memory_people mp
--     join public.in_space_memory_subjects s on s.id = mp.subject_id
--     join public.in_space_people pe on pe.id = mp.person_id
--    where pe.linked_profile = auth.uid() and mp.participation_status = 'proposed'
--
-- and each `in_space_*` view ends in `where space_id in (select public.my_space_ids())`.
--
-- When Ann tags Ben, the `memory_people` row belongs to Ann's space — the subject is hers,
-- and `0295` files a participation with its subject deliberately, so that `0292` §10(a)'s
-- invariant holds and nothing points across the boundary. Ben is not a member of Ann's
-- space. **So the row is filtered out and Ben's inbox returns zero rows, for ever.**
--
-- The ANSWERING side is already right and has been since `0248`. `respond_to_memory_tag`
-- reads the RAW tables and authorises on identity:
--
--     where mp.subject_id = p_subject and pe.linked_profile = auth.uid()
--
-- `0293` exempts it from the cross-space write guard for exactly this reason, and its header
-- says why in one line: *"reading someone else's card is not something you do TO their space
-- — answering a tag is."* So the door opens. Nobody can find the handle.
--
-- ---------------------------------------------------------------------------
-- WHY IDENTITY IS THE RIGHT KEY HERE, AND NOT A HOLE
-- ---------------------------------------------------------------------------
--
-- A space check asks *are you inside this history*. That is the correct question for
-- reading somebody's map and the wrong one for **a question addressed to you by name**. The
-- predicate `pe.linked_profile = auth.uid()` admits **exactly one person** — the one the tag
-- is about — which is strictly NARROWER than membership of a space, not looser. It is the
-- same authorisation `respond_to_memory_tag` already applies to the write.
--
-- WHAT CROSSES THE BOUNDARY, chosen deliberately and listed so it can be argued with:
--
--     subject_id · kind · photo_id · the tagger's display_name · when they tagged you
--
-- and nothing else. Not the place, not the distance, not the name of the card, not the
-- photograph — `photo_id` is an identifier, and reading the photo behind it is separately
-- RLS'd, so it stays refused. This is the minimum that lets somebody answer *"Ann says you
-- were on an outing on the 14th"*, which is the whole purpose of an inbox.
--
-- IT IS ALSO THE SAME SHAPE AS BEFORE. The signature does not move, so `lib/memoryPeople.ts`
-- and the Tag approvals section on Data & Privacy are untouched; a WITHIN-space tag returns
-- exactly the row it returned yesterday. What changes is only that a tag from outside your
-- space stops being invisible.
--
-- ⚠️ NOT DONE HERE: `my_tags_to_confirm()`, the older `tag_claims` inbox. It is space-scoped
-- in the same way AND it inner-joins `visible_activities`, `in_space_places` and
-- `in_space_tagging_rules` to show the card's name, distance and place — so a cross-space
-- claim is not merely filtered out, it is dropped by the join. Fixing it means deciding how
-- much of somebody else's card you may see before you accept it, which is a question worth
-- asking rather than answering in passing. The live Tag approvals screen uses
-- `my_memory_tags_to_confirm` (`app/src/lib/memoryPeople.ts`), not this one.
begin;

create or replace function public.my_memory_tags_to_confirm()
returns table(subject_id uuid, kind text, photo_id uuid, tagged_by text, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $fn$
  -- RAW tables, not the in_space_* views. The key is the identity the tag names, which
  -- admits exactly one person; see the header.
  select s.id, s.kind, s.photo_id, who.display_name, mp.created_at
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id
    join public.people pe on pe.id = mp.person_id
    left join public.profiles who on who.id = mp.tagged_by
   where pe.linked_profile = auth.uid()
     and mp.participation_status = 'proposed'
   order by mp.created_at desc;
$fn$;

do $do$
declare v_def text;
begin
  -- COMMENTS STRIPPED FIRST, and that is not fussiness: the first draft of this block
  -- failed on its own explanatory comment, which contains the literal `in_space_`. An
  -- assertion that reads prose is asserting the wrong thing.
  select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    into v_def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_memory_tags_to_confirm';

  if v_def like '%in_space_%' then
    raise exception '0300: the inbox still reads a space-scoped view, so a cross-account tag stays invisible';
  end if;
  -- The identity check is the ONLY thing standing between one person's inbox and another's.
  if v_def not like '%pe.linked_profile = auth.uid()%' then
    raise exception '0300: the identity predicate is gone — this would show everybody every proposed tag';
  end if;
  if v_def not like '%proposed%' then
    raise exception '0300: the inbox no longer filters to proposed tags';
  end if;

  raise notice '0300: a proposed tag now reaches the person it names, whichever space it lives in';
end
$do$;

commit;
