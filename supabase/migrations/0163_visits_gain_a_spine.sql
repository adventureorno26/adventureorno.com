-- 0163 — §0.8 phase 2 (ADD ONLY). The visit fields §0.3 makes the contract.
--
-- Nothing is removed and nothing is rewritten. `is_trip`, `solo_profile` and every
-- existing reader keep working exactly as they do today; this migration only adds the
-- shape the new model needs and the ONE definition of a trip that §0.4 demands.
--
-- WHY A SPINE. Today a visit cannot say who accepted it, what created it, or that it
-- belongs inside a bigger visit. That is why a Cape Cod week and the restaurant inside
-- it are indistinguishable — both are just rows with dates, and containment has to be
-- guessed from overlapping days. §0.1 forbids that guess.
--
-- TRIP QUALIFICATION LIVES IN ONE PLACE (§0.4): public.counts_as_trip(). Every number,
-- list, drill-down and card must call it. No component may reimplement it. The rule is
-- exactly §0.3's:
--
--     status = 'taken' AND accepted_at IS NOT NULL AND (end_date > start_date OR trip_marked)
--
-- COMPATIBILITY, deliberately: `trip_marked` is backfilled from `is_trip` and kept in
-- step by a trigger, in BOTH directions, for the compatibility period. §0.3 says do not
-- leave two writable trip flags — so this is one decision with two spellings until the
-- readers move, and `is_trip` is removed in a later migration (phase 8), never here.
--
-- ACCEPTANCE: every existing taken visit is accepted. They are Erica's real history —
-- treating them as unaccepted would erase 489 visits from every count on day one. New
-- machine-created rows will arrive unaccepted; that is the point of the column.
--
-- ROLLBACK: drop the trigger and function, then drop the six columns. `is_trip` is
-- untouched throughout, so dropping them loses no human decision.

begin;

alter table public.visits
  add column if not exists parent_visit_id uuid null references public.visits(id) on delete set null,
  add column if not exists trip_marked     boolean not null default false,
  add column if not exists source          text    not null default 'manual',
  add column if not exists accepted_at     timestamptz null,
  add column if not exists accepted_by     uuid null references public.profiles(id) on delete set null,
  add column if not exists updated_at      timestamptz not null default now();

comment on column public.visits.parent_visit_id is
  'The trip visit this visit is explicitly grouped under. NEVER inferred from overlapping dates (§0.1).';
comment on column public.visits.trip_marked is
  'A person said "count this as a trip". A multi-day visit qualifies WITHOUT it (§0.4).';
comment on column public.visits.source is
  'manual | evidence | import | approved_suggestion — how this row came to exist.';
comment on column public.visits.accepted_at is
  'When a person accepted this visit. Unaccepted visits never count (§0.4).';

-- source is a closed vocabulary; a typo must not become a new category silently.
alter table public.visits drop constraint if exists visits_source_check;
alter table public.visits add constraint visits_source_check
  check (source in ('manual','evidence','import','approved_suggestion'));

-- §0.3's constraints. end_date >= start_date is asserted rather than assumed: the
-- preflight found 0 violations, so this cannot fail on real data.
alter table public.visits drop constraint if exists visits_dates_ordered;
alter table public.visits add constraint visits_dates_ordered
  check (end_date >= start_date);

alter table public.visits drop constraint if exists visits_not_own_parent;
alter table public.visits add constraint visits_not_own_parent
  check (parent_visit_id is null or parent_visit_id <> id);

create index if not exists visits_parent_visit_id_idx on public.visits(parent_visit_id)
  where parent_visit_id is not null;
create index if not exists visits_accepted_taken_idx on public.visits(place_id)
  where accepted_at is not null and status = 'taken';

-- ---------------------------------------------------------------------------
-- Backfill. Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------

-- The existing human decision keeps its meaning under its new name.
update public.visits set trip_marked = true
 where is_trip and not trip_marked;

-- Every visit that exists today is Erica's real history and is accepted. `manual`
-- marks the ones a person demonstrably touched (0157); the rest are still hers.
update public.visits
   set accepted_at = coalesce(accepted_at, decided_at, created_at, now())
 where accepted_at is null;

update public.visits set source = 'evidence'
 where source = 'manual' and not manual and decided_at is null;

-- ---------------------------------------------------------------------------
-- THE ONE DEFINITION (§0.4). Everything reads this; nothing reimplements it.
-- ---------------------------------------------------------------------------
create or replace function public.counts_as_trip(v public.visits)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select v.status = 'taken'
     and v.accepted_at is not null
     and (v.end_date > v.start_date or v.trip_marked);
$function$;

comment on function public.counts_as_trip(public.visits) is
  'THE canonical trip test (§0.4). Every trip number, list, drill-down and card must '
  'call this. No UI component may reimplement it.';

-- The accepted/taken view every count reads (§0.4). A view, not a cache: at 489 rows
-- correctness beats speed, and §0.4 forbids trusting stale flags.
create or replace view public.accepted_visits as
  select v.*,
         public.counts_as_trip(v.*) as is_trip_qualified,
         (v.parent_visit_id is null) as is_headline
    from public.visits v
   where v.status = 'taken'
     and v.accepted_at is not null;

comment on view public.accepted_visits is
  'Accepted, taken visits — the only rows historical statistics may count (§0.4).';

revoke all on public.accepted_visits from public, anon;
grant select on public.accepted_visits to authenticated;

-- ---------------------------------------------------------------------------
-- One decision, two spellings, until the readers move (phase 8 removes is_trip).
-- ---------------------------------------------------------------------------
create or replace function public.visits_sync_trip_flags()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.is_trip and not new.trip_marked then new.trip_marked := true;
    elsif new.trip_marked and not new.is_trip then new.is_trip := true;
    end if;

    -- A VISIT A PERSON CREATES IS ACCEPTED IMMEDIATELY.
    --
    -- Without this, every new visit arrives with accepted_at = NULL, counts_as_trip()
    -- rejects it, and it is absent from every statistic — Erica logs a visit and it
    -- vanishes. The test below caught exactly that.
    --
    -- auth.uid() is non-null only inside a real person's request; cron jobs and edge
    -- functions run as service_role with no uid, so machine-created rows still arrive
    -- UNACCEPTED and wait for review, which is what §0.3 requires.
    if new.accepted_at is null and auth.uid() is not null then
      new.accepted_at := now();
      new.accepted_by := auth.uid();
    end if;
  else
    -- whichever one this statement actually changed wins
    if new.trip_marked is distinct from old.trip_marked then new.is_trip := new.trip_marked;
    elsif new.is_trip is distinct from old.is_trip then new.trip_marked := new.is_trip;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $function$;

revoke all on function public.visits_sync_trip_flags() from public, anon, authenticated;

drop trigger if exists visits_sync_trip_flags on public.visits;
create trigger visits_sync_trip_flags
  before insert or update on public.visits
  for each row execute function public.visits_sync_trip_flags();

commit;
