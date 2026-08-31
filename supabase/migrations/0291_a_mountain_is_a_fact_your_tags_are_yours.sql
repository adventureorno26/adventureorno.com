-- 0291 — a mountain is a fact; your tags are yours.
--
-- Erica, 2026-08-30: *"Any row count that changes for either of them, on any screen, that
-- cannot be explained."* And, ruling on this file specifically: **fix it BEFORE the fork
-- applies. Nobody loses data they can see today.**
--
-- 0289 gave 47 tables a `space_id` and 0290 taught the readers to name a space. Five tables
-- came through that pass with the COLUMN but not the KEY:
--
--     place_categories  primary key (slug)
--     activity_options  primary key (slug)
--     settings          primary key (key)
--     peaks             unique (name, lat, lng)
--     parks             unique (name)
--
-- A second space physically cannot hold a second copy of `slug = 'trail'`. Rehearsing the
-- data fork (`0292`, PR #203) showed what that costs: **Josh's peaks go 6 → 0 and his space
-- has no category vocabulary at all.** `0292` names the problem in its own header and
-- leaves it to a follow-up. This is that follow-up, and it lands FIRST.
--
--
-- ============================================================================
-- THE DECISION, TABLE BY TABLE — AND THEY ARE NOT ALL THE SAME KIND OF THING
-- ============================================================================
--
-- STATE.md §"Places are duplicated, and that is correct" draws the line already:
--
--     *"A place carries PERSONAL judgements — rating, review, categories, favourite,
--      bucket, `is_home`. Those are not facts about the world, they are one person's
--      opinion of it."*
--
-- Applied to these five, the line falls in a place the schema itself already marks. Three
-- of them have a write policy and a way for a person to add a row. Two have NEITHER — no
-- write policy, no `created_by`, no rating, no note, no opinion column of any kind — and
-- are populated out-of-repo by an OSM/Open-Topo-Data pass running as `service_role`.
--
--     table              user-writable?              verdict
--     ---------------------------------------------------------------------------
--     place_categories   place_categories_write      PER-SPACE — a vocabulary
--     activity_options   add_activity_option()       PER-SPACE — a picker
--     settings           settings_owner_write        PER-SPACE — a preference
--     peaks              NO POLICY AT ALL            GLOBAL — a fact about the world
--     parks              NO POLICY AT ALL            GLOBAL — a fact about the world
--
-- **`peaks` — GLOBAL.** A summit's elevation is not an opinion, and the table holds nothing
-- but `name`, `ele_m`, `lat`, `lng`. Who stood on it IS an opinion-shaped fact, and that
-- lives one hop away in `peak_bags`, which keeps its `space_id` and its scoped view. The
-- mountain is shared; the climb is not.
--
--     AND THERE IS A SECOND, HARDER REASON. `peaks` is the only one of the five with an
--     inbound foreign key — `peak_bags.peak_id -> peaks(id)`, NOT NULL, ON DELETE CASCADE.
--     Giving it per-space keys means Josh's copies get NEW ids, and `0292`'s
--     `update peak_bags set space_id = josh` would leave every one of his bags pointing at
--     a peak in Erica's space: the exact cross-space foreign key `0292`'s own section 10
--     asserts against, with no code anywhere to repoint it. Global keeps peak ids STABLE,
--     so the fork needs no change at all.
--
-- **`parks` — GLOBAL.** Same kind of row: a boundary polygon harvested from OSM, no
-- creator, no write policy. The JUDGEMENT built from it is already per-space — `places.park`
-- is a text column on a space-scoped table, stamped by `trg_place_park`.
--
--     THIS ONE FIXES A SECOND REGRESSION `0292` DOES NOT KNOW IT CAUSES. `set_place_park()`
--     is `language plpgsql` and NOT `security definer`, so it reads `parks` under the
--     caller's own RLS. After the fork Josh is not in Erica's space, so every place he
--     creates would be stamped `park = null` — silently, with no error. Nine parks, and his
--     National Parks card would stop growing. Global fixes it by construction.
--
-- **`place_categories` — PER-SPACE.** §"Places are duplicated" names *categories* as a
-- judgement in as many words. Two of the nineteen rows are `is_custom = true`. And the
-- global key is already an active hazard rather than a latent one: `add_place_category`
-- does `on conflict (slug) do update`, so one space can silently rewrite another space's
-- label, icon and colour. Folding `space_id` into the key closes that.
--
-- **`activity_options` — PER-SPACE.** It is the "+ Add an activity" picker, it carries
-- `created_by`, and `add_activity_option()` exists as a person's write path. Its
-- `place_category` column is a slug INTO the vocabulary above; leaving it global while the
-- vocabulary went per-space would point the picker at tags that differ by space.
--
-- **`settings` — PER-SPACE.** The one live key is `map_projection`. A display preference is
-- the least arguable personal row in the database.
--
--
-- ============================================================================
-- WHAT THIS DOES, AND — SAID FIRST — WHAT IT DELIBERATELY DOES NOT
-- ============================================================================
--
-- IT DOES NOT MOVE, COPY OR DELETE ONE ROW OF ERICA'S. Every row she can see today is the
-- same row, in the same space, with the same id, after this file. The only INSERTs are into
-- a space that holds zero of the table in question — which today is Josh's space and
-- nothing else.
--
-- IT IS NOT THE FORK. It does not touch `visits`, `activities`, `photos`, `places`,
-- `people` or `space_memberships`, and it does not remove anybody from anything. `0292`
-- still does all of that, unchanged, and this file is written so that `0292` needs no edit.
--
-- IT REACHES OUTSIDE THE FIVE EXACTLY ONCE, in section 7, and that is reported rather than
-- buried. Making `peaks` global is NOT SUFFICIENT ON ITS OWN to keep Josh's six, and the
-- measurement is section 7's whole justification. See it there.
--
--
-- MEASURED ON PRODUCTION, 2026-08-30, read-only:
--
--     peaks             49 rows   38 of them carry at least one peak_bag
--     parks              9 rows   no inbound foreign key anywhere in the schema
--     place_categories  19 rows   2 of them is_custom = true
--     activity_options   8 rows   all created_by = null
--     settings           1 row    map_projection = {"type": "globe"}
--     peak_bags         61 rows   37 profile_id = Erica, 0 = Josh, 6 = NULL
--
--     spaces            "Erica's space"  Erica owner, Josh editor, Test Bot editor
--                       "Josh's space"   Josh owner — and 0 rows of all five tables
--
-- **Josh is a member of BOTH spaces until `0292` section 9 removes him.** That single fact
-- shapes section 4, and getting it wrong is how this migration would have broken his screen
-- in the window between the two files. See section 4.
--
--
-- ============================================================================
-- WHY THE READ RULE CHANGES FROM "ALL MY SPACES" TO "MY HOME SPACE"
-- ============================================================================
--
-- `is_member(space_id)` is PLURAL — it admits a row from every space you are in. That is
-- exactly right for CONTENT: a visit is a visit whichever space it is filed in, and seeing
-- two spaces' visits is seeing more of your own history.
--
-- It is WRONG for a personal vocabulary, and `settings` proves it rather than arguing it.
-- The app reads the projection with `.maybeSingle()` (`app/src/lib/data.ts:1639`), which
-- ERRORS on more than one row. The client has always assumed exactly one answer to "what is
-- my map projection". A plural read of a preferences table is a bug whether or not anybody
-- ever forks anything — it just could not fire while only one space held rows.
--
-- The same is true of the other two, less dramatically: "what colour is my Hiking tag" has
-- one answer, and a member of two spaces would see every tag twice.
--
-- So these three are read from your HOME space — `home_space()`, section 1: the space you
-- own, or the single space you are in. Deterministic, never a `limit 1` over an unordered
-- set. WHAT THIS IS WORTH, IN ROW COUNTS ON SCREEN, TODAY:
--
--     Erica     owns her space                -> 19 / 8 / 1   (unchanged, her own rows)
--     Test Bot  editor in Erica's space only  -> 19 / 8 / 1   (unchanged, Erica's rows)
--     Josh      owner of his own space        -> 19 / 8 / 1   (unchanged, HIS COPIES)
--
-- Nothing moves on anybody's screen at 0291, and nothing moves again at 0292. That is the
-- whole point of doing it in this order.
--
--
-- WHY NOT SEED JOSH'S SPACE AND LEAVE THE READ RULE PLURAL. Because he is in both spaces
-- until `0292` runs. Nineteen copies plus Erica's nineteen is thirty-eight tags in his
-- picker, eight options become sixteen, and `map_projection` returns two rows and the
-- `.maybeSingle()` above starts erroring. Every one of those is "a row count that changes
-- that cannot be explained", on production, for however long the window between the two
-- files is. The home-space rule makes the seed invisible on the day it lands.
--
-- WHY NOT `current_space()`. It is `limit 1` over an unordered scan of your memberships —
-- for a two-space member it returns a DIFFERENT space depending on the plan. `0289` says of
-- it: *"Null rather than a guess otherwise."* A vocabulary needs an answer, not a guess.
--
-- WHY NOT DROP `default_space()` AS THE COLUMN DEFAULT and use `home_space()` instead. The
-- bootstrap seed. `scripts/db-bootstrap.sh` replays this chain into an empty schema and
-- `0050`/`0164` insert 18 categories and 8 options BEFORE any profile exists, with no
-- caller — `home_space()` returns null there and the NOT NULL would fail. The column
-- defaults are left exactly as `0289` set them.
--
--
-- ============================================================================
-- THE TWO PLACES THIS EDITS AN EXISTING TEST, AND WHY
-- ============================================================================
--
-- `supabase/tests/0289_a_space_is_the_boundary_and_it_says_so.test.sql` section 1 asserts
-- that every name in a 24-table array carries a NOT NULL `space_id` with a foreign key to
-- `spaces`. `peaks` and `parks` are removed from that array by this branch, because they
-- deliberately stop being space-owned tables here. The array's guard is `n < 20`; all 24
-- tables exist on production, so it goes 24 -> 22 and still binds. The test is REWRITTEN,
-- not deleted, and the old membership is recorded in the file.
--
-- `supabase/tests/the_readers_stay_enforced.test.sql` requires every SECURITY DEFINER
-- function that reads `public.activities` DIRECTLY to be named with a reason. Section 7
-- adds two, and the reason is written there and in that file.
--
--
-- CI. Not one assertion in this file counts rows. `scripts/db-test.sh` replays the chain
-- from an EMPTY schema where every production count is zero; "expected exactly N" has
-- broken CI on this repository twice. Everything below is structural, or "at most".

