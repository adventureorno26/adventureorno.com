-- 0237 — an export that is actually everything, and cannot become a way around the rules.
--
-- §3e Step 7. Two screens offer an "export" today and both of them overstate it:
--
--   Data health : "Download everything you can take with you."   → 162 places. Nothing else.
--   Settings    : "Download all 162 places"                       → the same three buttons.
--
-- 567 activities, 552 visits, 655 participants, 178 photos, 619 pieces of visit evidence,
-- 17,128 location pings, 49 import runs and every journal entry are not in it. The Data health
-- sentence is the one that matters: somebody reading it has been told their record is safe on
-- their own disk when almost none of it is. A backup you believe in and do not have is worse
-- than no backup at all.
--
-- WHAT THIS ADDS — three small functions rather than one big one, and the reason is a number:
--
--     authenticated  →  statement_timeout = 8s
--
-- The whole archive is ~9 MB and takes about seven seconds to build as superuser, so a single
-- `export_everything()` would have died on the timeout for the person who most needs it — the
-- one with the most data. Built section by section it also has something honest to show while
-- it runs, instead of a spinner over an unknown quantity.
--
--   export_manifest()        — the table of contents: section, row count, what it is. Cheap.
--   export_header()          — the envelope: when, who, and what is deliberately NOT in here.
--   export_section(name)     — one section's rows.
--
-- The browser walks the manifest, asks for each section in turn, and writes one JSON file.
-- `0237_the_export_is_the_whole_thing.test.sql` asserts that every section the manifest
-- promises actually resolves AND has the row count the manifest claimed — so the contents and
-- the table of contents cannot drift apart without the tests saying so.
--
-- WHY SECURITY **INVOKER**, deliberately, when nearly every other function here is DEFINER.
--
-- An export is the exact place where a definer's convenience turns into a way around
-- everything. 0228 decided that a Strava recording is visible only to its owner and to people
-- they have chosen to share with; 0236 made tagging propose rather than assert. A SECURITY
-- DEFINER `export_everything()` would hand all 567 activities to anyone who could call it and
-- quietly undo both. Running as the CALLER means the archive is bounded by the same row-level
-- policies as the app: what you can see is what you can take, and if that set is smaller than
-- someone expected, the answer is to be given access — not to have the export ignore the
-- question.
--
-- WHAT IS DELIBERATELY ABSENT, and the screen says all four out loud:
--
--   * CREDENTIALS — ingest_tokens, strava_accounts, google_tokens, oauth_states. Restoring
--     those would restore somebody's ability to ACT as her, which is not what a backup is for.
--     They come back by signing in again. `scripts/export-data.sh` has excluded them since it
--     was written; this agrees with it on purpose.
--   * THE PHOTO AND VIDEO FILES. Rows carry the object key, the date, the place and the hash —
--     the manifest of the library, not the library. Bytes are what the nightly encrypted
--     off-site backup is for, and conflating the two is how you end up holding 178 filenames
--     and no photographs.
--   * MACHINE PROPOSALS AND OPERATIONAL LOGS — suggestions, approval_undo, job_runs,
--     service_health, deleted_hashes. Re-derivable, and none of it is a record of anywhere
--     anyone went.
--   * REFERENCE DATA nobody made — parks, spatial_ref_sys. Two megabytes of national park
--     outlines in a personal archive is noise. `peaks` is the exception and only the summits
--     actually bagged are included, because a summit list with no summits in it is useless.
--
-- ON GEOMETRY. `to_jsonb` renders a geography column as WKB hex, which nothing else can read.
-- Shapes — place boundaries, the revealed area, a summit, a naming rule's circle — are written
-- as GeoJSON so the file opens in something other than this application. POINT geometries are
-- dropped instead: `places`, `activities`, `photos` and `location_pings` each carry `lat` and
-- `lng` beside `geom`, so keeping both would be a megabyte of the same fact written twice.

