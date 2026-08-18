-- 0218 — Christmas was last year, and the typo was not where it was showing.
--
-- `check-data-integrity.mjs` has flagged this since 2026-08-14: two visits dated
-- 2026-12-25, four months in the future, counting in every total as though they had already
-- happened. The file said the same thing every time — *"every one of them is a fact about
-- where Erica has actually been, and guessing is how the wrong thing gets saved"* — so it
-- waited. Asked directly on 2026-08-17, she said 2026 was a typo for 2025.
--
-- THE FIRST ATTEMPT AT THIS MIGRATION CORRECTED THE VISITS, AND IT DID NOT WORK.
-- The dates moved, `rebuild_place_visits` ran, and both visits came straight back at
-- 2026-12-25. It only failed loudly because the migration re-checked the world at the end
-- instead of trusting its own UPDATE:
--
--     0218: a visit in the future survived the correction
--
-- §"Derived vs source", for the fourth time in this repository. **`visits` is DERIVED.**
-- `rebuild_place_visits` builds visit islands from photos, activities, pings and — the one
-- nobody had checked — **`public.entries`**. The real typo is a journal entry:
--
--     "The Rabbit Hole"   Maryland Heights   2026-12-25
--
-- Correcting the copy achieved nothing because the copy is rebuilt from the original.
--
-- AND ONE BAD ENTRY MADE TWO BAD VISITS. Maryland Heights is `part_of` the Appalachian
-- Trail, and the rebuild deliberately folds a section's evidence up into its parent — "a
-- trail's evidence legitimately lives on its sections", as the integrity check itself says.
-- So a single mistyped year produced a future visit on the section AND on the trail, and
-- anyone fixing "the two visits" would have been fixing two symptoms of one cause.
--
-- Verified before writing, on production and rolled back: correct the entry, rebuild both
-- places, and future-dated visits go to zero without either visit being touched directly.

do $$
declare
  v_place uuid;
  n_entries int;
  before_counts jsonb := '{}'::jsonb;
  after_counts  jsonb := '{}'::jsonb;
begin
  select count(*) into n_entries from public.entries where date > current_date;
  if n_entries = 0 then
    raise notice '0218: no future-dated entries; already corrected';
    return;
  end if;

  -- Every place whose visits are built from a future-dated entry — the entry's own place
  -- AND every place that contains it, because the rebuild folds a section's evidence into
  -- its parent and that is how one entry became two visits.
  create temp table _touched on commit drop as
  select distinct p.id
    from public.entries e
    join public.places p on p.id = e.place_id
   where e.date > current_date
   union
  select distinct parent.id
    from public.entries e
    join public.places sec on sec.id = e.place_id
    join public.places parent on parent.id = any(sec.part_of)
   where e.date > current_date;

  for v_place in select id from _touched loop
    before_counts := before_counts || jsonb_build_object(v_place::text,
      (select visit_count from public.places where id = v_place));
  end loop;

  -- THE CORRECTION, on the record rather than on the mirror.
  update public.entries
     set date = date - interval '1 year'
   where date > current_date;

  -- The visits follow, because they were always going to.
  for v_place in select id from _touched loop
    perform public.rebuild_place_visits(v_place);
    perform public.recompute_place_stats(v_place);
    after_counts := after_counts || jsonb_build_object(v_place::text,
      (select visit_count from public.places where id = v_place));
  end loop;

  if exists (select 1 from public.visits where start_date > current_date) then
    raise exception '0218: a visit in the future survived the correction';
  end if;
  if exists (select 1 from public.entries where date > current_date) then
    raise exception '0218: an entry in the future survived the correction';
  end if;

  -- A count moving is not automatically wrong here — the corrected day may now merge with
  -- an adjacent one — but it IS a number changing on her screen for a reason she did not
  -- ask about, so it gets said out loud rather than discovered later.
  if after_counts <> before_counts then
    raise notice '0218: visit counts changed while correcting the year: % -> %',
      before_counts::text, after_counts::text;
  end if;

  raise notice '0218: % future-dated entr(y/ies) moved back a year; no visit is in the future.',
    n_entries;
end $$;