begin;

-- ---------------------------------------------------------------------------
-- 1. `home_space()` — the one space whose vocabulary and preferences are yours.
--
--    Ordered, so it is a fact and not a plan-dependent guess: the space you OWN wins, and
--    `space_id` breaks any remaining tie. For every account that exists today it returns
--    exactly what that person reads on screen right now.
--
--    SECURITY DEFINER for the same reason as `0289`'s helpers: it reads `space_memberships`,
--    which is itself RLS-protected, and an invoker-rights helper would recurse through the
--    very policy it is being asked to evaluate.
-- ---------------------------------------------------------------------------
create or replace function public.home_space()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select m.space_id
    from public.space_memberships m
   where m.profile_id = auth.uid()
   order by (m.role = 'owner') desc, m.space_id
   limit 1;
$$;

-- A new SECURITY DEFINER function is granted to PUBLIC by default, which reaches `anon`.
-- 0101/0273/0277 were each this mistake, and `0154_authz_matrix.test.sql` fails on it.
revoke all on function public.home_space() from public, anon, authenticated;
grant execute on function public.home_space() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. `peaks` and `parks` leave the space boundary.
--
--    Dropping the column rather than leaving it in place and ignoring it: a NOT NULL column
--    with a foreign key that no rule consults is a lie in the schema, and the next person to
--    read `peaks.space_id` would reasonably believe it meant something.
--
--    The read rule becomes `is_member()` — the no-argument turnstile `0289` deliberately
--    KEPT and redefined as "you are in at least one space". Signed-in members read the
--    gazetteer; `anon` reads nothing. Neither table has ever had a write policy, and neither
--    gains one here.
-- ---------------------------------------------------------------------------
-- `in_space_peaks` was `select * from peaks where space_id in (my_space_ids())`, so it holds
-- a dependency ON THE COLUMN and the drop below fails with "cannot drop column space_id of
-- table peaks because other objects depend on it" until it is gone. It goes FIRST, and by
-- hand rather than with `cascade`, because a `cascade` here would silently take anything
-- else that had come to depend on it. Section 7 replaces its only two readers; nothing else
-- in the schema names it.
drop view if exists public.in_space_peaks;

