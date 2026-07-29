-- 0096 — Make place_membership the canonical, constrained hierarchy relation.
--
-- ADR 0001 (docs/adr/0001-place-visit-entry-trip-model.md). place_membership
-- (child_id, parent_id) already mirrors every VALID places.part_of pair (measured:
-- 230 rows, 0 dangling, 0 cycles, 0 duplicates); part_of additionally carries 7
-- dangling parent refs. This migration hardens place_membership so it can replace
-- part_of, and quarantines bad data WITHOUT repairing it (ambiguous → human ruling).
--
-- ADDITIVE + REVERSIBLE. Adds a column, a table, constraints, and one trigger;
-- deletes no data; does not touch part_of or the sync trigger (which is already
-- FK-safe: it only inserts memberships whose parent exists). Trips are unaffected
-- (a separate, concurrent feature). part_of is retired in a LATER migration, only
-- after every reader uses place_membership.
--
-- VERIFY on a DISPOSABLE local stack (never production):
--   supabase start && supabase db reset      # applies 0001..0096
--   psql "$LOCAL_DB" -f supabase/tests/0096_place_membership.test.sql
-- Read-only preflight already run against prod (SELECT only, no apply):
--   230/230 valid FKs · 0 duplicate pairs · 0 cycles · 7 dangling part_of · 1 non-container parent.
--
-- ROLLBACK (reverse order):
--   drop trigger if exists trg_place_membership_no_cycle on public.place_membership;
--   drop function if exists public.place_membership_no_cycle();
--   alter table public.place_membership drop constraint if exists place_membership_child_fk;
--   alter table public.place_membership drop constraint if exists place_membership_parent_fk;
--   alter table public.place_membership drop constraint if exists place_membership_unique_pair;
--   alter table public.place_membership drop constraint if exists place_membership_type_chk;
--   alter table public.place_membership drop column if exists relationship_type;
--   drop table if exists public.place_membership_exceptions;

-- 1) Typed relationship (only genuine geographic containment for now).
alter table public.place_membership
  add column if not exists relationship_type text not null default 'contains';
alter table public.place_membership
  drop constraint if exists place_membership_type_chk;
alter table public.place_membership
  add constraint place_membership_type_chk check (relationship_type in ('contains'));

-- 2) Uniqueness (measured: 0 duplicate pairs, so this validates immediately).
alter table public.place_membership
  drop constraint if exists place_membership_unique_pair;
alter table public.place_membership
  add constraint place_membership_unique_pair unique (child_id, parent_id);

-- 3) Referential integrity to places, cascading on hard-delete so a purge can
--    never leave a dangling membership. NOT VALID first (additive pattern), then
--    VALIDATE — measured 230/230 rows already satisfy it, so VALIDATE succeeds.
alter table public.place_membership
  drop constraint if exists place_membership_child_fk;
alter table public.place_membership
  add constraint place_membership_child_fk
  foreign key (child_id) references public.places(id) on delete cascade not valid;
alter table public.place_membership validate constraint place_membership_child_fk;

alter table public.place_membership
  drop constraint if exists place_membership_parent_fk;
alter table public.place_membership
  add constraint place_membership_parent_fk
  foreign key (parent_id) references public.places(id) on delete cascade not valid;
alter table public.place_membership validate constraint place_membership_parent_fk;

-- 4) Cycle prevention: a new/updated edge may not make the parent a descendant of
--    the child (which would create a loop). Measured 0 current cycles.
create or replace function public.place_membership_no_cycle()
returns trigger
language plpgsql
as $$
begin
  if NEW.child_id = NEW.parent_id then
    raise exception 'place_membership: a place cannot contain itself (%).', NEW.child_id;
  end if;
  -- Is NEW.child_id reachable upward from NEW.parent_id? If so, adding
  -- child←parent closes a cycle.
  if exists (
    with recursive up(id) as (
      select NEW.parent_id
      union
      select m.parent_id from public.place_membership m join up on m.child_id = up.id
    )
    select 1 from up where id = NEW.child_id
  ) then
    raise exception 'place_membership: edge %→% would create a cycle.', NEW.child_id, NEW.parent_id;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_place_membership_no_cycle on public.place_membership;
create trigger trg_place_membership_no_cycle
  before insert or update on public.place_membership
  for each row execute function public.place_membership_no_cycle();

-- 5) Exceptions quarantine — data that CANNOT be auto-repaired (ambiguous), for a
--    human ruling. Populated data-drivenly (0 rows on a clean seed; 7+1 on prod).
create table if not exists public.place_membership_exceptions (
  child_id uuid,
  parent_id uuid,
  reason text not null,
  detected_at timestamptz not null default now()
);

-- 5a) part_of pairs whose parent place no longer exists (dangling). These are NOT
--     mirrored into place_membership (the sync trigger skips them); recorded so the
--     stale part_of entries can be reviewed before part_of is dropped.
insert into public.place_membership_exceptions (child_id, parent_id, reason)
select p.id, par, 'dangling_part_of_parent'
from public.places p, unnest(p.part_of) as par
where array_length(p.part_of,1) > 0
  and not exists (select 1 from public.places pp where pp.id = par)
  and not exists (
    select 1 from public.place_membership_exceptions e
    where e.child_id = p.id and e.parent_id = par and e.reason = 'dangling_part_of_parent'
  );

-- 5b) memberships whose parent is not a container (holds_children=false). Recorded,
--     NOT enforced as a hard constraint (the parent may simply need promoting).
insert into public.place_membership_exceptions (child_id, parent_id, reason)
select m.child_id, m.parent_id, 'parent_not_container'
from public.place_membership m
join public.places p on p.id = m.parent_id
where coalesce(p.holds_children, false) = false
  and not exists (
    select 1 from public.place_membership_exceptions e
    where e.child_id = m.child_id and e.parent_id = m.parent_id and e.reason = 'parent_not_container'
  );
