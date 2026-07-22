-- 0065_input_hygiene_and_merge.sql — Phase A3. Two guards so bad auto-places
-- stop accumulating:
--   1. A trigger that neutralizes junk inserts — the US-center failed-geocode
--      coordinate (38.0556674, -95.75) or a blank name on an auto place — by
--      un-saving them (hidden from map/stats) instead of letting them pile up.
--   2. merge_places_auto(loser, winner): the merge_places body WITHOUT the
--      interactive is_editor_or_owner() gate, so cron and backfills can call it.
--      It also repoints videos + fixes part_of arrays + rebuilds the winner's
--      visits — things the UI merge_places never had to.
--   3. merge_nearby_dupes(): folds auto leaf places that share a real (geocoded,
--      not 'New place') name and sit within 250 m into the oldest of the set.
--      Scheduled nightly; also run once in Phase B cleanup.

-- 1. Junk-input trigger -------------------------------------------------------
create or replace function public.neutralize_junk_place()
returns trigger language plpgsql as $$
begin
  -- US geographic center = the "geocode failed" sentinel. Never a real place.
  if new.lat is not null and new.lng is not null
     and abs(new.lat - 38.0556674) < 0.002 and abs(new.lng - (-95.75)) < 0.002 then
    new.saved := false;
    new.needs_geocode := false;
  end if;
  -- A blank-named auto place is a mis-ingest, not a destination.
  if coalesce(new.auto, false) and coalesce(btrim(new.name), '') = '' then
    new.saved := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_neutralize_junk_place on public.places;
create trigger trg_neutralize_junk_place
  before insert or update of lat, lng, name on public.places
  for each row execute function public.neutralize_junk_place();

-- 2. Non-interactive merge ----------------------------------------------------
create or replace function public.merge_places_auto(p_loser uuid, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_loser is null or p_winner is null or p_loser = p_winner then return; end if;
  if not exists (select 1 from public.places where id = p_loser) then return; end if;
  if not exists (select 1 from public.places where id = p_winner) then return; end if;

  update public.photos         set place_id = p_winner where place_id = p_loser;
  update public.entries        set place_id = p_winner where place_id = p_loser;
  update public.activities     set place_id = p_winner where place_id = p_loser;
  update public.location_pings set place_id = p_winner where place_id = p_loser;
  update public.videos         set place_id = p_winner where place_id = p_loser;

  -- Any place that was part_of the loser is now part_of the winner (deduped).
  update public.places set part_of = (
    select array_agg(distinct e) from unnest(array_replace(part_of, p_loser, p_winner)) e
    where e is not null and e <> id
  ) where p_loser = any(part_of);

  delete from public.visits where place_id = p_loser;
  delete from public.places where id = p_loser;
  perform public.recompute_place_stats(p_winner);
  perform public.rebuild_place_visits(p_winner);
end $$;
grant execute on function public.merge_places_auto(uuid, uuid) to service_role;

-- 3. Fold nearby same-name auto dupes ----------------------------------------
create or replace function public.merge_nearby_dupes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_cnt int := 0;
begin
  for r in
    select loser, winner from (
      select p1.id as loser, p2.id as winner
      from public.places p1
      join public.places p2
        on p1.id <> p2.id
       and lower(btrim(p1.name)) = lower(btrim(p2.name))
       and coalesce(btrim(p1.name), '') <> ''
       and p1.name <> 'New place'
       and p1.auto and not coalesce(p1.holds_children, false) and not coalesce(p1.is_trail, false)
       and not coalesce(p2.holds_children, false) and not coalesce(p2.is_trail, false)
       and p1.geom is not null and p2.geom is not null
       and st_dwithin(p1.geom, p2.geom, 250)
       -- keep the older row as winner; each loser matched to its oldest peer
       and p2.created_at < p1.created_at
    ) pairs
    order by winner
  loop
    if exists (select 1 from public.places where id = r.loser) then
      perform public.merge_places_auto(r.loser, r.winner);
      v_cnt := v_cnt + 1;
    end if;
  end loop;
  return v_cnt;
end $$;
grant execute on function public.merge_nearby_dupes() to service_role;

-- Nightly, after the geocode pass has had a chance to name new places.
select cron.schedule('merge-nearby-dupes', '30 4 * * *',
  $$select public.merge_nearby_dupes();$$)
where not exists (select 1 from cron.job where jobname = 'merge-nearby-dupes');
