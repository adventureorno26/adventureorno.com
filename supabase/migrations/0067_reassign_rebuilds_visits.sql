-- 0067_reassign_rebuilds_visits.sql — Phase C (per-activity place control). When
-- an activity is moved to another place (or split into its own), BOTH the old and
-- new place's visit islands must be rebuilt, not just their stat counters — else
-- the moved day lingers as a visit on the old place and never appears on the new
-- one. reassign_activity is what the "Wrong place? Move ↗" control calls.

create or replace function public.reassign_activity(p_activity uuid, p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old_place uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  select place_id into old_place from public.activities where id = p_activity;
  update public.activities set place_id = p_place where id = p_activity;
  if old_place is not null then
    perform public.recompute_place_stats(old_place);
    perform public.rebuild_place_visits(old_place);
  end if;
  if p_place is not null then
    perform public.recompute_place_stats(p_place);
    perform public.rebuild_place_visits(p_place);
  end if;
end $$;
