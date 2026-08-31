-- 0287 — a space is the boundary, and every rule says so out loud.
--
-- ⚠️ REBASED FROM 0281 TO 0287 BY `feat/space-scope-readers-v2`, AND THE FOUR `_select`
--    POLICIES BELOW WERE MERGED RATHER THAN COPIED. THIS IS A FINDING FOR PR #185.
--
--    PR #185 branched before 0283–0286 and sits in the 0281 slot. Replayed from an empty
--    schema on top of main, NEITHER ORDERING IS CORRECT, and this was measured, not
--    reasoned about:
--
--      * At 0281 (before 0284/0286) — `0281…test.sql` step 2 FAILS with
--        "6 policy/policies on a space-owned table still use the session-wide check",
--        because 0284 and 0286 re-create `places_select`, `photos_select`, `visits_select`
--        and `activities_select` afterwards and the space clause is undone.
--      * At 0287 (after 0286), copied verbatim — the space clause survives and
--        **`not is_blocked_between(...)` is silently dropped from all four**, because
--        0281 was written against the pre-0283 text. That is a blocked person becoming
--        able to see places, photos, visits and activities again: a security regression
--        introduced by a migration whose entire purpose is to tighten visibility.
--
--    So the four policies carry BOTH clauses below. #185 needs this merge whatever number
--    it eventually lands on; nothing else in this file was changed.
--
--
-- Erica, 2026-08-22: *"I want to be able to share this application with other people."*
-- STATE.md §3s step 1: *"Every read policy in the database ends in `is_member()` — are you
-- signed in to this household — so `places_select`, `photos_select` and the rest hand a new
-- account Erica and Josh's entire history. So today 'add a user' and 'give somebody all of
-- my data' are the same button."*
--
-- MEASURED ON PRODUCTION, 2026-08-30, every count inside `begin … rollback`:
--
--     58 tables · 81 policies · 205 SECURITY DEFINER functions
--     44 policies whose qualifier calls is_member()
--     public.is_member() is, in full:
--         select exists (select 1 from public.profiles where id = auth.uid())
--
-- That is the whole tenancy model: *do you have a row in profiles*. It is not a boundary,
-- it is a turnstile. This migration replaces it with one that can be written down.
--
--
-- ============================================================================
-- WHAT THIS DOES, AND — SAID FIRST — WHAT IT DELIBERATELY DOES NOT
-- ============================================================================
--
-- IT DOES:
--   1. `spaces` and `space_memberships`, with roles that govern WRITES only (§0.2: *"Roles
--      govern writes only. Visibility belongs to the space boundary, never to the role."*).
--   2. `is_member(space_id)`, `is_editor_or_owner(space_id)`, `is_owner(space_id)` —
--      the boundary as a function OF A ROW rather than of a session.
--   3. `space_id` on all 48 space-owned tables, NOT NULL, indexed, defaulted so that every
--      existing INSERT keeps working.
--   4. TWO SPACES: Erica's and Josh's, each owned by its person. Test Bot is placed in
--      Erica's space — required, because he is a member of everything today and would
--      otherwise drop to zero.
--   5. All 70 policies that named the old turnstile rewritten to name a space.
--   6. The three SECURITY DEFINER views get the explicit boundary clause reviewed on
--      `design/definer-views-with-partition`, plus the four invoker views, which need it
--      for the same reason once a definer function reads them.
--   7. `can_see_memory_subject` gains the `visit` branch it never had.
--
-- IT DOES NOT — AND THIS IS THE HALF THAT REMAINS:
--   **It does not move Josh's rows into Josh's space.** Every existing row is backfilled
--   into Erica's space and Josh is an editor of it, exactly as he is today. Josh's own
--   space is created, owned by him, and starts empty.
--
--   That is a decision, not an omission, and the reason is arithmetic. The split itself
--   needs no invention — the tags already determine it, and it was measured here:
--
--       visits      557 = 349 Erica-only + 100 Josh-only + 108 tagged BOTH + 0 unattributed
--       activities  572 = 351 Erica-only + 165 Josh-only +  56 tagged BOTH + 0 unattributed
--       photos      180 = 146 Erica      +  34 Josh           (by uploaded_by)
--       places      168 =  85 Erica-only +   7 Josh-only +  76 reachable from BOTH
--
--   A row tagged with BOTH has to be MATERIALISED INTO BOTH SPACES (Erica, 2026-08-30:
--   *"Materialize the ones he added me to by hitting both to my space and the ones I added
--   him to to his space"*), which means forking 108 visits, 56 outings and 76 places
--   together with every row that hangs off them — 41 foreign keys point at those three
--   tables — and remapping each copy's references to its own space's copies.
--
--   The fork is not the hard part. The hard part is that the ~60 SECURITY DEFINER stat
--   readers bypass RLS by construction, so after a fork they see BOTH copies of every
--   shared card and every person-scoped number doubles on the 108/56 shared rows. Making
--   them space-aware is a second, separately reviewable change. Landing the fork without
--   it would move numbers on Erica's and Josh's screens for a reason nobody chose — which
--   is precisely the abort criterion. So the fork waits, and it waits with its counts
--   already measured rather than with a guess.
--
--   The consequence of stopping here is that NO COUNT CHANGES FOR ANYBODY WHO HAS AN
--   ACCOUNT TODAY, and the leak that mattered closes anyway: a signed-up stranger with a
--   `profiles` row and no membership now reads zero rows from every table and every view,
--   where today they read all 557 visits and all 665 participation rows. §0.2: *"The one
--   thing that must not happen is another person getting an account before it is closed."*
--   This closes it.
--
--
-- ============================================================================
-- WHY THE VIEWS ARE INCLUDED HERE AND NOT LEFT TO RLS
-- ============================================================================
--
-- `activity_profiles`, `activity_provenance` and `visit_profiles` are SECURITY DEFINER, so
-- they run as their owner and ignore the asker's permissions: every member sees all
-- 628 / 572 / 665 rows, and so does a stranger. Erica ruled on 2026-08-30 that they are NOT
-- flipped to invoker, because *"within a space you already share, a card that hides who was
-- there lies by omission"* — flipping costs her 305 participant rows on visits she can still
-- see. The bypass closes by WRITING THE RULE DOWN: each view states, in its own WHERE, that
-- you see a participation row if you are inside the space that owns the memory.
--
-- `accepted_visits`, `visible_activities`, `place_counts` and `activity_mileage` are
-- `security_invoker = true`, which sounds like it already handles this. It does not. RLS is
-- not applied to a table's owner, and these views are read from inside SECURITY DEFINER
-- functions — where the current user IS the owner. So they need the clause stated too, for
-- exactly the same reason and by exactly the same sentence.
--
-- The advisor's `security_definer_view` ERROR therefore stays at 3. It is a lint for the
-- pattern being kept deliberately; §6c carries the exception with its reason.
--
--
-- ============================================================================
-- WHY can_see_memory_subject GAINS A `visit` BRANCH
-- ============================================================================
--
-- Its CASE handles 'photo' and 'outing' and then `else false`. `memory_subjects` holds 557
-- rows of kind='visit', so for every caller that CASE is false on all of them. Verified on
-- production, 2026-08-30, inside begin/rollback:
--
--     select count(*) from memory_subjects where kind='visit';                   -- 557
--     select count(*) from memory_subjects where kind='visit'
--       and can_see_memory_subject(id);                                          --   0
--
-- Erica and Josh nonetheless each see the visit subjects they created, because the OTHER
-- policy on the table — `memory_subjects_write` — is declared FOR ALL, permissive policies
-- are OR'd, and SELECT is one of ALL. A write policy has been doing duty as the read rule.
-- Adding `when 'visit' then public.is_member(s.space_id)` makes the read rule say what it
-- means; the write policy goes on governing writes.

begin;

-- ---------------------------------------------------------------------------
-- 1. The two tables. A space is a container of memories; a membership is a person in
--    one, with a role that says how much they may CHANGE — never how much they may see.
-- ---------------------------------------------------------------------------
-- `owner_profile` is NULLABLE on purpose. A schema replayed from empty by
-- `scripts/db-bootstrap.sh` has seeded rows in `activity_options`, `place_categories`,
-- `peaks`, `parks` and `settings` before a single profile exists — those rows need a space
-- to live in, and there is nobody yet to own it. The first `owner` profile claims it
-- (section 3). An unowned space is a fresh installation, not a broken one.
create table if not exists public.spaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_profile uuid references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now()
);

create table if not exists public.space_memberships (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (space_id, profile_id)
);

create index if not exists space_memberships_profile_idx on public.space_memberships (profile_id);
create index if not exists spaces_owner_idx on public.spaces (owner_profile);

alter table public.spaces            enable row level security;
alter table public.space_memberships enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The boundary, as a function of a ROW.
--
--    These are SECURITY DEFINER because they read `space_memberships`, which is itself
--    RLS-protected — an invoker-rights helper would recurse through the very policy it is
--    being asked to evaluate. Each is revoked from public and anon in section 9.
-- ---------------------------------------------------------------------------
create or replace function public.is_member(p_space uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_space is not null
     and exists (select 1 from public.space_memberships m
                  where m.space_id = p_space and m.profile_id = auth.uid());
$$;

create or replace function public.is_editor_or_owner(p_space uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_space is not null
     and exists (select 1 from public.space_memberships m
                  where m.space_id = p_space and m.profile_id = auth.uid()
                    and m.role in ('owner','editor'));
$$;

create or replace function public.is_owner(p_space uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_space is not null
     and exists (select 1 from public.space_memberships m
                  where m.space_id = p_space and m.profile_id = auth.uid()
                    and m.role = 'owner');
$$;

-- Every space you are inside. The plural form is the one the model is built on; a person
-- being in two spaces is the normal case as soon as step 2 of §3s lands.
create or replace function public.my_space_ids()
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select m.space_id from public.space_memberships m where m.profile_id = auth.uid();
$$;

-- The space a new row belongs to when the caller did not say. Unambiguous exactly when you
-- are in one space, which is every account today. Null rather than a guess otherwise — a
-- not-null violation is a better outcome than a row filed in the wrong space.
create or replace function public.current_space()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select m.space_id from public.space_memberships m
   where m.profile_id = auth.uid()
   limit 1;
$$;

-- The default for every space_id column.
--
-- The caller's own space when there is one. When there is NOT — a `service_role` write from
-- a worker, an edge function, a seed script, a restore, or one of the 74 files in
-- `supabase/tests/` — it falls back to the space with the most members. That fallback is
-- deliberate and it is temporary: while exactly one space holds data it can only ever pick
-- that space, and it is what stops this migration from breaking every write path in the app
-- and the workers on the day it is applied, none of which pass a space_id yet.
--
-- ⚠️ THE SPLIT MIGRATION MUST DELETE THIS FALLBACK. The moment Josh's space holds rows,
-- "the biggest space" stops being a fact and becomes a guess, and a guess that files a row
-- in the wrong space is exactly the failure this whole change exists to prevent. The
-- assertion in section 9 pins the fallback to at most one occupied space so it cannot
-- survive the split unnoticed.
create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    public.current_space(),
    (select s.id
       from public.spaces s
       left join public.space_memberships m on m.space_id = s.id
      group by s.id, s.created_at
      order by count(m.profile_id) desc, s.created_at
      limit 1));
$$;

-- The no-argument form stays, because 15 SECURITY DEFINER function bodies and
-- `assert_member()` call it, and this migration does not rewrite them. Its MEANING changes
-- from "you have a profile" to "you are inside at least one space" — which is the same
-- answer for Erica, Josh and Test Bot, and a different one for a stranger who has signed up
-- and been invited nowhere. That difference is the point of the whole file.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.space_memberships m where m.profile_id = auth.uid());
$$;

-- `is_owner()` and `is_editor_or_owner()` are deliberately NOT redefined. They read
-- `profiles.role` and are called from function bodies this migration does not touch;
-- widening Josh to "owner" because he owns his own space would hand him write rights over
-- rows in Erica's space that he does not have today. Every POLICY that used them is
-- rewritten below to the space-scoped overload, which is where the change belongs.

-- ---------------------------------------------------------------------------
-- 3. Every profile is in a space — enforced going forward, not just backfilled.
--    §3s: sign-up creating your own space is step 2. Until it exists, this trigger is what
--    stops a new `profiles` row from being an account with nowhere to put anything, and it
--    is also what keeps `supabase/tests/*.test.sql` working: those create profiles and then
--    insert places, and the default above needs a space to have appeared by then.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_profile_space()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_space uuid;
begin
  if exists (select 1 from public.space_memberships m where m.profile_id = new.id) then
    return new;
  end if;

  -- A fresh installation has one unowned space holding the seeded reference rows. The
  -- first owner claims it rather than starting a second one beside it.
  if new.role = 'owner' then
    select s.id into v_space from public.spaces s where s.owner_profile is null
     order by s.created_at limit 1;
    if v_space is not null then
      update public.spaces set owner_profile = new.id,
             name = coalesce(nullif(btrim(new.display_name), ''), 'Home') || '''s space'
       where id = v_space;
      insert into public.space_memberships (space_id, profile_id, role)
      values (v_space, new.id, 'owner') on conflict do nothing;
      return new;
    end if;
  end if;

  -- An owner gets their own space. Anyone else joins the single space if there is exactly
  -- one (the invite path today); otherwise they get their own, which is never wrong.
  if new.role = 'owner' or (select count(*) from public.spaces) <> 1 then
    insert into public.spaces (name, owner_profile)
    values (coalesce(nullif(btrim(new.display_name), ''), 'Space') || '''s space', new.id)
    returning id into v_space;
    insert into public.space_memberships (space_id, profile_id, role)
    values (v_space, new.id, 'owner') on conflict do nothing;
  else
    select s.id into v_space from public.spaces s limit 1;
    insert into public.space_memberships (space_id, profile_id, role)
    values (v_space, new.id, case when new.role = 'viewer' then 'viewer' else 'editor' end)
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists profiles_ensure_space on public.profiles;
create trigger profiles_ensure_space
  after insert on public.profiles
  for each row execute function public.ensure_profile_space();

-- ---------------------------------------------------------------------------
-- 4. The spaces, the memberships, and `space_id` on every space-owned table.
--
--    The order inside this block matters and is the opposite of the obvious one: the
--    SPACES are created FIRST, and each column is then added with that space as its
--    DEFAULT. `alter table … add column … default <literal>` fills every existing row in
--    the table rewrite, so there is no UPDATE at all — and therefore no trigger fires.
--
--    That is not an optimisation. The production rehearsal of the UPDATE version of this
--    migration, run inside `begin … rollback` on 2026-08-30, died here:
--
--      ERROR: place_membership: parent 0fabb00c-92d4-4c06-b928-ec857aa12187 is not a
--             container (holds_children)   — PL/pgSQL function place_membership_no_cycle()
--
--    That row is in production today and predates this file: a parent lost
--    `holds_children` after the membership was written. A trigger that validates USER
--    EDITS re-ran on it because a column it does not care about was being filled in.
--    ⚠️ THE `place_membership` INCONSISTENCY IS REAL AND IS NOT FIXED HERE. It is a
--    separate data question with a separate answer, and this migration must not silently
--    repair or destroy it. Adding the column with a default sidesteps it honestly:
--    nothing is validated because nothing is edited. The same move also stops every
--    `updated_at` trigger in the database from rewriting every row's timestamp, which is
--    a change nobody asked for and which would have shown up on screens as "just edited".
--
--    The table list is written out rather than derived, because "does this table belong to
--    a space" is a judgement about each table, and a derived list would silently absorb the
--    next table somebody adds. The nine that carry no space are named underneath.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner  uuid;
  v_second uuid;
  v_space  uuid;
  v_other  uuid;
  p        record;
  t        text;
  spaced text[] := array[
    -- memories and the places they happened
    'places','visits','activities','photos','videos','entries',
    'place_membership','place_membership_exceptions','place_categories','place_ratings',
    'place_wishes','trail_routes','peaks','parks','peak_bags','revealed_area',
    -- who was there
    'people','memory_subjects','memory_people','visit_people','visit_evidence',
    'tagging_rules','tagging_rule_exceptions','tag_claims',
    -- reactions and boards
    'photo_reactions','activity_reactions','board_items','shared_links','experience_requests',
    -- ingest, provenance and the machine's proposals
    'activity_sources','activity_options','source_connections','ingest_runs','ingest_items',
    'import_artifacts','naming_rules','suggestions','dup_dismissed','deleted_hashes',
    'purged_media','location_pings',
    -- the review ledgers and the undo trail
    'approved_fields','approval_undo','activity_participant_review','visit_participant_review',
    'activity_visit_review','trip_migration_exceptions',
    -- settings and the door into a space
    'settings','invites'
  ];
begin
  -- The owner of today's single household is the anchor. Identified by ROLE, never by id,
  -- so this file carries no production uuid and replays anywhere.
  select id into v_owner from public.profiles where role = 'owner' order by created_at limit 1;

  -- The anchor space is created whether or not anybody owns it yet: a schema replayed from
  -- empty by `scripts/db-bootstrap.sh` has seeded rows in `activity_options`,
  -- `place_categories`, `peaks`, `parks` and `settings` before a single profile exists, and
  -- those rows still need somewhere to live. The first `owner` profile claims it through
  -- the trigger in section 3.
  select id into v_space from public.spaces
   where owner_profile is not distinct from v_owner order by created_at limit 1;
  if v_space is null then
    insert into public.spaces (name, owner_profile)
    values (coalesce((select nullif(btrim(display_name), '') from public.profiles where id = v_owner), 'Home')
            || '''s space', v_owner)
    returning id into v_space;
  end if;

  -- EVERY profile lands in a space, and Test Bot is the one this sentence is really about.
  -- He is a member of everything today, he is what `verify:live` signs in as, and a
  -- backfill that placed only the two humans would drop him to zero on every screen
  -- without anybody noticing until he stopped reporting.
  for p in select id, role, display_name from public.profiles loop
    insert into public.space_memberships (space_id, profile_id, role)
    values (v_space, p.id, case
                             when p.id = v_owner then 'owner'
                             when p.role = 'viewer' then 'viewer'
                             else 'editor' end)
    on conflict (space_id, profile_id) do nothing;
  end loop;

  -- The second person's own space. It is created and owned by them and it starts EMPTY;
  -- the split that fills it is the migration after this one, for the reason set out in the
  -- header. They keep their editor membership of the first space, so nothing they can see
  -- today changes by one row.
  select id into v_second from public.profiles
   where id is distinct from v_owner and role in ('owner','editor')
     and coalesce(display_name, '') !~* '(test|bot)'
   order by created_at limit 1;

  if v_second is not null and not exists (select 1 from public.spaces where owner_profile = v_second) then
    insert into public.spaces (name, owner_profile)
    values (coalesce((select nullif(btrim(display_name), '') from public.profiles where id = v_second), 'Second')
            || '''s space', v_second)
    returning id into v_other;
    insert into public.space_memberships (space_id, profile_id, role)
    values (v_other, v_second, 'owner') on conflict do nothing;
  end if;

  -- The columns. Added WITH the anchor space as their default, which fills every existing
  -- row without an UPDATE and therefore without a trigger. The default is then switched to
  -- `default_space()`, which is what new rows need.
  foreach t in array spaced loop
    -- A name that is absent is tolerated rather than fatal, so this list stays readable
    -- against a schema that has moved on. Section 11 asserts the ones that must be there.
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = ('public.' || t)::regclass
                      and a.attname = 'space_id' and a.attnum > 0 and not a.attisdropped) then
      execute format('alter table public.%I add column space_id uuid not null default %L', t, v_space);
    else
      execute format('update public.%I set space_id = %L where space_id is null', t, v_space);
    end if;
    execute format('alter table public.%I alter column space_id set default public.default_space()', t);
    execute format('alter table public.%I alter column space_id set not null', t);
    execute format('create index if not exists %I on public.%I (space_id)', t || '_space_idx', t);
    if not exists (select 1 from pg_constraint
                    where conrelid = ('public.' || t)::regclass and conname = t || '_space_fk') then
      execute format('alter table public.%I add constraint %I foreign key (space_id) '
                     'references public.spaces(id) on delete restrict', t, t || '_space_fk');
    end if;
  end loop;
end $$;

-- NOT space-scoped, and each for a reason:
--   profiles          — an account, not content. You are one person in however many spaces.
--   join_requests     — a request to get IN, made from outside every space. A space_id on it
--                       would have to be filled by somebody who has none. Stays user-scoped.
--   google_tokens, ingest_tokens, oauth_states, strava_accounts
--                     — credentials belonging to a PERSON. Moving spaces must not move them.
--   job_runs, service_health — the platform's own health, identical for everybody.
--   spatial_ref_sys   — PostGIS.
--   spaces, space_memberships — the boundary itself.

-- ---------------------------------------------------------------------------
-- 6. Who may read the boundary itself.
--    You see a space you are in, and the memberships of spaces you are in. Not a directory:
--    a stranger learns nothing about which spaces exist or who is in them.
-- ---------------------------------------------------------------------------
drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces
  for select using (public.is_member(id));

drop policy if exists spaces_owner_write on public.spaces;
create policy spaces_owner_write on public.spaces
  for all using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists space_memberships_select on public.space_memberships;
create policy space_memberships_select on public.space_memberships
  for select using (public.is_member(space_id));

drop policy if exists space_memberships_owner_write on public.space_memberships;
create policy space_memberships_owner_write on public.space_memberships
  for all using (public.is_owner(space_id)) with check (public.is_owner(space_id));

grant select on public.spaces, public.space_memberships to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Every policy that named the turnstile now names a space.
--
--    Each one below is the EXISTING qualifier with `is_member()` replaced by
--    `is_member(space_id)`, `is_editor_or_owner()` by `is_editor_or_owner(space_id)` and
--    `is_owner()` by `is_owner(space_id)`. Nothing else in any qualifier is touched, which
--    is why no row moves for anybody who is a member of the space today.
-- ---------------------------------------------------------------------------

-- places, visits, activities: the three that matter most.
drop policy if exists places_select on public.places;
create policy places_select on public.places for select using (
  deleted_at is null and public.is_member(space_id)
  -- 0284's block, kept. A boundary migration that dropped it would re-open what 0284 shut.
  and not public.is_blocked_between(created_by, (select auth.uid()))
  and (saved or created_by = (select auth.uid()) or (created_by is null and public.is_owner(space_id))));
drop policy if exists places_write on public.places;
create policy places_write on public.places for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));

drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select using (
  public.is_member(space_id)
  and not public.is_blocked_between(created_by, (select auth.uid())));
drop policy if exists visits_write on public.visits;
create policy visits_write on public.visits for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select using (
  public.is_member(space_id)
  and not public.is_blocked_between(owner_profile, (select auth.uid()))
  and (lower(coalesce(original_source, '')) <> 'strava'
    or owner_profile = (select auth.uid())
    or exists (select 1 from public.activity_profiles ap
                 join public.profiles ow on ow.id = activities.owner_profile
                where ap.activity_id = activities.id
                  and ap.profile_id = (select auth.uid())
                  and coalesce(ap.claim_status, 'accepted') <> 'rejected'
                  and ow.share_tagged_outings)));

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select using (
  deleted_at is null and public.is_member(space_id)
  and not public.is_blocked_between(uploaded_by, (select auth.uid()))
  and (uploaded_by = (select auth.uid())
    or (uploaded_by is null and public.is_owner(space_id))
    or (place_id is not null and public.place_is_saved(place_id))));
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert with check (public.is_editor_or_owner(space_id));
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos for update
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos for delete
  using (public.is_owner(space_id) or uploaded_by = (select auth.uid()));

drop policy if exists videos_select on public.videos;
create policy videos_select on public.videos for select using (
  public.is_member(space_id)
  and (uploaded_by = (select auth.uid())
    or (uploaded_by is null and public.is_owner(space_id))
    or (place_id is not null and public.place_is_saved(place_id))));

drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries for select using (
  public.is_member(space_id)
  and (created_by = (select auth.uid())
    or (created_by is null and public.is_owner(space_id))
    or (place_id is not null and public.place_is_saved(place_id))));
drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries for insert with check (public.is_editor_or_owner(space_id));
drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries for update
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries for delete using (public.is_editor_or_owner(space_id));

-- Who was there. `memory_people_select` keeps both of its arms — the second one,
-- `person_is_mine`, is how you see a tag on a memory you cannot otherwise read — but the
-- whole thing is now inside a space.
drop policy if exists memory_people_select on public.memory_people;
create policy memory_people_select on public.memory_people for select using (
  public.is_member(space_id)
  and (public.can_see_memory_subject(subject_id) or public.person_is_mine(person_id)));
drop policy if exists memory_people_write on public.memory_people;
create policy memory_people_write on public.memory_people for all
  using (public.is_editor_or_owner(space_id)
     and exists (select 1 from public.memory_subjects s
                  where s.id = memory_people.subject_id and s.owner_profile = (select auth.uid())))
  with check (public.is_editor_or_owner(space_id)
     and exists (select 1 from public.memory_subjects s
                  where s.id = memory_people.subject_id and s.owner_profile = (select auth.uid())));

drop policy if exists memory_subjects_select on public.memory_subjects;
create policy memory_subjects_select on public.memory_subjects for select using (
  public.is_member(space_id) and public.can_see_memory_subject(id));
