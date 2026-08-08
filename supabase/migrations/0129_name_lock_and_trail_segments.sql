-- 0129 — A name you gave is yours; and a trail is its segments (Plan A).
--
-- Erica: "I want the rule that if I name a place it is ONLY manually changed by me,
-- and the same for Josh and Both." And: "We've done all this 5 fucking times, why is
-- everything having to be repeated?"
--
-- WHY IT KEEPS REPEATING. There was no flag anywhere recording that a human named a
-- place. `places` had only `auto` and `needs_geocode`. Renaming in the UI happens to
-- set auto=false, which is an implementation accident rather than a stated rule, and
-- 74 of 132 places still carry auto=true — every one of them nameable and mergeable
-- by automation. The rules lived in prose, so they drifted and had to be re-derived
-- every session. This migration puts them in the schema, with tests, so they cannot.
--
-- PART 1 — NAME LOCK
--   places.name_locked. Set it whenever a person names or renames a place. Once set,
--   automation must never rewrite the name: merge_nearby_dupes skips locked places on
--   both sides, and the nightly geocoder must skip them too (it already only touches
--   needs_geocode rows; the lock is belt and braces and is asserted by the tests).
--   Attribution is irrelevant here — Erica, Josh and Both are all "a person", exactly
--   as with visit editing.
--   Backfill: every place with auto = false and a real name is human-touched, so it
--   is locked now.
--
-- PART 2 — TRAILS ARE THEIR SEGMENTS (Plan A, chosen by Erica)
--   A trail crosses several cities, so it cannot be a boundary polygon. The spec's
--   rule is that cities/regions attach SPATIALLY while trails and trips attach by an
--   explicit part_of link — that mechanism already exists and simply was not used.
--   W&OD is currently FOUR unlinked places holding 55 runs between them:
--       Washington & Old Dominion Trail  35   (leaf, counts)
--       W&OD Bridle Trail                11   (leaf, counts)
--       W&OD                              6   (the trail itself, 0 members)
--       Purcellville Trailhead - W&OD     3   (leaf, counts)
--   The three leaves become SEGMENTS of the W&OD trail. Each keeps counting once as
--   a place; the trail stays a rollup that does not double-count, and its card can
--   now aggregate every segment's runs. The Appalachian (6 segments) and Tuscarora
--   (1 segment) are already linked this way and are left alone.

-- ---------------------------------------------------------------- part 1: the lock
alter table public.places
  add column if not exists name_locked boolean not null default false;

comment on column public.places.name_locked is
  'A person named this place. Automation (geocoder, dupe-merging, ingest) must never rewrite the name. Set by the app whenever a human names or renames.';

-- Anything a human has already touched keeps its name.
update public.places
   set name_locked = true
 where not auto
   and coalesce(btrim(name), '') <> ''
   and name <> 'New place';

-- merge_nearby_dupes must not fold a human-named place into anything, in either
-- direction. It already required p1.auto; this makes the intent explicit and covers
-- the winner side too.
-- Signature is unchanged from 0065 (returns integer — the number merged); the ONLY
-- difference is the two name_locked guards.
create or replace function public.merge_nearby_dupes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
       and not p1.name_locked           -- never absorb a name a person gave
       and not p2.name_locked           -- and never merge INTO one either
       and p1.geom is not null and p2.geom is not null
       and st_dwithin(p1.geom, p2.geom, 250)
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
end $function$;

-- Naming a place from the app locks it. One call, so every surface behaves the same.
create or replace function public.set_place_name(p_place uuid, p_name text)
returns public.places
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.places;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a place needs a name';
  end if;

  update public.places
     set name = btrim(p_name),
         name_locked = true,     -- yours from now on
         auto = false,
         needs_geocode = false   -- stop the nightly geocoder rewriting it
   where id = p_place
  returning * into v_row;

  if v_row.id is null then raise exception 'place % not found', p_place; end if;
  return v_row;
end $function$;

revoke all on function public.set_place_name(uuid, text) from public;
revoke all on function public.set_place_name(uuid, text) from anon;
grant execute on function public.set_place_name(uuid, text) to authenticated;
grant execute on function public.set_place_name(uuid, text) to service_role;

-- ------------------------------------------------------- part 2: W&OD gets segments
do $$
declare v_trail uuid;
begin
  select id into v_trail from public.places where name = 'W&OD' and is_trail limit 1;
  if v_trail is null then return; end if;

  -- The trail keeps its own name for good.
  update public.places set name_locked = true where id = v_trail;

  update public.places p
     set part_of = array(select distinct x from unnest(p.part_of || v_trail) x)
   where p.id <> v_trail
     and p.name in ('Washington & Old Dominion Trail', 'W&OD Bridle Trail', 'Purcellville Trailhead - W&OD')
     and not (v_trail = any(p.part_of));

  -- Segments are places a person recognises; keep their names too.
  update public.places
     set name_locked = true
   where name in ('Washington & Old Dominion Trail', 'W&OD Bridle Trail', 'Purcellville Trailhead - W&OD');

  perform public.rebuild_place_visits(v_trail);
  perform public.recompute_place_stats(v_trail);
end $$;
