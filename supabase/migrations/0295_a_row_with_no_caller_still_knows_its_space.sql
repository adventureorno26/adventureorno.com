-- 0295 — a row with no caller still knows its space.
--
-- DRAFT — REHEARSED LOCALLY AGAINST THE FULL CHAIN, NOT APPLIED. Nothing in this file has
-- been run against production.
--
-- ---------------------------------------------------------------------------
-- WHAT IS BROKEN, AND IT IS BROKEN ON PRODUCTION RIGHT NOW
-- ---------------------------------------------------------------------------
--
-- `0289` gave 46 tables `space_id uuid not null default public.default_space()`.
-- `0292` §8 then replaced `default_space()` with, in full:
--
--     select public.current_space();
--
-- and `current_space()` reads `where m.profile_id = auth.uid()`. So for any writer with no
-- caller — the photo gateway, every edge function, cron, a restore — `default_space()`
-- returns NULL and the insert dies on the NOT NULL constraint.
--
-- 0292 deleted the old "biggest space" fallback deliberately and it was right to: with two
-- occupied spaces, "the biggest" is a guess, and a guess files a row in the wrong person's
-- history. Its comment says the consequence out loud — *"A write that reaches here with no
-- caller must name its space itself."* **No writer was ever taught to.** `grep -c space_id`
-- over `workers/photo-gateway/src/` and all eleven `supabase/functions/*/index.ts` returns
-- zero, across the board.
--
-- Measured, not inferred. Against a full local replay of the chain with 0292 §8's body
-- installed, the exact insert `ingest-overland` performs:
--
--     insert into public.location_pings (lat, lng, recorded_at, source)
--     values (39.1, -77.5, now(), 'overland');
--     ERROR:  null value in column "space_id" of relation "location_pings"
--             violates not-null constraint
--
-- ---------------------------------------------------------------------------
-- WHY NO TEST CAUGHT IT, WHICH IS THE MORE IMPORTANT HALF
-- ---------------------------------------------------------------------------
--
-- 0292 §8 sits INSIDE the branch that actually forks, and that was a considered choice —
-- its own comment explains that a schema replayed from empty seeds `activity_options`,
-- `place_categories`, `peaks`, `parks` and `settings` before any profile exists, so
-- removing the fallback unconditionally would break `db-bootstrap.sh` on every push.
--
-- The cost of that choice was not noticed: **CI replays a schema in which
-- `default_space()` still has the fallback.** Production is the only place the new body
-- exists. So `db-test.sh`, all 77 SQL tests and the whole e2e suite exercise a
-- `default_space()` that production does not have, in the one function that decides where
-- every row in the database is filed.
--
-- That is a permanent blind spot, not a one-off. §4 below closes it with an assertion that
-- holds under BOTH bodies, so this class of divergence fails a test next time.
--
-- ---------------------------------------------------------------------------
-- THE RULE THIS FILE ADDS, AND WHY IT IS NOT A GUESS
-- ---------------------------------------------------------------------------
--
--     A row with no caller belongs to the space of the person the row is already about.
--
-- That is not a new policy — it is 0292's own splitting rule ("a row goes to the space of
-- whoever is tagged on it") applied to a row that has not been written yet. It reads a
-- column that is already on the row. It is a FACT about the row, where "the biggest space"
-- was a claim about the world, and that difference is the whole reason one is acceptable
-- and the other was deleted.
--
-- It applies ONLY when there is no caller. A signed-in caller whose `space_id` comes out
-- NULL is a real bug and is deliberately left to fail loudly: `default_space()` would have
-- answered for them, so a NULL there means something worse is wrong than a missing default.
--
-- WHAT THIS FILE DOES NOT FIX, NAMED SO IT CANNOT BE LOST. Nineteen space-owned tables
-- carry no owning-profile column, so nothing on the row can answer the question. Two of
-- them are written by a service-role job today and are therefore STILL BROKEN after this
-- migration:
--
--   * `supabase/functions/suggest/index.ts:215`  -> ingest_runs
--   * `supabase/functions/suggest/index.ts:374`  -> suggestions
--   * `supabase/functions/detect-trips/index.ts:208,223` -> places, visits
--
-- detect-trips is the subtle one: `places` and `visits` DO have `created_by`, but it
-- inserts neither, so there is nothing for §2 to read. All four need the writer to name its
-- space, which is a code change and a function deploy, not a migration. They are listed
-- here rather than papered over, because inventing a space for a trip-detection row is
-- exactly the guess 0292 removed.
begin;

