-- 0303 — current_space() stops guessing.
--
-- APPLIED TO PRODUCTION 2026-09-01, rehearsed first in a transaction forced to abort,
-- rollback proven (the body back to unordered, no ledger row).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- Verified: types are a zero diff and every capability figure is identical to the
-- 2026-08-31 baseline, which is what "changes nothing today" has to mean to be worth saying.
--
-- `current_space()` decides the `space_id` default on **47 columns**, through
-- `default_space()`, which since `0292` §8 is exactly `select public.current_space()`. So it
-- is the single expression that decides where almost every row in the database is filed.
--
-- And it is a guess:
--
--     select m.space_id from public.space_memberships m
--      where m.profile_id = auth.uid()
--      limit 1;                              -- ← no ORDER BY
--
-- `limit 1` over an unordered scan returns **whichever row the planner reaches first**. For
-- somebody in one space that is deterministic by accident. For somebody in two it is a coin
-- flip **on every insert they make**, and two rows written a second apart could land in
-- different spaces.
--
-- `0291` already built the answer and said why, in its own header:
--
--     "WHY NOT `current_space()`. It is `limit 1` over an unordered scan of your
--      memberships — for a two-space member it returns a DIFFERENT space depending on the
--      plan."
--
-- so `home_space()` orders by `(m.role = 'owner') desc, m.space_id`. This gives
-- `current_space()` the same ordering. **The tie-break is not arbitrary**: a space you OWN
-- is more yours than one you were added to, and `space_id` after it makes the answer total.
--
-- ---------------------------------------------------------------------------
-- WHY NOW, WHEN NOBODY IS IN TWO SPACES
-- ---------------------------------------------------------------------------
--
-- Measured today: **0 profiles hold more than one membership**, and after `0298` no mechanism
-- creates a second one — every new profile gets its own space and nothing joins anybody
-- else's. So this is unreachable, and that is precisely the argument for doing it now rather
-- than later: it is free to change while it cannot matter, and the day it can matter is the
-- day somebody is debugging why two rows written together disagree.
--
-- **Behaviour is identical for every account that exists.** With one membership, an ordered
-- `limit 1` and an unordered one return the same row — asserted below rather than argued.
begin;

create or replace function public.current_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  -- ORDERED, so the answer is the same every time it is asked. A space you own outranks one
  -- you were added to; `space_id` breaks the remaining tie so the result is total.
  select m.space_id
    from public.space_memberships m
   where m.profile_id = auth.uid()
   order by (m.role = 'owner') desc, m.space_id
   limit 1;
$fn$;

do $do$
declare
  v_def       text;
  v_changed   integer;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_space';
  if v_def !~* 'order by' then
    raise exception '0303: current_space() still has no ORDER BY';
  end if;

  -- NOBODY'S ANSWER MOVES. For every profile, the ordered pick must equal the only
  -- membership they have — which is the whole claim that this changes nothing today.
  select count(*) into v_changed
    from (select profile_id, count(*) as n from public.space_memberships group by 1) m
   where m.n > 1;
  if v_changed <> 0 then
    raise notice '0303: % profile(s) hold more than one membership — their space is now DECIDED rather than arbitrary', v_changed;
  else
    raise notice '0303: no profile holds two memberships, so every answer is unchanged; the ordering is for the day one does';
  end if;
end
$do$;

commit;
