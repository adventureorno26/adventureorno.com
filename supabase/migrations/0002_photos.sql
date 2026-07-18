-- 0002_photos.sql — Phase 2: photo pipeline metadata
-- Numbered migration; NEVER edit after merge (add a new migration instead).
--
-- The photo *bytes* live in Cloudflare R2 and are written only by the
-- photo-gateway Worker (service_role). This migration adds the small amount of
-- relational metadata Phase 2 needs on top of 0001's `photos` table:
--   * where a row came from (Erica's automated Shortcut vs a manual upload)
--   * fast lookups for the unassigned-photos tray and place galleries
--   * a place cover-photo pointer (set by clustering in Phase 3, editable later)

-- source: 'shortcut' = Erica's daily automation via /ingest; 'manual' = a
-- deliberate drag-and-drop upload via /upload (home-zone/screenshot checks are
-- warnings the user can override on this path).
alter table public.photos
  add column if not exists source text not null default 'manual'
    check (source in ('shortcut', 'manual'));

-- taken_at drives gallery ordering and "most recent landscape = cover" (Phase 3).
create index if not exists photos_taken_idx on public.photos (taken_at desc nulls last);

-- Cover photo per place. Nullable; ON DELETE SET NULL so deleting the cover photo
-- doesn't cascade-delete the place.
alter table public.places
  add column if not exists cover_photo_id uuid
    references public.photos (id) on delete set null;

-- Orientation is derived from width/height; expose it as a generated column so the
-- clustering job can pick a landscape cover without recomputing in SQL each time.
alter table public.photos
  add column if not exists is_landscape boolean
    generated always as (width is not null and height is not null and width >= height) stored;

-- ---------------------------------------------------------------------------
-- Photo-health signal (Phase 2 task 5): "Last automated upload: <ts>".
-- The Worker stamps ingest_tokens.last_used_at on every *authenticated* /ingest
-- call (even when the photo is skipped), so a silently-dying Shortcut shows a
-- stale timestamp. This owner-only RPC exposes just that timestamp to the UI
-- without leaking token rows.
-- ---------------------------------------------------------------------------
create or replace function public.last_automated_upload()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(last_used_at)
  from public.ingest_tokens
  where revoked_at is null;
$$;

revoke all on function public.last_automated_upload() from public;
grant execute on function public.last_automated_upload() to authenticated;