-- ---------------------------------------------------------------------------
-- 1. The space of a GIVEN profile, deterministically.
--
--    `home_space()` (0291) already answers this for the CALLER and orders by
--    `(role = 'owner') desc` so a two-space member gets a stable answer. Its header says
--    why that matters: `current_space()` is `limit 1` over an unordered scan and "for a
--    two-space member it returns a DIFFERENT space depending on the plan". This is the
--    same function with the profile passed in, because a trigger has no caller to ask.
-- ---------------------------------------------------------------------------
create or replace function public.home_space_of(p_profile uuid)
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select m.space_id
    from public.space_memberships m
   where m.profile_id = p_profile
   order by (m.role = 'owner') desc, m.space_id
   limit 1;
$fn$;
revoke all on function public.home_space_of(uuid) from public, anon, authenticated;
grant execute on function public.home_space_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Fill space_id from the row's own owner, and ONLY when nobody is asking.
--
--    The owning column differs per table, so it arrives as a trigger argument rather than
--    being guessed from the row: `to_jsonb(new) ->> tg_argv[0]`. One function, 27 tables.
--
--    THE NAME MATTERS. Two BEFORE ROW triggers on one table fire in alphabetical order,
--    and 0293 adds `refuse_write_outside_my_space`. `fill_...` sorts before `refuse_...`,
--    so the space is filled before the boundary is checked. If it ran the other way the
--    guard would inspect a NULL. (0293's guard also returns early when `auth.uid()` is
--    null, so the two never actually contend — but the ordering is load-bearing the moment
--    that changes, and a name is a cheap place to be right.)
-- ---------------------------------------------------------------------------
create or replace function public.fill_space_from_the_row_owner()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_col   text := tg_argv[0];
  v_owner uuid;
  v_space uuid;
begin
  if new.space_id is not null then return new; end if;

  -- A SIGNED-IN caller is not this function's business. `default_space()` answers for them,
  -- and a NULL here would mean something is wrong that a default should not hide.
  if auth.uid() is not null then return new; end if;

  v_owner := nullif(to_jsonb(new) ->> v_col, '')::uuid;
  if v_owner is null then
    raise exception 'public.% was written with no caller and no %, so it names no space',
                    tg_table_name, v_col
      using errcode = '23502',
            hint    = 'a writer with no caller must name its space itself (0292 section 8)';
  end if;

  v_space := public.home_space_of(v_owner);
  if v_space is null then
    raise exception 'public.% names profile % , who is in no space', tg_table_name, v_owner
      using errcode = '23502',
            hint    = 'every profile gets a space from ensure_profile_space() (0289 section 3)';
  end if;

  new.space_id := v_space;
  return new;
end
$fn$;
revoke all on function public.fill_space_from_the_row_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Attach it, discovered from the catalogue rather than typed out.
--
--    Same reasoning as 0293's guard: a list typed here goes stale the day somebody adds a
--    table, and this is the failure mode where staleness is silent. The owner column is
--    chosen by a fixed priority so the answer does not depend on catalogue order.
--
--    `spaces` and `space_memberships` are excluded: `space_memberships` is the row this
--    whole mechanism reads to answer the question, and filling it from itself is a loop
--    with nobody inside it (0293 excludes it for the same reason).
-- ---------------------------------------------------------------------------
do $do$
declare
  r        record;
  v_count  integer := 0;
  --    `deleted_by`, `initiated_by` and `source_owner_profile` are profile columns exactly
  --    like the first five; they were missed on the first pass and each one is a table a
  --    nightly job writes (`purge_trash` -> deleted_hashes, `suggest` -> ingest_runs).
  v_prio   text[] := array['profile_id','owner_profile','uploaded_by','invited_by',
                          'deleted_by','initiated_by','source_owner_profile','created_by'];
