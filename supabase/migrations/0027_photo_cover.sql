-- When any photo is attached to a place (including restaurant/spot photos), also
-- recompute the place so it picks up a cover photo → its map marker becomes a
-- photo marker. recompute_place_stats preserves a manually-chosen cover.
create or replace function public.visit_from_photo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_visit(NEW.place_id, coalesce(NEW.taken_at::date, NEW.created_at::date));
  perform public.recompute_place_stats(NEW.place_id);
  return NEW;
end $$;