-- The POLICIES depend on the column too — `using (public.is_member(space_id))` is a
-- dependent object in exactly the way the view is, and the drop fails with the same message
-- until they are gone. So the order is: view, then policies, then the column, then the new
-- policies. Between the two there is no window in which anything is readable that should
-- not be: this is one transaction, and `peaks` and `parks` have never had a write policy.
drop policy if exists peaks_select on public.peaks;
drop policy if exists parks_select on public.parks;

alter table public.peaks drop column if exists space_id;
alter table public.parks drop column if exists space_id;

create policy peaks_select on public.peaks for select using (public.is_member());
create policy parks_select on public.parks for select using (public.is_member());

-- ---------------------------------------------------------------------------
-- 3. The three personal tables get keys that can hold a second space's copy.
--
--    `slug` and `key` stay unique WITHIN a space, which is what they always meant. Nothing
--    is dropped from the tables and no row moves — this is the constraint, and only the
--    constraint.
-- ---------------------------------------------------------------------------
alter table public.place_categories drop constraint if exists place_categories_pkey;
alter table public.place_categories add primary key (space_id, slug);

alter table public.activity_options drop constraint if exists activity_options_pkey;
alter table public.activity_options add primary key (space_id, slug);

alter table public.settings drop constraint if exists settings_pkey;
alter table public.settings add primary key (space_id, key);

