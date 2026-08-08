-- Trailheads are real places (with their own photos + map markers) LINKED to a
-- trail via trail_id, rather than having their activities absorbed. The trail
-- card lists its member trailheads and surfaces their photos.
alter table places add column if not exists trail_id uuid references places (id) on delete set null;
create index if not exists places_trail_id_idx on places (trail_id) where trail_id is not null;

-- Re-link a place as a trailhead of a trail (keep its activities/photos/marker).
create or replace function public.add_place_to_trail(p_place uuid, p_trail uuid, p_trailhead text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  update public.places
    set trail_id = p_trail,
        name = coalesce(nullif(btrim(p_trailhead), ''), name)
    where id = p_place;
end $$;

grant execute on function public.add_place_to_trail(uuid, uuid, text) to authenticated;
