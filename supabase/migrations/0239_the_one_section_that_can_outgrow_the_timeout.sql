-- 0239 — the one section that can outgrow the timeout learns to page.
--
-- 0237 split the archive into sections because `authenticated` carries an 8-second statement
-- timeout. Measured on production the day it shipped:
--
--     location_pings   17,128 rows   1,270 ms server-side   4.9 MB
--     everything else  combined         < 300 ms            3.8 MB
--
-- So there is roughly 6× headroom, and exactly one section that will spend it. Pings are the
-- only thing here that grows on its own — a device recording all day adds thousands without
-- anybody doing anything, while places, visits and outings grow when a person goes somewhere.
-- At around 100,000 pings this section stops returning, and it stops returning FOR THE PERSON
-- WITH THE MOST TO LOSE, which is the failure 0237 split the function up to avoid in the first
-- place. Fixing it after it happens means fixing it for someone who cannot export.
--
-- `p_offset` and `p_limit` therefore apply to `location_pings` and to nothing else, and this
-- says so rather than implying a generality it does not have: every other section is under a
-- thousand rows and comes back whole. The manifest's row count is what tells the caller
-- whether paging is needed at all.
--
-- The order is `(recorded_at, id)`, not `recorded_at` alone — pings share a timestamp often
-- enough that ordering by it alone would let a row appear in two pages, or in none.
--
-- The one-argument form is dropped rather than left beside this one: two overloads reachable
-- through PostgREST under the same name is an ambiguity, and the defaults mean every existing
-- caller keeps working unchanged.
drop function if exists public.export_section(text);

create or replace function public.export_section(
  p_section text, p_offset int default 0, p_limit int default null)
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
      -- THE ONLY SECTION THAT CAN OUTGROW THE TIMEOUT, so it is the only one that pages.
      (select coalesce(jsonb_agg(to_jsonb(x) - 'geom' order by x.recorded_at, x.id), '[]'::jsonb)
         from (select * from location_pings
                order by recorded_at, id
               offset greatest(coalesce(p_offset, 0), 0)
                limit p_limit) x)
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
  'has an 8-second statement timeout. p_offset/p_limit apply to location_pings ONLY — the one '
  'section that grows on its own; everything else is under a thousand rows and comes back '
  'whole (0239). Returns NULL — not [] — for a name that is not a section.';

revoke all on function public.export_section(text, int, int) from public, anon;
grant execute on function public.export_section(text, int, int) to authenticated;
