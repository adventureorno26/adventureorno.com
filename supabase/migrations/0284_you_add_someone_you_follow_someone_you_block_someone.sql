-- 0284 — you add someone, you follow someone, you block someone.
--
-- docs/STATE.md §CONNECTING TO SOMEONE, approved 2026-08-30:
--
--   | Add    | MUTUAL   — both sides agree     | they see what you share with people you added |
--   | Follow | ONE-WAY  — no approval          | they see only what you made public            |
--
--   "You can add, remove and block. Blocking is bidirectional and enforced in RLS, never
--    only in the UI — a blocked user must not be able to reach the data by calling the API
--    directly."
--
-- And the word is **add**. Erica, 2026-08-30: *"I don't know that I want to use the term
-- friend, just add."* No table, column, constraint, function, argument or comment in this
-- file says the other word.
--
-- Before this file there is nothing: no connections, no requests, no blocking. `profiles`
-- has six columns and `profiles_select` is `is_member()`, meaning every account can see
-- every other account and always could.
--
-- ===========================================================================
-- ONE TABLE WITH A TYPE, OR TWO? — TWO, AND HERE IS THE REASON.
-- ===========================================================================
-- The two relationships are not the same SHAPE, and the difference is not cosmetic:
--
--   * an **add** is an UNDIRECTED PAIR carrying a STATE. {A,B} is one fact with one
--     answer. Storing it as A→B and B→A is storing one fact twice, which is the defect
--     this repository keeps having (0278, 0280). It wants a canonical ordering.
--
--   * a **follow** is a DIRECTED EDGE with no state at all. A→B and B→A are two
--     genuinely different facts that may both be true, and a canonical ordering would
--     be actively WRONG for it — it would collapse "I follow you" and "you follow me"
--     into one row and lose which is which.
--
-- One table with a `kind` column therefore cannot carry the constraint that matters. It
-- would have to either drop the canonical ordering (and lose the guarantee that an add
-- cannot be stored twice) or apply it conditionally — two different row shapes in one
-- table, where every reader has to remember which shape it is looking at and every
-- constraint becomes a CASE. That is not one table; it is two tables sharing a name.
--
-- So: `connection_adds` (undirected, stateful), `connection_follows` (directed, stateless),
-- and `connection_blocks` (directed at the point of writing, symmetric at the point of
-- enforcement — see below). Three narrow tables, each with constraints that are true of
-- every row in it.
--
-- ===========================================================================
-- ORDERING — the answer to "a mutual relationship must not be storable twice".
-- ===========================================================================
-- CANONICAL ORDERING, not a two-way uniqueness trick. `connection_adds` stores
-- (profile_low, profile_high) with `check (profile_low < profile_high)` and the pair as
-- the PRIMARY KEY. uuid has a total order, so {A,B} has exactly one legal representation
-- and the second insert is a primary-key violation rather than a race the application is
-- trusted to avoid. Nothing may write the table directly (no INSERT/UPDATE/DELETE grant),
-- and the RPCs canonicalise with least()/greatest().
--
-- ===========================================================================
-- BLOCKING — bidirectional, and enforced in three layers because RLS alone is not enough
-- ===========================================================================
-- A block is WRITTEN one-way (`blocker` blocked `blocked`, so unblocking is unambiguous)
-- and READ symmetrically: `is_blocked_between(a, b)` is true if either blocked the other.
-- Every enforcement point below calls that, so there is no direction in which the rule
-- is weaker.
--
--   1. RLS on the data itself — profiles, people, memory_people, visits, activities,
--      photos, places. This is the layer STATE.md names, and it is what stops a blocked
--      user reaching the rows by calling PostgREST directly with their own token.
--
--   2. TRIGGERS on people and memory_people. This codebase reaches its tables through
--      ~200 SECURITY DEFINER functions (`tag_person_on_photo`, `set_visit_participants`,
--      `create_visit`, …) and a SECURITY DEFINER function BYPASSES RLS. An RLS-only rule
--      would therefore be true of the API and false of the app, which is the worst
--      possible place for a security rule to be half-true. A trigger fires for the owner
--      too, so "you cannot tag someone who has blocked you" holds on every path without
--      rewriting a single one of those functions.
--
--   3. The block RPC removes what already exists, and a trigger guarantees it: blocking
--      deletes the add row and BOTH follow rows for the pair, whatever created the block.
--
-- WHAT IS DELIBERATELY NOT COVERED, said plainly rather than left to be discovered: the
-- ~120 SECURITY DEFINER stat readers (`settings_stats_for_people`, `person_memories`, …)
-- still bypass RLS, so a blocked pair can still appear in each other's aggregates. That is
-- the SAME hole §THE THREE SECURITY DEFINER VIEWS already schedules for the partition
-- (item 9), and closing it here would mean rewriting a hundred functions that are about to
-- be rewritten anyway. `can_see_memory_subject` is the one such reader fixed here, because
-- it is the gate the memory tables' own policies call.