-- ---------------------------------------------------------------------------
-- The table of contents.
-- ---------------------------------------------------------------------------
create or replace function public.export_manifest()
returns table (section text, rows bigint, note text)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select 'people', count(*), 'everyone with an account here — names and roles, never passwords' from profiles
  union all select 'places', count(*), 'every place you have saved, with its shape' from places
  union all select 'place_categories', count(*), 'the categories places can have' from place_categories
  union all select 'place_membership_exceptions', count(*), 'places you said do NOT belong to a container' from place_membership_exceptions
  union all select 'ratings', count(*), 'what each of you thought of a place' from place_ratings
  union all select 'wishes', count(*), 'the places on the bucket list' from place_wishes
  union all select 'visits', count(*), 'a day, or a set of days, at a place' from visits
  union all select 'visit_people', count(*), 'who was on each visit' from visit_profiles
  union all select 'visit_evidence', count(*), 'what proves each visit happened' from visit_evidence
  union all select 'entries', count(*), 'your journal' from entries
  union all select 'activities', count(*), 'outings you can see — yours, and those shared with you' from activities
  union all select 'activity_sources', count(*), 'where each outing came from' from activity_sources where activity_id in (select id from activities)
  union all select 'activity_people', count(*), 'who was on each outing, and whether they said so' from activity_profiles where activity_id in (select id from activities)
  union all select 'activity_reactions', count(*), 'reactions to an outing' from activity_reactions where activity_id in (select id from activities)
  union all select 'activity_options', count(*), 'the kinds of activity you can pick from' from activity_options
  union all select 'photos', count(*), 'photo records — dates, places, file names; not the images' from photos
  union all select 'photo_reactions', count(*), 'reactions to a photo' from photo_reactions
  union all select 'videos', count(*), 'video records — not the files' from videos
  union all select 'peaks_bagged', count(*), 'summits, and the outing you did them on' from peak_bags
  union all select 'peaks', count(*), 'the summits themselves, for the ones you have bagged' from peaks where id in (select peak_id from peak_bags)
  union all select 'tag_claims', count(*), 'every tag someone proposed, and the answer they gave' from tag_claims
  union all select 'naming_rules', count(*), 'rules that name a place automatically' from naming_rules
  union all select 'tagging_rules', count(*), 'rules that suggest who was there' from tagging_rules
  union all select 'tagging_rule_exceptions', count(*), 'the times you told a tagging rule it was wrong' from tagging_rule_exceptions
  union all select 'location_pings', count(*), 'the raw track your phone recorded' from location_pings
  union all select 'revealed_area', count(*), 'the part of the map you have uncovered' from revealed_area
  union all select 'imports', count(*), 'every import run, and whether it worked' from ingest_runs
  union all select 'import_items', count(*), 'what each run did with each thing it found' from ingest_items
  union all select 'files_kept', count(*), 'the original uploaded files still held' from import_artifacts
  union all select 'connections', count(*), 'which accounts are connected — the link, not the keys' from source_connections
  union all select 'settings', count(*), 'your settings' from settings;
$function$;

comment on function public.export_manifest is
  'The archive''s table of contents: section, row count, what it is — so a person can read the '
  'contents before downloading anything. Runs as the CALLER, so the counts are what YOU can '
  'see (0237).';

-- ---------------------------------------------------------------------------
-- The envelope.
-- ---------------------------------------------------------------------------
create or replace function public.export_header()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'format',         'adventureorno.archive',
    'format_version', 1,
    'exported_at',    now(),
    'exported_by',    (select jsonb_build_object('id', p.id, 'display_name', p.display_name)
                         from profiles p where p.id = auth.uid()),
    'not_included',   jsonb_build_array(
      'The photo and video FILES. This holds their dates, places, file names and hashes — the images themselves stay in storage.',
      'Sign-in credentials. Strava, Google and device tokens are deliberately absent; they come back by signing in again.',
      'Anything you cannot see in the app. An outing whose owner has not chosen to share it is not here, and this export does not go around that.',
      'Machine proposals and operational logs — pending suggestions, job runs, health checks. Re-derivable, and none of it is a record of anywhere anyone went.'));
$function$;

comment on function public.export_header is
  'The archive envelope: when, who, and — said out loud — the four things that are '
  'deliberately not in it (0237).';