drop policy if exists memory_subjects_write on public.memory_subjects;
create policy memory_subjects_write on public.memory_subjects for all
  using (owner_profile = (select auth.uid()) and public.is_editor_or_owner(space_id))
  with check (owner_profile = (select auth.uid()) and public.is_editor_or_owner(space_id));

drop policy if exists people_read on public.people;
create policy people_read on public.people for select using (
  public.is_member(space_id)
  and (owner_profile = (select auth.uid()) or linked_profile = (select auth.uid())
    or public.person_on_visible_memory(id) or public.person_on_visible_visit(id)));
drop policy if exists people_write on public.people;
create policy people_write on public.people for all
  using (owner_profile = (select auth.uid()) and public.is_editor_or_owner(space_id))
  with check (owner_profile = (select auth.uid()) and public.is_editor_or_owner(space_id));

-- `profiles` has no space_id — an account is not content — so its read rule becomes
-- "we share a space", which is the same three people today and nobody for a stranger.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = (select auth.uid())
  or exists (select 1 from public.space_memberships mine
               join public.space_memberships theirs on theirs.space_id = mine.space_id
              where mine.profile_id = (select auth.uid()) and theirs.profile_id = profiles.id));

-- The plain `is_member()` reads.
drop policy if exists activity_options_read on public.activity_options;
create policy activity_options_read on public.activity_options for select using (public.is_member(space_id));
drop policy if exists activity_participant_review_read on public.activity_participant_review;
create policy activity_participant_review_read on public.activity_participant_review for select using (public.is_member(space_id));
drop policy if exists approval_undo_select on public.approval_undo;
create policy approval_undo_select on public.approval_undo for select using (public.is_member(space_id));
drop policy if exists approved_fields_select on public.approved_fields;
create policy approved_fields_select on public.approved_fields for select using (public.is_member(space_id));
drop policy if exists import_artifacts_select on public.import_artifacts;
create policy import_artifacts_select on public.import_artifacts for select using (public.is_member(space_id));
drop policy if exists ingest_items_select on public.ingest_items;
create policy ingest_items_select on public.ingest_items for select using (public.is_member(space_id));
drop policy if exists ingest_runs_select on public.ingest_runs;
create policy ingest_runs_select on public.ingest_runs for select using (public.is_member(space_id));
drop policy if exists naming_rules_select on public.naming_rules;
create policy naming_rules_select on public.naming_rules for select using (public.is_member(space_id));
drop policy if exists parks_select on public.parks;
create policy parks_select on public.parks for select using (public.is_member(space_id));
drop policy if exists peak_bags_select on public.peak_bags;
create policy peak_bags_select on public.peak_bags for select using (public.is_member(space_id));
drop policy if exists peaks_select on public.peaks;
create policy peaks_select on public.peaks for select using (public.is_member(space_id));
drop policy if exists place_wishes_select on public.place_wishes;
create policy place_wishes_select on public.place_wishes for select using (public.is_member(space_id));
drop policy if exists revealed_area_read on public.revealed_area;
create policy revealed_area_read on public.revealed_area for select using (public.is_member(space_id));
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select using (public.is_member(space_id));
drop policy if exists shared_links_select on public.shared_links;
create policy shared_links_select on public.shared_links for select using (public.is_member(space_id));
drop policy if exists source_connections_select on public.source_connections;
create policy source_connections_select on public.source_connections for select using (public.is_member(space_id));
drop policy if exists suggestions_select on public.suggestions;
create policy suggestions_select on public.suggestions for select using (public.is_member(space_id));
drop policy if exists tag_claims_select on public.tag_claims;
create policy tag_claims_select on public.tag_claims for select using (public.is_member(space_id));
drop policy if exists tagging_rule_exceptions_select on public.tagging_rule_exceptions;
create policy tagging_rule_exceptions_select on public.tagging_rule_exceptions for select using (public.is_member(space_id));
drop policy if exists tagging_rules_select on public.tagging_rules;
create policy tagging_rules_select on public.tagging_rules for select using (public.is_member(space_id));
drop policy if exists trail_routes_read on public.trail_routes;
create policy trail_routes_read on public.trail_routes for select using (public.is_member(space_id));
drop policy if exists visit_evidence_read on public.visit_evidence;
create policy visit_evidence_read on public.visit_evidence for select using (public.is_member(space_id));
drop policy if exists visit_people_read on public.visit_people;
create policy visit_people_read on public.visit_people for select using (public.is_member(space_id));
drop policy if exists place_membership_select on public.place_membership;
create policy place_membership_select on public.place_membership for select using (public.is_member(space_id));
drop policy if exists place_categories_select on public.place_categories;
create policy place_categories_select on public.place_categories for select using (public.is_member(space_id));
drop policy if exists board_items_select on public.board_items;
create policy board_items_select on public.board_items for select using (public.is_member(space_id));
drop policy if exists deleted_hashes_select on public.deleted_hashes;
create policy deleted_hashes_select on public.deleted_hashes for select using (public.is_member(space_id));
drop policy if exists dup_dismissed_select on public.dup_dismissed;
create policy dup_dismissed_select on public.dup_dismissed for select using (public.is_member(space_id));
drop policy if exists pings_select on public.location_pings;
create policy pings_select on public.location_pings for select using (public.is_member(space_id));
drop policy if exists pings_insert_own on public.location_pings;
create policy pings_insert_own on public.location_pings for insert
  with check (public.is_member(space_id) and profile_id = (select auth.uid()));
