-- 0301 — a tag says what it is about.
--
-- APPLIED TO PRODUCTION 2026-08-31, rehearsed against production first in a transaction
-- forced to abort, rollback proven (`are_added` gone, no ledger row).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- Measured after applying: Josh's two waiting tags read `kind=visit · tagged_by=(nobody) ·
-- card=(not named)` — correct on both counts. They were made by the app, so there is nobody
-- he could have added, and they live in a space he is not in. He can still answer them
-- either way, which before 0300 he could not do at all. Every capability figure is identical
-- to the morning baseline across 0293–0301.
--
-- Erica, 2026-08-31, on the copy `0300` shipped: *"I don't want anything to say somewhere you
-- were. You can see the full card if you add someone."*
--
-- Two instructions, and the second answers the question `0300` deliberately left open — how
-- much of somebody else's card you may see before you accept a tag on it. **The answer is
-- the connection.** If you have added them, you see the card. If you have not, you are still
-- told what KIND of thing it is and when, because a question you cannot identify is not a
-- question you can answer.
--
-- ⚠️ THIS AMENDS §7d, and quietly would be the wrong way to do it. The Strava rule says one
-- person does not see another's Strava-origin recordings. Her rule is more permissive for
-- one specific case: a card you are TAGGED ON, by somebody you have ADDED. That is narrower
-- than it sounds — it needs a mutual, accepted connection AND a tag naming you — but it is
-- an amendment and it is recorded here as one rather than left to be discovered in a diff.
--
-- ---------------------------------------------------------------------------
-- WHAT THE INBOX RETURNS NOW
-- ---------------------------------------------------------------------------
--
--   subject_id · kind · photo_id · tagged_by · created_at   (unchanged, from 0300)
--   card                                                     (new)
--
-- `card` is the name of the thing — a place for a visit, the activity's name for an outing —
-- and it is NULL when you are not entitled to it. The UI says the name when there is one and
-- names the KIND when there is not. Nothing anywhere says "somewhere you were".
begin;

-- ---------------------------------------------------------------------------
-- 1. Have these two added each other?
--
--    `connection_adds` is canonically ordered (`profile_low < profile_high`) with a status
--    of pending | accepted | declined, so the question is one lookup with the pair sorted.
--    An add is MUTUAL by construction (§CONNECTING TO SOMEONE) — there is no direction to
--    get wrong, which is why this takes an unordered pair.
-- ---------------------------------------------------------------------------
create or replace function public.are_added(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select exists (
    select 1 from public.connection_adds c
     where c.profile_low  = least(p_a, p_b)
       and c.profile_high = greatest(p_a, p_b)
       and c.status = 'accepted')
     and p_a is distinct from p_b;
$fn$;
revoke all on function public.are_added(uuid, uuid) from public, anon;
grant execute on function public.are_added(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The inbox names the card, when you are entitled to it.
--
--    Entitlement is `is_member(subject's space)` OR `are_added(you, the tagger)`. The first
--    is the old world and changes nothing for a tag inside your own space. The second is her
--    rule.
--
--    A machine-made tag has `tagged_by = NULL` — the app's own guess (§finding 15). There is
--    nobody to have added, so `are_added` is false and the card stays unnamed unless you are
--    in its space. That is the right answer: an assertion nobody made is not somebody
--    sharing something with you.
-- ---------------------------------------------------------------------------
-- DROP first: adding an OUT column changes the row type, and `create or replace` refuses
-- that ("cannot change return type of existing function"). Dropping and recreating inside
-- one transaction is atomic — no window exists where the function is missing.
drop function if exists public.my_memory_tags_to_confirm();

create function public.my_memory_tags_to_confirm()
returns table(subject_id uuid, kind text, photo_id uuid, tagged_by text,
              created_at timestamptz, card text)
language sql stable security definer set search_path to 'public' as $fn$
  select s.id, s.kind, s.photo_id, who.display_name, mp.created_at,
         case
           when public.is_member(s.space_id)
             or (mp.tagged_by is not null and public.are_added(auth.uid(), mp.tagged_by))
           then nullif(btrim(coalesce(act.name, pl.name, '')), '')
           else null
         end as card
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id
    join public.people pe on pe.id = mp.person_id
    left join public.profiles who on who.id = mp.tagged_by
    left join public.activities act on act.id = s.activity_id
    left join public.visits v on v.id = s.visit_id
    left join public.places pl on pl.id = v.place_id
   where pe.linked_profile = auth.uid()
     and mp.participation_status = 'proposed'
   order by mp.created_at desc;
$fn$;

-- The grants went with the dropped function.
revoke all on function public.my_memory_tags_to_confirm() from public, anon;
grant execute on function public.my_memory_tags_to_confirm() to authenticated, service_role;

do $do$
declare v_def text;
begin
  select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_memory_tags_to_confirm';

  if v_def like '%in_space_%' then
    raise exception '0301: 0300 was undone — the inbox is space-scoped again';
  end if;
  if v_def not like '%pe.linked_profile = auth.uid()%' then
    raise exception '0301: the identity predicate is gone';
  end if;
  -- The card must be GATED. Returning it unconditionally would hand every tagged person the
  -- name of a card belonging to somebody they have never connected to.
  if v_def not like '%are_added%' or v_def not like '%is_member(s.space_id)%' then
    raise exception '0301: the card name is not gated on space membership or an add';
  end if;

  raise notice '0301: the inbox names the card when you share a space or have added them';
end
$do$;

commit;