-- ---------------------------------------------------------------------------
-- One section at a time, because `authenticated` has an 8-second statement timeout.
-- ---------------------------------------------------------------------------
create or replace function public.export_section(p_section text)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select case p_section

    when 'people' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
         from (select id, display_name, role, created_at, share_location, share_tagged_outings
                 from profiles) x)

    when 'places' then
      (select coalesce(jsonb_agg(
                to_jsonb(x) - 'geom' - 'boundary'
                || jsonb_build_object('boundary', st_asgeojson(x.boundary)::jsonb)
                order by x.created_at), '[]'::jsonb) from places x)
    when 'place_categories' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.slug), '[]'::jsonb) from place_categories x)
    when 'place_membership_exceptions' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from place_membership_exceptions x)
    when 'ratings' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from place_ratings x)
    when 'wishes' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from place_wishes x)

    when 'visits' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date), '[]'::jsonb) from visits x)
    when 'visit_people' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from visit_profiles x)
    when 'visit_evidence' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.evidence_date), '[]'::jsonb) from visit_evidence x)
    when 'entries' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from entries x)

    when 'activities' then
      (select coalesce(jsonb_agg(to_jsonb(x) - 'geom' order by x.start_date), '[]'::jsonb) from activities x)
    when 'activity_sources' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from activity_sources x
        where x.activity_id in (select id from activities))
    when 'activity_people' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from activity_profiles x
        where x.activity_id in (select id from activities))
    when 'activity_reactions' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from activity_reactions x
        where x.activity_id in (select id from activities))
    when 'activity_options' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from activity_options x)

    when 'photos' then
      (select coalesce(jsonb_agg(to_jsonb(x) - 'geom' order by x.taken_at), '[]'::jsonb) from photos x)
    when 'photo_reactions' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from photo_reactions x)
    when 'videos' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.taken_at), '[]'::jsonb) from videos x)

    when 'peaks_bagged' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from peak_bags x)
    when 'peaks' then
      (select coalesce(jsonb_agg(to_jsonb(x) - 'geom'
                || jsonb_build_object('geom', st_asgeojson(x.geom)::jsonb)
                order by x.name), '[]'::jsonb)
         from peaks x where x.id in (select peak_id from peak_bags))

    when 'tag_claims' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from tag_claims x)
    when 'naming_rules' then
      (select coalesce(jsonb_agg(to_jsonb(x) - 'center'
                || jsonb_build_object('center', st_asgeojson(x.center)::jsonb)), '[]'::jsonb)
         from naming_rules x)
    when 'tagging_rules' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from tagging_rules x)
    when 'tagging_rule_exceptions' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from tagging_rule_exceptions x)

    when 'location_pings' then
      (select coalesce(jsonb_agg(to_jsonb(x) - 'geom' order by x.recorded_at), '[]'::jsonb)
         from location_pings x)
    when 'revealed_area' then
      (select coalesce(jsonb_agg(to_jsonb(x) - 'geom'
                || jsonb_build_object('geom', st_asgeojson(x.geom)::jsonb)), '[]'::jsonb)
         from revealed_area x)

    when 'imports' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.started_at), '[]'::jsonb) from ingest_runs x)
    when 'import_items' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from ingest_items x)
    when 'files_kept' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from import_artifacts x)
    when 'connections' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from source_connections x)
    when 'settings' then
      (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from settings x)

    -- Not a section. NULL rather than an empty array, so "we have nothing here" and "there is
    -- no such thing here" cannot be confused for each other — the test relies on the difference.
    else null
  end;
$function$;

comment on function public.export_section is
  'One section of the archive, named by export_manifest(). Split up because `authenticated` '
  'has an 8-second statement timeout and the whole thing takes about seven as superuser. '
  'Returns NULL — not [] — for a name that is not a section (0237).';

-- These replace a single `export_archive()` that existed for about an hour on 08-20 and never
-- shipped; it could not have finished inside the timeout.
drop function if exists public.export_archive();

revoke all on function public.export_manifest() from public, anon;
revoke all on function public.export_header() from public, anon;
revoke all on function public.export_section(text) from public, anon;
grant execute on function public.export_manifest() to authenticated;
grant execute on function public.export_header() to authenticated;
grant execute on function public.export_section(text) to authenticated;
