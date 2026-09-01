-- 0302 — a grant nothing can use.
--
-- APPLIED TO PRODUCTION 2026-09-01, rehearsed against production first in a transaction
-- forced to abort, rollback proven (all six dead grants back, no ledger row).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- Re-running the seven attacks afterwards: three now fail at the GRANT level with `42501
-- permission denied` instead of being silently filtered to zero rows — a louder no, and the
-- point of the change. The other four are still RLS-filtered to zero, which is correct.
-- Types are a zero diff and every capability figure is identical to the 2026-08-31 baseline.
--
-- `0293`'s header named an audit and asked that it not be lost:
--
--     "Ten tables carry no `space_id` and cannot be guarded by this mechanism. 'A space is
--      not the right question here' is not the same sentence as 'this one is safe'."
--
-- This is that audit. **The answer is that all ten are protected** — and the interesting
-- part is what it took to establish that, plus the dead grants it turned up on the way.
--
-- ---------------------------------------------------------------------------
-- THE AUDIT, MEASURED ON PRODUCTION AS JOSH — AN EDITOR, IN NEITHER OF ERICA'S ROLES
-- ---------------------------------------------------------------------------
--
--   connection_adds · connection_blocks · connection_follows   SELECT-only grant. Every
--       write goes through a SECURITY DEFINER function. Safe.
--   oauth_states      No grant to `authenticated` at all, RLS on, and NO policies. Nothing
--       but `service_role` can see or touch it. Safe, and the strictest of the ten.
--   service_health    SELECT-only grant.
--   job_runs          `is_member()` to read.
--   join_requests     INSERT/SELECT/UPDATE constrained to your own row.
--   invite_codes      Readable by its issuer or the owner. `role` has a CHECK admitting
--       only `editor|viewer`, so a redeemed code CANNOT mint a global owner — which is what
--       makes the `profiles` note below a constraint to preserve rather than a live hole.
--   profiles          Writes gate on `is_owner()`.
--   spaces            `is_owner(id)` — the space-scoped variant. Safe.
--
-- Seven attacks were run as Josh, each in a rolled-back transaction: delete every
-- `job_runs` row, rename and delete Erica's space, update and delete Erica's PROFILE, wipe
-- `join_requests`, rewrite every invite code. **All seven touched zero rows.**
--
-- ⚠️ AND THE FIRST VERSION OF THAT PROBE SAID THE OPPOSITE, which is the part worth keeping.
-- It asked "did the statement error?" — and five of the seven did not, so it reported
-- ACCEPTED and would have raised a false alarm on the most alarming thing in the database.
-- **An UPDATE or DELETE that RLS filters to nothing SUCCEEDS.** It returns without error and
-- changes nothing. `0293`'s own test was caught by this exact shape from the other side:
-- *"the assertion passed without ever looking at the row."* Count the rows, never the
-- absence of an error.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE CHANGES: THREE DEAD GRANTS
-- ---------------------------------------------------------------------------
--
-- `authenticated` holds INSERT/UPDATE/DELETE on tables that have **no policy for those
-- commands**, so RLS refuses every one. The grants are unreachable — which is why removing
-- them cannot change behaviour, and why they are worth removing anyway: they are one
-- forgotten `create policy` away from being live, and the next person writing a policy will
-- not know a grant is already waiting underneath it.
--
--     invite_codes    INSERT, UPDATE, DELETE   (only a SELECT policy exists)
--     job_runs        INSERT, UPDATE, DELETE   (only a SELECT policy exists)
--     join_requests   DELETE                   (INSERT/SELECT/UPDATE have policies; DELETE does not)
--
-- Checked before touching anything: **the app never writes any of them.** `join.ts` upserts
-- `join_requests` (INSERT/UPDATE, kept) and the three `profiles` call sites in
-- `AuthProvider.tsx`, `lastSeen.ts` and `people.ts` are all `.select()`.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT CHANGE
-- ---------------------------------------------------------------------------
--
-- **`profiles` writes gate on `is_owner()` — the GLOBAL role, not a space.** So a second
-- profile with `role = 'owner'` could update or delete EVERY profile row, Erica's included.
-- It is not reachable today and the audit says why in three steps: exactly one profile is
-- `role='owner'`; `invite_codes.role` has a CHECK admitting only `editor|viewer`; and
-- `approve_join_request` raises on any role but those two. **So the only way to a second
-- global owner is Erica deliberately making one.** That is a constraint to preserve, not a
-- hole to close, and §3 below fails the build if the CHECK that guarantees it is ever
-- dropped. Narrowing `profiles` to a space cannot be done the way the other 46 tables were —
-- it has no `space_id` and cannot have one, because a profile is what a space is made OF.
--
-- **`job_runs` and `service_health` read on `is_member()` with no argument.** After the
-- partition that means *in at least one space*, so a third account will read every job run
-- and all 12,726 service-health rows. It is infrastructure telemetry — no place, no person,
-- no date anybody visited — but it IS cross-space by design and it should be a decision
-- rather than something discovered later. Recorded, not changed.
begin;

revoke insert, update, delete on public.invite_codes  from authenticated;
revoke insert, update, delete on public.job_runs      from authenticated;
revoke delete                 on public.join_requests from authenticated;

do $do$
declare v_bad text;
begin
  -- 1. The grants are gone.
  select string_agg(format('%s:%s', table_name, privilege_type), ', ' order by table_name)
    into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and ((table_name in ('invite_codes','job_runs') and privilege_type in ('INSERT','UPDATE','DELETE'))
       or (table_name = 'join_requests' and privilege_type = 'DELETE'));
  if v_bad is not null then
    raise exception '0302: a dead grant survived — %', v_bad;
  end if;

  -- 2. AND THE LIVE ONES ARE STILL THERE. Revoking too much is the failure mode here:
  --    `join.ts` upserts a join request, so INSERT and UPDATE must survive.
  if not exists (select 1 from information_schema.role_table_grants
                  where table_schema='public' and grantee='authenticated'
                    and table_name='join_requests' and privilege_type='INSERT')
     or not exists (select 1 from information_schema.role_table_grants
                     where table_schema='public' and grantee='authenticated'
                       and table_name='join_requests' and privilege_type='UPDATE') then
    raise exception '0302: join_requests lost the INSERT/UPDATE that lib/join.ts needs';
  end if;

  -- 3. THE CONSTRAINT THAT KEEPS `profiles` SAFE. An invite must never be able to mint a
  --    global owner; if this CHECK is ever widened, the is_owner() note above stops being
  --    a note and becomes a hole.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invite_codes'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%role%'
       and pg_get_constraintdef(oid) like '%editor%'
       and pg_get_constraintdef(oid) not like '%owner%') then
    raise exception '0302: invite_codes.role no longer excludes owner — a redeemed code could mint a global owner';
  end if;

  raise notice '0302: three dead grants removed; the live ones and the owner CHECK are intact';
end
$do$;

commit;
