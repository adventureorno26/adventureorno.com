-- 0119 — Extend Data Health with more integrity signals (Prompt 8, rec 61).
--
-- Adds the queryable signals the rec names that weren't surfaced yet:
--   * strava_tokens_expired — connected athletes whose access token is past expiry
--     (stale credentials; auto-refresh should renew, so a lingering count means a
--     refresh is failing).
--   * pings_unattributed — location_pings with no profile_id (older device points
--     before ingestion attribution was added in this session's rec-24 work).
-- Additive: same function, extra keys. (Orphaned R2 objects / failed jobs /
-- reconciliation times need the Worker /reconcile + a job system — out of SQL scope.)
--
-- ROLLBACK: recreate data_health() without the two new keys (prior definition).

create or replace function public.data_health()
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    'pings',              (select count(*) from location_pings),
    'pings_unattributed', (select count(*) from location_pings where profile_id is null),
    'strava_tokens_expired', (select count(*) from strava_accounts where expires_at < now())
  ) else null end;
$function$;
