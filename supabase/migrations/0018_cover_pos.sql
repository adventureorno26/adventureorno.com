-- 0018_cover_pos.sql — vertical focal point (0-100%) for a place's cover crop,
-- so the hero image on the card can be adjusted to frame it well.
alter table public.places add column if not exists cover_pos_y smallint not null default 50;