begin;

-- ===========================================================================
-- 1. THE TABLES
-- ===========================================================================

-- ---- add: mutual, and one row per pair -------------------------------------
create table if not exists public.connection_adds (
  profile_low  uuid        not null references public.profiles(id) on delete cascade,
  profile_high uuid        not null references public.profiles(id) on delete cascade,
  requested_by uuid        not null references public.profiles(id) on delete cascade,
  status       text        not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_by   uuid        references public.profiles(id) on delete set null,
  decided_at   timestamptz,
  primary key (profile_low, profile_high),
  -- The canonical ordering. This is the constraint that makes A→B and B→A the same row.
  constraint connection_adds_canonical_order check (profile_low < profile_high),
  -- 'declined' is kept rather than deleted: 0241 established that an answer is given once.
  -- 'accepted' is the only status in which anything is shared.
  constraint connection_adds_status check (status in ('pending', 'accepted', 'declined')),
  constraint connection_adds_requester_is_a_party
    check (requested_by in (profile_low, profile_high)),
  -- Only the OTHER side answers. You cannot accept your own request.
  constraint connection_adds_decided_by_the_other_side
    check (decided_by is null
           or (decided_by in (profile_low, profile_high) and decided_by <> requested_by)),
  constraint connection_adds_decided_together
    check ((decided_by is null) = (decided_at is null)),
  constraint connection_adds_answered_status
    check ((status = 'pending') = (decided_by is null))
);

comment on table public.connection_adds is
  'A MUTUAL connection between two accounts (docs/STATE.md §CONNECTING TO SOMEONE). One row '
  'per pair, canonically ordered profile_low < profile_high, so the relationship cannot be '
  'stored twice and removal by either side is symmetric by construction — there is only one '
  'row to remove. `pending` until the other side answers; `declined` is kept, not deleted, '
  'so a question is answered once (0284).';
comment on column public.connection_adds.requested_by is
  'Which of the two asked. The other one — and only the other one — may accept or decline.';
comment on column public.connection_adds.status is
  'pending | accepted | declined. Only `accepted` shares anything. Removing an accepted add '
  'DELETES the row rather than setting a fourth status, so either side may ask again later; '
  'blocking, not removal, is the way to make it permanent.';

create index if not exists connection_adds_high_idx on public.connection_adds (profile_high);
create index if not exists connection_adds_pending_idx
  on public.connection_adds (requested_by) where status = 'pending';

-- ---- follow: one-way, no approval ------------------------------------------
create table if not exists public.connection_follows (
  follower   uuid        not null references public.profiles(id) on delete cascade,
  followed   uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followed),
  constraint connection_follows_not_self check (follower <> followed)
);

comment on table public.connection_follows is
  'A ONE-WAY follow. No approval, and deliberately NOT canonically ordered: (A,B) and (B,A) '
  'are two different true facts, which is precisely why this is not the same table as '
  'connection_adds. A follow grants nothing on its own — the follower sees only what the '
  'followed person has chosen to make public (0284).';

