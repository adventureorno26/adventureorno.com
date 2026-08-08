-- Fold a place into an existing trail as a trailhead: move its activities onto
-- the trail (labeled with the trailhead name) and, if nothing else remains on the
-- source place, remove the now-redundant pin.
create or replace function public.add_place_to_trail(p_place uuid, p_trail uuid, p_trailhead text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  update public.activities
    set place_id = p_trail,
        trailhead = coalesce(nullif(btrim(p_trailhead), ''), name)
    where place_id = p_place;
  perform public.recompute_place_stats(p_trail);
  if not exists (select 1 from public.activities where place_id = p_place)
     and not exists (select 1 from public.photos where place_id = p_place)
     and not exists (select 1 from public.entries where place_id = p_place) then
    delete from public.places where id = p_place;
  else
    perform public.recompute_place_stats(p_place);
  end if;
end $$;

grant execute on function public.add_place_to_trail(uuid, uuid, text) to authenticated;
