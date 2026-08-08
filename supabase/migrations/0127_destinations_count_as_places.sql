-- 0127 — A destination you went to COUNTS as a place (place-model Slice 4).
--
-- Erica: "A trip to a place should also be counted as a place, right? The name of
-- the trip is often just Cape Cod — then visits to Linnell Landing Beach, etc, are
-- inside the trip/place." And then, concretely: "I just looked at our Barbados trip
-- and it says we have had 0 visits to Barbados, there are 0 places, even though we
-- were there for 5 days VISITING BARBADOS - and all our trips look like that now."
--
-- WHY IT READ ZERO. Barbados is stored as the place "Paynes Bay" with
-- category='trip'. `counts_as_place` is generated as
--     category IS DISTINCT FROM 'trail' AND category IS DISTINCT FROM 'trip'
-- so the destination counted as NOTHING, even with 19 photos and a real visit.
-- `trip_stats` compounds it: it only counts stops whose status = 'completed', and a
-- stop is promoted only when its place has a visit inside the window. The Barbados
-- trip's single stop pointed at "Annabelle's On The Beach", which has no photos of
-- its own (they are all on Paynes Bay) and therefore no visits — so the stop stayed
-- 'planned' and the trip reported 0 places / 0 visits.
--
-- This is NOT a regression from 0125/0126: no place went from a positive day count
-- to zero visits (measured: regressed_to_zero = 0 across all 132 places). It is the
-- original modelling problem Erica reported.
--
-- THE MODEL, from the authoritative spec: "A city is both a place you visited AND a
-- box that holds other places — it is not one or the other." Only trails and trips
-- are non-counting ROLLUPS, and the reason is double-counting. A destination like
-- Cape Cod or Barbados is a REGION: it counts once, and it holds the beach, the
-- restaurant and the stay inside it — which each also count. The journey itself
-- stays a canonical `trips` row, and trips count every time.
--
-- WHAT THIS DOES
--   1. Reclassifies every legacy category='trip' PLACE into a counting container.
--      Note the trigger derives category from categories[], and its first matching
--      branch wins, so simply dropping 'trip' would misfile things: Cape Cod
--      (['trip','beach']) would become a 'beach' LEAF and Paynes Bay
--      (['walking','beach','dining','stay','trip']) a 'walking' leaf, orphaning
--      their children. So 'trip' is replaced by 'region' unless 'city' is already
--      present, in which case city wins (San Diego, West Palm Beach).
--   2. Makes each destination an explicit stop on any canonical trip whose window
--      contains one of its visits, then promotes it — so trip_stats stops reporting
--      zero.
--   3. Recomputes stats for every touched place.
--
-- Trails are untouched: they remain rollups, exactly as the spec requires.

-- 1. trip-places become counting destinations ------------------------------------
update public.places
   set categories = case
         when categories @> array['city'] then array_remove(categories, 'trip')
         else array_append(array_remove(categories, 'trip'), 'region')
       end,
       -- the trigger preserves a non-null category when no branch matches, so clear
       -- it and let sync_place_category re-derive from the new categories[]
       category = null
 where category = 'trip'
   and not is_trail;

-- 2. the destination becomes a stop on the trip it belongs to ---------------------
insert into public.trip_stops (trip_id, place_id, status)
select distinct t.id, p.id, 'planned'
  from public.trips t
  join public.visits v on v.start_date >= t.start_date and v.start_date <= t.end_date
  join public.places p on p.id = v.place_id
 where t.start_date is not null
   and t.end_date is not null
   and (t.end_date - t.start_date) <= 30      -- same guard as 0125; ignore bogus windows
   and p.holds_children                        -- destinations only, not every leaf
   and not p.is_trail
   and not exists (select 1 from public.trip_stops s
                    where s.trip_id = t.id and s.place_id = p.id)
on conflict do nothing;

-- 3. promote those stops and refresh the affected places --------------------------
do $$
declare r record;
begin
  for r in select distinct place_id from public.trip_stops loop
    perform public.promote_trip_stops_for_place(r.place_id);
    perform public.recompute_place_stats(r.place_id);
  end loop;
  -- and every reclassified destination, whose counts_as_place just flipped
  for r in select id as place_id from public.places where category in ('region','city') loop
    perform public.recompute_place_stats(r.place_id);
  end loop;
end $$;
