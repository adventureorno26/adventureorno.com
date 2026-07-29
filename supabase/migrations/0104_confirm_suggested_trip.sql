-- 0104 — Confirm one auto-suggested trip draft into a canonical Trip.
--
-- Auto-detection (`detect-trips`) leaves `suggested` container-Place drafts. They are
-- NEVER trips until Erica confirms one. This RPC promotes a single draft: mark it
-- saved + not-suggested, then run the shared, idempotent backfill to create its
-- `trips` row + `trip_stops` (returns the new trip id, or null if the draft can't be
-- migrated — e.g. it has no dates). Editors/owners only. Dismissal stays client-side
-- (strip membership + delete the draft) — no data-model change needed for that.
--
-- ROLLBACK:
--   drop function if exists public.confirm_suggested_trip(uuid);

create or replace function public.confirm_suggested_trip(p_place uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  -- Promote the draft to a real, saved container-Place trip.
  update public.places
     set suggested = false, saved = true
   where id = p_place and category = 'trip' and deleted_at is null;
  -- Shared, idempotent backfill creates this place's trip + stops (and no-ops others).
  perform public.migrate_container_place_trips();
  select id into v_trip from public.trips where source_place_id = p_place;
  return v_trip;
end $$;
revoke execute on function public.confirm_suggested_trip(uuid) from anon, public;
grant execute on function public.confirm_suggested_trip(uuid) to authenticated;
