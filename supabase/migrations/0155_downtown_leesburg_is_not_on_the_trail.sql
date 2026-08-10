-- "downtown Leesburg, VA" is not on the Appalachian Trail. Erica approved
-- removing it from the trail on 2026-08-10; the place itself STAYS — it holds
-- 3 photos and 2 visits and is somewhere she has been.
--
-- The removal did not take. Only the `place_membership` row was deleted, and
-- membership is not the record: `places.part_of` is, and the
-- `sync_membership_from_part_of` trigger rebuilds membership from it on the
-- next update of that place. So the trail card still listed the section, and
-- the row would have come back on its own. One fact, two mechanisms, and the
-- delete hit the copy — the same failure as `part_of` vs the card, and
-- `counts_as_place` vs the Places filter.
--
-- Removing it from part_of removes it from BOTH.

update public.places
   set part_of = array_remove(part_of, '6bffaec6-00be-4626-b1d2-cf6815b849f7'::uuid)
 where id = '3e813625-3831-43c6-a5d0-7704cc9e50f2'
   and '6bffaec6-00be-4626-b1d2-cf6815b849f7'::uuid = any(part_of);

-- The trigger fires on that update and drops the membership row; this covers
-- the case where the row was re-created in between.
delete from public.place_membership
 where parent_id = '6bffaec6-00be-4626-b1d2-cf6815b849f7'
   and child_id = '3e813625-3831-43c6-a5d0-7704cc9e50f2';

do $$
declare n int;
begin
  select count(*) into n
    from public.places
   where '6bffaec6-00be-4626-b1d2-cf6815b849f7'::uuid = any(part_of);
  raise notice 'Appalachian Trail sections after: %', n;

  -- The place itself must survive. It is hers; only its membership was wrong.
  if not exists (select 1 from public.places where id = '3e813625-3831-43c6-a5d0-7704cc9e50f2') then
    raise exception 'downtown Leesburg, VA was deleted — it must only have left the trail';
  end if;
end $$;
