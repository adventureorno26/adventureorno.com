-- Data-health snapshot for the backup/health center: counts + integrity signals
-- across the whole dataset (including trash/drafts that RLS hides), so it's easy
-- to trust the data and spot orphans. Member-only.

create or replace function public.data_health()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_member() then json_build_object(
    'places_saved',       (select count(*) from places where saved and deleted_at is null and not coalesce(bucket,false)),
    'places_draft',       (select count(*) from places where not saved and deleted_at is null and not coalesce(bucket,false)),
    'places_bucket',      (select count(*) from places where coalesce(bucket,false) and deleted_at is null),
    'places_trash',       (select count(*) from places where deleted_at is not null),
    'photos',             (select count(*) from photos where deleted_at is null),
    'photos_unassigned',  (select count(*) from photos where place_id is null and deleted_at is null),
    'photos_no_date',     (select count(*) from photos where taken_at is null and deleted_at is null),
    'photos_trash',       (select count(*) from photos where deleted_at is not null),
    'photos_orphaned',    (select count(*) from photos ph where ph.place_id is not null
                             and not exists (select 1 from places pl where pl.id = ph.place_id)),
    'visits',             (select count(*) from visits),
    'activities',         (select count(*) from activities),
    'activities_no_place',(select count(*) from activities where place_id is null),
    'videos',             (select count(*) from videos),
    'videos_no_poster',   (select count(*) from videos where poster_key is null),
    'pings',              (select count(*) from location_pings)
  ) else null end;
$$;
grant execute on function public.data_health() to authenticated;