drop policy if exists activity_sources_select on public.activity_sources;
create policy activity_sources_select on public.activity_sources for select
  using (public.is_member(space_id) and public.can_see_activity(activity_id));

-- Reactions and ratings: mine to write, the space's to read.
drop policy if exists activity_reactions_read on public.activity_reactions;
create policy activity_reactions_read on public.activity_reactions for select using (public.is_member(space_id));
drop policy if exists activity_reactions_write on public.activity_reactions;
create policy activity_reactions_write on public.activity_reactions for all
  using (public.is_member(space_id) and profile_id = (select auth.uid()))
  with check (public.is_member(space_id) and profile_id = (select auth.uid()));
drop policy if exists photo_reactions_select on public.photo_reactions;
create policy photo_reactions_select on public.photo_reactions for select using (
  public.is_member(space_id)
  and (profile_id = (select auth.uid())
    or exists (select 1 from public.photos ph
                where ph.id = photo_reactions.photo_id and ph.deleted_at is null
                  and ph.place_id is not null and public.place_is_saved(ph.place_id))));
drop policy if exists photo_reactions_write on public.photo_reactions;
create policy photo_reactions_write on public.photo_reactions for all
  using (public.is_member(space_id) and profile_id = (select auth.uid()))
  with check (public.is_member(space_id) and profile_id = (select auth.uid()));