-- ---------------------------------------------------------------------------
-- 4. The three read rules — and the matching write rules — name your home space.
--
--    The WRITE rules move with the read rules on purpose. Josh is an editor in Erica's
--    space, so `is_editor_or_owner(space_id)` lets him INSERT and DELETE her categories
--    today. Leaving that while he can no longer SELECT them would be incoherent — a person
--    able to delete rows they cannot see. Erica and Test Bot are unaffected: their home
--    space IS Erica's space, and `is_editor_or_owner` still has to agree.
--
--    `(select public.home_space())` rather than a bare call, so the planner evaluates it
--    ONCE per query as an InitPlan instead of once per row. This is `0290`'s measured
--    lesson (`data_health` 47ms -> 429ms when a definer helper took the row as an
--    argument), applied before it can bite.
-- ---------------------------------------------------------------------------
drop policy if exists place_categories_select on public.place_categories;
create policy place_categories_select on public.place_categories for select
  using (space_id = (select public.home_space()));

drop policy if exists place_categories_write on public.place_categories;
create policy place_categories_write on public.place_categories for all
  using (space_id = (select public.home_space()) and public.is_editor_or_owner(space_id))
  with check (space_id = (select public.home_space()) and public.is_editor_or_owner(space_id));

drop policy if exists activity_options_read on public.activity_options;
create policy activity_options_read on public.activity_options for select
  using (space_id = (select public.home_space()));

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select
  using (space_id = (select public.home_space()));

drop policy if exists settings_owner_write on public.settings;
create policy settings_owner_write on public.settings for all
  using (space_id = (select public.home_space()) and public.is_owner(space_id))
  with check (space_id = (select public.home_space()) and public.is_owner(space_id));

-- ---------------------------------------------------------------------------
-- 5. A space with no vocabulary is given the one its members read today.
--
--    NOT the built-in list from `0050`/`0164`. The rows are COPIED from the space that
--    actually has them, so what Josh sees after this file is byte-for-byte what he sees
--    before it — including `race` and `bar`, the two tags Erica added herself, which he can
--    see today and therefore does not lose. He can delete them in his own space afterwards;
--    that is now a thing he can do without touching hers.
--
--    Guarded three ways so it is a no-op wherever it should be:
--      * only spaces holding ZERO rows of that table are touched, so it cannot run twice
--        and cannot double anybody's picker;
--      * the source is the space with the MOST rows, tie-broken by id, so it is
--        deterministic rather than plan-dependent;
--      * on a schema replayed from empty there is exactly one space, so `src` and the
--        target are the same space and nothing is inserted. CI does nothing here.
--
--    `settings` copies too. It is one row today (`map_projection`), and on a replayed
--    schema it is zero rows in every space, so the loop finds no source and stops.
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_src uuid;
  v_dst uuid;
  n int;