begin
  for r in
    select c.relname as tbl,
           (select a.attname from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
               and a.attname = any(v_prio)
               -- ⚠️ THE TYPE CHECK IS NOT DEFENSIVE PROGRAMMING, IT IS A REAL CASE.
               -- `memory_people.created_by` is TEXT and holds 'import' / 'rule' — it is
               -- provenance, not a person. Matching on name alone bound the trigger to it
               -- and every insert died on `invalid input syntax for type uuid: "import"`.
               -- A column that is not a uuid is not a profile, whatever it is called.
               and a.atttypid = 'uuid'::regtype
             order by array_position(v_prio, a.attname)
             limit 1) as owner_col
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute sa on sa.attrelid = c.oid and sa.attname = 'space_id'
                          and sa.attnum > 0 and not sa.attisdropped
     where n.nspname = 'public'
       and c.relkind in ('r','p')
       and c.relname not in ('spaces','space_memberships')
     order by c.relname
  loop
    continue when r.owner_col is null;
    execute format('drop trigger if exists fill_space_from_the_row_owner on public.%I', r.tbl);
    execute format(
      'create trigger fill_space_from_the_row_owner before insert on public.%I '
      'for each row execute function public.fill_space_from_the_row_owner(%L)',
      r.tbl, r.owner_col);
    v_count := v_count + 1;
  end loop;

  -- AT MOST, NEVER EXACTLY. `db-bootstrap.sh` replays into an empty schema where the table
  -- set is whatever the chain has built so far, so an exact count would be a promise about
  -- a moving target. What must hold is that nothing WITH an owner column was missed.
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute sa on sa.attrelid = c.oid and sa.attname = 'space_id'
                          and sa.attnum > 0 and not sa.attisdropped
     where n.nspname = 'public' and c.relkind in ('r','p')
       and c.relname not in ('spaces','space_memberships')
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                      and a.attname = any(v_prio) and a.atttypid = 'uuid'::regtype)
       and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid and not t.tgisinternal
                          and t.tgname = 'fill_space_from_the_row_owner')
  ) then
    raise exception '0295: a space-owned table with an owner column was left unfilled';
  end if;

  raise notice '0295: fill trigger on % space-owned table(s)', v_count;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3b. Rows that carry no profile, but are ABOUT something that has a space.
--
--     Four tables have no usable owning profile on the row (memory_people has one, but it
--     is nullable, and a TEXT `created_by` that is provenance rather than a person).
--     Each is still fully determined — not guessed — because it names its subject with a
--     foreign key, and the subject already knows its space:
--
--       purged_media     -> photo_id   -> photos          (purge_trash, 04:30)
--       memory_people    -> subject_id -> memory_subjects (every tagging path)
--       place_membership -> child_id  -> places      (merge/attach paths)
--       suggestions      -> subject_id, keyed by subject_type (dedupe_joint_outings, 04:20)
--
--     Attached by name rather than discovered: there are three, the parent differs for
--     each, and a wrong edge here would file a row against the wrong subject. A list you
--     can read is worth more than a loop you have to trust.
--
--     STILL NOT COVERED, and named so it is not mistaken for done: `revealed_area` has
--     neither a profile nor a foreign key — it is one row, `id = 1`, for the whole
--     database. It does not fail (its insert is `on conflict (id) do update`, which never
--     touches `space_id`), but `rebuild_revealed_area()` now unions BOTH spaces' photos,
--     pings and activities into that single row. That is a cross-space leak on the map and
--     a design change, not a default. It is reported separately, not patched here.
-- ---------------------------------------------------------------------------
create or replace function public.fill_space_from_the_parent_row()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_parent text := tg_argv[0];
  v_fk     text := tg_argv[1];
  v_id     uuid;
  v_space  uuid;
begin
  if new.space_id is not null then return new; end if;
  if auth.uid() is not null then return new; end if;

  v_id := nullif(to_jsonb(new) ->> v_fk, '')::uuid;
  if v_id is null then
    raise exception 'public.% was written with no caller and no %, so it names no space',
                    tg_table_name, v_fk
      using errcode = '23502',
            hint    = 'a writer with no caller must name its space itself (0292 section 8)';
  end if;

  execute format('select space_id from public.%I where id = $1', v_parent)
     into v_space using v_id;
  if v_space is null then
    raise exception 'public.% points at %.% = %, which has no space',
                    tg_table_name, v_parent, 'id', v_id
      using errcode = '23502';
  end if;

  new.space_id := v_space;
  return new;