drop policy if exists place_ratings_select on public.place_ratings;
create policy place_ratings_select on public.place_ratings for select using (
  public.is_member(space_id)
  and (profile_id = (select auth.uid())
    or (place_id is not null and public.place_is_saved(place_id))));
drop policy if exists place_ratings_write on public.place_ratings;
create policy place_ratings_write on public.place_ratings for all
  using (public.is_member(space_id) and profile_id = (select auth.uid()))
  with check (public.is_member(space_id) and profile_id = (select auth.uid()));
drop policy if exists place_wishes_write on public.place_wishes;
create policy place_wishes_write on public.place_wishes for all
  using (public.is_member(space_id) and profile_id = (select auth.uid()))
  with check (public.is_member(space_id) and profile_id = (select auth.uid()));

-- The editor/owner writes.
drop policy if exists board_items_write on public.board_items;
create policy board_items_write on public.board_items for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists dup_dismissed_write on public.dup_dismissed;
create policy dup_dismissed_write on public.dup_dismissed for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists experience_requests_rw on public.experience_requests;
create policy experience_requests_rw on public.experience_requests for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists place_categories_write on public.place_categories;
create policy place_categories_write on public.place_categories for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists place_membership_write on public.place_membership;
create policy place_membership_write on public.place_membership for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists place_membership_exceptions_select on public.place_membership_exceptions;
create policy place_membership_exceptions_select on public.place_membership_exceptions for select
  using (public.is_editor_or_owner(space_id));
drop policy if exists shared_links_write on public.shared_links;
create policy shared_links_write on public.shared_links for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists trail_routes_write on public.trail_routes;
create policy trail_routes_write on public.trail_routes for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));
drop policy if exists trip_migration_exceptions_select on public.trip_migration_exceptions;
create policy trip_migration_exceptions_select on public.trip_migration_exceptions for select
  using (public.is_editor_or_owner(space_id));
drop policy if exists visit_people_write on public.visit_people;
create policy visit_people_write on public.visit_people for all
  using (public.is_editor_or_owner(space_id)) with check (public.is_editor_or_owner(space_id));

-- The owner-only ones, now owner OF THIS SPACE rather than owner of the installation.
drop policy if exists activity_visit_review_read on public.activity_visit_review;
create policy activity_visit_review_read on public.activity_visit_review for select using (public.is_owner(space_id));
drop policy if exists deleted_hashes_owner_write on public.deleted_hashes;
create policy deleted_hashes_owner_write on public.deleted_hashes for all
  using (public.is_owner(space_id)) with check (public.is_owner(space_id));
drop policy if exists invites_owner_all on public.invites;
create policy invites_owner_all on public.invites for all
  using (public.is_owner(space_id)) with check (public.is_owner(space_id));
drop policy if exists settings_owner_write on public.settings;
create policy settings_owner_write on public.settings for all
  using (public.is_owner(space_id)) with check (public.is_owner(space_id));
drop policy if exists visit_review_read on public.visit_participant_review;
create policy visit_review_read on public.visit_participant_review for select using (public.is_owner(space_id));

-- Unchanged on purpose, and each named so the omission is a decision:
--   job_runs_select, service_health_select   — `is_member()`, which now means "you are in
--       some space". Platform health is the same fact for everyone who has an account.
--   ingest_tokens_owner_all, profiles_owner_write — `is_owner()` on unscoped tables.
--   jr_select_visible / jr_insert_own / jr_update_own — a join request is made from outside.
--   photos/entries/etc. `place_is_saved`, `can_see_activity`, `person_is_mine` arms — the
--       inner rules are untouched; only the boundary around them changed.

-- ---------------------------------------------------------------------------
-- 8. The views state their own boundary.
--
--    Sections 1–3 of this block are the SQL written and dry-run on
--    `design/definer-views-with-partition`, unchanged apart from living here. Sections 4–7
--    apply the same sentence to the four invoker views, which need it because a SECURITY
--    DEFINER function reads them as the table owner, and a table owner is not subject to RLS.
-- ---------------------------------------------------------------------------
create or replace view public.activity_profiles as
  select s.activity_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status
           when 'declined' then 'rejected'
           else mp.participation_status
         end as claim_status,
         mp.evidence,
         mp.created_by,
         mp.tagged_by as asserted_by,
         mp.decided_by,
         mp.decided_at,
         mp.rule_id
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'outing'
    join public.people pe on pe.id = mp.person_id
   where pe.linked_profile is not null
     -- THE RULE, written down: you see who was on a memory if you are in the space that
     -- owns the memory. Before the partition this sentence had no way to be said, so the
     -- view said nothing and the definer property answered for it.
     and public.is_member(s.space_id);

create or replace view public.visit_profiles as
  select s.visit_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status
           when 'declined' then 'rejected'
           else mp.participation_status
         end as claim_status,
         mp.evidence,
         mp.created_by,
         mp.tagged_by as asserted_by,
         mp.decided_by,
         mp.decided_at,
         mp.rule_id
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
    join public.people pe on pe.id = mp.person_id
   where pe.linked_profile is not null
     and public.is_member(s.space_id);

-- Not a participant view at all: it aggregates `activities` + `activity_sources`, so the
-- boundary is the ACTIVITY's space, not a subject's.
create or replace view public.activity_provenance as
  select a.id as activity_id,
         a.owner_profile,
         count(s.id) as source_count,
         array_agg(distinct s.provider order by s.provider) as providers,
         array_agg(distinct s.origin order by s.origin) as origins,
         bool_or(lower(s.provider) = 'strava') as has_strava_source
    from public.activities a
    left join public.activity_sources s on s.activity_id = a.id
   where public.is_member(a.space_id)
   group by a.id, a.owner_profile;

-- Say the definer property out loud. It was never chosen — 0266 simply did not write
-- `security_invoker`, and the default is false. From here it is deliberate, and a later
-- `create or replace view` that drops the WHERE has an assertion waiting for it.
alter view public.activity_profiles   set (security_invoker = false);
alter view public.visit_profiles      set (security_invoker = false);
alter view public.activity_provenance set (security_invoker = false);