begin
  -- place_categories
  select space_id into v_src from public.place_categories
   group by space_id order by count(*) desc, space_id limit 1;
  if v_src is not null then
    for v_dst in
      select s.id from public.spaces s
       where s.id <> v_src
         and not exists (select 1 from public.place_categories c where c.space_id = s.id)
    loop
      insert into public.place_categories
        (space_id, slug, label, icon, color, review, sort_order, is_auto, is_container,
         is_custom, created_at)
      select v_dst, c.slug, c.label, c.icon, c.color, c.review, c.sort_order, c.is_auto,
             c.is_container, c.is_custom, c.created_at
        from public.place_categories c
       where c.space_id = v_src
      on conflict (space_id, slug) do nothing;
      get diagnostics n = row_count;
      raise notice '0291: seeded % place_categories into space %', n, v_dst;
    end loop;
  end if;

  -- activity_options. `created_by` is deliberately NOT copied: the option now exists in a
  -- space its author is not necessarily in, and claiming they created it there would be an
  -- invented fact. The column is nullable and means "a person added this one".
  select space_id into v_src from public.activity_options
   group by space_id order by count(*) desc, space_id limit 1;
  if v_src is not null then
    for v_dst in
      select s.id from public.spaces s
       where s.id <> v_src
         and not exists (select 1 from public.activity_options o where o.space_id = s.id)
    loop
      insert into public.activity_options
        (space_id, slug, label, kind, activity_type, place_category, sort, active,
         created_by, created_at)
      select v_dst, o.slug, o.label, o.kind, o.activity_type, o.place_category, o.sort,
             o.active, null, o.created_at
        from public.activity_options o
       where o.space_id = v_src
      on conflict (space_id, slug) do nothing;
      get diagnostics n = row_count;
      raise notice '0291: seeded % activity_options into space %', n, v_dst;
    end loop;
  end if;

  -- settings
  select space_id into v_src from public.settings
   group by space_id order by count(*) desc, space_id limit 1;
  if v_src is not null then
    for v_dst in
      select s.id from public.spaces s
       where s.id <> v_src
         and not exists (select 1 from public.settings t where t.space_id = s.id)
    loop
      insert into public.settings (space_id, key, value, updated_at)
      select v_dst, t.key, t.value, t.updated_at
        from public.settings t
       where t.space_id = v_src
      on conflict (space_id, key) do nothing;
      get diagnostics n = row_count;
      raise notice '0291: seeded % settings into space %', n, v_dst;
    end loop;
  end if;
end
$seed$;

-- ---------------------------------------------------------------------------
-- 6. The two writers land the row in the space it was read from.
--
--    Both were written when the key was global and both are wrong in the same two ways
--    once it is not: `on conflict (slug)` names a constraint that no longer exists, and the
--    authorisation gate is the NO-ARGUMENT `is_editor_or_owner()`, which since `0289` means
--    "you are an editor or owner of SOME space" rather than of the space the row lands in.
--
--    Bodies are otherwise unchanged — same slugify, same defaults, same sort arithmetic,
--    same error messages and errcodes, same "adding one that already exists returns it".
--    `create or replace` on an existing function keeps its ACL, so no grant moves here.
--
--    ⚠️ TWO MORE READERS OF `activity_options` ARE LEFT ALONE, AND NAMED SO THEY ARE NOT
--       LOST. `add_activity_to_visit()` and `add_place_to_visit()` (current definitions in
--       `0266_the_participant_tables_become_views.sql`) each do
--           select * into v_opt from public.activity_options where slug = p_option and active;
--       with no space clause. From today that can match two rows and plpgsql takes one of
--       them arbitrarily. It changes NOTHING that anybody sees, because the second row is a
--       byte-for-byte copy of the first and only `label`, `activity_type` and
--       `place_category` are read out of it — but it stops being harmless the first time
--       one space edits an option the other still has. Rewriting two large writers is not
--       this file's job; scoping them is a small, separate, reviewable change.
-- ---------------------------------------------------------------------------
create or replace function public.add_place_category(
  p_label text, p_icon text default ''::text, p_color text default '#38bdf8'::text,
  p_review text default null::text)
