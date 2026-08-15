-- 0191 — visits.is_trip goes. A trip is a visit you MARKED, and `trip_marked` is the mark.
--
-- §0.4: a visit counts as a trip when it is MULTI-DAY or someone marked it. Two columns
-- have been carrying the second half — `is_trip` and `trip_marked` — kept identical in
-- both directions by `visits_sync_trip_flags`. One fact, two columns, which is the bug
-- shape §8 exists to remove.
--
-- #83 took the READERS off it first: the card decides from card_view's is_trip_qualified,
-- and VISIT_COLS no longer selects the column. This is the other half.
--
-- FOUR THINGS STILL TOUCH IT, and each needs a different answer:
--
--   set_visit_is_trip       writes is_trip           -> writes trip_marked
--   apply_inbox_field       writes is_trip           -> writes trip_marked
--   rebuild_place_visits    reads visits.is_trip     -> reads trip_marked
--   visits_sync_trip_flags  mirrors the two columns  -> REWRITTEN, not dropped
--
-- THE TRIGGER IS THE INTERESTING ONE. It does three jobs and only one of them is the
-- mirror. It also accepts a person-created visit immediately — without that, every new
-- visit arrives with accepted_at = NULL, counts_as_trip() rejects it, and it is absent
-- from every statistic: Erica logs a visit and it vanishes. And it stamps updated_at.
-- Dropping the trigger to remove the mirror would have taken both with it.
--
-- WHY TWO OF THESE ARE PATCHED BY STRING REPLACEMENT rather than rewritten in full.
-- `rebuild_place_visits` and `apply_inbox_field` are long, and reproducing them here to
-- change one token invites transcription errors in the parts that are NOT changing. Each
-- patch asserts the exact text it expects to find, exactly once, and raises if it does
-- not — so a definition that has drifted stops this migration instead of silently
-- half-applying. The rewritten definition is deterministic given the same starting
-- definition, which the earlier migrations pin.
--
-- ROLLBACK: the column can be re-added and backfilled from trip_marked, and the four
-- functions restored from 0133/0117/0164. Nothing here loses information: is_trip and
-- trip_marked were identical on every row by construction.

-- ---------------------------------------------------------------------------
-- 0. They really are identical. If they are not, stop.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.visits
   where is_trip is distinct from trip_marked;
  if n > 0 then
    raise exception
      '0191: % visit(s) have is_trip <> trip_marked. The mirror was not holding, so '
      'dropping the column would lose a real difference. Investigate before rerunning.', n;
  end if;
  raise notice '0191: is_trip and trip_marked agree on every row';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The trigger keeps its real jobs and loses the mirror.
-- ---------------------------------------------------------------------------
create or replace function public.visits_sync_trip_flags()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    -- A VISIT A PERSON CREATES IS ACCEPTED IMMEDIATELY.
    --
    -- Without this, every new visit arrives with accepted_at = NULL, counts_as_trip()
    -- rejects it, and it is absent from every statistic — Erica logs a visit and it
    -- vanishes.
    --
    -- auth.uid() is non-null only inside a real person's request; cron jobs and edge
    -- functions run as service_role with no uid, so machine-created rows still arrive
    -- UNACCEPTED and wait for review, which is what §0.3 requires.
    if new.accepted_at is null and auth.uid() is not null then
      new.accepted_at := now();
      new.accepted_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $function$;

comment on function public.visits_sync_trip_flags() is
  'Accepts a person-created visit immediately and stamps updated_at. It no longer syncs '
  'is_trip with trip_marked, because is_trip is gone (0191) — the name is kept so the '
  'trigger that calls it does not have to be recreated.';

