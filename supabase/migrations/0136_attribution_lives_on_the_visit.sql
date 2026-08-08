-- Attribution belongs to the VISIT, never the place (docs/SCHEMA.md).
--
-- places.solo_profile is the pre-visit-model column. set_place_solo was already
-- rewritten to write visits, so nothing had WRITTEN the column in a long time —
-- but three client reads still consulted it, and it is null for 129 of 132 places.
-- A null there silently means "belongs to everyone", so:
--   * StatsBar's drill-down filter `p.solo_profile && p.solo_profile !== person`
--     never excluded anything — the Army Ten Miler showed in Josh's view with
--     Erica's stats even though races_list/race_stats filter correctly;
--   * the place card's Who control read the stale column, so Rehoboth Beach said
--     "Both" although its visit is Erica with solo_override.
--
-- Ground rule 1: remove the mechanism, not the rows. The column goes.
--
-- The three labels it still held (Seneca Creek State Park, Purcellville Trailhead,
-- Beaverdam Reservoir — all Erica) are carried down onto their own visits FIRST, with
-- solo_override = true so rebuild_place_visits can never re-derive them away. Pre-state
-- captured in supabase/snapshots/2026-08-08-places-solo-profile.json.

begin;

-- 1. Preserve the labels before removing where they lived. Only visits carrying no
--    explicit decision of their own are touched — an overridden visit already
--    outranks a place-level guess.
update public.visits v
   set solo_profile = p.solo_profile,
       solo_override = true
  from public.places p
 where p.id = v.place_id
   and p.solo_profile is not null
   and coalesce(v.solo_override, false) = false;

-- 2. Remove the mechanism.
alter table public.places drop column solo_profile;

-- 3. The derived read that replaces it. A place belongs to one person only when
--    EVERY visit to it is theirs; any joint visit, or visits by both people, makes
--    it Both. This is what the place card's Who control reads now.
create or replace function public.place_attribution()
returns table(place_id uuid, solo_profile uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.assert_member();

  select v.place_id,
         case
           when count(*) filter (where v.solo_profile is null) = 0
            and count(distinct v.solo_profile) = 1
           then (array_agg(distinct v.solo_profile))[1]
         end
    from public.visits v
   group by v.place_id;
$$;

revoke all on function public.place_attribution() from public;
revoke all on function public.place_attribution() from anon;
grant execute on function public.place_attribution() to authenticated;

commit;
