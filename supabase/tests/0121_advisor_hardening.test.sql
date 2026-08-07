-- Regression coverage for 0121 advisor hardening. LOCAL disposable stack only.

begin;

do $$
declare
  targets text[] := array[
    'entries.entries_select',
    'join_requests.jr_insert_own',
    'join_requests.jr_select_visible',
    'join_requests.jr_update_own',
    'location_pings.pings_insert_own',
    'photo_reactions.photo_reactions_select',
    'photo_reactions.photo_reactions_write',
    'photos.photos_delete',
    'photos.photos_select',
    'place_ratings.place_ratings_select',
    'place_ratings.place_ratings_write',
    'place_wishes.place_wishes_write',
    'places.places_select',
    'videos.videos_select'
  ];
  n_present int;
  n_wrapped int;
  n_pinned int;
begin
  select count(*) into n_present
  from pg_policies
  where schemaname = 'public'
    and (tablename || '.' || policyname) = any (targets);
  if n_present <> 14 then
    raise exception 'FAIL: expected 14 hardened policies, found %', n_present;
  end if;

  select count(*) into n_wrapped
  from pg_policies
  where schemaname = 'public'
    and (tablename || '.' || policyname) = any (targets)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~*
      '\(\s*select\s+auth\.uid\(\)';
  if n_wrapped <> 14 then
    raise exception 'FAIL: expected all 14 policies to wrap auth.uid(), found %', n_wrapped;
  end if;

  select count(*) into n_pinned
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'activity_category',
      'neutralize_junk_place',
      'on_this_day',
      'place_membership_no_cycle',
      'race_bucket'
    )
    and 'search_path=public, pg_temp' = any (coalesce(p.proconfig, array[]::text[]));
  if n_pinned <> 5 then
    raise exception 'FAIL: expected 5 pinned function search paths, found %', n_pinned;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'place_membership_unique_pair'
      and conrelid = 'public.place_membership'::regclass
  ) then
    raise exception 'FAIL: redundant place_membership_unique_pair still exists';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'place_membership_pkey'
      and conrelid = 'public.place_membership'::regclass
      and contype = 'p'
  ) then
    raise exception 'FAIL: place_membership primary key is missing';
  end if;

  raise notice 'PASS: advisor hardening invariants hold (0121)';
end $$;

rollback;
