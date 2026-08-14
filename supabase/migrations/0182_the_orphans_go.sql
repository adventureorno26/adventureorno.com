-- 0182 — §0.8 phase 8, step 1 of 5: the orphan tables.
--
-- Phase 8 is the removal phase, and it runs "only after explicit production sign-off".
-- Signed off 2026-08-14. It is deliberately FIVE migrations, smallest and most provable
-- first, because a removal that turns out to be wrong is the expensive kind of mistake:
-- the sequence and its preconditions are recorded in §0.8a of docs/STATE.md.
--
-- THIS STEP IS THE ONE WITH NOTHING TO ARGUE ABOUT. Measured on production first:
--
--   trip_people    0 rows
--   trip_notes     0 rows
--   inbound foreign keys to either: none
--   functions referencing them: add_trip_note, delete_trip_note — and nothing calls
--                               those either, in the app or in an Edge Function
--
-- They are the last structural remnants of the retired trip-as-a-table model (§0.1: a
-- trip is a qualifying VISIT, never a table). Keeping empty tables around is not free —
-- they show up in the generated types, in backups, in the restore path, and in every
-- future audit of "what holds trip data", which is exactly the confusion §0 exists to
-- end.
--
-- ROLLBACK: the table definitions and both functions are in git history. They contain
-- no data to lose — that is the whole point of removing them now rather than later.

begin;

drop function if exists public.add_trip_note(uuid, date, text);
drop function if exists public.delete_trip_note(uuid);

drop table if exists public.trip_notes;
drop table if exists public.trip_people;

commit;
