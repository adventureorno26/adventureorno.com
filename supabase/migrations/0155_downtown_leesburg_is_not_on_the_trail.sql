-- "downtown Leesburg, VA" is not on the Appalachian Trail. Erica approved
-- removing it from the trail on 2026-08-10; the place itself STAYS — it holds
-- 3 photos and 2 visits and is somewhere she has been.
--
-- The removal did not take. Only the `place_membership` row was deleted, and
-- membership is not the record: `places.part_of` is, and the
-- `sync_membership_from_part_of` trigger rebuilds membership from it on the
-- next update of that place. So the trail card still listed the section, and
-- the row would have come back on its own. One fact, two mechanisms, and the
-- delete hit the copy.
--
-- Removing it from part_of removes it from BOTH.
--
-- CI applies this chain to an EMPTY database, where neither id exists. Every
-- statement here is therefore a no-op there, and the safety check only fires
-- when the row was present to begin with — a migration that asserts production
-- rows is measuring the database, not the change.

do $$
declare
  trail uuid := '6bffaec6-00be-4626-b1d2-cf6815b849f7'; -- Appalachian Trail
  spot  uuid := '3e813625-3831-43c6-a5d0-7704cc9e50f2'; -- downtown Leesburg, VA
  had   boolean;
  n     int;
begin
  select exists (select 1 from public.places where id = spot) into had;

  update public.places
     set part_of = array_remove(part_of, trail)
   where id = spot
     and trail = any(part_of);

  -- The update fires the trigger, which drops the membership row. This covers
  -- the case where the row was re-created in between.
  delete from public.place_membership
   where parent_id = trail and child_id = spot;

  -- The place is hers; only its membership was wrong. If it is gone, something
  -- other than this migration removed it and we should stop.
  if had and not exists (select 1 from public.places where id = spot) then
    raise exception 'downtown Leesburg, VA was deleted — it must only have left the trail';
  end if;

  select count(*) into n from public.places where trail = any(part_of);
  raise notice 'Appalachian Trail sections after: %', n;
end $$;
