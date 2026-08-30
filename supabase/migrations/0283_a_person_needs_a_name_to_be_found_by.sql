-- 0283 — a person needs a name to be found by, and a say in what that name shows.
--
-- MEASURED FIRST, 2026-08-30. `public.profiles` has exactly six columns:
--
--     id · role · display_name · created_at · share_location · share_tagged_outings
--
-- There is no handle, so there is nothing to look somebody up BY. There is no avatar and
-- no bio, so there is nothing to recognise them by. And there is no visibility setting, so
-- there is nothing a person can CHOOSE to make public — which makes "what a new user sees"
-- (STATE §0.2, the partition decisions) unanswerable, because today the answer is either
-- *everything you own* or *nothing at all*, decided by `is_member()` rather than by them.
--
-- A PROFILE BELONGS TO A PERSON, NOT TO A SPACE, so none of this waits on the partition.
--
-- HER RULES, and where each one lands:
--
--   * *"it's fine for users to share their home address and whatever else they want to
--     share"* — so this migration hides NO CATEGORY on anybody's behalf. `public_places`
--     publishes their places with coordinates if they ask for it. The app's job is the
--     switch, not the judgement. Default private; what they mark public is public.
--   * *"a person's own stats are ALL of theirs… including the cards shared with the
--     viewer"* — `public_profile()` reports the whole of a person's history, not the slice
--     the reader happens to be able to see. That is why it reads the base tables rather
--     than `accepted_visits` / `visible_activities`, which are `security_invoker` and would
--     silently return ZERO to a stranger instead of the truth.
--   * *"users are found by searching for them"* — `find_profiles()`.
--   * the verb is **add** / **follow**, never "friend" — no identifier here says otherwise.
--
-- ---------------------------------------------------------------------------------------
-- THE HANDLE: why lowercase-only, and why "immutable-ish" means what it means here.
--
--   * **Stored lowercase, `^[a-z0-9][a-z0-9_]{1,29}$`.** Case-insensitive uniqueness is
--     then a property of the DATA, not of an index expression that a later `insert` can
--     quietly step around. A plain `unique (handle)` cannot drift from `unique (lower(...))`
--     because uppercase cannot be stored in the first place. It is URL-safe as written, so
--     `/@josh` needs no encoding, and it is typeable out loud.
--   * **Everybody gets one on sight.** A nullable handle would mean "findable" was a state
--     some accounts were not in, so the trigger derives one from the display name at
--     insert. That is a DEFAULT, not a decision.
--   * **You may change it once — to the one you chose — and then it is fixed.**
--     `handle_claimed_at` is the difference. A handle that keeps moving is an impersonation
--     tool: a link, a mention or a saved bookmark to `/@josh` starts pointing at a
--     different human and nothing on the page says so. So after the claim it changes only
--     by an operator acting as `postgres`/`service_role` — a support action with a person
--     behind it, not a self-serve toggle. That is the "-ish".
--
-- ---------------------------------------------------------------------------------------
-- WHAT A STRANGER CAN REACH. There are exactly two doors, both `authenticated`-only, and
-- NEITHER requires membership — that is the point of them, and it is new:
--
--     find_profiles(query)   → public profiles only, ≥2 characters, ranked, capped
--     public_profile(handle) → one card, containing only what that person published
--
-- Both answer identically for *"no such handle"* and *"that account is private"* — no row.
-- A private account therefore cannot be confirmed to exist, so this is not an enumeration
-- oracle. The table itself stays member-gated exactly as before; a stranger reading
-- `public.profiles` directly still gets zero rows.
--
-- THE STRAVA RULE IS CARRIED ACROSS RATHER THAN DROPPED. `visible_activities` lets you see
-- a Strava-original recording when it is YOURS, or when its owner shares what they tag you
-- on (0200/0228). The public surface transposes the first half — a person's public page may
-- show their own Strava recordings, because they are the athlete and they published the
-- page — and refuses the second: republishing somebody ELSE's Strava recording to the
-- world is not the tagger's to give. Totals and lists use the same predicate, so they agree.

