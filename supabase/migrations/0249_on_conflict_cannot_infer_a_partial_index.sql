-- 0249 — ON CONFLICT cannot infer a partial index. Again.
--
-- Caught by 0247's own test on its first run:
--
--     ERROR: 42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--     specification
--
-- 0247 wrote the four uniqueness rules as PARTIAL indexes — `unique (photo_id) where photo_id
-- is not null` — because only one of the four target columns is filled in per row. Postgres
-- will only infer a partial index for `on conflict (photo_id)` if the statement REPEATS the
-- index predicate, and `photo_subject` did not, so registering a photo failed outright.
--
-- This is the same failure as 0209, which spent an afternoon on an upsert that had been
-- silently doing nothing for weeks. It is at least loud this time.
--
-- AND THE PREDICATE WAS NEVER NEEDED. A unique index treats NULLs as distinct, so
-- `unique (photo_id)` already permits every outing, visit and place subject to leave it null
-- while still allowing exactly one row per photo. The `where` clause bought nothing and cost
-- the inference.
drop index if exists public.memory_subjects_one_per_photo;
drop index if exists public.memory_subjects_one_per_activity;
drop index if exists public.memory_subjects_one_per_visit;
drop index if exists public.memory_subjects_one_per_place;

create unique index memory_subjects_one_per_photo    on public.memory_subjects (photo_id);
create unique index memory_subjects_one_per_activity on public.memory_subjects (activity_id);
create unique index memory_subjects_one_per_visit    on public.memory_subjects (visit_id);
create unique index memory_subjects_one_per_place    on public.memory_subjects (place_id);
