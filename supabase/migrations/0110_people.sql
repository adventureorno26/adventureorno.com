-- 0110 — Non-login "people" records (Prompt 2B).
--
-- The domain contract (ADR 0001 / Prompt 2A) separates *authenticated profiles*
-- (Erica = owner, Josh = editor, viewers = reaction-only) from *people*: children
-- and other companions who are NOT login accounts but can be attached to visits and
-- trips. This adds that entity plus two join tables, additively and reversibly.
-- Nothing here drops or rewrites existing data.
--
-- ROLLBACK (safe — only touches the new tables):
--   drop table if exists public.trip_people;
--   drop table if exists public.visit_people;
--   drop table if exists public.people;

create table if not exists public.people (
  id          uuid primary key default gen_random_uuid(),
  display_name text not null,
  kind        text not null default 'child',
  birthdate   date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint people_name_nonblank check (length(btrim(display_name)) > 0),
  constraint people_kind_valid    check (kind in ('child', 'adult', 'pet', 'other'))
);

-- Who (non-login) was present on a visit / trip. Cascade so removing a person or a
-- visit/trip cleans up its links; the person↔visit link is idempotent (PK).
create table if not exists public.visit_people (
  visit_id   uuid not null references public.visits(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (visit_id, person_id)
);

create table if not exists public.trip_people (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, person_id)
);

create index if not exists visit_people_person_idx on public.visit_people(person_id);
create index if not exists trip_people_person_idx  on public.trip_people(person_id);

alter table public.people        enable row level security;
alter table public.visit_people  enable row level security;
alter table public.trip_people   enable row level security;

-- Members (incl. viewers) may READ people and the links; only owner/editor may write.
-- Mirrors how visits/entries are gated elsewhere. Direct PostgREST table access is
-- fine — the policies are the authorization boundary.
drop policy if exists people_read  on public.people;
drop policy if exists people_write on public.people;
create policy people_read  on public.people for select using (public.is_member());
create policy people_write on public.people for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

drop policy if exists visit_people_read  on public.visit_people;
drop policy if exists visit_people_write on public.visit_people;
create policy visit_people_read  on public.visit_people for select using (public.is_member());
create policy visit_people_write on public.visit_people for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

drop policy if exists trip_people_read  on public.trip_people;
drop policy if exists trip_people_write on public.trip_people;
create policy trip_people_read  on public.trip_people for select using (public.is_member());
create policy trip_people_write on public.trip_people for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- PostgREST needs table grants in addition to RLS; RLS then filters per policy.
grant select on public.people, public.visit_people, public.trip_people to authenticated;
grant insert, update, delete on public.people, public.visit_people, public.trip_people to authenticated;
