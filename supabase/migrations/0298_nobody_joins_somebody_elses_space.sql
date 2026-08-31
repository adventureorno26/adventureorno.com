-- 0298 — nobody joins somebody else's space.
--
-- APPLIED TO PRODUCTION 2026-08-31, through `apply-migration.mjs`. Rehearsed against
-- production first in a transaction forced to abort, with the rollback proven (the counting
-- guess still present, 3 memberships untouched).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- ⚠️ AND IT WAS APPLIED WHILE 13 SQL TESTS WERE RED, which should not have happened. The
-- chain replay and the apply were run in one command and only the tail was read. Production
-- was unaffected — this changes only what happens when a NEW profile is created, and the
-- three existing memberships were verified untouched — but a check and an irreversible step
-- do not belong in the same breath. The 13 are fixed in the same PR; see its body.
--
-- Erica, 2026-08-31, asked which of the two ways in should survive the fork:
-- *"Retire it — tagging is the link. Nobody ever joins someone else's space."* This is that,
-- and it is mostly a matter of making true what is already accidentally true.
--
-- ---------------------------------------------------------------------------
-- THE HAZARD, WHICH IS DEAD TODAY AND LIVE AFTER ANY RESTORE
-- ---------------------------------------------------------------------------
--
-- `ensure_profile_space()` ends with a guess:
--
--     if new.role = 'owner' or (select count(*) from public.spaces) <> 1 then
--       …give them their own space…
--     else
--       select s.id into v_space from public.spaces s limit 1;   -- ← THE space
--       insert into space_memberships (…, case when new.role = 'viewer' …else 'editor' end)
--     end if;
--
-- So **whenever there is exactly one space, any new non-owner profile is silently made an
-- EDITOR of it.** There are two spaces today, so the branch cannot fire — but a restore
-- rebuilds from the chain and a fresh schema has exactly one, and that is precisely the
-- moment nobody is watching. `select … limit 1` with no ORDER BY is the same unordered-scan
-- class as `current_space()`, so which space it picks is not even decided.
--
-- The 0289 comment above it — *"Anyone else joins the single space if there is exactly one
-- (the invite path today); otherwise they get their own, which is never wrong"* — is honest
-- about being a heuristic. It was right for one household. **§THE PARTITION ended the
-- household**, and Josh's editor membership of Erica's space with it: *"Let it end — tagging
-- is the link."* A heuristic that hands a stranger editor rights contradicts that outright.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT CHANGE, said plainly
-- ---------------------------------------------------------------------------
--
-- `claim_invite()` and `approve_join_request()` are NOT dropped and NOT made to raise. Both
-- insert only a `public.profiles` row and never named a space — the membership was always
-- this trigger's doing — so after this migration they do exactly what they already do in
-- practice: decide **who may hold an account**, which is still wanted, while granting
-- membership of nobody's space. The `invites` table keeps its one historical row.
--
-- ⚠️ A UI CONSEQUENCE THIS FILE CANNOT FIX, recorded so it is not discovered by a user.
-- Settings ▸ Data & Privacy still renders `JoinRequestsCard` (`app/src/lib/join.ts`,
-- `approve_join_request`), which offers to approve somebody INTO your space. Approving now
-- gives them their own space instead — the control does not do what it says. That is the
-- exact defect item 6 exists to remove, and it needs an app change, not a migration.
begin;

-- ---------------------------------------------------------------------------
-- 1. Every new profile gets its own space. No exceptions, no counting.
--
--    The FIRST-OWNER branch is kept and is not the same thing: a schema replayed from empty
--    seeds `activity_options`, `place_categories` and `settings` into an unowned space
--    before any profile exists, and the first owner claims that space rather than stranding
--    those rows and starting a second one beside it. That is a bootstrap detail, not a
--    person joining somebody else's history — the space has no owner and no other member.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_profile_space()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_space uuid;
begin
  if exists (select 1 from public.space_memberships m where m.profile_id = new.id) then
    return new;
  end if;

  -- A fresh installation has one UNOWNED space holding the seeded reference rows. The first
  -- owner claims it rather than starting a second one beside it.
  if new.role = 'owner' then
    select s.id into v_space from public.spaces s where s.owner_profile is null
     order by s.created_at limit 1;
    if v_space is not null then
      update public.spaces set owner_profile = new.id,
             name = coalesce(nullif(btrim(new.display_name), ''), 'Home') || '''s space'
       where id = v_space;
      insert into public.space_memberships (space_id, profile_id, role)
      values (v_space, new.id, 'owner') on conflict do nothing;
      return new;
    end if;
  end if;

  -- EVERYBODY ELSE GETS THEIR OWN, and owns it. The old `else` branch — join the single
  -- space if there happens to be exactly one — is gone: see the header. Membership of a
  -- space somebody else owns is now something only a deliberate act can create, and there
  -- is no such act. Tagging is the link.
  insert into public.spaces (name, owner_profile)
  values (coalesce(nullif(btrim(new.display_name), ''), 'Space') || '''s space', new.id)
  returning id into v_space;
  insert into public.space_memberships (space_id, profile_id, role)
  values (v_space, new.id, 'owner') on conflict do nothing;

  return new;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 2. What must be true.
-- ---------------------------------------------------------------------------
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ensure_profile_space';

  -- The guess is gone. Matched on the counting, which is the thing that made it a guess.
  if v_def like '%count(*) from public.spaces%' then
    raise exception '0298: ensure_profile_space still counts spaces to decide where to put somebody';
  end if;

  -- And it can still hand the first owner the seeded space, or a bootstrap replay strands
  -- every reference row.
  if v_def not like '%owner_profile is null%' then
    raise exception '0298: the first-owner branch is gone — a fresh install would strand its seeded rows';
  end if;

  -- Nobody is currently in a space they do not own EXCEPT by a membership that already
  -- exists; this migration creates none and removes none.
  raise notice '0298: % membership(s) untouched; new profiles now always get their own space',
              (select count(*) from public.space_memberships);
end
$do$;

commit;
