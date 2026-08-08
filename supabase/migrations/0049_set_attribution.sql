-- 0049_set_attribution.sql — RPCs so the UI can set "who was here" per row.
-- Convention unchanged: solo_profile NULL = both of us, = X = that person only.

-- Activities have no client UPDATE policy, so this runs SECURITY DEFINER. Setting
-- an activity's owner recomputes place stats and rebuilds visits, so the inferred
-- visit-level attribution follows automatically.
create or replace function public.set_activity_solo(p_activity uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pl uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.activities set solo_profile = p_profile where id = p_activity
    returning place_id into pl;
  if pl is not null then
    perform public.recompute_place_stats(pl);
    perform public.rebuild_place_visits(pl);
  end if;
end $$;
grant execute on function public.set_activity_solo(uuid, uuid) to authenticated;

-- Manually set a visit's attribution. Sets solo_override so rebuild_place_visits
-- keeps the human choice instead of re-inferring it from activities.
create or replace function public.set_visit_solo(p_visit uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.visits set solo_profile = p_profile, solo_override = true where id = p_visit;
end $$;
grant execute on function public.set_visit_solo(uuid, uuid) to authenticated;
