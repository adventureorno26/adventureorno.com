-- 0013_reassign_activity.sql — let owner/editor move a misgrouped activity to a
-- different place (or a new one). Activities have no client UPDATE policy by
-- design, so this runs SECURITY DEFINER and recomputes both places' stats.
create or replace function public.reassign_activity(p_activity uuid, p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old_place uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  select place_id into old_place from public.activities where id = p_activity;
  update public.activities set place_id = p_place where id = p_activity;
  if old_place is not null then perform public.recompute_place_stats(old_place); end if;
  if p_place is not null then perform public.recompute_place_stats(p_place); end if;
end $$;

grant execute on function public.reassign_activity(uuid, uuid) to authenticated;