create index if not exists connection_follows_followed_idx on public.connection_follows (followed);

-- ---- block: written one-way, enforced both ways ----------------------------
create table if not exists public.connection_blocks (
  blocker    uuid        not null references public.profiles(id) on delete cascade,
  blocked    uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint connection_blocks_not_self check (blocker <> blocked)
);

comment on table public.connection_blocks is
  'A block. Stored one-way so that unblocking is unambiguous — only the person who blocked '
  'can unblock — but ENFORCED symmetrically everywhere via is_blocked_between(): neither '
  'party can read, look up or tag the other. The blocked party cannot read this table, so '
  'they are not told (0284).';

create index if not exists connection_blocks_blocked_idx on public.connection_blocks (blocked);

-- ===========================================================================
-- 2. THE PREDICATE EVERY RULE BELOW IS WRITTEN IN TERMS OF
-- ===========================================================================
-- SECURITY DEFINER on purpose: the blocked party cannot SELECT the block row (see the
-- policy below), so an invoker-rights version would answer "not blocked" for exactly the
-- person the rule exists to stop. Null-safe, because most callers pass a nullable column.
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (select 1 from public.connection_blocks b
                  where (b.blocker = p_a and b.blocked = p_b)
                     or (b.blocker = p_b and b.blocked = p_a));
$$;

comment on function public.is_blocked_between(uuid, uuid) is
  'Is there a block between these two accounts, in EITHER direction? The single predicate '
  'every RLS policy, trigger and RPC in 0284 is written in terms of, so that "bidirectional" '
  'is a property of one function rather than a discipline applied twenty times.';

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- ===========================================================================
-- 3. RLS ON THE THREE NEW TABLES
-- ===========================================================================
-- Read-only to `authenticated`. There is no INSERT/UPDATE/DELETE grant at all, so the RPCs
-- below are the only door — a client cannot forge a `status = 'accepted'` row for a pair it
-- is not part of, because it cannot write the table under any policy.
alter table public.connection_adds    enable row level security;
alter table public.connection_follows enable row level security;
alter table public.connection_blocks  enable row level security;

drop policy if exists connection_adds_select on public.connection_adds;
create policy connection_adds_select on public.connection_adds for select to authenticated
  using ((select auth.uid()) in (profile_low, profile_high)
         and not public.is_blocked_between(profile_low, profile_high));

drop policy if exists connection_follows_select on public.connection_follows;
create policy connection_follows_select on public.connection_follows for select to authenticated
  using ((select auth.uid()) in (follower, followed)
         and not public.is_blocked_between(follower, followed));

-- Only the blocker. Telling somebody they have been blocked is a feature nobody asked for.
drop policy if exists connection_blocks_select on public.connection_blocks;
create policy connection_blocks_select on public.connection_blocks for select to authenticated
  using (blocker = (select auth.uid()));

-- THE REVOKE IS THE LOAD-BEARING LINE, not the grant. `postgres` has ALTER DEFAULT
-- PRIVILEGES in this schema granting `arwdxtm` — INSERT, UPDATE and DELETE included — to
-- `authenticated` on every new table, so a table created and left alone is a table a client
-- can write. `memory_people` and `tag_claims` already carry the same correction (rxtm).
revoke all on table public.connection_adds    from public, anon, authenticated;
revoke all on table public.connection_follows from public, anon, authenticated;
revoke all on table public.connection_blocks  from public, anon, authenticated;

grant select on public.connection_adds    to authenticated;
grant select on public.connection_follows to authenticated;
grant select on public.connection_blocks  to authenticated;

-- ===========================================================================
-- 4. TRIGGERS — the layer that survives SECURITY DEFINER
-- ===========================================================================

-- A block ends whatever existed. Written as a trigger and not only in block_profile() so
-- that it is true of the DATA rather than of one code path.
create or replace function public.connections_block_clears_the_rest()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.connection_adds
   where profile_low  = least(new.blocker, new.blocked)
     and profile_high = greatest(new.blocker, new.blocked);
  delete from public.connection_follows
   where (follower = new.blocker and followed = new.blocked)
      or (follower = new.blocked and followed = new.blocker);
  return null;
