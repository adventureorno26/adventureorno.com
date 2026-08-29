-- 0272 — the two visit counts left stale by 0271's approved deletions.
--
-- Two visits were deleted on 2026-08-29 with Erica's explicit yes: Leesburg 2024-10-22 and
-- Great Falls 2026-07-19. Both said `source='evidence'` and neither had any — `delete_visit`
-- returned `"evidence": []` for both, the same answer the two 2026-12-25 visits gave in §7c.
-- The full undo snapshots are recorded in §7 so they can be put back.
--
-- WHAT THE DELETIONS THEN EXPOSED, which is the part worth keeping: `delete_visit` removes
-- the row and does NOT refresh `places.visit_count`. So the moment the two visits went, the
-- integrity check swapped one stale mirror for two — Great Falls 3 vs 2, Leesburg 5 vs 4.
-- Nothing maintains that column: there is no trigger on `visits`, and the only writers are
-- backfills in old migrations. It is a cache that is correct until someone changes a visit.
--
-- This file repairs the two. It does NOT add a trigger, because `visit_count` decides which
-- place survives a merge and giving it a new maintainer is a decision about the data model,
-- not a repair. The choice — trigger it, or retire the column and the check with it — is
-- recorded in STATE.md beside the description of `check-data-integrity.mjs`, and is Erica's.

begin;

do $$
declare n int;
begin
  select count(*) into n
    from public.places p
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
  if n <> 2 then
    raise exception 'expected exactly 2 places with a stale visit_count, found %', n;
  end if;

  update public.places p
     set visit_count = (select count(*) from public.visits v where v.place_id = p.id)
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);

  select count(*) into n
    from public.places p
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
  if n <> 0 then
    raise exception '% place(s) still disagree with their visit count', n;
  end if;
end $$;

-- And the two visits really are gone, so this file cannot be read later as if it had
-- deleted them itself.
do $$
begin
  if exists (select 1 from public.visits
              where id in ('88f89b11-7dc3-4da1-a0d6-60eda68bdf14',
                           '42e11a96-ce19-40db-aea2-3da29eece7b5')) then
    raise exception 'one of the two evidence-less visits is still present';
  end if;
end $$;

commit;
