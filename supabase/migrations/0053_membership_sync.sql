-- 0053_membership_sync.sql — §3: make place_membership the authoritative link.
-- The app's existing "Part of…" / "Add existing places" controls write the
-- places.part_of array; this trigger mirrors every change into place_membership
-- so all queries (trail card, stats, members list) read the join table. part_of
-- stays as a synced compatibility mirror; it is no longer the source of truth.

create or replace function public.sync_membership_from_part_of() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Drop memberships no longer in the array.
  delete from public.place_membership m
   where m.child_id = NEW.id
     and m.parent_id <> all (coalesce(NEW.part_of, '{}'::uuid[]));
  -- Add memberships new to the array (only where the parent still exists).
  insert into public.place_membership (child_id, parent_id)
  select NEW.id, par
    from unnest(coalesce(NEW.part_of,'{}'::uuid[])) as par
   where par <> NEW.id
     and exists (select 1 from public.places pp where pp.id = par)
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists places_sync_membership on public.places;
create trigger places_sync_membership
  after insert or update of part_of on public.places
  for each row execute function public.sync_membership_from_part_of();

-- Convenience: an "Add to…" helper the UI can call to link a place into a
-- container by id (keeps part_of + membership in sync via the trigger above).
create or replace function public.add_to_container(p_child uuid, p_parent uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  if p_child = p_parent then return; end if;
  update public.places
     set part_of = (select array(select distinct unnest(coalesce(part_of,'{}') || p_parent)))
   where id = p_child;
end $$;
grant execute on function public.add_to_container(uuid,uuid) to authenticated;

create or replace function public.remove_from_container(p_child uuid, p_parent uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.places
     set part_of = array_remove(coalesce(part_of,'{}'), p_parent)
   where id = p_child;
end $$;
grant execute on function public.remove_from_container(uuid,uuid) to authenticated;