-- ---------------------------------------------------------------------------
-- 1. What a public profile is made of.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists handle             text,
  add column if not exists handle_claimed_at  timestamptz,
  add column if not exists avatar_url         text,
  add column if not exists bio                text,
  add column if not exists profile_visibility text not null default 'private',
  add column if not exists public_stats       boolean not null default false,
  add column if not exists public_places      boolean not null default false,
  add column if not exists public_activity    boolean not null default false;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_handle_format') then
    alter table public.profiles
      add constraint profiles_handle_format check (handle ~ '^[a-z0-9][a-z0-9_]{1,29}$');
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_visibility_known') then
    alter table public.profiles
      add constraint profiles_visibility_known check (profile_visibility in ('private','public'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_bio_length') then
    alter table public.profiles
      add constraint profiles_bio_length check (bio is null or char_length(bio) <= 280);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_url_shape') then
    alter table public.profiles
      add constraint profiles_avatar_url_shape
      check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https?://'));
  end if;
end
$do$;

create unique index if not exists profiles_handle_key on public.profiles (handle);

comment on column public.profiles.handle is
  'The stable, URL-safe, human-typeable name a person is found by. Lowercase a-z0-9_ only, '
  '2-30 characters, unique — so case-insensitive uniqueness is a property of the stored data '
  'rather than of an index expression. Assigned from the display name on insert; changeable '
  'ONCE, via set_handle(), after which it is fixed (0283).';
comment on column public.profiles.handle_claimed_at is
  'When the person chose this handle themselves. NULL means the handle is still the one the '
  'system derived for them and may still be changed (0283).';
comment on column public.profiles.avatar_url is
  'Optional picture for the profile card. http(s) only, 2048 characters (0283).';
comment on column public.profiles.bio is
  'Optional one-paragraph self-description, 280 characters (0283).';
comment on column public.profiles.profile_visibility is
  'private | public. The master switch: private means the account cannot be found by search '
  'and has no readable card, and a stranger cannot even confirm it exists. Default private '
  '(0283).';
comment on column public.profiles.public_stats is
  'When public, the card carries this person''s totals — places, miles, trips (0283).';
comment on column public.profiles.public_places is
  'When public, the card carries the places they have been, WITH coordinates. Erica, '
  '2026-08-30: "it''s fine for users to share their home address and whatever else they want '
  'to share" — this is their switch, not the app''s judgement (0283).';
comment on column public.profiles.public_activity is
  'When public, the card carries their recent outings and visits (0283).';

-- ---------------------------------------------------------------------------
-- 2. Deriving a handle, and the names nobody may take.
-- ---------------------------------------------------------------------------
-- One definition of the reserved list, used by the write guard and the deriver, so the two
-- cannot disagree. These are all path segments the web app either uses or will use, and a
-- handle becomes a path segment.
create or replace function public.handle_is_reserved(p_handle text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(p_handle, '') = any (array[
    'about','account','admin','administrator','anon','api','app','assets','auth','blog',
    'contact','data','delete','edit','event','events','explore','export','follow','followers',
    'following','help','home','import','inbox','insights','integrations','login','logout',
    'map','me','messages','new','null','owner','people','person','photo','photos','place',
    'places','privacy','profile','profiles','public','root','search','settings','signin',
    'signup','static','support','system','terms','trash','trip','trips','undefined','user',
    'users','you'
  ]);
$fn$;

comment on function public.handle_is_reserved(text) is
  'The handles nobody may take, because each is (or will be) a path segment in the web app '
  'and a handle becomes a path segment. One list, read by both the write guard and the '
  'deriver (0283).';

create or replace function public.handle_from_name(p_name text)
returns text
language sql
immutable
as $fn$
  select nullif(
           btrim(
             left(
               btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '_', 'g'), '_'),
               30),
             '_'),
           '');
$fn$;

comment on function public.handle_from_name(text) is
  'Deterministic lowercase URL-safe seed for a handle: "Test Bot" -> "test_bot". Returns '
  'NULL when nothing usable is left. Uniqueness and the reserved list are assign_handle''s '
  'job, not this one''s (0283).';

-- Deterministic and collision-free: the seed, then the seed with a numeric suffix, then a
-- name derived from the id. Nothing personal is invented — a handle and nothing else.
create or replace function public.assign_handle(p_name text, p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_base text;
  v_cand text;
  n int := 1;
begin
  v_base := public.handle_from_name(p_name);
  if v_base is null or char_length(v_base) < 2 then
    v_base := 'user_' || left(replace(coalesce(p_id, gen_random_uuid())::text, '-', ''), 8);
  end if;

  v_cand := v_base;
  while public.handle_is_reserved(v_cand)
        or exists (select 1 from public.profiles p
                    where p.handle = v_cand and p.id is distinct from p_id)
        or v_cand !~ '^[a-z0-9][a-z0-9_]{1,29}$'
  loop
    n := n + 1;
    if n > 200 then
      -- The id is unique by construction, so this terminates. 12 hex characters.
      return 'user_' || left(replace(coalesce(p_id, gen_random_uuid())::text, '-', ''), 12);
    end if;
    v_cand := btrim(left(v_base, 30 - (char_length(n::text) + 1)), '_') || '_' || n::text;
    if v_cand !~ '^[a-z0-9]' then
      v_cand := 'user_' || left(replace(coalesce(p_id, gen_random_uuid())::text, '-', ''), 12);
    end if;
  end loop;
  return v_cand;
end
$fn$;

comment on function public.assign_handle(text, uuid) is
  'The handle a profile gets when it has none: derived from the display name, suffixed _2, '
  '_3 … on collision, and falling back to the row id. Called by the write guard; not a door '
  '(0283).';

-- ---------------------------------------------------------------------------
-- 3. The write guard: normalise, fill, refuse a reserved name, and hold a claimed
--    handle still.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_handle_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  new.handle := nullif(btrim(lower(coalesce(new.handle, ''))), '');

  if tg_op = 'UPDATE' then
    -- An upsert that names only some columns must not be read as "clear the handle".
    if new.handle is null then
      new.handle := old.handle;
      new.handle_claimed_at := old.handle_claimed_at;
    end if;
    if old.handle is not null
       and new.handle is distinct from old.handle
       and old.handle_claimed_at is not null
       and current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception
        'the handle "%" has been claimed and cannot be changed — it is how people find and link to you',
        old.handle
        using errcode = '42501';
    end if;
  end if;

  if new.handle is null then
    new.handle := public.assign_handle(new.display_name, new.id);
  end if;

  if public.handle_is_reserved(new.handle) then
    raise exception '"%" is reserved and cannot be used as a handle', new.handle
      using errcode = '23514';
  end if;

  return new;
end
$fn$;

comment on function public.profiles_handle_guard() is
  'BEFORE INSERT OR UPDATE on profiles: lowercases and trims the handle, derives one when '
  'there is none, refuses the reserved list, and holds a CLAIMED handle still against '
  'everyone but an operator (0283).';

drop trigger if exists profiles_handle_guard on public.profiles;
create trigger profiles_handle_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_handle_guard();

-- ---------------------------------------------------------------------------
-- 4. The three profiles that exist get a handle from the name they already have.
--    Ordered, so replaying this produces the same three handles every time.
-- ---------------------------------------------------------------------------
do $do$
declare r record;
begin
  for r in select id, display_name from public.profiles where handle is null order by created_at, id
  loop
    update public.profiles set handle = public.assign_handle(r.display_name, r.id) where id = r.id;
  end loop;
end
$do$;

alter table public.profiles alter column handle set not null;

-- ---------------------------------------------------------------------------
-- 5. Choosing your handle, once.
-- ---------------------------------------------------------------------------
create or replace function public.set_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_me uuid := auth.uid();
  v_h  text;
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  v_h := nullif(btrim(lower(coalesce(p_handle, ''))), '');
  if v_h is null or v_h !~ '^[a-z0-9][a-z0-9_]{1,29}$' then
    raise exception
      'a handle is 2 to 30 characters of a-z, 0-9 and _, starting with a letter or digit'
      using errcode = '22023';
  end if;
  if public.handle_is_reserved(v_h) then
    raise exception '"%" is reserved and cannot be used as a handle', v_h using errcode = '23514';
  end if;
  if exists (select 1 from public.profiles where handle = v_h and id <> v_me) then
    raise exception '"%" is taken', v_h using errcode = '23505';
  end if;

  update public.profiles
     set handle = v_h, handle_claimed_at = now()
   where id = v_me;
  if not found then
    raise exception 'you have no profile' using errcode = '42501';
  end if;
  return v_h;
end
$fn$;

comment on function public.set_handle(text) is
  'Claim your handle. Works once: the guard holds a claimed handle still afterwards, because '
  'a link to /@someone must keep meaning the same person (0283).';

-- ---------------------------------------------------------------------------
-- 6. Choosing what a stranger sees.
-- ---------------------------------------------------------------------------
-- Every argument is optional and NULL means "leave it alone"; an empty string clears a
-- text field. One door for the whole card, so a client cannot half-save it.
create or replace function public.save_public_profile(
  p_display_name text default null,
  p_avatar_url   text default null,
  p_bio          text default null,
  p_visibility   text default null,
  p_stats        boolean default null,
  p_places       boolean default null,
  p_activity     boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_me  uuid := auth.uid();
  v_row public.profiles%rowtype;
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_visibility is not null and p_visibility not in ('private','public') then
    raise exception 'visibility is private or public, not "%"', p_visibility using errcode = '22023';
  end if;

  update public.profiles p
     set display_name = case when p_display_name is null then p.display_name
                             else nullif(btrim(p_display_name), '') end,
         avatar_url   = case when p_avatar_url is null then p.avatar_url
                             else nullif(btrim(p_avatar_url), '') end,
         bio          = case when p_bio is null then p.bio
                             else nullif(btrim(p_bio), '') end,
         profile_visibility = coalesce(p_visibility, p.profile_visibility),
         public_stats       = coalesce(p_stats,      p.public_stats),
         public_places      = coalesce(p_places,     p.public_places),
         public_activity    = coalesce(p_activity,   p.public_activity)
   where p.id = v_me
  returning p.* into v_row;

  if not found then
    raise exception 'you have no profile' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'handle',             v_row.handle,
    'handle_claimed',     v_row.handle_claimed_at is not null,
    'display_name',       v_row.display_name,
    'avatar_url',         v_row.avatar_url,
    'bio',                v_row.bio,
    'profile_visibility', v_row.profile_visibility,
    'public_stats',       v_row.public_stats,
    'public_places',      v_row.public_places,
    'public_activity',    v_row.public_activity);
end
$fn$;

comment on function public.save_public_profile(text, text, text, text, boolean, boolean, boolean) is
  'The one door for your own public profile. NULL leaves a field alone, an empty string '
  'clears it. Nothing here can touch `role` — that is member management, and it stays the '
  'account owner''s (0283).';

-- ---------------------------------------------------------------------------
-- 7. Finding somebody.
-- ---------------------------------------------------------------------------
-- Callable by ANY authenticated user, member or not — being findable is the whole point,
-- and after the partition a searcher is by definition outside the space they are searching.
--
-- Why it is not an enumeration oracle:
--   * only `profile_visibility = 'public'` rows can ever match, so a private account never
--     appears and never distinguishes itself from a name that does not exist;
--   * two characters minimum, so it cannot be walked one letter at a time;
--   * LIKE metacharacters in the term are escaped, so `%` cannot ask for everybody;
--   * the result set is capped.
create or replace function public.find_profiles(p_query text, p_limit int default 20)
returns table(handle text, display_name text, avatar_url text, bio text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with q as (
    select t as term,
           regexp_replace(t, '([%_\\])', '\\\1', 'g') as pat
      from (select nullif(btrim(lower(coalesce(p_query, ''))), '') as t) s
  )
  select p.handle, p.display_name, p.avatar_url, p.bio
    from public.profiles p, q
   where auth.uid() is not null
     and q.term is not null
     and char_length(q.term) >= 2
     and p.profile_visibility = 'public'
     and (p.handle like q.pat || '%' escape '\'
       or lower(coalesce(p.display_name, '')) like '%' || q.pat || '%' escape '\')
   order by (p.handle = q.term) desc,
            (p.handle like q.pat || '%' escape '\') desc,
            p.display_name nulls last,
            p.handle
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$fn$;

comment on function public.find_profiles(text, int) is
  'Search people by handle (prefix) or display name (contains). Public profiles only, two '
  'characters minimum, capped at 50. Returns only what those people published — no id, no '
  'role, no settings. Safe for any authenticated user; a private account is indistinguishable '
  'from a name that does not exist (0283).';

-- ---------------------------------------------------------------------------
-- 8. Reading one person's public profile.
-- ---------------------------------------------------------------------------
-- Returns exactly what that person chose to expose and nothing else, as one document, so
-- the shape of the answer follows their switches rather than the caller's SELECT list.
--
-- NULL for an unknown handle AND for a private account — the same answer, deliberately.
--
-- It reads the BASE tables. `accepted_visits` and `visible_activities` are
-- `security_invoker`, so a stranger asking through them would get zero rather than the
-- truth, and a person's own stats are all of theirs (STATE §0.2). Outings are collapsed to
-- `coalesce(shared_group_id, id)` before anything is summed, per the same section.
create or replace function public.public_profile(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  pr        public.profiles%rowtype;
  v_stats   jsonb := null;
  v_places  jsonb := null;
  v_acts    jsonb := null;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into pr
    from public.profiles
   where handle = nullif(btrim(lower(coalesce(p_handle, ''))), '')
     and profile_visibility = 'public';
  if not found then
    -- No such handle, or an account that has not published itself. One answer for both.
    return null;
  end if;

  -- TODO (item 2, blocking): when block lists land, a blocked viewer gets this same NULL.

  if pr.public_stats or pr.public_places or pr.public_activity then
    create temporary table if not exists pp_scratch_v (visit_id uuid primary key) on commit drop;
    create temporary table if not exists pp_scratch_o (act_id uuid primary key, distance double precision) on commit drop;
    delete from pp_scratch_v;
    delete from pp_scratch_o;

    -- Visits this person is ACCEPTED on. A proposed tag is a claim, not shared history.
    insert into pp_scratch_v (visit_id)
    select distinct v.id
      from public.memory_people mp
      join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
      join public.people pe on pe.id = mp.person_id
                           and pe.linked_profile = pr.id
                           and pe.deleted_at is null
      join public.visits v on v.id = s.visit_id
     where mp.participation_status = 'accepted'
       and v.status = 'taken'
       and v.accepted_at is not null;

    -- Outings, one recording per canonical outing, so 15 miles run together is 15 miles.
    insert into pp_scratch_o (act_id, distance)
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.memory_people mp
      join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'outing'
      join public.people pe on pe.id = mp.person_id
                           and pe.linked_profile = pr.id
                           and pe.deleted_at is null
      join public.activities a on a.id = s.activity_id
     where mp.participation_status = 'accepted'
       -- Their own Strava recordings are theirs to publish; somebody else's are not ours
       -- to republish to the world (0200/0228, transposed).
       and (lower(coalesce(a.original_source, '')) <> 'strava' or a.owner_profile = pr.id)
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id;
  end if;

  if pr.public_stats then
    select jsonb_build_object(
             'places', (select count(distinct pl.id)::int
                          from pp_scratch_v sv
                          join public.visits v on v.id = sv.visit_id
                          join public.places pl on pl.id = v.place_id
                         where pl.counts_as_place and pl.deleted_at is null),
             'miles',  (select round((coalesce(sum(o.distance), 0) / 1609.344)::numeric, 1)
                          from pp_scratch_o o),
             'trips',  (select count(*)::int
                          from pp_scratch_v sv
                          join public.visits v on v.id = sv.visit_id
                         where v.parent_visit_id is null and public.counts_as_trip(v.*)))
      into v_stats;
  end if;

  if pr.public_places then
    select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) into v_places
      from (
        select jsonb_build_object(
                 'name', pl.name,
                 'lat', pl.lat,
                 'lng', pl.lng,
                 'categories', to_jsonb(coalesce(pl.categories, array[]::text[])),
                 'visits', count(*)::int) as t
          from pp_scratch_v sv
          join public.visits v on v.id = sv.visit_id
          join public.places pl on pl.id = v.place_id
         where pl.counts_as_place and pl.deleted_at is null
         group by pl.id, pl.name, pl.lat, pl.lng, pl.categories
         order by pl.name
         limit 250) z;
  end if;

  if pr.public_activity then
    select coalesce(jsonb_agg(t order by t->>'happened_on' desc), '[]'::jsonb) into v_acts
      from (
        select jsonb_build_object(
                 'kind', 'outing',
                 'happened_on', coalesce(a.local_date, (a.start_date at time zone 'UTC')::date),
                 'title', a.name,
                 'type', a.type,
                 'place_name', pl.name,
                 'distance', a.distance) as t,
               coalesce(a.local_date, (a.start_date at time zone 'UTC')::date) as on_day
          from pp_scratch_o o
          join public.activities a on a.id = o.act_id
          left join public.places pl on pl.id = a.place_id
        union all
        select jsonb_build_object(
                 'kind', 'visit',
                 'happened_on', v.start_date,
                 'title', null::text,
                 'type', null::text,
                 'place_name', pl.name,
                 'distance', null::double precision),
               v.start_date
          from pp_scratch_v sv
          join public.visits v on v.id = sv.visit_id
          left join public.places pl on pl.id = v.place_id
        order by on_day desc nulls last
        limit 50) z;
  end if;

  return jsonb_build_object(
    'handle',       pr.handle,
    'display_name', pr.display_name,
    'avatar_url',   pr.avatar_url,
    'bio',          pr.bio,
    'member_since', pr.created_at::date,
    'shows', jsonb_build_object('stats',    pr.public_stats,
                                'places',   pr.public_places,
                                'activity', pr.public_activity),
    'stats',    v_stats,
    'places',   v_places,
    'activity', v_acts);
end
$fn$;

comment on function public.public_profile(text) is
  'One person''s public profile card: identity always, then totals / places / recent '
  'activity only where they switched each on. NULL for an unknown handle AND for a private '
  'account — the same answer, so a private account cannot be confirmed to exist. Reads base '
  'tables rather than the security_invoker views, because a person''s own stats are ALL of '
  'theirs, not the slice the reader can see (0283).';

-- ---------------------------------------------------------------------------
-- 9. RLS. Your own row is yours whatever else changes; every other row stays behind
--    the space boundary, which is the ONE line item 9 narrows.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_member());

comment on policy profiles_select on public.profiles is
  'Your own row always; anyone else''s only inside your space. `is_member()` is global '
  'today and becomes `is_member(space_id)` with the partition — this is the seam. Nothing '
  'else reads another person''s profile row: the public surface is public_profile() and '
  'find_profiles(), which return only what that person published (0283).';

-- ---------------------------------------------------------------------------
-- 10. Grants. A new SECURITY DEFINER function is granted to PUBLIC by default, which
--     reaches `anon`.
-- ---------------------------------------------------------------------------
revoke all on function public.handle_is_reserved(text) from public, anon;
grant execute on function public.handle_is_reserved(text) to authenticated;
revoke all on function public.handle_from_name(text) from public, anon;
grant execute on function public.handle_from_name(text) to authenticated;

-- Neither of these is a door: one is the write guard, one is what the write guard calls.
revoke all on function public.assign_handle(text, uuid) from public, anon, authenticated;
revoke all on function public.profiles_handle_guard() from public, anon, authenticated;

revoke all on function public.set_handle(text) from public, anon;
grant execute on function public.set_handle(text) to authenticated;
revoke all on function public.save_public_profile(text, text, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_public_profile(text, text, text, text, boolean, boolean, boolean) to authenticated;
revoke all on function public.find_profiles(text, int) from public, anon;
grant execute on function public.find_profiles(text, int) to authenticated;
revoke all on function public.public_profile(text) from public, anon;
grant execute on function public.public_profile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Assert what this migration changed, in the transaction that changed it.
--     Nothing below counts rows: an empty schema has no profiles, and CI replays the
--     whole chain from empty.
-- ---------------------------------------------------------------------------
do $do$
declare
  missing text;
  bad     text;
begin
  -- (a) the columns exist, with the defaults that make "private until you say otherwise" true
  select string_agg(c, ', ') into missing
    from unnest(array['handle','handle_claimed_at','avatar_url','bio','profile_visibility',
                      'public_stats','public_places','public_activity']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  if missing is not null then
    raise exception 'FAIL 0283: profiles is missing %', missing;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles'
                    and column_name='profile_visibility'
                    and column_default like '%private%' and is_nullable = 'NO') then
    raise exception 'FAIL 0283: profile_visibility does not default to private';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='profiles'
                and column_name in ('public_stats','public_places','public_activity')
                and column_default <> 'false') then
    raise exception 'FAIL 0283: a publication switch defaults to on';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='profiles'
                and column_name='handle' and is_nullable = 'YES') then
    raise exception 'FAIL 0283: handle is nullable — some account would not be findable';
  end if;

  -- (b) every profile that exists has a valid, unique, unreserved handle
  select string_agg(p.id::text, ', ') into bad from public.profiles p
   where p.handle is null or p.handle !~ '^[a-z0-9][a-z0-9_]{1,29}$' or public.handle_is_reserved(p.handle);
  if bad is not null then
    raise exception 'FAIL 0283: bad handle on profile(s) %', bad;
  end if;
  if (select count(*) from public.profiles) <> (select count(distinct handle) from public.profiles) then
    raise exception 'FAIL 0283: two profiles share a handle';
  end if;

  -- (c) the guard is installed
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_handle_guard') then
    raise exception 'FAIL 0283: the handle guard is not installed';
  end if;

  -- (d) nothing new is reachable by anon — the lockdown regression this repo keeps having
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_handle','save_public_profile','find_profiles','public_profile',
                       'assign_handle','profiles_handle_guard','handle_is_reserved','handle_from_name')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('public', p.oid, 'EXECUTE'));
  if bad is not null then
    raise exception 'FAIL 0283: anon/public can execute %', bad;
  end if;

  -- (e) and the two doors ARE reachable by a signed-in person
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_handle','save_public_profile','find_profiles','public_profile')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if bad is not null then
    raise exception 'FAIL 0283: authenticated cannot execute %', bad;
  end if;

  raise notice 'PASS 0283: every profile has a unique handle, publication is off by default, and the two public doors are authenticated-only';
end
$do$;
