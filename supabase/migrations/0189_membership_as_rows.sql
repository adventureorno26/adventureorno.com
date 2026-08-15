-- 0189 — §0.8 phase 8, step 4a: membership, as rows the app can read.
--
-- §0.7 removes `places.part_of` and its sync trigger "after every reader uses
-- `place_membership`". No reader does yet: the frontend derives containment from the
-- `part_of` ARRAY carried on every place object — `allPlaces.filter(p => p.part_of
-- .includes(id))` — in six places, plus `lib/containers.ts` and two in `MapView`.
--
-- That is not wrong today. `part_of` is the RECORD and `place_membership` the mirror
-- (§8), so reading the array is reading the source. It is simply the wrong SIDE to be
-- on when the two swap over, and it only works because every place happens to be
-- loaded into memory at once.
--
-- This is the reader that lets them move. 19 rows today; a handful even for a very
-- well-travelled couple, so it is handed over whole rather than per place.
--
-- The WRITERS need nothing: `add_to_container` and `remove_from_container` already
-- exist and already write `part_of`. The frontend calls `updatePlace({ part_of })`
-- directly in four places instead, which is the same "write the mirror" mistake 0178
-- fixed in the database — it just happens to be writing the record here, by luck
-- rather than design.
--
-- ROLLBACK: drop function public.place_memberships_all().

begin;

create or replace function public.place_memberships_all()
returns table(child_id uuid, parent_id uuid, relationship_type text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select m.child_id, m.parent_id, m.relationship_type
    from public.place_membership m
    join public.places c on c.id = m.child_id and c.deleted_at is null
    join public.places p on p.id = m.parent_id and p.deleted_at is null
   order by m.parent_id, m.child_id;
$function$;

comment on function public.place_memberships_all() is
  'Which places sit inside which, as rows (§0.7). The frontend derived this from the '
  'part_of array on every place object, which only worked because all of them are '
  'loaded at once — and is the wrong side to be reading when part_of goes.';

revoke all on function public.place_memberships_all() from public, anon;
grant execute on function public.place_memberships_all() to authenticated;

commit;
