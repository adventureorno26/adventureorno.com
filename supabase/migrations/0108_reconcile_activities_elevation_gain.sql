-- 0108 — Reconcile schema drift: activities.elevation_gain exists in production
-- (written by supabase/functions/_shared/strava.ts as a.total_elevation_gain) but no
-- migration creates it — added out-of-band, exactly like places.address / suggested
-- (reconciled in 0098). This ADDITIVE, idempotent migration adds it so the
-- migration-built schema matches production and generated types stay accurate.
-- No-op in production (column already exists).
--
-- ROLLBACK: alter table public.activities drop column if exists elevation_gain;

alter table public.activities add column if not exists elevation_gain double precision;
