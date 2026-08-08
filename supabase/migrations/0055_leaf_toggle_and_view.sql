-- 0055_leaf_toggle_and_view.sql — leaf-level attribution toggle + map view filter.
--
-- Erica's rule: LEAF place cards show a Just-me/Just-Josh/Both toggle; container
-- cards (trail/trip/city) don't. The toggle sets ALL of that leaf's visits, using
-- solo_override=true so rebuild_place_visits (0048) preserves the choice. Miles &
-- stats already read visits, so the headline follows automatically.

create or replace function public.set_place_solo(p_place uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.visits
     set solo_profile = p_profile, solo_override = true, manual = true
   where place_id = p_place;
end $$;
grant execute on function public.set_place_solo(uuid, uuid) to authenticated;

-- Which places appear for the current person view — mirrors wander_stats exactly.
--   Both (null): places with a post-cutoff joint visit (solo_profile IS NULL)
--   A person:    places with their solo visit OR a joint one
-- Used by the map to hide pre-cutoff (Erica-only) markers when the toggle is Both.
create or replace function public.place_ids_for_view(p_profile uuid default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id
  from public.places p
  join public.visits v on v.place_id = p.id
  where p.counts_as_place
    and case when p_profile is null
             then v.solo_profile is null
             else (v.solo_profile is null or v.solo_profile = p_profile) end;
$$;
grant execute on function public.place_ids_for_view(uuid) to authenticated;

-- Lock the Seneca Creek pre-cutoff Erica fix so a rebuild can't revert it.
update public.visits set solo_override = true
 where place_id = (select id from public.places where name = 'Seneca Creek State Park' limit 1)
   and start_date = '2025-11-08';