end $$;

comment on function public.connections_block_clears_the_rest() is
  'Blocking removes the add and both follows for the pair. A trigger rather than a line in '
  'block_profile(), so it holds however the block row arrived (0284).';

revoke all on function public.connections_block_clears_the_rest() from public, anon, authenticated;

drop trigger if exists connection_blocks_clear_the_rest on public.connection_blocks;
create trigger connection_blocks_clear_the_rest
  after insert on public.connection_blocks
  for each row execute function public.connections_block_clears_the_rest();

-- And nothing may be created across a block, whichever table.
create or replace function public.connections_refuse_across_a_block()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare a uuid; b uuid;
begin
  if tg_table_name = 'connection_adds' then
    a := new.profile_low; b := new.profile_high;
  else
    a := new.follower; b := new.followed;
  end if;
  if public.is_blocked_between(a, b) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.connections_refuse_across_a_block() from public, anon, authenticated;

drop trigger if exists connection_adds_refuse_across_a_block on public.connection_adds;
create trigger connection_adds_refuse_across_a_block
  before insert or update on public.connection_adds
  for each row execute function public.connections_refuse_across_a_block();

drop trigger if exists connection_follows_refuse_across_a_block on public.connection_follows;
create trigger connection_follows_refuse_across_a_block
  before insert on public.connection_follows
  for each row execute function public.connections_refuse_across_a_block();

-- ---- you cannot record, link to, or tag a blocked account ------------------
-- `people` is how somebody enters this app's memory at all, and `memory_people` is how they
-- get onto a card. Both are written almost exclusively through SECURITY DEFINER functions,
-- so the RLS added in §5 does not fire for them. These triggers do.
create or replace function public.people_refuse_a_blocked_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.linked_profile is not null
     and public.is_blocked_between(new.linked_profile, auth.uid()) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.people_refuse_a_blocked_link() from public, anon, authenticated;

drop trigger if exists people_refuse_a_blocked_link on public.people;
create trigger people_refuse_a_blocked_link
  before insert or update of linked_profile on public.people
  for each row execute function public.people_refuse_a_blocked_link();

create or replace function public.memory_people_refuse_a_blocked_tag()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.people pe
              where pe.id = new.person_id
                and public.is_blocked_between(pe.linked_profile, auth.uid())) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  return new;
end $$;

comment on function public.memory_people_refuse_a_blocked_tag() is
  'You cannot tag somebody you have blocked, or somebody who has blocked you — on either '
  'side, and on every path, because a trigger fires where RLS does not: this table is '
  'written by SECURITY DEFINER functions that bypass policies entirely (0284).';

revoke all on function public.memory_people_refuse_a_blocked_tag() from public, anon, authenticated;

drop trigger if exists memory_people_refuse_a_blocked_tag on public.memory_people;
create trigger memory_people_refuse_a_blocked_tag
  before insert or update on public.memory_people
  for each row execute function public.memory_people_refuse_a_blocked_tag();

-- ===========================================================================
-- 5. THE EXISTING POLICIES LEARN THE RULE
-- ===========================================================================
-- Every change here is a conjunction added to a policy that already existed. Nothing is
-- widened; with no blocks in the table `is_blocked_between` is false for every pair and the
-- predicates are exactly what they were.

-- LOOKUPS. `profiles_select` was `is_member()` — everyone sees everyone. This is the row a
-- person-picker reads, so it is where "cannot appear in their lookups" has to be true.
drop policy if exists profiles_select on public.profiles;
-- YOUR OWN ROW, ALWAYS — restored 2026-08-30 during integration review.
-- 0283 wrote this policy as `id = auth.uid() or is_member()`; this file was written
-- independently and rewrote it as `is_member() and not blocked`, silently dropping the
-- own-row clause. Applied in order, this one wins, and the moment `is_member()` returns
-- false for you — which is precisely what the spaces partition changes — you could not
-- read your own profile and would be locked out of your own settings.
-- A self-block cannot exist, so the own-row branch needs no block check.
create policy profiles_select on public.profiles for select
  using (
    id = (select auth.uid())
    or (public.is_member() and not public.is_blocked_between(id, (select auth.uid())))
  );

