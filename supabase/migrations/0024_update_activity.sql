-- Let owner/editor rename an activity (or fix its type) in the app. Activities
-- have no client UPDATE policy, so this runs SECURITY DEFINER.
create or replace function public.update_activity(p_id uuid, p_name text, p_type text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  update public.activities
    set name = coalesce(p_name, name),
        type = coalesce(p_type, type)
    where id = p_id
    returning place_id into pl;
  if pl is not null then perform public.recompute_place_stats(pl); end if;
end $$;

grant execute on function public.update_activity(uuid, text, text) to authenticated;
