-- 0098 — Reconcile schema drift: places.address and places.suggested exist in
-- production but are created by NO migration (added out-of-band historically).
-- A fresh `supabase db reset` therefore fails at 0044 (which backfills city from
-- places.address). This ADDITIVE, idempotent migration adds them so the
-- migration-built schema matches production — enabling type generation from a
-- disposable database (see scripts/db-bootstrap.sh) and CI schema-drift checks.
--
-- In production both already exist → `if not exists` makes this a no-op there.
-- It does NOT make native `supabase db reset` succeed (0001's check_function_bodies
-- and 0044's mid-chain address dependency still block strict in-order apply — see
-- docs/decisions.md; the long-term fix is a re-baseline). Use the bootstrap script.
--
-- ROLLBACK:
--   alter table public.places drop column if exists suggested;
--   alter table public.places drop column if exists address;

alter table public.places add column if not exists address text;
alter table public.places add column if not exists suggested boolean not null default false;
