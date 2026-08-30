-- 0273 — `places.visit_count` stops being a cache nobody updates.
--
-- 0271 repaired one stale mirror. 0272 repaired two more that appeared the moment two
-- visits were deleted, because `delete_visit` never touched the column. Forty minutes
-- later a third appeared — Red Iguana, stored 1 against 2 real visits — from a visit
-- added through the app while the session was still open. Nothing was deleted that time.
--
-- So the diagnosis in 0272 was too narrow. It is not `delete_visit`: **nothing maintained
-- this column in either direction.** There were four triggers on `visits` and not one of
-- them touched `visit_count`; every writer was a backfill in an old migration (0003, 0009,
-- 0010, 0015, 0097, 0117, 0190, 0240, 0260), each correct on the day it ran and stale by
-- the next visit. Repairing the number a fourth time would have been the fourth time.
--
-- 0272 deliberately left the choice open — maintain the column, or retire it — because
-- `visit_count` decides which place survives a merge and that is a decision about the data
-- model. This file takes the first option.
--
-- WHY A TRIGGER AND NOT A GENERATED/COMPUTED READ. Retiring the column is the tidier end
-- state, but it is not a small change: the column is read by the merge path and by callers
-- that would all have to move to `place_visit_totals()` in the same commit. A trigger makes
-- the column true today without touching a single reader, and it does not block retiring it
-- later — a column that is always correct is strictly easier to delete than one that is not.
--
-- WHAT IT COUNTS: `count(*) from public.visits` for the place, which is exactly what
-- `check-data-integrity.mjs` compares against. It is deliberately NOT `accepted_visits` —
-- the check is the definition of correct here, and two different answers to "how many
-- visits" is how this column got untrustworthy in the first place.

begin;

create or replace function public.visits_sync_place_visit_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
begin
  -- An UPDATE can move a visit between places, so BOTH ends need recounting. array_remove
  -- drops the nulls from INSERT (no old) and DELETE (no new) without a branch per case.
  ids := array_remove(array[
    case when tg_op in ('UPDATE','DELETE') then old.place_id end,
    case when tg_op in ('INSERT','UPDATE') then new.place_id end
  ], null);

  update public.places p
     set visit_count = (select count(*) from public.visits v where v.place_id = p.id)
   where p.id = any(ids)
     -- Only write when the answer actually changes. Without this, every visit write
     -- dirties a `places` row and wakes anything watching that table for no reason.
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);

  return null;  -- AFTER trigger; the return value is ignored.
end $$;

drop trigger if exists visits_sync_place_visit_count on public.visits;
create trigger visits_sync_place_visit_count
  after insert or update of place_id or delete on public.visits
  for each row execute function public.visits_sync_place_visit_count();

-- The backfill. Bounded rather than exact, because this file is replayed from nothing by
-- `scripts/db-test.sh` where an empty schema has no drift at all (the lesson from 0271).
do $$
declare n int;
begin
  select count(*) into n
    from public.places p
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
  if n > 25 then
    raise exception 'refusing to rewrite % visit counts — that is not drift, that is a bug', n;
  end if;

  update public.places p
     set visit_count = (select count(*) from public.visits v where v.place_id = p.id)
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
end $$;

-- Prove it: the trigger is attached for all three operations, and no drift is left.
--
-- Deliberately NOT proved by inserting a real visit here. `visits` carries four other
-- triggers (participants, parent check, decided-at, trip flags), so a probe row inside a
-- migration that COMMITS can leave behind participant rows the delete does not reach. The
-- round trip was verified separately, against production, inside a transaction that was
-- rolled back — insert moved the mirror up by one, delete moved it back.
do $$
declare n int;
begin
  select count(*) into n
    from public.places p
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
  if n <> 0 then raise exception '% place(s) still disagree after the backfill', n; end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.visits'::regclass
       and t.tgname = 'visits_sync_place_visit_count'
       and not t.tgisinternal
       -- tgtype bit 2 = INSERT, 3 = DELETE, 4 = UPDATE. All three, or the column drifts
       -- again through whichever one was left out.
       and (t.tgtype & 4) <> 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0
  ) then
    raise exception 'visits_sync_place_visit_count is not attached for insert, delete AND update';
  end if;
end $$;

commit;
