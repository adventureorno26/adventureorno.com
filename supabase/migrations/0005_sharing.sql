-- 0005_sharing.sql — Phase 5: viewer role, photo↔entry links, trip helpers
-- Numbered migration; NEVER edit after merge.

-- ---------------------------------------------------------------------------
-- Add a read-only 'viewer' role. Writes are already gated by is_editor_or_owner()
-- (which excludes viewer), and reads by is_member() (any profile) — so allowing
-- 'viewer' in the CHECK constraints is all that's needed for a read-only role.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('owner', 'editor', 'viewer'));

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites
  add constraint invites_role_check check (role in ('owner', 'editor', 'viewer'));

-- ---------------------------------------------------------------------------
-- Photo ↔ entry linking (task 3): attach specific photos to an entry so the
-- carbonara shot sits on the restaurant note. A photo still belongs to its
-- place; entry_id is an optional extra pointer. ON DELETE SET NULL so removing
-- an entry doesn't delete the photo.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists entry_id uuid references public.entries (id) on delete set null;
create index if not exists photos_entry_idx on public.photos (entry_id);

-- ---------------------------------------------------------------------------
-- trip_stats(trip_id): places (by first_visit in range), photos (by taken_at),
-- and miles (activities by start_date). SECURITY DEFINER but only reads
-- members-visible data; returns a small JSON blob for the trips UI.
-- ---------------------------------------------------------------------------
create or replace function public.trip_stats(p_trip uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end   date;
  v_places int;
  v_photos int;
  v_meters double precision;
begin
  select start_date, end_date into v_start, v_end from public.trips where id = p_trip;
  if v_start is null or v_end is null then
    return jsonb_build_object('places', 0, 'photos', 0, 'miles', 0);
  end if;

  select count(*) into v_places from public.places
    where first_visit between v_start and v_end;
  select count(*) into v_photos from public.photos
    where taken_at::date between v_start and v_end;
  select coalesce(sum(distance), 0) into v_meters from public.activities
    where start_date::date between v_start and v_end;

  return jsonb_build_object(
    'places', v_places,
    'photos', v_photos,
    'miles', round((v_meters / 1609.344)::numeric, 1));
end;
$$;

revoke all on function public.trip_stats(uuid) from public;
grant execute on function public.trip_stats(uuid) to authenticated;