-- `accepted_visits` and `visible_activities` are rebuilt through their OWN column order,
-- read from the catalogue, rather than through a list typed out here.
--
-- THAT IS NOT FUSSINESS, IT IS A BUG THIS FILE HIT. `create or replace view` refuses to
-- reorder or rename a column, and production's `activities` does not have the same physical
-- column order as the same 280 migrations replayed from empty:
--
--   production      … also_profiles, elevation_gain, source_id, is_race, elevation_profile …
--   fresh replay    … also_profiles, source_id, is_race, elevation_profile, elevation_gain …
--
-- A hand-written list is therefore correct in exactly one of the two databases this file
-- has to run in. Asking the catalogue is correct in both, and stays correct when the drift
-- is eventually repaired.
do $$
declare cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = 'public.visible_activities'::regclass
     and a.attnum > 0 and not a.attisdropped;

  execute format($f$
    create or replace view public.visible_activities as
      select %s
        from public.activities a
       where public.is_member(a.space_id)
         and (lower(coalesce(original_source, '')) <> 'strava'
           or owner_profile = auth.uid()
           or exists (select 1 from public.activity_profiles ap
                        join public.profiles ow on ow.id = a.owner_profile
                       where ap.activity_id = a.id and ap.profile_id = auth.uid()
                         and coalesce(ap.claim_status, 'accepted') <> 'rejected'
                         and ow.share_tagged_outings))$f$, cols);

  select string_agg(
           case a.attname
             when 'is_trip_qualified' then 'public.counts_as_trip(v.*) as is_trip_qualified'
             when 'is_headline'       then '(parent_visit_id is null) as is_headline'
             else quote_ident(a.attname)
           end, ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = 'public.accepted_visits'::regclass
     and a.attnum > 0 and not a.attisdropped;

  execute format($f$
    create or replace view public.accepted_visits as
      select %s
        from public.visits v
       where status = 'taken' and accepted_at is not null
         and public.is_member(v.space_id)$f$, cols);
end $$;

create or replace view public.place_counts as
  select p.id as place_id,
         (select count(*) from public.photos ph
           where ph.place_id = p.id and public.is_member(ph.space_id)) as photo_count,
         (select count(*) from public.activities a
           where a.place_id = p.id and public.is_member(a.space_id)) as route_count,
         (select round((coalesce(sum(c.distance), 0::double precision) / 1609.344::double precision)::numeric, 1)
            from (select distinct on (coalesce(a.shared_group_id, a.id)) a.distance
                    from public.activities a
                   where a.place_id = p.id and a.start_date >= '2025-12-21'::date
                     and public.is_member(a.space_id)
                   order by coalesce(a.shared_group_id, a.id), a.id) c) as miles
    from public.places p
   where public.is_member(p.space_id);

create or replace view public.activity_mileage as
  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.type, a.distance
      from public.activities a
     where a.start_date >= '2025-12-21'::date
       and public.is_member(a.space_id)
     order by coalesce(a.shared_group_id, a.id), a.id)
  select type, count(*) as activity_count,
         coalesce(sum(distance), 0::double precision) as meters,
         round((coalesce(sum(distance), 0::double precision) / 1609.344::double precision)::numeric, 1) as miles
    from canon group by type;

-- And these four say their property out loud too, for the same reason the definer three do.
-- `create or replace view` does not reliably carry `reloptions` across a redefinition, and
-- an invoker view that silently became a definer view is the exact bug being closed here.
alter view public.accepted_visits    set (security_invoker = true);
alter view public.visible_activities set (security_invoker = true);
alter view public.place_counts       set (security_invoker = true);
alter view public.activity_mileage   set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 9. `can_see_memory_subject` gains the branch it never had.
--
--    Measured on production, 2026-08-30: 557 subjects of kind='visit', and
--    `can_see_memory_subject` returns false on every one of them for every caller. The
--    reason Erica and Josh still see theirs is `memory_subjects_write`, which is FOR ALL —
--    a write policy standing in for the read rule. This says the rule instead.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_memory_subject(p_subject uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.memory_subjects s
     where s.id = p_subject
       and public.is_member(s.space_id)
       and case s.kind
             when 'photo' then exists (
               select 1 from public.photos ph
                where ph.id = s.photo_id
                  and ph.deleted_at is null
                  and (ph.uploaded_by = auth.uid()
                    or (ph.uploaded_by is null and public.is_owner(s.space_id))
                    or (ph.place_id is not null and public.place_is_saved(ph.place_id))))
             when 'outing' then public.can_see_activity(s.activity_id)
             -- The space boundary IS the rule for a visit: `visits_select` has never said
             -- anything more than "are you inside", and a participation row must not be
             -- harder to see than the visit it describes.
             when 'visit' then true
             else false
           end);
$$;

