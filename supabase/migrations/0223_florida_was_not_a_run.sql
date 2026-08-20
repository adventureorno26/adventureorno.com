-- 0223 — "Florida" was not a run. Erica, 2026-08-20: *"yes remove the Florida 486 mph run"*.
--
-- Found by the integrity check added on 2026-08-18, which exists to catch exactly this:
--
--     name        Florida
--     type        Run
--     when        2026-02-01 17:25:56Z
--     distance    67.8 miles
--     moving_time 502 seconds        →  486 mph
--     polyline    18 characters      →  two points
--     owner       Erica              source file
--     id          38aab9fb-60c6-4021-965e-834a973ac763
--
-- A flight, or a GPS jump, recorded as a run. Nothing about it looked wrong in a list: it
-- had a name, a type, a distance and a place. It counted in her mileage, it created a place
-- called Florida and a visit there, and it single-handedly produced an "831 miles apart" day
-- in the how-close-we-came chart before being caught.
--
-- WHAT GOES, AND WHAT ONLY GOES AS FAR AS THE TRASH:
--
--   * the ACTIVITY is deleted outright. Activities have no soft-delete in this schema, and
--     six child tables cascade (sources, profiles, reactions, reviews, peak_bags). Its exact
--     values are written above so it can be reconstructed if she ever wants it back.
--   * the derived VISIT goes with it. It is `source=evidence, manual=false` with exactly one
--     piece of evidence — this activity — so once the activity is gone the visit is a claim
--     about a day with nothing behind it, which is the very thing the integrity check flags.
--   * the PLACE is only soft-deleted, into the Trash. Nothing else lives there (1 activity,
--     1 visit, 0 photos, 0 entries), so it is purely an artifact of the bad row — but
--     "never remove without asking" cuts both ways, and a place she can restore in one click
--     is the honest middle. If she wants it gone for good, Trash does that.
do $$
declare
  v_act   uuid;
  v_place uuid;
  v_left  int;
begin
  select a.id, a.place_id into v_act, v_place
    from public.activities a
   where a.name = 'Florida' and a.type = 'Run'
     and a.moving_time = 502
     and round((a.distance / 1609.344)::numeric, 1) = 67.8;

  if v_act is null then
    raise notice '0223: the Florida run is already gone';
    return;
  end if;

  -- The visit first, while its evidence still resolves.
  delete from public.visits v
   where v.place_id = v_place
     and not v.manual
     and v.start_date = date '2026-02-01';

  delete from public.activities where id = v_act;

  if v_place is not null then
    perform public.rebuild_place_visits(v_place);
    perform public.recompute_place_stats(v_place);

    select (select count(*) from public.activities where place_id = v_place)
         + (select count(*) from public.visits     where place_id = v_place)
         + (select count(*) from public.photos     where place_id = v_place and deleted_at is null)
         + (select count(*) from public.entries    where place_id = v_place)
      into v_left;

    -- Only if it is genuinely empty. A place that turns out to hold something else is a
    -- place she has been, and this migration has no business touching it.
    if v_left = 0 then
      update public.places set deleted_at = now() where id = v_place and deleted_at is null;
      raise notice '0223: Florida place moved to Trash (nothing else was there)';
    else
      raise notice '0223: Florida place KEPT — % other things live there', v_left;
    end if;
  end if;

  if exists (select 1 from public.activities
              where moving_time > 60 and distance > 1000
                and ((distance / 1609.344) / (moving_time / 3600.0)) > 30) then
    raise notice '0223: another impossibly fast activity remains — the integrity check will name it';
  end if;

  raise notice '0223: the 486 mph run is gone.';
end $$;
