-- 0179 — "add a new activity" is a real entry in the dropdown, so the list has to grow.
--
-- 0164 made the dropdown DATA (`activity_options`) rather than a hardcoded list, and
-- seeded the eight Erica named: run, walk, hike, bike, winery, brewery, restaurant, bar.
-- The last two entries she asked for — "import activity" and "add a new activity" — are
-- actions rather than options, and the second one needs a way to write the table.
--
-- The table is read-only to `authenticated` (correctly: an option is app vocabulary, not
-- a row anyone should be able to overwrite), so this is the only door, and it decides
-- the one thing a person cannot be asked: whether the new activity is something you DO
-- or somewhere you GO. That distinction is the whole model — a Run is a route on a
-- visit, a Winery is a PLACE with its own card and its own visits — so it is asked in
-- those words in the UI and stored as `kind` here.
--
-- ROLLBACK: drop function public.add_activity_option(text, text, text).

begin;

create or replace function public.add_activity_option(
  p_label text,
  p_kind  text,                       -- 'route' (something we did) | 'place' (somewhere we went)
  p_type  text default null            -- the activity type or place category; defaults from the label
) returns public.activity_options
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text;
  v_row  public.activity_options;
  v_next int;
begin
  if not public.is_editor_or_owner() then
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
  select * into v_row from public.activity_options where slug = v_slug;
  if v_row.slug is not null then
    if not v_row.active then
      update public.activity_options set active = true where slug = v_slug returning * into v_row;
    end if;
    return v_row;
  end if;

  select coalesce(max(sort), 0) + 10 into v_next from public.activity_options;

  insert into public.activity_options (slug, label, kind, activity_type, place_category, sort, active, created_by)
  values (
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
end $function$;

comment on function public.add_activity_option(text, text, text) is
  'Add an option to the "+ Add an activity" dropdown (§0.6). Idempotent on the derived '
  'slug, and re-activates a retired option rather than colliding with it. `kind` is the '
  'model decision: route = something you did, place = somewhere you went, which gets its '
  'own card and its own visits.';

revoke all on function public.add_activity_option(text, text, text) from public, anon;
grant execute on function public.add_activity_option(text, text, text) to authenticated;

-- The table is the app's vocabulary, not user data: 0164 created it before 0174
-- closed the default grants, so `authenticated` has held INSERT, UPDATE and DELETE on
-- it ever since — the same gap visit_evidence had. The RPC above is the only door.
revoke insert, update, delete on public.activity_options from authenticated;

comment on table public.activity_options is
  'The "+ Add an activity" dropdown, as DATA. Read-only to a browser; add options '
  'through add_activity_option(), which decides route (something you did) vs place '
  '(somewhere you went, with its own card and visits).';

commit;
