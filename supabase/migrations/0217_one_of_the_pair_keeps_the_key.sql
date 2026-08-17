-- 0217 — when two rows are the same recording, ONE of them still keeps the key.
--
-- 0216 backfilled 264 of 267 file rows and deliberately skipped collisions, on the ground
-- that two rows producing one key are a real duplicate for a person to decide about rather
-- than something a migration should quietly merge. That reasoning was right about the merge
-- and wrong about the key.
--
-- The pair in production is Erica's Garmin GPX, imported at 21:50 and again at 22:01 on
-- 2026-08-17 — the same file, twice, before 0216 existed. Leaving BOTH unkeyed means a
-- third upload of that same file matches neither and creates a THIRD row. The skip meant to
-- avoid deciding for her instead guaranteed the problem repeats.
--
-- So the EARLIEST recording of each colliding group takes the key, and the later ones stay
-- unkeyed. Nothing is merged and nothing is deleted: the duplicate stays visible, its card
-- stays on the pile, and she decides. What changes is that the next upload of that file
-- attaches to the original instead of adding to the pile.
--
-- Earliest by `created_at` because that is the one every later copy is a repeat OF.

with keyed as (
  select s.id,
         a.created_at,
         public.file_content_key(a.owner_profile, a.start_date, a.distance, a.type) as k
    from public.activity_sources s
    join public.activities a on a.id = s.activity_id
   where s.provider = 'file'
     and s.external_key is null
),
ranked as (
  select id, k, row_number() over (partition by k order by created_at, id) as rn
    from keyed
   where k is not null
),
-- Only where no row already holds that key, so this can never fight 0216's backfill or
-- collide with a key an import has since written.
free as (
  select r.id, r.k
    from ranked r
   where r.rn = 1
     and not exists (
       select 1 from public.activity_sources x
        where x.provider = 'file' and x.external_key = r.k)
)
update public.activity_sources s
   set external_key = f.k
  from free f
 where s.id = f.id;