returns text
language plpgsql security definer set search_path to 'public' as $$
declare s text; v_space uuid;
begin
  -- WAS: `if not public.is_editor_or_owner() then` — the no-argument form, which since 0289
  -- means "an editor or owner of SOME space". The row has to land in one particular space,
  -- so the check has to be about that space.
  v_space := public.home_space();
  if v_space is null or not public.is_editor_or_owner(v_space) then raise exception 'not authorized'; end if;
  s := regexp_replace(lower(trim(p_label)), '[^a-z0-9]+', '-', 'g');
  s := trim(both '-' from s);
  if s = '' then raise exception 'invalid label'; end if;
  insert into public.place_categories (space_id,slug,label,icon,color,review,sort_order,is_custom)
  values (v_space, s, trim(p_label), coalesce(p_icon,''), coalesce(p_color,'#38bdf8'),
          coalesce(nullif(trim(p_review),''), trim(p_label) || ' Reviews'),
          200, true)
  -- WAS: `on conflict (slug)`, which named the global key and let one space overwrite
  -- another space's label, icon and colour.
  on conflict (space_id,slug) do update set
    label = excluded.label, icon = excluded.icon, color = excluded.color, review = excluded.review;
  return s;
end $$;

create or replace function public.add_activity_option(
  p_label text, p_kind text, p_type text default null::text)
returns public.activity_options
language plpgsql security definer set search_path to 'public' as $$
declare
  v_slug text;
  v_row  public.activity_options;
  v_next int;
  v_space uuid;