-- PEOPLE. Both the account they are and the account that recorded them.
drop policy if exists people_read on public.people;
create policy people_read on public.people for select
  using (((owner_profile = (select auth.uid()))
          or (linked_profile = (select auth.uid()))
          or public.person_on_visible_memory(id)
          or public.person_on_visible_visit(id))
         and not public.is_blocked_between(owner_profile, (select auth.uid()))
         and not public.is_blocked_between(linked_profile, (select auth.uid())));

drop policy if exists people_write on public.people;
create policy people_write on public.people for all
  using (owner_profile = (select auth.uid()) and public.is_editor_or_owner())
  with check (owner_profile = (select auth.uid()) and public.is_editor_or_owner()
              and not public.is_blocked_between(linked_profile, (select auth.uid())));

-- TAGGING.
drop policy if exists memory_people_write on public.memory_people;
create policy memory_people_write on public.memory_people for all
  using (public.is_editor_or_owner()
         and exists (select 1 from public.memory_subjects s
                      where s.id = memory_people.subject_id
                        and s.owner_profile = (select auth.uid())))
  with check (public.is_editor_or_owner()
              and exists (select 1 from public.memory_subjects s
                           where s.id = memory_people.subject_id
                             and s.owner_profile = (select auth.uid()))
              and not exists (select 1 from public.people pe
                               where pe.id = memory_people.person_id
                                 and public.is_blocked_between(pe.linked_profile,
                                                               (select auth.uid()))));

-- THE DATA. Today every one of these begins with `is_member()`, because the space partition
-- (item 9) has not landed — so "cannot read the blocker's data" has to be said explicitly
-- against the owning column each table already carries. These conjunctions stay correct
-- after the partition; they are about a person, not about a space.
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select
  using (public.is_member()
         and not public.is_blocked_between(created_by, (select auth.uid())));

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select
  using (public.is_member()
         and not public.is_blocked_between(owner_profile, (select auth.uid()))
         and ((lower(coalesce(original_source, '')) <> 'strava')
              or (owner_profile = (select auth.uid()))
              or exists (select 1
                           from public.activity_profiles ap
                           join public.profiles ow on ow.id = activities.owner_profile
                          where ap.activity_id = activities.id
                            and ap.profile_id = (select auth.uid())
                            and coalesce(ap.claim_status, 'accepted') <> 'rejected'
                            and ow.share_tagged_outings)));

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select
  using (deleted_at is null
         and public.is_member()
         and not public.is_blocked_between(uploaded_by, (select auth.uid()))
         and ((uploaded_by = (select auth.uid()))
              or (uploaded_by is null and public.is_owner())
              or (place_id is not null and public.place_is_saved(place_id))));

drop policy if exists places_select on public.places;
create policy places_select on public.places for select
  using (deleted_at is null
         and public.is_member()
         and not public.is_blocked_between(created_by, (select auth.uid()))
         and (saved
              or (created_by = (select auth.uid()))
              or (created_by is null and public.is_owner())));

-- THE MEMORY GATE. `memory_subjects` and `memory_people` are read through this SECURITY
-- DEFINER function, which re-implements the photo predicate inline and therefore does not
-- inherit the policy above. One conjunction, at the owner of the subject.
create or replace function public.can_see_memory_subject(p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.memory_subjects s
     where s.id = p_subject
       and public.is_member()
       and not public.is_blocked_between(s.owner_profile, auth.uid())
       and case s.kind
             when 'photo' then exists (
               select 1 from public.photos ph
                where ph.id = s.photo_id
                  and ph.deleted_at is null
                  and (ph.uploaded_by = auth.uid()
                    or (ph.uploaded_by is null and public.is_owner())
                    or (ph.place_id is not null and public.place_is_saved(ph.place_id))))
             when 'outing' then public.can_see_activity(s.activity_id)
             else false
           end);
