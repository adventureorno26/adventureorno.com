-- 0109 — Indexed substring search. search_photos' text filter matches
-- place.name / place.review / photo.caption with ILIKE '%txt%' (a leading-wildcard
-- scan). Trigram GIN indexes let those predicates use an index instead of a
-- sequential scan, with identical behavior + authorization (the RPC is unchanged).
-- Additive + reversible; indexes are tiny (hundreds of rows today) and grow with data.
--
-- ROLLBACK:
--   drop index if exists public.places_name_trgm;
--   drop index if exists public.places_review_trgm;
--   drop index if exists public.photos_caption_trgm;

create extension if not exists pg_trgm;

create index if not exists places_name_trgm
  on public.places using gin (name gin_trgm_ops);
create index if not exists places_review_trgm
  on public.places using gin (review gin_trgm_ops);
create index if not exists photos_caption_trgm
  on public.photos using gin (caption gin_trgm_ops);