begin
  v_space := public.home_space();
  if v_space is null or not public.is_editor_or_owner(v_space) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('route','place') then
    raise exception 'an activity is either something you did (route) or somewhere you went (place)';
  end if;

  v_slug := regexp_replace(lower(btrim(coalesce(p_label,''))), '[^a-z0-9]+', '_', 'g');
  v_slug := btrim(v_slug, '_');
  if v_slug = '' then raise exception 'give the activity a name'; end if;

  -- Adding one that already exists returns it rather than failing: the person's
  -- intent ("I want a Paddle option") is satisfied either way.
  -- Every lookup and the `max(sort)` below gain `space_id = v_space`. Without that, adding
  -- "Paddle" in one space would find another space's row, return it, and add nothing here.
  select * into v_row from public.activity_options where slug = v_slug and space_id = v_space;
  if v_row.slug is not null then
    if not v_row.active then
      update public.activity_options set active = true
       where slug = v_slug and space_id = v_space returning * into v_row;
    end if;
    return v_row;
  end if;

  select coalesce(max(sort), 0) + 10 into v_next
    from public.activity_options where space_id = v_space;

  insert into public.activity_options (space_id, slug, label, kind, activity_type, place_category, sort, active, created_by)
  values (
    v_space,
    v_slug,
    btrim(p_label),
    p_kind,
    case when p_kind = 'route'
         then coalesce(nullif(btrim(coalesce(p_type,'')), ''), initcap(btrim(p_label))) end,
    case when p_kind = 'place'
         then coalesce(nullif(btrim(coalesce(p_type,'')), ''), v_slug) end,
    v_next,
    true,
    auth.uid())
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The peaks readers stop asking a peak_bag which space it is in, and ask the outing.
--
--    THIS IS THE SECTION THAT REACHES OUTSIDE THE FIVE TABLES, and it is here because
--    making `peaks` global IS NOT SUFFICIENT ON ITS OWN. Measured on production:
--
--        Josh's six peaks are, every one of them, a `peak_bags` row with profile_id NULL
--        hanging off an activity owned by Erica with Josh in `also_profiles`.
--
--        peak_bags.profile_id = Josh   ->  0 rows.
--
--    `0292` moves peak bags with `where space_id = erica and profile_id = josh`. That
--    matches NOTHING. Meanwhile all six of those activities are both-tagged, so `0292`
--    COPIES them into Josh's space with new ids and no peak_bags attached. He would read a
--    global `peaks` table through an empty set of bags and still see zero.
--
--    The honest fix is not to move more rows around. It is that `peak_bags.space_id` is a
--    DENORMALISATION THAT GOES STALE THE MOMENT AN OUTING IS COPIED. A peak bag says "this
--    outing touched this summit"; the outing is the thing that has a space, and a copied
--    outing is THE SAME OUTING — which is exactly what `shared_group_id` already exists to
--    say, and what these two functions already canonicalise on one line further down.
--
--    So the bag is resolved through `coalesce(a.shared_group_id, a.id)` instead of through
--    its own `space_id`, and `peak_bags.space_id` is left in place untouched so that
--    `0292` applies afterwards with no edit at all.
--
--    WHY THESE READ `public.activities` DIRECTLY, which
--    `supabase/tests/the_readers_stay_enforced.test.sql` requires a reason for: they read
--    it for ONE column, `shared_group_id`, to map a bag's `activity_id` onto its canonical
--    outing key. Nothing from that row is returned and nothing is filtered by it. What the
--    caller may see is still decided entirely by `visible_activities` and
--    `people_memory_keys`, both unchanged. Both functions are added to that file's list.
--
--    THE `place_id` LINK IS NARROWED, and this is a real behaviour change worth naming: a
--    peak's place link is only returned if the caller can actually see that place. Before
--    the fork every bag's place is in Erica's space and nothing changes for anybody. After
--    it, Josh's summits link to nothing, because his copy of the place is a different row
--    and STATE.md defers cross-space place identity ("there is no canonical cross-space
--    identity for a place yet"). A summit with no link is honest; a link into a space you
--    are not in would 404.
-- ---------------------------------------------------------------------------
create or replace function public.peaks_bagged(p_profile uuid default null::uuid)
returns table(id uuid, name text, ele_ft integer, place_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select public.assert_member();

  select pk.id, pk.name, round(pk.ele_m * 3.28084)::int as ele_ft,
         (select pb.place_id
            from public.peak_bags pb
           where pb.peak_id = pk.id
             and pb.place_id is not null
             and exists (select 1 from public.in_space_places ip where ip.id = pb.place_id)
           limit 1) as place_id
    from public.peaks pk
   where p_profile is null
      or exists (select 1
                   from public.peak_bags pb
                   join public.activities pa on pa.id = pb.activity_id
                   join public.visible_activities va
                     on coalesce(va.shared_group_id, va.id) = coalesce(pa.shared_group_id, pa.id)
                  where pb.peak_id = pk.id
                    and (pb.profile_id = p_profile or pb.profile_id is null))
   order by pk.ele_m desc nulls last, pk.name;
$$;

create or replace function public.peaks_bagged_for_people(p_people uuid[], p_mode text default 'all'::text)
returns table(id uuid, name text, ele_ft integer, place_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select public.assert_member();

  select pk.id, pk.name, round(pk.ele_m * 3.28084)::int as ele_ft,
         (select pb.place_id
            from public.peak_bags pb
           where pb.peak_id = pk.id
             and pb.place_id is not null
             and exists (select 1 from public.in_space_places ip where ip.id = pb.place_id)
           limit 1) as place_id
    from public.peaks pk
   where coalesce(array_length(p_people, 1), 0) = 0
      or exists (select 1
                   from public.peak_bags pb
                   join public.activities pa on pa.id = pb.activity_id
                  where pb.peak_id = pk.id
                    and coalesce(pa.shared_group_id, pa.id) in
                          (select k.key from public.people_memory_keys(p_people, p_mode) k
                            where k.kind = 'outing'))
   order by pk.ele_m desc nulls last, pk.name;
$$;

-- ⚠️ NAMED SO IT IS NOT LOST, AND DELIBERATELY NOT CHANGED HERE. The `p_people` empty
--    branch of both functions returns EVERY peak, which before this file meant every peak
--    in your spaces and after it means every peak in the installation. Today those are the
--    same 49 rows, so no number moves for anybody — which is the only reason it is left
--    alone under an abort criterion that forbids unexplained movement. The moment a THIRD
--    space imports summits of its own, that branch starts listing a stranger's mountains
--    and must be narrowed to bagged-and-visible. It is a gazetteer, not a secret, but it is
--    not this file's change to make.

-- ---------------------------------------------------------------------------
-- 8. Assert what changed, in the transaction that changed it.
--
--    Structural only. NOT ONE ASSERTION COUNTS ROWS — `scripts/db-test.sh` replays this
--    chain from an empty schema where every production count is zero, and "expected exactly
--    N" has broken CI on this repository twice. Where a count is unavoidable it is phrased
--    "at most".
-- ---------------------------------------------------------------------------
do $assert$
declare
  t text;
  v_bad text;
  n int;
begin
  -- 8a. The two world-fact tables really left the boundary, in both directions: no column,
  --     and no policy still asking a space question about them.
  foreach t in array array['peaks', 'parks'] loop
    if exists (select 1 from pg_attribute a
                where a.attrelid = ('public.' || t)::regclass
                  and a.attname = 'space_id' and a.attnum > 0 and not a.attisdropped) then
      raise exception 'FAIL 8a: public.%.space_id still exists', t;
    end if;
    if exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = t
                  and coalesce(p.qual, '') ~ 'space_id') then
      raise exception 'FAIL 8a: a policy on public.% still names space_id', t;
    end if;
    -- It is still readable by a member and still closed to anon: exactly one SELECT policy,
    -- and no write policy has appeared.
    select count(*) into n from pg_policies p
     where p.schemaname = 'public' and p.tablename = t;
    if n <> 1 then
      raise exception 'FAIL 8a: public.% has % policies, expected the single select', t, n;
    end if;
  end loop;

  if to_regclass('public.in_space_peaks') is not null then
    raise exception 'FAIL 8a: in_space_peaks survived, and it can no longer be correct';
  end if;

  -- 8b. The three personal tables can now hold a second space's copy: `space_id` is part of
  --     the primary key, and no OTHER unique constraint re-imposes a global one.
  foreach t in array array['place_categories', 'activity_options', 'settings'] loop
    if not exists (
      select 1 from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.conrelid = ('public.' || t)::regclass and c.contype = 'p'
         and a.attname = 'space_id') then
      raise exception 'FAIL 8b: public.% primary key does not include space_id', t;
    end if;
    select string_agg(c.conname, ', ') into v_bad
      from pg_constraint c
     where c.conrelid = ('public.' || t)::regclass
       and c.contype in ('p', 'u')
       and not exists (select 1 from pg_attribute a
                        where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                          and a.attname = 'space_id');
    if v_bad is not null then
      raise exception 'FAIL 8b: public.% still has a space-blind unique key: %', t, v_bad;
    end if;
    -- And they kept the space column `0289` gave them, NOT NULL with its foreign key.
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = ('public.' || t)::regclass and a.attname = 'space_id'
                      and a.attnum > 0 and not a.attisdropped and a.attnotnull) then
      raise exception 'FAIL 8b: public.%.space_id is missing or nullable', t;
    end if;
  end loop;

  -- 8c. No space that has any of the vocabulary has a PARTIAL copy of it, and no space that
  --     shares a database with a populated one was left with nothing. Phrased as "every
  --     space agrees with the fullest space, or has none at all" so it is true on an empty
  --     replay (one space, or zero) and true on production (two, both full).
  select string_agg(x.sid::text, ', ') into v_bad from (
    select s.id as sid
      from public.spaces s
     where (select count(*) from public.place_categories c where c.space_id = s.id) <> 0
       and (select count(*) from public.place_categories c where c.space_id = s.id)
           <> (select max(k.n) from (select count(*) n from public.place_categories
                                      group by space_id) k)
  ) x;
  if v_bad is not null then
    raise exception 'FAIL 8c: space(s) % hold a partial category vocabulary', v_bad;
  end if;

  -- 8d. The home-space rule is actually what the three read policies say. A policy that
  --     drifted back to `is_member(space_id)` would re-double a two-space member's picker.
  foreach t in array array['place_categories', 'activity_options', 'settings'] loop
    if exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = t and p.cmd = 'SELECT'
                  and coalesce(p.qual, '') !~ 'home_space') then
      raise exception 'FAIL 8d: the select policy on public.% does not name home_space()', t;
    end if;
  end loop;

  -- 8e. `home_space()` is not executable by anon. This is the check `0154_authz_matrix`
  --     would otherwise make on our behalf, one migration too late.
  if has_function_privilege('anon', 'public.home_space()', 'execute') then
    raise exception 'FAIL 8e: anon may execute home_space()';
  end if;

  -- 8f. The peaks readers resolve a bag through its outing, not through its own space_id.
  foreach t in array array['peaks_bagged', 'peaks_bagged_for_people'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = t
                      and pg_get_functiondef(p.oid) ~ 'shared_group_id'
                      and pg_get_functiondef(p.oid) !~ 'in_space_peaks') then
      raise exception 'FAIL 8f: public.% does not resolve a peak bag through the outing', t;
    end if;
  end loop;

  raise notice '0291: peaks and parks are facts and left the boundary; categories, options and settings are per-space and every space has its own';
end
$assert$;

commit;
