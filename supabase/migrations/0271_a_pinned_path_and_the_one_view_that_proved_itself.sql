-- 0271 — the advisor backlog, minus the part that cannot be closed by assertion.
--
-- §6c has carried four ERROR-level `security_definer_view` findings since 0266 turned the
-- participant tables into views. Its instruction was exact: *"Fix them to
-- `security_invoker = true` and prove each one still returns the same rows for each
-- member."* The proof was run before this file was written — all four flipped inside a
-- transaction, counted for Erica, Josh and the test account, then rolled back:
--
--   view                  Erica        Josh         Test bot     verdict
--   activity_profiles     627 -> 536   627 -> 486   627 -> 303   DIFFERS
--   activity_provenance   571 -> 480   571 -> 430   571 -> 293   DIFFERS
--   visible_activities    480 -> 480   430 -> 430   293 -> 293   same
--   visit_profiles        664 -> 359   664 -> 305   664 ->   0   DIFFERS
--
-- So the assumption behind the instruction was wrong, and finding that out is the point of
-- insisting on the proof. Three of the four are not a drop-in flip: the definer property is
-- currently DOING something — handing every member all 627 participations and all 664 visit
-- participations regardless of the RLS on `memory_people`, `memory_subjects` and `people`.
-- Flipping those three is still the right end state (it is the leak §6c describes), but it
-- CHANGES WHAT THE APP SHOWS today, which is a decision about the product and not a
-- migration's to take. They stay open and stay recorded, with the numbers, so the next
-- session argues with evidence instead of re-measuring.
--
-- `visible_activities` is different and that is not luck: its own WHERE clause is the same
-- expression as the `activities_select` policy, so invoker RLS re-applies a filter the view
-- already applied. Identical for all three accounts, measured, so it flips here.
--
-- Also: the six `function_search_path_mutable` warnings. All six are SECURITY INVOKER and
-- reference only `public` objects and built-ins, so pinning the path changes no result — it
-- removes the ability of a caller's search_path to decide which `places` or which
-- `is_generic_activity_name` they meant.
--
-- And one mirror: `places.visit_count` for Riverpoint Drive Trailhead says 13 against 12
-- real visits — the last row `check-data-integrity.mjs` flags in that check, and the only
-- one of its three findings that is arithmetic rather than memory. The other two are visits
-- claiming evidence that no longer sits at their place; those are Erica's to decide and are
-- deliberately NOT touched here.

begin;

-- 1. The one view that proved identical for every member.
alter view public.visible_activities set (security_invoker = true);

-- 2. Pin the six mutable search paths. `pg_temp` last, per the usual advice, so a temp
--    object can never shadow a public one.
alter function public.is_generic_activity_name(text)                                   set search_path = public, pg_temp;
alter function public.activity_display_name(text, uuid, text)                          set search_path = public, pg_temp;
alter function public.file_content_key(uuid, timestamptz, double precision, text)      set search_path = public, pg_temp;
alter function public.local_zone(double precision, double precision, text, text)       set search_path = public, pg_temp;
alter function public.owner_profile_is_immutable()                                     set search_path = public, pg_temp;
alter function public.together_since()                                                 set search_path = public, pg_temp;

-- 3. The stale mirror. Scoped to the place that disagrees, and bounded so this cannot
--    quietly rewrite a count that was right.
--
--    THE GUARD IS "AT MOST", NOT "EXACTLY", and the first draft got that wrong. It said
--    `if n <> 1`, which is a statement about production on the afternoon this was written
--    — and every migration here is also replayed from nothing by `scripts/db-test.sh`,
--    where a database with no visits has no stale mirrors and n is 0. The exact form
--    failed CI on an empty schema, correctly. What actually needs preventing is repairing
--    MORE than the one row this file was written for; finding none is what a fresh
--    database and a second run both look like.
do $$
declare n int;
begin
  select count(*) into n
    from public.places p
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
  if n > 1 then
    raise exception 'expected at most 1 place with a stale visit_count, found %', n;
  end if;

  update public.places p
     set visit_count = (select count(*) from public.visits v where v.place_id = p.id)
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
end $$;

-- 4. Prove the three changes landed, in the same transaction that made them.
do $$
declare n int;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'visible_activities'
       and 'security_invoker=true' = any(c.reloptions)
  ) then
    raise exception 'visible_activities is not security_invoker';
  end if;

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('is_generic_activity_name','activity_display_name','file_content_key',
                       'local_zone','owner_profile_is_immutable','together_since')
     and p.proconfig is null;
  if n <> 0 then
    raise exception '% of the six functions still has a mutable search_path', n;
  end if;

  select count(*) into n
    from public.places p
   where p.deleted_at is null
     and p.visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id);
  if n <> 0 then
    raise exception '% place(s) still disagree with their visit count', n;
  end if;
end $$;

commit;
