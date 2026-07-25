-- Per-person draft privacy.
--
-- Until now every member could read every place and photo. Erica wants her own
-- un-saved items (automated phone clusters, half-sorted photos) to stay PRIVATE to
-- her until she deliberately saves them to a card / the map — and the same for
-- Josh. Once `saved`, a place (and its photos) becomes visible to both.
--
--   * places: visible if saved, or you created it. Legacy/auto rows with no
--     created_by (Erica's phone clusters) stay visible to the owner only.
--   * photos: visible if you uploaded it, or its place is saved.

-- Saved-lookup that bypasses RLS (avoids a policy referencing places' own policy).
create or replace function public.place_is_saved(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select saved from public.places where id = pid), false);
$$;
grant execute on function public.place_is_saved(uuid) to authenticated;

-- places: members read only saved rows, their own drafts, or (owner) unattributed drafts.
drop policy if exists places_select on public.places;
create policy places_select on public.places
  for select using (
    public.is_member() and (
      saved
      or created_by = auth.uid()
      or (created_by is null and public.is_owner())
    )
  );

-- photos: members read only their own uploads or photos on a saved place.
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos
  for select using (
    public.is_member() and (
      uploaded_by = auth.uid()
      or (uploaded_by is null and public.is_owner())
      or (place_id is not null and public.place_is_saved(place_id))
    )
  );