$$;

revoke all on function public.can_see_memory_subject(uuid) from public, anon;
grant execute on function public.can_see_memory_subject(uuid) to authenticated;

-- THE PERSON PICKER. SECURITY DEFINER, so it reads `people` past the policy above; the
-- lookup a person actually uses has to obey the rule too.
create or replace function public.my_people()
returns table(id uuid, display_name text, linked_profile uuid, favourite boolean, is_me boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select pe.id, pe.display_name, pe.linked_profile, pe.favourite,
         pe.linked_profile is not distinct from auth.uid()
    from public.people pe
   where pe.owner_profile = auth.uid()
     and pe.deleted_at is null
     and not public.is_blocked_between(pe.linked_profile, auth.uid())
   order by (pe.linked_profile is not distinct from auth.uid()) desc,
            pe.favourite desc, lower(pe.display_name);
$$;

revoke all on function public.my_people() from public, anon;
grant execute on function public.my_people() to authenticated;

-- ===========================================================================
-- 6. THE DOORS
-- ===========================================================================
-- Every one of these takes the OTHER person's id and derives the caller from auth.uid().
-- None of them accepts "who I am" as an argument, so a client cannot act as somebody else
-- by changing a parameter — the failure the import RPCs had until 0234.

create or replace function public.connections_other_party(p_profile uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_profile is null or p_profile = v_me then
    raise exception 'that is not somebody else';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'no such account';
  end if;
  -- Deliberately the SAME message as "no such account" would give: a blocked person must
  -- not be able to tell a block apart from an account that does not exist.
  if public.is_blocked_between(p_profile, v_me) then
    raise exception 'no such account';
  end if;
  return v_me;
end $$;

comment on function public.connections_other_party(uuid) is
  'Shared preamble for the connection RPCs: the caller is a member, the target is somebody '
  'else who exists, and there is no block between them. Returns the CALLER, from auth.uid() '
  'and never from an argument (0284).';

revoke all on function public.connections_other_party(uuid) from public, anon;
grant execute on function public.connections_other_party(uuid) to authenticated;

-- ---- ask ------------------------------------------------------------------
create or replace function public.request_add(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me   uuid := public.connections_other_party(p_profile);
  v_low  uuid := least(p_profile, auth.uid());
  v_high uuid := greatest(p_profile, auth.uid());
  v_row  public.connection_adds%rowtype;
begin
  select * into v_row from public.connection_adds
   where profile_low = v_low and profile_high = v_high for update;

  if not found then
    insert into public.connection_adds (profile_low, profile_high, requested_by)
    values (v_low, v_high, v_me);
    return jsonb_build_object('status', 'pending', 'asked', true);
  end if;

  if v_row.status = 'accepted' then
    return jsonb_build_object('status', 'accepted', 'asked', false);
  end if;

  if v_row.status = 'pending' then
    if v_row.requested_by = v_me then
      return jsonb_build_object('status', 'pending', 'asked', false);
    end if;
    -- They asked, and now so have you. Two people saying yes is an accepted add; making
    -- them find the other button would be ceremony, not consent.
    update public.connection_adds
       set status = 'accepted', decided_by = v_me, decided_at = now()
     where profile_low = v_low and profile_high = v_high;
    return jsonb_build_object('status', 'accepted', 'asked', false);
  end if;

  -- declined. The person who was refused does not get to ask again; the person who
  -- refused may change their mind and ask.
  if v_row.requested_by = v_me then
    raise exception 'that was already answered' using errcode = '42501';
  end if;
  update public.connection_adds
     set status = 'pending', requested_by = v_me, requested_at = now(),
         decided_by = null, decided_at = null
   where profile_low = v_low and profile_high = v_high;
  return jsonb_build_object('status', 'pending', 'asked', true);
end $$;

create or replace function public.accept_add(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := public.connections_other_party(p_profile);
  v_n  int;
begin
  update public.connection_adds
     set status = 'accepted', decided_by = v_me, decided_at = now()
   where profile_low  = least(p_profile, v_me)
     and profile_high = greatest(p_profile, v_me)
     and status = 'pending'
     and requested_by = p_profile;          -- only the side that did NOT ask may answer
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'there is nothing to accept'; end if;
  return jsonb_build_object('status', 'accepted');
end $$;

create or replace function public.decline_add(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := public.connections_other_party(p_profile);
  v_n  int;
begin
  update public.connection_adds
     set status = 'declined', decided_by = v_me, decided_at = now()
   where profile_low  = least(p_profile, v_me)
     and profile_high = greatest(p_profile, v_me)
     and status = 'pending'
     and requested_by = p_profile;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'there is nothing to decline'; end if;
  return jsonb_build_object('status', 'declined');
end $$;

-- Symmetric by construction: there is one row for the pair, and either side deletes it.
-- Cancelling a request you made is the same call.
create or replace function public.remove_add(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := public.connections_other_party(p_profile);
  v_n  int;
begin
  delete from public.connection_adds
   where profile_low  = least(p_profile, v_me)
     and profile_high = greatest(p_profile, v_me)
     and (status = 'accepted' or (status = 'pending' and requested_by = v_me));
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n > 0);
end $$;

-- ---- follow ---------------------------------------------------------------
create or replace function public.follow_profile(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_me uuid := public.connections_other_party(p_profile);
begin
  insert into public.connection_follows (follower, followed)
  values (v_me, p_profile)
  on conflict (follower, followed) do nothing;
  return jsonb_build_object('following', true);
end $$;

create or replace function public.unfollow_profile(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_me uuid := public.connections_other_party(p_profile);
begin
  delete from public.connection_follows where follower = v_me and followed = p_profile;
  return jsonb_build_object('following', false);
end $$;

-- ---- block ----------------------------------------------------------------
-- NOT routed through connections_other_party: that helper refuses when a block exists, and
-- blocking somebody you have already blocked must be idempotent rather than an error.
create or replace function public.block_profile(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_profile is null or p_profile = v_me then
    raise exception 'that is not somebody else';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'no such account';
  end if;
  insert into public.connection_blocks (blocker, blocked)
  values (v_me, p_profile)
  on conflict (blocker, blocked) do nothing;
  -- The trigger has already removed the add and both follows.
  return jsonb_build_object('blocked', true);
end $$;

-- Unblocking restores NOTHING. Whatever the block removed stays removed; if you want to be
-- connected again, ask again.
create or replace function public.unblock_profile(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_me uuid := auth.uid(); v_n int;
begin
  if not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.connection_blocks where blocker = v_me and blocked = p_profile;
  get diagnostics v_n = row_count;
  return jsonb_build_object('blocked', false, 'was_blocked', v_n > 0);
end $$;

-- ---- list -----------------------------------------------------------------
-- One call, one shape. `relation` says which of the three it is; `direction` says which way
-- it points, and is 'mutual' only for an accepted add.
create or replace function public.my_connections()
returns table(profile_id uuid, display_name text, relation text, status text,
              direction text, since timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select auth.uid() as id)
  select x.profile_id, pr.display_name, x.relation, x.status, x.direction, x.since
    from (
      select case when a.profile_low = me.id then a.profile_high else a.profile_low end,
             'add',
             a.status,
             case when a.status = 'accepted' then 'mutual'
                  when a.requested_by = me.id then 'outgoing'
                  else 'incoming' end,
             coalesce(a.decided_at, a.requested_at)
        from public.connection_adds a, me
       where me.id in (a.profile_low, a.profile_high)
         and a.status in ('pending', 'accepted')
      union all
      select case when f.follower = me.id then f.followed else f.follower end,
             'follow', 'accepted',
             case when f.follower = me.id then 'outgoing' else 'incoming' end,
             f.created_at
        from public.connection_follows f, me
       where me.id in (f.follower, f.followed)
      union all
      select b.blocked, 'block', 'accepted', 'outgoing', b.created_at
        from public.connection_blocks b, me
       where b.blocker = me.id
    ) as x(profile_id, relation, status, direction, since)
    join public.profiles pr on pr.id = x.profile_id
   -- SECURITY DEFINER reads `profiles` past its policy, so the rule is repeated here. A
   -- block row itself is exempt: you must be able to see your own block list to undo it.
   where x.relation = 'block'
      or not public.is_blocked_between(x.profile_id, auth.uid())
   order by x.relation, x.since desc;
$$;

comment on function public.my_connections() is
  'Every connection this account has, in one shape: relation add|follow|block, direction '
  'mutual|outgoing|incoming, status pending|accepted. Takes no profile id — the caller is '
  'auth.uid() (0284).';

-- ---- grants ---------------------------------------------------------------
-- A new SECURITY DEFINER function default-grants EXECUTE to PUBLIC, which is how 0101
-- reopened what 0093 closed. Every one of them is revoked from public and anon here, and
-- scripts/db-test.sh fails the build if one is missed.
revoke all on function public.request_add(uuid)      from public, anon;
revoke all on function public.accept_add(uuid)       from public, anon;
revoke all on function public.decline_add(uuid)      from public, anon;
revoke all on function public.remove_add(uuid)       from public, anon;
revoke all on function public.follow_profile(uuid)   from public, anon;
revoke all on function public.unfollow_profile(uuid) from public, anon;
revoke all on function public.block_profile(uuid)    from public, anon;
revoke all on function public.unblock_profile(uuid)  from public, anon;
revoke all on function public.my_connections()       from public, anon;

grant execute on function public.request_add(uuid)      to authenticated;
grant execute on function public.accept_add(uuid)       to authenticated;
grant execute on function public.decline_add(uuid)      to authenticated;
grant execute on function public.remove_add(uuid)       to authenticated;
grant execute on function public.follow_profile(uuid)   to authenticated;
grant execute on function public.unfollow_profile(uuid) to authenticated;
grant execute on function public.block_profile(uuid)    to authenticated;
grant execute on function public.unblock_profile(uuid)  to authenticated;
grant execute on function public.my_connections()       to authenticated;

-- ===========================================================================
-- 7. THE FILE CHECKS ITSELF
-- ===========================================================================
do $$
declare bad text;
begin
  -- (a) No SECURITY DEFINER function introduced here is reachable by the anon key that
  --     ships in the client bundle.
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname in ('is_blocked_between','request_add','accept_add','decline_add',
                       'remove_add','follow_profile','unfollow_profile','block_profile',
                       'unblock_profile','my_connections','connections_other_party',
                       'my_people','can_see_memory_subject',
                       'connections_block_clears_the_rest','connections_refuse_across_a_block',
                       'people_refuse_a_blocked_link','memory_people_refuse_a_blocked_tag')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then
    raise exception 'anon can execute: % — lockdown regression', bad;
  end if;

  -- (b) The word this repository does not use. Erica, 2026-08-30.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name like 'connection\_%'
                and column_name ilike '%friend%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname ilike '%friend%') then
    raise exception 'the word is add, not the other one';
  end if;

  -- (c) The canonical ordering is a constraint, not a convention.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.connection_adds'::regclass
                    and conname = 'connection_adds_canonical_order') then
    raise exception 'connection_adds lost its canonical ordering check';
  end if;

  -- (d) Nothing may write the connection tables directly.
  select string_agg(t, ', ') into bad from (
    select unnest(array['connection_adds','connection_follows','connection_blocks']) as t
  ) s where has_table_privilege('authenticated', 'public.' || s.t, 'INSERT')
        or has_table_privilege('authenticated', 'public.' || s.t, 'UPDATE')
        or has_table_privilege('authenticated', 'public.' || s.t, 'DELETE');
  if bad is not null then
    raise exception 'a client can write % directly — the RPCs are meant to be the only door', bad;
  end if;
end $$;

commit;