-- ---------------------------------------------------------------------------
-- 10. A new or replaced SECURITY DEFINER function is granted to PUBLIC by default, which
--     reaches `anon`. 0101/0273/0277 were each this mistake.
-- ---------------------------------------------------------------------------
revoke all on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
revoke all on function public.is_editor_or_owner(uuid) from public, anon;
grant execute on function public.is_editor_or_owner(uuid) to authenticated;
revoke all on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;
revoke all on function public.my_space_ids() from public, anon;
grant execute on function public.my_space_ids() to authenticated;
revoke all on function public.current_space() from public, anon;
grant execute on function public.current_space() to authenticated;
revoke all on function public.default_space() from public, anon;
grant execute on function public.default_space() to authenticated;
revoke all on function public.ensure_profile_space() from public, anon;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;
revoke all on function public.can_see_memory_subject(uuid) from public, anon;
grant execute on function public.can_see_memory_subject(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Assert what changed, in the transaction that changed it.
--
--     Every check is structural or bounded. `scripts/db-bootstrap.sh` replays this file
--     against an EMPTY schema, so there is not one "expected exactly N rows" below.
-- ---------------------------------------------------------------------------
do $$
declare
  t text; v text; n int; sig text;
  must_have_space text[] := array[
    'places','visits','activities','photos','videos','entries','people',
    'memory_subjects','memory_people','visit_evidence','visit_people','place_ratings',
    'place_wishes','place_membership','place_categories','settings','peak_bags','peaks',
    'parks','trail_routes','revealed_area','location_pings','activity_sources','invites'];
begin
  -- 11a. The boundary exists and is protected by itself.
  foreach t in array array['spaces','space_memberships'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'public.% is missing', t;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception 'public.% does not have row level security enabled', t;
    end if;
  end loop;

  -- 11b. Every table that must carry a space does, and it is NOT NULL with a foreign key.
  foreach t in array must_have_space loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = ('public.' || t)::regclass and a.attname = 'space_id'
                      and a.attnum > 0 and not a.attisdropped and a.attnotnull) then
      raise exception 'public.%.space_id is missing or nullable', t;
    end if;
    if not exists (select 1 from pg_constraint c
                    where c.conrelid = ('public.' || t)::regclass and c.contype = 'f'
                      and c.confrelid = 'public.spaces'::regclass) then
      raise exception 'public.% has no foreign key to spaces', t;
    end if;
  end loop;

  -- 11c. NOT ONE policy in `public` may still call the no-argument turnstile as its whole
  --      answer on a table that has a space. This is the check that would have caught a
  --      half-partitioned database, which is worse than an unpartitioned one because it
  --      looks safe.
  select count(*) into n
    from pg_policies p
    join pg_class c on c.oid = ('public.' || p.tablename)::regclass
   where p.schemaname = 'public'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'space_id'
                    and a.attnum > 0 and not a.attisdropped)
     and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '\mis_member\(\)'
  ;
  if n <> 0 then
    raise exception '% policy/policies on a space-owned table still end in the old is_member()', n;
  end if;

  select count(*) into n
    from pg_policies p
    join pg_class c on c.oid = ('public.' || p.tablename)::regclass
   where p.schemaname = 'public'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'space_id'
                    and a.attnum > 0 and not a.attisdropped)
     and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '\m(is_owner|is_editor_or_owner)\(\)';
  if n <> 0 then
    raise exception '% policy/policies on a space-owned table still use an installation-wide role check', n;
  end if;

  -- 11d. All seven views name the boundary; the three definer ones are still definer, and
  --      the four invoker ones are still invoker.
  foreach v in array array['activity_profiles','visit_profiles','activity_provenance',
                           'accepted_visits','visible_activities','place_counts','activity_mileage'] loop
    if to_regclass('public.' || v) is null then
      raise exception 'view public.% is missing', v;
    end if;
    if pg_get_viewdef(('public.' || v)::regclass, true) not like '%is_member(%' then
      raise exception 'public.% does not state its space boundary', v;
    end if;
  end loop;

  foreach v in array array['activity_profiles','visit_profiles','activity_provenance'] loop
    if 'security_invoker=true' = any (coalesce(
         (select c.reloptions from pg_class c where c.oid = ('public.' || v)::regclass), '{}')) then
      raise exception 'public.% is security_invoker; this file deliberately keeps it definer', v;
    end if;
  end loop;

  foreach v in array array['accepted_visits','visible_activities','place_counts','activity_mileage'] loop
    if not ('security_invoker=true' = any (coalesce(
              (select c.reloptions from pg_class c where c.oid = ('public.' || v)::regclass), '{}'))) then
      raise exception 'public.% lost its security_invoker option', v;
    end if;
  end loop;

  -- 11e. The visit branch is really there.
  if pg_get_functiondef('public.can_see_memory_subject(uuid)'::regprocedure) not like '%when ''visit'' then%' then
    raise exception 'can_see_memory_subject still has no visit branch';
  end if;

  -- 11f. Nothing this file created is reachable by anon, and no SECURITY DEFINER function
  --      anywhere in `public` is either. The second half is the standing lockdown that
  --      `scripts/db-test.sh` also enforces; asserting it here means the transaction that
  --      created the functions is the one that proves it.
  foreach sig in array array['public.is_member(uuid)','public.is_editor_or_owner(uuid)',
                             'public.is_owner(uuid)','public.my_space_ids()','public.current_space()',
                             'public.default_space()','public.is_member()',
                             'public.can_see_memory_subject(uuid)'] loop
    if has_function_privilege('anon', sig, 'EXECUTE') then
      raise exception 'anon can execute %', sig;
    end if;
  end loop;

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not like 'st\_%';
  if n <> 0 then
    raise exception '% anon-executable SECURITY DEFINER function(s) — lockdown regression', n;
  end if;

  select count(*) into n
    from unnest(array['spaces','space_memberships']) as t(v)
   where has_table_privilege('anon', ('public.' || t.v)::regclass, 'SELECT');
  if n <> 0 then
    raise exception '% of the two boundary tables is readable by anon', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 12. The data assertions. Bounded and guarded, never exact: this file is replayed from
--     nothing by `scripts/db-bootstrap.sh`, where every one of these tables is empty.
-- ---------------------------------------------------------------------------
do $$
declare n_prof int; n_placed int; n_spaces int; n_occupied int; t text; n int;
begin
  select count(*) into n_prof from public.profiles;
  if n_prof = 0 then
    raise notice '0281: no profiles, so no space could be created — structure only.';
    return;
  end if;

  -- EVERY profile is in a space. Test Bot is the one this is really about: he is a member
  -- of everything today and a backfill that placed only the two humans would drop him to
  -- zero on every screen without anybody noticing until he stopped reporting.
  select count(*) into n_placed
    from public.profiles p
   where exists (select 1 from public.space_memberships m where m.profile_id = p.id);
  if n_placed <> n_prof then
    raise exception '% of % profiles are in no space', n_prof - n_placed, n_prof;
  end if;

  -- Every space that HAS an owner has them as an owner-member of it. A space with no owner
  -- is a fresh installation waiting for its first `owner` profile, which is legitimate.
  if exists (select 1 from public.spaces s
              where s.owner_profile is not null
                and not exists (select 1 from public.space_memberships m
                                 where m.space_id = s.id and m.profile_id = s.owner_profile
                                   and m.role = 'owner')) then
    raise exception 'a space exists whose owner is not an owner-member of it';
  end if;

  -- Not one row anywhere is homeless. `space_id` is NOT NULL so this cannot fail; it is
  -- here because the day it can is the day somebody added a table and skipped section 4.
  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'space_id'
                        and a.attnum > 0 and not a.attisdropped
     where ns.nspname = 'public' and c.relkind = 'r' and c.relname <> 'space_memberships'
  loop
    execute format('select count(*) from public.%I where space_id is null', t) into n;
    if n <> 0 then raise exception '% rows in public.% have no space', n, t; end if;
  end loop;

  -- The `default_space()` fallback is only honest while ONE space holds data. See its
  -- comment: the split migration must delete it, and this is what will fail if it does not.
  select count(*) into n_spaces from public.spaces;
  select count(distinct space_id) into n_occupied from public.visits;
  if n_spaces > 1 and n_occupied > 1 then
    raise exception 'more than one space holds visits while default_space() still guesses — '
                    'remove the fallback before splitting the data';
  end if;

  raise notice '0281: % profile(s) placed across % space(s); % space(s) hold visits.',
               n_prof, n_spaces, n_occupied;
end $$;

commit;
