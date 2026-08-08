-- 0017_videos.sql — video clips per place. Bytes live in R2 (via the Worker);
-- this table is the metadata + a poster-frame reference for the gallery.
create table if not exists public.videos (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid references public.places(id) on delete set null,
  r2_key      text not null,
  poster_key  text,
  content_type text not null default 'video/mp4',
  taken_at    timestamptz,
  lat         double precision,
  lng         double precision,
  duration_s  double precision,
  uploaded_by uuid references auth.users(id),
  source      text not null default 'manual',
  created_at  timestamptz not null default now()
);
create index if not exists videos_place_idx on public.videos (place_id, taken_at desc nulls last);

alter table public.videos enable row level security;
drop policy if exists videos_select on public.videos;
create policy videos_select on public.videos for select using (public.is_member());
-- Inserts/updates/deletes go through the photo-gateway Worker (service role);
-- no client write policy by design.