-- ---------------------------------------------------------------------------
-- 2. The RPC the card calls writes the mark, not the mirror.
--    Same name and signature: the frontend keeps calling set_visit_is_trip.
-- ---------------------------------------------------------------------------
create or replace function public.set_visit_is_trip(p_visit uuid, p_is_trip boolean)
returns visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.visits
     set trip_marked = coalesce(p_is_trip, false),
         manual      = case when p_is_trip then true else manual end
   where id = p_visit
  returning * into v_row;

  if v_row.id is null then raise exception 'visit % not found', p_visit; end if;
  -- "This was a trip" is exactly the kind of judgement no machine should undo.
  perform public.record_approval('visit', p_visit, 'is_trip', to_jsonb(coalesce(p_is_trip, false)));
  perform public.recompute_place_stats(v_row.place_id);
  return v_row;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. rebuild_place_visits takes its trip WINDOWS from the mark.
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  old_txt constant text := 'where v.is_trip';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rebuild_place_visits';
  if src is null then raise exception '0191: rebuild_place_visits not found'; end if;

  if (length(src) - length(replace(src, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception '0191: expected exactly one "%" in rebuild_place_visits', old_txt;
  end if;

  execute replace(src, old_txt, 'where v.trip_marked');
  raise notice '0191: rebuild_place_visits now reads trip_marked';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The inbox writes the mark. The FIELD NAME stays 'is_trip' on purpose:
--    rows already sitting in the inbox name it that, and renaming the field
--    would strand them.
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  old_txt constant text := 'update public.visits set is_trip = (p_value #>> ''{}'')::boolean where';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_inbox_field';
  if src is null then raise exception '0191: apply_inbox_field not found'; end if;

  if (length(src) - length(replace(src, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception '0191: expected exactly one is_trip write in apply_inbox_field';
  end if;

  execute replace(
    src,
    old_txt,
    'update public.visits set trip_marked = (p_value #>> ''{}'')::boolean where'
  );
  raise notice '0191: apply_inbox_field now writes trip_marked';
end $$;

-- Its `select to_jsonb(v.is_trip) into prev` reads the column for the undo snapshot.
-- Point that at trip_marked too, or the undo records a column that is about to vanish.
do $$
declare
  src text;
  old_txt constant text := 'select to_jsonb(v.is_trip) into prev';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_inbox_field';
  if (length(src) - length(replace(src, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception '0191: expected exactly one is_trip read in apply_inbox_field';
  end if;
  execute replace(src, old_txt, 'select to_jsonb(v.trip_marked) into prev');
  raise notice '0191: apply_inbox_field undo snapshot reads trip_marked';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Nothing reads or writes it any more. Prove that, then drop it.
--
-- THE FIRST VERSION OF THIS GUARD WAS TOO BLUNT and refused the migration: it matched
-- the string literal 'is_trip' that record_approval records under, and the word inside
-- ordinary comments, naming four functions that do not touch the column at all. Comments
-- and quoted strings are stripped before matching, so what is left is code.
-- ---------------------------------------------------------------------------
do $$
declare offender text;
begin
  select string_agg(p.proname, ', ') into offender
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     -- apply_inbox_field keeps the inbox FIELD NAME 'is_trip' — renaming that would
     -- strand rows already sitting in the inbox — but it writes trip_marked now.
     and p.proname <> 'apply_inbox_field'
     and regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'),  -- comments
           '''[^'']*''', '''''', 'g'                                          -- string literals
         ) ~ '\mis_trip\M'
     and pg_get_functiondef(p.oid) !~ 'is_trip_qualified';
  if offender is not null then
    raise exception '0191: still referenced in CODE by %', offender;
  end if;
  raise notice '0191: no function reads or writes the column';
end $$;

-- ---------------------------------------------------------------------------
-- 6. The view has to come apart and go back together.
--
-- `accepted_visits` SELECTS the column by name, and CREATE OR REPLACE VIEW cannot drop
-- a column from a view. So it is dropped, the column goes, and it is rebuilt.
--
-- TWO PROPERTIES THAT MUST SURVIVE:
--   * `security_invoker = true` — without it the view runs as its owner and RLS on
--     `visits` stops applying, which would hand every row to anyone who can select.
--   * `is_trip_qualified` — the card reads its trip state from here (§0.4), so losing
--     it would quietly stop every multi-day visit reading as a trip.
--
-- The old view also granted INSERT/UPDATE/DELETE to `authenticated`. Those are NOT
-- restored: 0176 revoked direct writes on `visits`, and with security_invoker a write
-- through the view already fails against the table underneath. The grants said something
-- that was not true.
-- ---------------------------------------------------------------------------
drop view if exists public.accepted_visits;

create view public.accepted_visits
with (security_invoker = true)
as
  select id, place_id, start_date, end_date, note, created_by, created_at,
         solo_override, manual, status, decided_at, parent_visit_id, trip_marked,
         source, accepted_at, accepted_by, updated_at, client_key,
         public.counts_as_trip(v.*) as is_trip_qualified,
         parent_visit_id is null    as is_headline
    from public.visits v
   where status = 'taken' and accepted_at is not null;

grant select on public.accepted_visits to authenticated;
grant select on public.accepted_visits to service_role;

-- ---------------------------------------------------------------------------
-- 7. A trigger names the column too.
--
-- `visits_mark_decided` fires BEFORE UPDATE OF a specific column list, and that list
-- includes is_trip — a real dependency Postgres tracks, so the drop is refused until it
-- is rebuilt. Exactly what 0188 hit taking solo_profile out.
--
-- `trip_marked` takes its place in the list. Losing it would mean marking a visit as a
-- trip no longer counts as deciding something about that visit, which is the opposite of
-- what marking one means.
-- ---------------------------------------------------------------------------
drop trigger if exists visits_mark_decided on public.visits;
create trigger visits_mark_decided
  before update of start_date, end_date, note, trip_marked, status
  on public.visits
  for each row execute function public.visits_mark_decided();

alter table public.visits drop column is_trip;