end
$fn$;
revoke all on function public.fill_space_from_the_parent_row() from public, anon, authenticated;

drop trigger if exists fill_space_from_the_row_owner on public.purged_media;
create trigger fill_space_from_the_row_owner before insert on public.purged_media
  for each row execute function public.fill_space_from_the_parent_row('photos','photo_id');

-- `memory_people` has `tagged_by` (a profile) but it is nullable — the app's own guesses
-- carry NULL, which is why 0279 had 15 of them. Its SUBJECT is never null, and
-- 0292 section 10(a) already asserts that no memory_people row may point at a subject in a
-- different space. Resolving from the subject is therefore not a new rule; it is the
-- existing invariant, applied one step earlier.
drop trigger if exists fill_space_from_the_row_owner on public.memory_people;
create trigger fill_space_from_the_row_owner before insert on public.memory_people
  for each row execute function public.fill_space_from_the_parent_row('memory_subjects','subject_id');

drop trigger if exists fill_space_from_the_row_owner on public.place_membership;
create trigger fill_space_from_the_row_owner before insert on public.place_membership
  for each row execute function public.fill_space_from_the_parent_row('places','child_id');

-- `suggestions` is polymorphic, so the parent TABLE is a column value. `subject_type`
-- decides it; anything else raises rather than picking one.
create or replace function public.fill_space_from_the_subject()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_space uuid; v_tbl text;
begin
  if new.space_id is not null then return new; end if;
  if auth.uid() is not null then return new; end if;

  v_tbl := case new.subject_type
             when 'activity' then 'activities'
             when 'place'    then 'places'
             when 'visit'    then 'visits'
             when 'photo'    then 'photos'
           end;
  if v_tbl is null or new.subject_id is null then
    raise exception 'public.suggestions names subject_type=%, which resolves to no table',
                    coalesce(new.subject_type,'<null>')
      using errcode = '23502';
  end if;

  execute format('select space_id from public.%I where id = $1', v_tbl)
     into v_space using new.subject_id;
  if v_space is null then
    raise exception 'public.suggestions points at %.% which has no space', v_tbl, new.subject_id
      using errcode = '23502';
  end if;

  new.space_id := v_space;
  return new;
end
$fn$;
revoke all on function public.fill_space_from_the_subject() from public, anon, authenticated;

drop trigger if exists fill_space_from_the_row_owner on public.suggestions;
create trigger fill_space_from_the_row_owner before insert on public.suggestions
  for each row execute function public.fill_space_from_the_subject();

-- ---------------------------------------------------------------------------
-- 4. THE ASSERTION THAT CLOSES THE BLIND SPOT.
--
--    The bug existed because production's `default_space()` and CI's are different
--    functions, and nothing compared them. This asserts the property that has to hold
--    under EITHER body: a caller-less insert into a space-owned table with an owner column
--    lands in that owner's space. Under CI's fallback body it passes because the fallback
--    fills it; under production's body it passes because §2 fills it. It fails only if the
--    row ends up somewhere that is not its owner's space — which is the actual thing worth
--    protecting, and it is now checked on every replay.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_profile uuid;
  v_space   uuid;
  v_got     uuid;
begin
  select m.profile_id, m.space_id into v_profile, v_space
    from public.space_memberships m
   order by (m.role = 'owner') desc, m.space_id
   limit 1;

  if v_profile is null then
    raise notice '0295: no memberships in this schema — behaviour assertion skipped';
    return;
  end if;

  insert into public.location_pings (lat, lng, recorded_at, source, profile_id)
  values (0, 0, now(), '0295-assert', v_profile)
  returning space_id into v_got;

  if v_got is distinct from public.home_space_of(v_profile) then
    raise exception '0295: a caller-less ping landed in % , not its owner''s space %',
                    v_got, public.home_space_of(v_profile);
  end if;

  delete from public.location_pings where source = '0295-assert';
  raise notice '0295: a caller-less write lands in its owner''s space — asserted';
end
$do$;

commit;
