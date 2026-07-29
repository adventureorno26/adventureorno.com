-- Soft-delete / trash for places & photos (visits are derived, so they rebuild).
-- Deleting sets deleted_at instead of destroying the row: an Undo snackbar can
-- restore it immediately, a Trash page keeps it for 30 days, and only the 30-day
-- purge permanently deletes + blocklists the hash (re-import blocklist stays
-- SEPARATE from ordinary recovery).

alter table public.places add column if not exists deleted_at timestamptz;
alter table public.photos add column if not exists deleted_at timestamptz;
create index if not exists places_deleted_idx on public.places (deleted_at) where deleted_at is not null;
create index if not exists photos_deleted_idx on public.photos (deleted_at) where deleted_at is not null;

-- Hide trashed rows from every normal read (adds deleted_at is null to the
-- draft-privacy policies from 0083).
drop policy if exists places_select on public.places;
create policy places_select on public.places
  for select using (
    deleted_at is null and public.is_member() and (
      saved or created_by = auth.uid() or (created_by is null and public.is_owner())
    )
  );

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos
  for select using (
    deleted_at is null and public.is_member() and (
      uploaded_by = auth.uid()
      or (uploaded_by is null and public.is_owner())
      or (place_id is not null and public.place_is_saved(place_id))
    )
  );

-- Soft delete / restore (permission-checked; photos honour rule #6: owner any,
-- editor only their own uploads).
create or replace function public.soft_delete_place(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.places set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_place(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.places set deleted_at = null where id = p_id;
end $$;

create or replace function public.soft_delete_photo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uploader uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  select uploaded_by into v_uploader from public.photos where id = p_id;
  if not public.is_owner() and v_uploader is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;
  update public.photos set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_photo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uploader uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  select uploaded_by into v_uploader from public.photos where id = p_id;
  if not public.is_owner() and v_uploader is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;
  update public.photos set deleted_at = null where id = p_id;
end $$;

grant execute on function public.soft_delete_place(uuid), public.restore_place(uuid),
  public.soft_delete_photo(uuid), public.restore_photo(uuid) to authenticated;

-- What's in the trash (last 30 days) that the caller may see.
create or replace function public.list_trash()
returns table (kind text, id uuid, label text, deleted_at timestamptz, place_id uuid)
language sql stable security definer set search_path = public as $$
  select 'place'::text, p.id, coalesce(nullif(p.name, ''), 'Untitled place'), p.deleted_at, null::uuid
  from public.places p
  where p.deleted_at is not null and p.deleted_at > now() - interval '30 days'
    and public.is_member()
    and (p.saved or p.created_by = auth.uid() or (p.created_by is null and public.is_owner()))
  union all
  select 'photo'::text, ph.id, coalesce(ph.caption, 'Photo'), ph.deleted_at, ph.place_id
  from public.photos ph
  where ph.deleted_at is not null and ph.deleted_at > now() - interval '30 days'
    and public.is_member()
    and (ph.uploaded_by = auth.uid() or (ph.uploaded_by is null and public.is_owner()))
  order by deleted_at desc;
$$;
grant execute on function public.list_trash() to authenticated;

-- Permanent purge of anything trashed > 30 days. Photos get their hash added to
-- the re-import blocklist HERE (only on permanent deletion), then the row is
-- removed. (R2 object cleanup is handled by a separate reconciliation job.)
create or replace function public.purge_trash() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.deleted_hashes (sha256, deleted_at)
    select sha256, now() from public.photos
    where deleted_at is not null and deleted_at < now() - interval '30 days' and sha256 is not null
      and not exists (select 1 from public.deleted_hashes d where d.sha256 = photos.sha256);
  delete from public.photos where deleted_at is not null and deleted_at < now() - interval '30 days';
  delete from public.places where deleted_at is not null and deleted_at < now() - interval '30 days';
end $$;

select cron.schedule('purge-trash', '30 4 * * *', $$select public.purge_trash()$$);
