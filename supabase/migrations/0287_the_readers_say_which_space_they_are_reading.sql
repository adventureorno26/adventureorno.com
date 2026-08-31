-- 0287 — the readers say which space they are reading.
--
-- DRAFT — REHEARSED, NOT APPLIED. Nothing in this file has been run against production
-- outside a transaction that was rolled back.
--
-- 0281 makes a space the boundary and rewrites 70 POLICIES to name one. It says, in its
-- own header, what it leaves behind:
--
--     "The hard part is that the ~60 SECURITY DEFINER stat readers bypass RLS by
--      construction, so after a fork they see BOTH copies of every shared card and every
--      person-scoped number doubles on the 108/56 shared rows."
--
-- That is this file. A policy cannot help here: SECURITY DEFINER runs as the function's
-- owner, and an owner is not subject to RLS. The boundary has to be written into the
-- readers themselves, exactly as 0281 wrote it into the seven views.
--
--
-- ============================================================================
-- WHAT WAS MEASURED, ON PRODUCTION, 2026-08-30 — not guessed from filenames
-- ============================================================================
--
-- Every count below comes from `pg_proc` on project aanfyhsjbtnqzphuoiem, read through the
-- Management API. The word "reader" means: SECURITY DEFINER, in `public`, contains no DML,
-- and names at least one space-owned relation.
--
--     226  SECURITY DEFINER functions in `public`
--      74  of them are readers of space-owned relations
--       8  of those 74 read ONLY the seven views 0281 already scopes, so 0281 scopes them
--          transitively and they are not touched here:
--            activity_lines, activity_lines_for_people, climbing_stats,
--            climbing_stats_for_people, mileage_by_person, mileage_by_person_for_people,
--            occasion_count, wrapped_year_miles
--      66  reach a space-owned BASE TABLE directly. Those are the leak.
--       3  of the 66 are excluded with a reason (below).
--      62  are rewritten in section 2.
--       0  of the 74 contain any INSERT, UPDATE or DELETE — checked, because a rewrite that
--          silently changed a write path is the one mistake this file could not survive.
--
-- WHY NOT search_path. The obvious mechanism — a `scoped` schema of shadow views, put in
-- front of `public` on each function's search_path — was measured and DISCARDED: **71 of
-- the 74 readers reference their tables as `public.places`, schema-qualified**, and a
-- qualified name ignores the search_path entirely. It would have scoped three functions
-- and looked like it had scoped seventy-four. That is the worst possible outcome, so it is
-- recorded here rather than left for somebody to rediscover.
--
-- WHY NOT security_invoker. Flipping the readers to invoker rights would apply RLS, and
-- RLS after 0281 does contain the space clause — but it contains everything ELSE too. Erica
-- ruled on 2026-08-30 that a card which hides who was there "lies by omission"; §0.2 has
-- the measurement: she would lose 305 participant rows on visits she can still see. The
-- boundary is written down instead. Same ruling, same reason, one section later.
--
--
-- ============================================================================
-- THE MECHANISM: ONE VIEW PER TABLE, AND WHY A VIEW RATHER THAN A WHERE CLAUSE
-- ============================================================================
--
-- Section 1 creates `in_space_<table>` for each of the twenty space-owned base tables the
-- readers touch. Section 2 repoints the readers at them. Two reasons this beats editing
-- sixty-two WHERE clauses by hand:
--
--   1. OUTER JOINS. Several readers `left join public.places p on …`. A WHERE clause
--      appended to such a query turns the outer join into an inner one and drops rows; a
--      clause added to the ON has to be written per-site and got right per-site. A view
--      restricts the relation and leaves the join type alone, every time, with no judgement
--      needed at sixty-two separate sites.
--   2. THE RULE IS WRITTEN ONCE PER TABLE. A reviewer checks twenty sentences and a
--      name substitution, instead of sixty-two hand-written predicates.
--
-- The substitution is purely lexical and only at a FROM or JOIN site:
--     (from|join)\s+(public\.)?<table>(?![A-Za-z0-9_])  ->  \1public.in_space_<table>
-- so `declare v_row public.visits` and `returns setof visits` are untouched, and
-- `place_membership` never eats `place_membership_exceptions`.
--
--
-- ============================================================================
-- `activities` HAS NO VIEW HERE, DELIBERATELY
-- ============================================================================
--
-- `supabase/tests/the_readers_stay_enforced.test.sql` is a structural guard: every
-- SECURITY DEFINER function that reads `public.activities` directly must be named on an
-- allowlist with a reason, because SECURITY DEFINER bypasses the Strava rule. Its regex is
--
--     (from|join|using|update)[[:space:]]+(public\.)?activities
--
-- An `in_space_activities` view would let seven allowlisted readers quietly stop matching
-- that regex while still bypassing the Strava rule, which is the guard being defeated by
-- the change that was supposed to strengthen it. So `activities` keeps its name and the
-- seven get the clause written into them by hand, in this file, one site at a time:
--
--     can_see_activity          `and public.is_member(a.space_id)` on the subject row
--     data_health               both raw counts
--     import_duplicates_pending on the join to the suggestion's subject
--     person_totals             in the `canon` CTE, before the dedupe
--     shared_outings            both sites — `mine`, and the honest `restricted_rows` count
--     visible_recording_of      in the ON of the LEFT JOIN, not the WHERE
--
--     same_recording_of         **UNCHANGED, and that is the finding.** It is called by the
--                               importer, where `auth.uid()` is NULL, so any caller-boundary
--                               clause would make it return nothing and duplicate detection
--                               would silently stop. It does not need one: it already reads
--                               `a.owner_profile = p_owner`, and an activity owned by a
--                               profile is in that profile's space by construction of the
--                               split. Adding `is_member()` here would have been a bug that
--                               looked like a fix.
--
--
-- ============================================================================
-- THE THREE READERS THAT ARE NOT REWRITTEN, EACH WITH ITS REASON
-- ============================================================================
--
--   memory_people_refuse_a_blocked_tag  A TRIGGER, and the one exclusion that is a safety
--                                       matter rather than a scoping one. It reads `people`
--                                       to ask "is the person being tagged blocked?".
--                                       Scoping that read would make a block stop being
--                                       found across a space boundary — i.e. it would let
--                                       exactly the tag through that the trigger exists to
--                                       refuse. Blocks are bidirectional and global; they
--                                       are not a space question.
--
--   merge_nearby_dupes                  A WRITE path (it calls `merge_places_auto`).
--   move_visit_to_place                 A WRITE path (it calls `set_visit_place` and
--                                       `reassign_activity`).
--
--   ⚠️ THE TWO WRITE PATHS ARE A REAL GAP AND THIS FILE DOES NOT CLOSE IT. Both are
--   SECURITY DEFINER, so 0281's rewritten policies do not constrain them either — a definer
--   writer bypasses RLS exactly as a definer reader does. After the split, nothing in the
--   database stops `merge_nearby_dupes` from merging a place in Erica's space into one in
--   Josh's. That is a WRITER audit, it is a different question with a different answer, and
--   inventing an answer for it inside a reader migration is how a migration stops being
--   reviewable. It is named here so it cannot be lost.
--
--
-- ============================================================================
-- THE ABORT CRITERION, AND WHAT IT MEASURED
-- ============================================================================
--
-- Erica, 2026-08-30: *"Any row count that changes for either of them, on any screen, that
-- cannot be explained."* Both accounts were signed in as themselves against PRODUCTION,
-- inside `begin … rollback`, before and after this file, over 45 numbers each. Every one is
-- identical, which is the expected result and the only acceptable one: 0281 puts every
-- existing row in ONE space and both humans in it, so `is_member(space_id)` is true for
-- every row either of them can reach today. The clause is inert until the split fills
-- Josh's space — which is the whole point of landing it first.
--
--     ERICA  My Stats 132 places / 2136.1 mi · Our Stats 55 / 481.6 · Josh's own 61 / 1053.7
--     JOSH   My Stats  61 places / 1468.7 mi · Our Stats 55 / 535.4 · Erica's own 132 / 1334.2
--
-- (§0.2's reference figures are 2135.6 and 481.6. 481.6 reproduces exactly. My Stats reads
-- 2136.1 rather than 2135.6 — a 0.5 mile difference that predates this file and is present
-- in the BEFORE measurement, so it is data added since §0.2 was written, not a regression
-- introduced here. It is called out rather than rounded away.)
--
--
-- ============================================================================
-- WHAT THIS FILE REQUIRES, AND WHAT IT DOES NOT DO
-- ============================================================================
--
-- REQUIRES 0281. There is no `space_id` and no `is_member(uuid)` without it. This file is
-- meaningless applied alone and will not compile.
--
-- IT DOES NOT split the data. Every row is still in one space after this runs, so nothing
-- moves. This is the precondition 0281's header asks for, so that the split — which forks
-- 108 visits, 56 outings and 76 places into both spaces — lands into readers that already
-- know which copy is theirs, instead of doubling every shared number the moment it runs.

begin;

-- ---------------------------------------------------------------------------
-- 1. THE BOUNDARY, AS A RELATION. One view per space-owned table a reader touches,
--    each stating the same sentence in its own WHERE: you see a row if you are in the
--    space that owns it. Definer, and revoked from every client role — these exist to be
--    read from INSIDE a SECURITY DEFINER function and from nowhere else.
-- ---------------------------------------------------------------------------

create or replace view public.in_space_approved_fields as
  select * from public.approved_fields where public.is_member(space_id);
alter view public.in_space_approved_fields set (security_invoker = false);
revoke all on public.in_space_approved_fields from public;
revoke all on public.in_space_approved_fields from anon, authenticated;

create or replace view public.in_space_entries as
  select * from public.entries where public.is_member(space_id);
alter view public.in_space_entries set (security_invoker = false);
revoke all on public.in_space_entries from public;
revoke all on public.in_space_entries from anon, authenticated;

create or replace view public.in_space_location_pings as
  select * from public.location_pings where public.is_member(space_id);
alter view public.in_space_location_pings set (security_invoker = false);
revoke all on public.in_space_location_pings from public;
revoke all on public.in_space_location_pings from anon, authenticated;

create or replace view public.in_space_memory_people as
  select * from public.memory_people where public.is_member(space_id);
alter view public.in_space_memory_people set (security_invoker = false);
revoke all on public.in_space_memory_people from public;
revoke all on public.in_space_memory_people from anon, authenticated;

create or replace view public.in_space_memory_subjects as
  select * from public.memory_subjects where public.is_member(space_id);
alter view public.in_space_memory_subjects set (security_invoker = false);
revoke all on public.in_space_memory_subjects from public;
revoke all on public.in_space_memory_subjects from anon, authenticated;

create or replace view public.in_space_naming_rules as
  select * from public.naming_rules where public.is_member(space_id);
alter view public.in_space_naming_rules set (security_invoker = false);
revoke all on public.in_space_naming_rules from public;
revoke all on public.in_space_naming_rules from anon, authenticated;

create or replace view public.in_space_peak_bags as
  select * from public.peak_bags where public.is_member(space_id);
alter view public.in_space_peak_bags set (security_invoker = false);
revoke all on public.in_space_peak_bags from public;
revoke all on public.in_space_peak_bags from anon, authenticated;

create or replace view public.in_space_peaks as
  select * from public.peaks where public.is_member(space_id);
alter view public.in_space_peaks set (security_invoker = false);
revoke all on public.in_space_peaks from public;
revoke all on public.in_space_peaks from anon, authenticated;

create or replace view public.in_space_people as
  select * from public.people where public.is_member(space_id);
alter view public.in_space_people set (security_invoker = false);
revoke all on public.in_space_people from public;
revoke all on public.in_space_people from anon, authenticated;

create or replace view public.in_space_photos as
  select * from public.photos where public.is_member(space_id);
alter view public.in_space_photos set (security_invoker = false);
revoke all on public.in_space_photos from public;
revoke all on public.in_space_photos from anon, authenticated;

create or replace view public.in_space_place_membership as
  select * from public.place_membership where public.is_member(space_id);
alter view public.in_space_place_membership set (security_invoker = false);
revoke all on public.in_space_place_membership from public;
revoke all on public.in_space_place_membership from anon, authenticated;

create or replace view public.in_space_place_ratings as
  select * from public.place_ratings where public.is_member(space_id);
alter view public.in_space_place_ratings set (security_invoker = false);
revoke all on public.in_space_place_ratings from public;
revoke all on public.in_space_place_ratings from anon, authenticated;

create or replace view public.in_space_place_wishes as
  select * from public.place_wishes where public.is_member(space_id);
alter view public.in_space_place_wishes set (security_invoker = false);
revoke all on public.in_space_place_wishes from public;
revoke all on public.in_space_place_wishes from anon, authenticated;

create or replace view public.in_space_places as
  select * from public.places where public.is_member(space_id);
alter view public.in_space_places set (security_invoker = false);
revoke all on public.in_space_places from public;
revoke all on public.in_space_places from anon, authenticated;

create or replace view public.in_space_suggestions as
  select * from public.suggestions where public.is_member(space_id);
alter view public.in_space_suggestions set (security_invoker = false);
revoke all on public.in_space_suggestions from public;
revoke all on public.in_space_suggestions from anon, authenticated;

create or replace view public.in_space_tag_claims as
  select * from public.tag_claims where public.is_member(space_id);
alter view public.in_space_tag_claims set (security_invoker = false);
revoke all on public.in_space_tag_claims from public;
revoke all on public.in_space_tag_claims from anon, authenticated;

create or replace view public.in_space_tagging_rules as
  select * from public.tagging_rules where public.is_member(space_id);
alter view public.in_space_tagging_rules set (security_invoker = false);
revoke all on public.in_space_tagging_rules from public;
revoke all on public.in_space_tagging_rules from anon, authenticated;

create or replace view public.in_space_videos as
  select * from public.videos where public.is_member(space_id);
alter view public.in_space_videos set (security_invoker = false);
revoke all on public.in_space_videos from public;
revoke all on public.in_space_videos from anon, authenticated;

create or replace view public.in_space_visit_people as
  select * from public.visit_people where public.is_member(space_id);
alter view public.in_space_visit_people set (security_invoker = false);
revoke all on public.in_space_visit_people from public;
revoke all on public.in_space_visit_people from anon, authenticated;

create or replace view public.in_space_visits as
  select * from public.visits where public.is_member(space_id);
alter view public.in_space_visits set (security_invoker = false);
revoke all on public.in_space_visits from public;
revoke all on public.in_space_visits from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. THE READERS. 62 function bodies, each taken from production verbatim and
--    changed only where a space-owned relation is named. `create or replace` on an
--    EXISTING function keeps its ACL, so no grant moves here and 0154's matrix is unmoved.
-- ---------------------------------------------------------------------------

create or replace function public.activities_of_type(p_type text, p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, type text, name text, distance double precision, start_date timestamp with time zone, place_id uuid, place_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id))
           a.id, a.type, a.name, a.distance, a.start_date, a.place_id
      from public.visible_activities a
     where a.type = p_type
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select c.id, c.type, c.name, c.distance, c.start_date, c.place_id, p.name
    from canon c
    left join public.in_space_places p on p.id = c.place_id
   order by c.start_date desc nulls last;
$function$;

create or replace function public.activities_of_type_for_people(p_type text, p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, type text, name text, distance double precision, start_date timestamp with time zone, place_id uuid, place_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once: the same run recorded by two people shares a
    -- shared_group_id (0140/0141). Tie-break a.id, matching mileage_by_person_for_people.
    select distinct on (coalesce(a.shared_group_id, a.id))
           a.id, a.type, a.name, a.distance, a.start_date, a.place_id
      from public.visible_activities a
     where a.type = p_type
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  -- The place join happens after the collapse so it cannot re-multiply the rows, and the
  -- caller's ordering is restored here — DISTINCT ON owns the ORDER BY of its own subquery.
  select c.id, c.type, c.name, c.distance, c.start_date, c.place_id, p.name
    from canon c
    left join public.in_space_places p on p.id = c.place_id
   order by c.start_date desc nulls last;
$function$;

create or replace function public.can_rename_place(p_place uuid, p_caller uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
           -- never named by a person yet, so it is anyone's to name
           when not coalesce(p.name_locked, false) then true
           -- named in the shared space -> either of us
           when p.name_scope is null then true
           -- named in someone's own space -> only them
           else p.name_scope = p_caller
         end
    from public.in_space_places p
   where p.id = p_place;
$function$;

create or replace function public.can_see_activity(p_activity uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.activities a
     where a.id = p_activity
       and public.is_member(a.space_id)
       and (
         lower(coalesce(a.original_source, '')) <> 'strava'
         or a.owner_profile = auth.uid()
         or exists (
              select 1
                from public.activity_profiles ap
                join public.profiles ow on ow.id = a.owner_profile
               where ap.activity_id = a.id
                 and ap.profile_id = auth.uid()
                 and coalesce(ap.claim_status, 'accepted') <> 'rejected'
                 and ow.share_tagged_outings)
       )
  );
$function$;

create or replace function public.can_see_memory_subject(p_subject uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.in_space_memory_subjects s
     where s.id = p_subject
       and public.is_member()
       and not public.is_blocked_between(s.owner_profile, auth.uid())
       and case s.kind
             when 'photo' then exists (
               select 1 from public.in_space_photos ph
                where ph.id = s.photo_id
                  and ph.deleted_at is null
                  and (ph.uploaded_by = auth.uid()
                    or (ph.uploaded_by is null and public.is_owner())
                    or (ph.place_id is not null and public.place_is_saved(ph.place_id))))
             when 'outing' then public.can_see_activity(s.activity_id)
             else false
           end);
$function$;

create or replace function public.card_view(p_place uuid DEFAULT NULL::uuid, p_visit uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_place  public.places;
  v_visit  public.visits;
  v_mode   text;
  v_edit   boolean := public.is_editor_or_owner();
  v_result jsonb;
begin
  perform public.assert_member();

  if p_visit is not null then
    select * into v_visit from public.in_space_visits where id = p_visit;
    if v_visit.id is null then raise exception 'no such visit'; end if;
    select * into v_place from public.in_space_places where id = v_visit.place_id;
    v_mode := 'visit';
  elsif p_place is not null then
    select * into v_place from public.in_space_places where id = p_place;
    if v_place.id is null then raise exception 'no such place'; end if;
    v_mode := case when coalesce(v_place.is_trail, false) then 'trail' else 'place' end;
  else
    raise exception 'card_view needs a place or a visit';
  end if;

  with
  -- A trail's visits include its sections'. Everywhere else it is just this place.
  scope as (
    select v_place.id as place_id
    union
    select m.child_id from public.in_space_place_membership m
     where v_mode = 'trail' and m.parent_id = v_place.id
  ),
  rows_v as (
    select av.*
      from public.accepted_visits av
     where (v_mode = 'visit' and av.id = v_visit.id)
        or (v_mode <> 'visit' and av.place_id in (select place_id from scope))
  ),
  visit_rows as (
    select r.id, r.place_id, r.start_date, r.end_date, r.note,
           r.is_trip_qualified, r.is_headline, r.parent_visit_id,
           case when v_mode = 'trail' and r.place_id <> v_place.id
                then (select p.name from public.in_space_places p where p.id = r.place_id) end as segment,
           coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                      order by pr.display_name)
                       from public.visit_profiles vp
                       join public.profiles pr on pr.id = vp.profile_id
                      where vp.visit_id = r.id), '[]'::jsonb) as people,
           -- BY visit_id, not by date (§0.1). place_visit_stats counted a photo for
           -- every visit at the place whose range covered its date.
           (select count(*) from public.in_space_photos ph
             where ph.visit_id = r.id and ph.deleted_at is null) as photos,
           (select count(*) from public.in_space_videos vd where vd.visit_id = r.id) as videos,
           (select count(*) from public.visible_activities a where a.visit_id = r.id) as routes,
           (select count(*) from public.in_space_visits c where c.parent_visit_id = r.id) as children,
           -- What is inside this visit, so "N places" and the list it opens are the
           -- same data. Previously one trip_contents call per trip.
           coalesce((select jsonb_agg(jsonb_build_object(
                              'visit_id', c.id, 'place_id', c.place_id,
                              'place_name', cp.name,
                              'start_date', c.start_date, 'end_date', c.end_date)
                            order by c.start_date, cp.name)
                       from public.in_space_visits c
                       join public.in_space_places cp on cp.id = c.place_id
                      where c.parent_visit_id = r.id
                        and cp.deleted_at is null), '[]'::jsonb) as contents
      from rows_v r
  ),
  route_rows as (
    select a.id, a.name, a.type, a.distance,
           coalesce(a.local_date, a.start_date::date) as day, a.summary_polyline,
           -- WHO DID IT, from the participant rows. The card read this off
           -- `activities.solo_profile`, which cannot say "Erica and Sam but not Josh" —
           -- one nullable column has exactly two states for a household of two, and no
           -- states at all for a household of three (§0.3).
           coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                      order by pr.display_name)
                       from public.activity_profiles ap
                       join public.profiles pr on pr.id = ap.profile_id
                      where ap.activity_id = a.id), '[]'::jsonb) as people
      from public.visible_activities a
     where a.visit_id in (select id from rows_v)
     order by coalesce(a.local_date, a.start_date::date) desc
  ),
  photo_rows as (
    select ph.id, coalesce(ph.local_date, ph.taken_at::date) as day, ph.caption
      from public.in_space_photos ph
     where ph.visit_id in (select id from rows_v) and ph.deleted_at is null
     order by coalesce(ph.local_date, ph.taken_at::date) desc
  ),
  member_rows as (
    select p.id, p.name, p.rating, coalesce(p.categories[1], 'place') as category
      from public.in_space_place_membership m
      join public.in_space_places p on p.id = m.child_id
     where m.parent_id = v_place.id and p.deleted_at is null
       and v_mode <> 'visit'
     order by p.name
  ),
  rating_rows as (
    select pr.display_name as name, r.profile_id, r.rating
      from public.in_space_place_ratings r
      join public.profiles pr on pr.id = r.profile_id
     where r.place_id = v_place.id
     order by pr.display_name
  )
  select jsonb_build_object(
    'version', 3,
    'mode', v_mode,
    'can_edit', v_edit,
    'place', jsonb_build_object(
       'id', v_place.id, 'name', v_place.name, 'address', v_place.address,
       'admin1', v_place.admin1, 'lat', v_place.lat, 'lng', v_place.lng,
       'is_trail', coalesce(v_place.is_trail, false),
       'cover_photo_id', v_place.cover_photo_id,
       'categories', coalesce(to_jsonb(v_place.categories), '[]'::jsonb)),
    'visit', case when v_mode = 'visit' then jsonb_build_object(
       'id', v_visit.id, 'start_date', v_visit.start_date, 'end_date', v_visit.end_date,
       'note', v_visit.note, 'trip_marked', v_visit.trip_marked,
       'parent_visit_id', v_visit.parent_visit_id) end,
    'ratings', coalesce((select jsonb_agg(to_jsonb(x)) from rating_rows x), '[]'::jsonb),
    'visits',  coalesce((select jsonb_agg(to_jsonb(x) order by x.start_date desc)
                           from visit_rows x), '[]'::jsonb),
    'routes',  coalesce((select jsonb_agg(to_jsonb(x)) from route_rows x), '[]'::jsonb),
    'photos',  coalesce((select jsonb_agg(to_jsonb(x)) from photo_rows x), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(to_jsonb(x)) from member_rows x), '[]'::jsonb),
    -- Computed from the very rows above, so a label cannot disagree with its list.
    'totals', jsonb_build_object(
       'visits',  (select count(*) from visit_rows),
       'trips',   (select count(*) from visit_rows where is_trip_qualified and is_headline),
       'photos',  (select count(*) from photo_rows),
       'videos',  (select coalesce(sum(videos), 0) from visit_rows),
       'routes',  (select count(*) from route_rows),
       'miles',   coalesce((select sum(distance) from route_rows), 0) / 1609.344,
       'members', (select count(*) from member_rows))
  ) into v_result;

  return v_result;
end $function$;

create or replace function public.data_health()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.is_member() then json_build_object(
    'places_saved',       (select count(*) from public.in_space_places where saved and deleted_at is null and not coalesce(bucket,false)),
    'places_draft',       (select count(*) from public.in_space_places where not saved and deleted_at is null and not coalesce(bucket,false)),
    'places_bucket',      (select count(*) from public.in_space_places where coalesce(bucket,false) and deleted_at is null),
    'places_trash',       (select count(*) from public.in_space_places where deleted_at is not null),
    'photos',             (select count(*) from public.in_space_photos where deleted_at is null),
    'photos_unassigned',  (select count(*) from public.in_space_photos where place_id is null and deleted_at is null),
    'photos_no_date',     (select count(*) from public.in_space_photos where taken_at is null and deleted_at is null),
    'photos_trash',       (select count(*) from public.in_space_photos where deleted_at is not null),
    'photos_orphaned',    (select count(*) from public.in_space_photos ph where ph.place_id is not null
                             and not exists (select 1 from public.in_space_places pl where pl.id = ph.place_id)),
    'visits',             (select count(*) from public.in_space_visits),
    'activities',         (select count(*) from activities where public.is_member(space_id)),
    'activities_no_place',(select count(*) from activities where place_id is null and public.is_member(space_id)),
    'videos',             (select count(*) from public.in_space_videos),
    'videos_no_poster',   (select count(*) from public.in_space_videos where poster_key is null),
    'pings',              (select count(*) from public.in_space_location_pings),
    'pings_unattributed', (select count(*) from public.in_space_location_pings where profile_id is null),
    'strava_tokens_expired', (select count(*) from strava_accounts where expires_at < now())
  ) else null end;
$function$;

create or replace function public.date_night_pick(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with mem as (
    select count(*)::int c from public.profiles
      where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)'
  ),
  bothwant as (
    select w.place_id from public.in_space_place_wishes w
    group by w.place_id
    having count(*) >= (select c from mem) and (select c from mem) >= 2
  )
  select b.place_id from bothwant b
  join public.in_space_places p on p.id = b.place_id
  where p_lat is null or p_lng is null or p_radius_km is null
     or (p.lat is not null and st_dwithin(
           p.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000))
  order by random()
  limit 1;
$function$;

create or replace function public.geo_coverage(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(us_states text[], us_state_count integer, countries text[], country_count integer, has_dc boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with base as (
    select p.* from public.in_space_places p
    where saved and not coalesce(bucket, false)
      and (p_profile is null
           or exists(select 1 from public.place_people() pp
                     where pp.place_id = p.id and pp.profile_id = p_profile))
  ),
  us as (
    select distinct admin1 from base
    where country = 'United States' and admin1 is not null and admin1 <> 'District of Columbia'
  ),
  co as (select distinct country from base where country is not null)
  select (select array_agg(admin1 order by admin1) from us), (select count(*)::int from us),
         (select array_agg(country order by country) from co), (select count(*)::int from co),
         exists(select 1 from base where admin1 = 'District of Columbia');
$function$;

create or replace function public.geo_coverage_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(us_states text[], us_state_count integer, countries text[], country_count integer, has_dc boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with base as (
    select p.admin1, p.country
      from public.in_space_places p
     where p.saved
       and not coalesce(p.bucket, false)
       and p.deleted_at is null
       and (coalesce(array_length(p_people, 1), 0) = 0
              or p.id in (select public.place_ids_for_people(p_people, p_mode)))
  ),
  us as (
    select distinct admin1 from base
     where country = 'United States' and admin1 is not null and admin1 <> 'District of Columbia'
  ),
  co as (select distinct country from base where country is not null)
  select (select array_agg(admin1 order by admin1) from us), (select count(*)::int from us),
         (select array_agg(country order by country) from co), (select count(*)::int from co),
         exists(select 1 from base where admin1 = 'District of Columbia');
$function$;

create or replace function public.import_duplicates_pending()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'count', count(*),
    'earliest', min(a.start_date)::date,
    'latest',   max(a.start_date)::date)
    from public.in_space_suggestions s
    join public.activities a on a.id = s.subject_id and public.is_member(a.space_id)
   where s.status = 'pending'
     and s.field = 'shared_group_id'
     and s.source = 'import'
     and s.subject_type = 'activity'
     and a.owner_profile = auth.uid();
$function$;

create or replace function public.inbox(p_limit integer DEFAULT 25, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select coalesce(jsonb_agg(c.card order by c.newest desc), '[]'::jsonb)
  from (
    select
      g.group_key,
      max(g.created_at) as newest,
      split_part(g.group_key, ':', 1) as kind,
      nullif(split_part(g.group_key, ':', 2), '')::uuid as subject
    from public.in_space_suggestions g
    where g.status = 'pending'
      and (p_cursor is null or g.created_at < p_cursor)
      -- A CARD ABOUT SOMETHING YOU CANNOT SEE IS NOT A QUESTION.
      --
      -- Measured 2026-08-18: of the 33 cards Erica's queue returned, FIFTEEN had no
      -- visible activity at all. Their subject is Josh's Strava recording, correctly
      -- hidden from her by the rule 0200 exists to enforce — so the card rendered as
      -- "Something to name", a heading reading `shared_group_id`, and a bare uuid. She
      -- could not see it, could not judge it, and approving it would have linked two
      -- activities one of which is invisible to her.
      --
      -- Visits are unaffected: they are not source-restricted, so they carry no subject
      -- to hide.
      and (split_part(g.group_key, ':', 1) = 'visit'
           or exists (select 1 from public.visible_activities va
                       where va.id = nullif(split_part(g.group_key, ':', 2), '')::uuid))
      -- And for a DUPLICATE, both sides must be visible or the comparison is half-blind:
      -- "are these the same outing?" cannot be answered against a blank.
      and (g.field is distinct from 'shared_group_id'
           or exists (select 1 from public.visible_activities vb
                       where vb.id = coalesce((g.evidence ->> 'kept')::uuid,
                                              (g.proposed_value #>> '{}')::uuid)))
    group by g.group_key
    order by max(g.created_at) desc
    limit greatest(1, least(100, p_limit))
  ) gk
  cross join lateral (
    select jsonb_build_object(
      'group_key',    gk.group_key,
      'subject_type', case when gk.kind = 'visit' then 'visit' else 'activity' end,
      'subject_id',   gk.subject::text,
      'created_at',   gk.newest,
      'activity',     case when gk.kind <> 'visit' then (
                        select jsonb_build_object(
                                 'name', a.name, 'type', a.type, 'distance', a.distance,
                                 'start_date', a.start_date, 'place', p.name,
                                 -- what the card was missing
                                 'place_id', a.place_id, 'lat', a.lat, 'lng', a.lng,
                                 'polyline', a.summary_polyline)
                          from public.visible_activities a
                          left join public.in_space_places p on p.id = a.place_id
                         where a.id = gk.subject) end,
      'visit',        case when gk.kind = 'visit' then (
                        select jsonb_build_object(
                                 'place', p.name, 'start_date', v.start_date,
                                 'end_date', v.end_date, 'place_id', v.place_id)
                          from public.in_space_visits v
                          left join public.in_space_places p on p.id = v.place_id
                         where v.id = gk.subject) end,
      -- THE OTHER SIDE OF A DUPLICATE PROPOSAL.
      -- A card that asks "are these the same outing?" has to show BOTH. Until now it
      -- showed one activity and a raw UUID, rendered through the naming UI — a heading
      -- reading `shared_group_id`, a radio option whose text was the uuid, and a free-text
      -- box inviting a person to type one. There is no answer a person could give to that.
      'counterpart',  (
        select jsonb_build_object(
                 'id', b.id, 'name', b.name, 'type', b.type, 'distance', b.distance,
                 'start_date', b.start_date, 'place', bp.name, 'place_id', b.place_id,
                 'polyline', b.summary_polyline,
                 'owner', ow.display_name,
                 'source', coalesce(nullif(b.original_source,''), b.source),
                 'minutes_apart', (s.evidence ->> 'minutes_apart')::numeric,
                 'pct_diff', (s.evidence ->> 'pct_diff')::numeric,
                 'reason', s.evidence ->> 'reason')
          from public.in_space_suggestions s
          join public.visible_activities b
            on b.id = coalesce((s.evidence ->> 'kept')::uuid, (s.proposed_value #>> '{}')::uuid)
          left join public.in_space_places bp on bp.id = b.place_id
          left join public.profiles ow on ow.id = b.owner_profile
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.field = 'shared_group_id'
         limit 1),
      'mine',         (
        select jsonb_build_object('owner', ow.display_name,
                 'source', coalesce(nullif(a.original_source,''), a.source))
          from public.visible_activities a
          left join public.profiles ow on ow.id = a.owner_profile
         where a.id = gk.subject),
      'fields',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'field', s.field, 'label', s.label,
                   'proposed', s.proposed_value, 'current', s.current_value,
                   'source', s.source, 'confidence', s.confidence,
                   'evidence', s.evidence, 'rank', s.rank)
                 order by s.field, s.rank)
          from public.in_space_suggestions s
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type <> 'photo'), '[]'::jsonb),
      'photos',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'photo_id', s.subject_id::text,
                   'confidence', s.confidence,
                   'distance_m', (s.evidence ->> 'distance_m')::int,
                   'local_date', s.evidence ->> 'local_date',
                   'taken_at', ph.taken_at)
                 order by (s.evidence ->> 'distance_m')::int)
          from public.in_space_suggestions s
          join public.in_space_photos ph on ph.id = s.subject_id
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type = 'photo' and ph.deleted_at is null), '[]'::jsonb)
    ) as card, gk.newest
  ) c;
$function$;

create or replace function public.inbox_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select jsonb_build_object(
    'cards',       (select count(distinct group_key) from public.in_space_suggestions where status = 'pending'),
    'suggestions', (select count(*) from public.in_space_suggestions where status = 'pending'));
$function$;

create or replace function public.last_seen()
 RETURNS TABLE(profile_id uuid, display_name text, lat double precision, lng double precision, recorded_at timestamp with time zone, age_seconds bigint, photo_id uuid, is_me boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with latest as (
    select distinct on (lp.profile_id)
      lp.profile_id, lp.lat, lp.lng, lp.recorded_at
    from public.in_space_location_pings lp
    where lp.profile_id is not null
    order by lp.profile_id, lp.recorded_at desc
  ),
  their_photo as (
    select distinct on (ph.uploaded_by) ph.uploaded_by, ph.id
    from public.in_space_photos ph
    where ph.uploaded_by is not null
      and ph.deleted_at is null
    order by ph.uploaded_by, coalesce(ph.taken_at, ph.created_at) desc
  )
  select
    p.id,
    p.display_name,
    l.lat,
    l.lng,
    l.recorded_at,
    extract(epoch from (now() - l.recorded_at))::bigint as age_seconds,
    tp.id,
    (p.id = auth.uid()) as is_me
  from public.profiles p
  join latest l on l.profile_id = p.id
  left join their_photo tp on tp.uploaded_by = p.id
  where p.share_location or p.id = auth.uid()
  order by l.recorded_at desc;
end $function$;

create or replace function public.list_trash()
 RETURNS TABLE(kind text, id uuid, label text, deleted_at timestamp with time zone, place_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'place'::text, p.id, coalesce(nullif(p.name, ''), 'Untitled place'), p.deleted_at, null::uuid
  from public.in_space_places p
  where p.deleted_at is not null and p.deleted_at > now() - interval '30 days'
    and public.is_member()
    and (p.saved or p.created_by = auth.uid() or (p.created_by is null and public.is_owner()))
  union all
  select 'photo'::text, ph.id, coalesce(ph.caption, 'Photo'), ph.deleted_at, ph.place_id
  from public.in_space_photos ph
  where ph.deleted_at is not null and ph.deleted_at > now() - interval '30 days'
    and public.is_member()
    and (ph.uploaded_by = auth.uid() or (ph.uploaded_by is null and public.is_owner()))
  order by deleted_at desc;
$function$;

create or replace function public.match_photo(p_taken_at timestamp with time zone, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS TABLE(place_id uuid, name text, meters double precision, reason text, score double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select auth.uid() as uid),
  photo as (
    select
      p_taken_at as t,
      case
        when p_lat is not null and p_lng is not null
        then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
      end as g
  ),
  near_ping as (
    select lp.geom as pg, abs(extract(epoch from (lp.recorded_at - photo.t))) as dt
    from public.in_space_location_pings lp, photo, me
    where photo.t is not null
      and lp.profile_id = me.uid
      and lp.recorded_at between photo.t - interval '3 hours' and photo.t + interval '3 hours'
    order by dt asc
    limit 1
  ),
  cand as (
    select pl.id, pl.name,
           st_distance(pl.geom, photo.g) as meters,
           'photo location'::text as reason,
           greatest(0, 100 - st_distance(pl.geom, photo.g) / 30) as score
    from public.in_space_places pl, photo, me
    where photo.g is not null and pl.geom is not null
      and (pl.saved or pl.created_by = me.uid)
      and st_dwithin(pl.geom, photo.g, 5000)

    union all
    select pl.id, pl.name,
           st_distance(pl.geom, np.pg) as meters,
           'you were here then'::text as reason,
           greatest(0, 95 - st_distance(pl.geom, np.pg) / 40 - np.dt / 900) as score
    from public.in_space_places pl, near_ping np, me
    where (pl.saved or pl.created_by = me.uid) and pl.geom is not null
      and st_dwithin(pl.geom, np.pg, 5000)

    union all
    select pl.id, pl.name,
           0::double precision as meters,
           ('same time as ' || coalesce(a.name, a.type))::text as reason,
           greatest(0, 85 - abs(extract(epoch from (a.start_date - photo.t))) / 3600) as score
    from public.visible_activities a
    join public.in_space_places pl on pl.id = a.place_id, photo, me
    where a.place_id is not null and a.start_date is not null and photo.t is not null
      and a.start_date between photo.t - interval '6 hours' and photo.t + interval '6 hours'
      and (exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id and ap.profile_id = me.uid)
           or a.owner_profile = me.uid
           or me.uid = any(coalesce(a.also_profiles, '{}'::uuid[])))

    union all
    select pl.id, pl.name,
           0::double precision as meters,
           'on your visit dates'::text as reason,
           55::double precision as score
    from public.in_space_places pl, photo, me
    where photo.t is not null and pl.first_visit is not null
      and (pl.saved or pl.created_by = me.uid)
      and photo.t::date between pl.first_visit - 1
                            and coalesce(pl.last_visit, pl.first_visit) + 1
  )
  select place_id, name, meters, reason, score
  from (
    select distinct on (c.id)
      c.id as place_id, c.name, c.meters, c.reason, c.score
    from cand c
    order by c.id, c.score desc
  ) best
  where public.is_member()
  order by score desc
  limit 6;
$function$;

create or replace function public.memories_with_people(p_people uuid[], p_mode text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(kind text, id uuid, happened_on date, title text, place_id uuid, place_name text, distance double precision, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with matched as (
    select k.kind, k.key, k.status from public.people_memory_keys(p_people, p_mode) k
  )
  select * from (
    -- photographs
    select m.kind, p.id,
           coalesce(p.local_date, (p.taken_at at time zone 'UTC')::date, p.created_at::date),
           nullif(btrim(coalesce(p.caption, '')), ''), p.place_id, pl.name,
           null::double precision, m.status
      from matched m
      join public.in_space_photos p on p.id = m.key and p.deleted_at is null
      left join public.in_space_places pl on pl.id = p.place_id
     where m.kind = 'photo'

    union all
    -- outings: the canonical key, shown through a recording the caller can actually see
    select m.kind, act.id,
           coalesce(act.local_date, (act.start_date at time zone 'UTC')::date),
           act.name, act.place_id, pl.name, act.distance, m.status
      from matched m
      join lateral (
        select a2.* from public.visible_activities a2
         where coalesce(a2.shared_group_id, a2.id) = m.key
         order by a2.created_at
         limit 1) act on true
      left join public.in_space_places pl on pl.id = act.place_id
     where m.kind = 'outing'

    union all
    select m.kind, v.id, v.start_date, null::text, v.place_id, pl.name,
           null::double precision, m.status
      from matched m
      join public.in_space_visits v on v.id = m.key
      left join public.in_space_places pl on pl.id = v.place_id
     where m.kind = 'visit'
  ) t(kind, id, happened_on, title, place_id, place_name, distance, status)
   where (p_from is null or t.happened_on >= p_from)
     and (p_to   is null or t.happened_on <= p_to)
   order by t.happened_on desc nulls last, t.kind;
$function$;

create or replace function public.my_memory_tags_to_confirm()
 RETURNS TABLE(subject_id uuid, kind text, photo_id uuid, tagged_by text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.kind, s.photo_id, who.display_name, mp.created_at
    from public.in_space_memory_people mp
    join public.in_space_memory_subjects s on s.id = mp.subject_id
    join public.in_space_people pe on pe.id = mp.person_id
    left join public.profiles who on who.id = mp.tagged_by
   where pe.linked_profile = auth.uid()
     and mp.participation_status = 'proposed'
   order by mp.created_at desc;
$function$;

create or replace function public.my_people()
 RETURNS TABLE(id uuid, display_name text, linked_profile uuid, favourite boolean, is_me boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pe.id, pe.display_name, pe.linked_profile, pe.favourite,
         pe.linked_profile is not distinct from auth.uid()
    from public.in_space_people pe
   where pe.owner_profile = auth.uid()
     and pe.deleted_at is null
     and not public.is_blocked_between(pe.linked_profile, auth.uid())
   order by (pe.linked_profile is not distinct from auth.uid()) desc,
            pe.favourite desc, lower(pe.display_name);
$function$;

create or replace function public.my_tags_to_confirm(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(t order by t.start_date desc nulls last), '[]'::jsonb)
    from (
      select 'activity'::text  as kind,
             c.id              as claim_id,
             c.subject_id      as subject_id,
             c.status,
             a.id              as activity_id,
             (a.id <> c.subject_id) as via_another_recording,
             a.name,
             a.type,
             a.distance,
             a.start_date,
             pl.name           as place,
             who.display_name  as tagged_by,
             r.note            as rule_note,
             1::bigint         as visits
        from public.in_space_tag_claims c
        join public.visible_activities a on a.id = public.visible_recording_of(c.subject_id)
        left join public.in_space_places pl on pl.id = a.place_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.in_space_tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'activity'
         and c.status in ('proposed', 'accepted_legacy')

      union all

      select 'visit', c.id, c.subject_id, c.status,
             null::uuid, false,
             null::text, null::text, null::double precision,
             v.start_date::timestamptz,
             pl.name, who.display_name, r.note, 1::bigint
        from public.in_space_tag_claims c
        join public.in_space_visits v on v.id = c.subject_id
        left join public.in_space_places pl on pl.id = v.place_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.in_space_tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'visit'
         and c.status in ('proposed', 'accepted_legacy')

      union all

      select 'place', c.id, c.subject_id, c.status,
             null::uuid, false,
             null::text, null::text, null::double precision,
             (select max(v.start_date)::timestamptz from public.in_space_visits v
               where v.place_id = c.subject_id),
             pl.name, who.display_name, r.note,
             (select count(*) from public.in_space_visits v where v.place_id = c.subject_id)
        from public.in_space_tag_claims c
        join public.in_space_places pl on pl.id = c.subject_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.in_space_tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'place'
         and c.status in ('proposed', 'accepted_legacy')

      limit greatest(1, p_limit)
    ) t;
$function$;

create or replace function public.peaks_bagged(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, ele_ft integer, place_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select pk.id, pk.name, round(pk.ele_m * 3.28084)::int as ele_ft,
         (select pb.place_id from public.in_space_peak_bags pb
           where pb.peak_id = pk.id and pb.place_id is not null limit 1) as place_id
  from public.in_space_peaks pk
  where p_profile is null
     or exists(select 1 from public.in_space_peak_bags pb
               where pb.peak_id = pk.id and (pb.profile_id = p_profile or pb.profile_id is null))
  order by pk.ele_m desc nulls last, pk.name;
$function$;

create or replace function public.peaks_bagged_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, name text, ele_ft integer, place_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select pk.id, pk.name, round(pk.ele_m * 3.28084)::int as ele_ft,
         (select pb.place_id from public.in_space_peak_bags pb
           where pb.peak_id = pk.id and pb.place_id is not null limit 1) as place_id
    from public.in_space_peaks pk
   where coalesce(array_length(p_people, 1), 0) = 0
      or exists (select 1
                   from public.in_space_peak_bags pb
                   join public.visible_activities a on a.id = pb.activity_id
                  where pb.peak_id = pk.id
                    and coalesce(a.shared_group_id, a.id) in
                          (select k.key from public.people_memory_keys(p_people, p_mode) k
                            where k.kind = 'outing'))
   order by pk.ele_m desc nulls last, pk.name;
$function$;

create or replace function public.people_memory_keys(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(kind text, key uuid, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with wanted as (
    -- Only people you may read at all. Anything else contributes nothing rather than
    -- answering, so this cannot be used to find out whether an id is somebody's contact.
    select pe.id, pe.linked_profile
      from public.in_space_people pe
     where pe.id = any(coalesce(p_people, '{}'::uuid[]))
       and pe.deleted_at is null
       and (pe.owner_profile = auth.uid()
         or pe.linked_profile = auth.uid()
         or public.person_on_visible_memory(pe.id)
         or public.person_on_visible_visit(pe.id))
  ),
  n as (select count(*)::int as asked from wanted),

  -- ---- one row per (person, memory), outings ALREADY collapsed --------------
  hits as (
    select w.id as person_id, 'photo'::text as kind, s.photo_id as key,
           mp.participation_status as status
      from wanted w
      join public.in_space_memory_people mp on mp.person_id = w.id
      join public.in_space_memory_subjects s on s.id = mp.subject_id and s.kind = 'photo'
     where mp.participation_status in ('accepted','proposed')
       and public.can_see_memory_subject(s.id)

    union all
    select w.id, 'outing', coalesce(act.shared_group_id, act.id),
           case when coalesce(ap.claim_status,'accepted') = 'proposed' then 'proposed'
                else 'accepted' end
      from wanted w
      join public.activity_profiles ap on ap.profile_id = w.linked_profile
      join public.visible_activities act on act.id = ap.activity_id
     where w.linked_profile is not null
       and coalesce(ap.claim_status, 'accepted') <> 'rejected'

    union all
    select w.id, 'visit', v.id,
           case when coalesce(vp.claim_status,'accepted') = 'proposed' then 'proposed'
                else 'accepted' end
      from wanted w
      join public.visit_profiles vp on vp.profile_id = w.linked_profile
      join public.in_space_visits v on v.id = vp.visit_id
     where w.linked_profile is not null
       and public.is_member()
  ),

  -- ---- ALL means everybody asked for; ANY means at least one ----------------
  matched as (
    select h.kind, h.key,
           -- One unanswered tag makes the whole match unsettled, which is the honest
           -- summary: it is not agreed that these people were all there.
           case when bool_or(h.status = 'proposed') then 'proposed' else 'accepted' end as status
      from hits h, n
     group by h.kind, h.key, n.asked
    having case when lower(coalesce(p_mode,'all')) = 'any'
                then count(distinct h.person_id) >= 1
                else count(distinct h.person_id) = n.asked and n.asked > 0
           end
  )
  select m.kind, m.key, m.status from matched m;
$function$;

create or replace function public.person_is_mine(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.in_space_people pe
                  where pe.id = p_person
                    and (pe.owner_profile = auth.uid() or pe.linked_profile = auth.uid()));
$function$;

create or replace function public.person_on_visible_memory(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.in_space_memory_people mp
                  where mp.person_id = p_person
                    and public.can_see_memory_subject(mp.subject_id));
$function$;

create or replace function public.person_on_visible_visit(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_member()
     and exists (select 1 from public.in_space_visit_people vp
                   join public.in_space_visits v on v.id = vp.visit_id
                  where vp.person_id = p_person);
$function$;

create or replace function public.person_totals(p_profile uuid)
 RETURNS TABLE(type text, activity_count bigint, miles numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once, the same rule every other total uses (0140/0141).
    select distinct on (coalesce(a.shared_group_id, a.id)) a.type, a.distance
      from public.activities a
     where public.is_member(a.space_id)
       and exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id
                      and ap.profile_id = p_profile
                      and coalesce(ap.claim_status, 'accepted') <> 'declined')
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select type,
         count(*)::bigint,
         round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
    from canon
   group by type;
$function$;

create or replace function public.photo_people(p_photo uuid)
 RETURNS TABLE(person_id uuid, display_name text, participation_status text, verification_status text, linked_profile uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pe.id, pe.display_name, mp.participation_status, mp.verification_status, pe.linked_profile
    from public.in_space_memory_subjects s
    join public.in_space_memory_people mp on mp.subject_id = s.id
    join public.in_space_people pe on pe.id = mp.person_id
   where s.photo_id = p_photo
     and public.can_see_memory_subject(s.id)
     and mp.participation_status in ('proposed','accepted')
   order by lower(pe.display_name);
$function$;

create or replace function public.place_attribution()
 RETURNS TABLE(place_id uuid, solo_profile uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select v.place_id,
         case when count(*) filter (where pc.n <> 1) = 0
               and count(distinct pc.only_one) = 1
              then (array_agg(distinct pc.only_one))[1] end
    from public.in_space_visits v
    cross join lateral (
      select count(*) as n, (array_agg(vp.profile_id))[1] as only_one
        from public.visit_profiles vp where vp.visit_id = v.id
    ) pc
   group by v.place_id;
$function$;

create or replace function public.place_days(p_place uuid)
 RETURNS TABLE(day date, activities integer, entries integer, photos integer, pings integer, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with d as (
    select start_date::date as day, 'a' as kind
      from public.visible_activities where place_id = p_place and start_date is not null
    union all
    select date, 'e' from public.in_space_entries where place_id = p_place and date is not null
    union all
    select taken_at::date, 'p' from public.in_space_photos where place_id = p_place and deleted_at is null and taken_at is not null
    union all
    select recorded_at::date, 'g'
      from public.in_space_location_pings where place_id = p_place
  ),
  grouped as (
    select
      day,
      count(*) filter (where kind = 'a')::int as activities,
      count(*) filter (where kind = 'e')::int as entries,
      count(*) filter (where kind = 'p')::int as photos,
      count(*) filter (where kind = 'g')::int as pings
    from d group by day
  )
  select
    g.*,
    (select a.name from public.visible_activities a
       where a.place_id = p_place and a.start_date::date = g.day and a.name is not null
       order by a.start_date desc limit 1) as label
  from grouped g
  order by g.day desc;
$function$;

create or replace function public.place_ids_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select distinct p.id
    from public.in_space_places p
    join public.accepted_visits v on v.place_id = p.id
   where p.counts_as_place
     and p.deleted_at is null
     and (coalesce(array_length(p_people, 1), 0) = 0
       or v.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                    where k.kind = 'visit'));
$function$;

create or replace function public.place_ids_for_view(p_profile uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select distinct p.id
    from public.in_space_places p
    join public.accepted_visits v on v.place_id = p.id
   where p.counts_as_place
     and p.deleted_at is null
     and case when p_profile is null
              then public.is_shared_visit(v.id)
              else exists (select 1 from public.visit_profiles vp
                            where vp.visit_id = v.id and vp.profile_id = p_profile) end;
$function$;

create or replace function public.place_is_saved(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select saved from public.in_space_places where id = pid), false);
$function$;

create or replace function public.place_memberships_all()
 RETURNS TABLE(child_id uuid, parent_id uuid, relationship_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select m.child_id, m.parent_id, m.relationship_type
    from public.in_space_place_membership m
    join public.in_space_places c on c.id = m.child_id and c.deleted_at is null
    join public.in_space_places p on p.id = m.parent_id and p.deleted_at is null
   order by m.parent_id, m.child_id;
$function$;

create or replace function public.place_people()
 RETURNS TABLE(place_id uuid, profile_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select id, created_by from public.in_space_places where created_by is not null
  union
  select place_id, owner_profile from public.visible_activities where place_id is not null and owner_profile is not null
  union
  select a.place_id, unnest(a.also_profiles) from public.visible_activities a
    where a.place_id is not null and array_length(a.also_profiles, 1) is not null
  union
  select place_id, uploaded_by from public.in_space_photos where place_id is not null and uploaded_by is not null
$function$;

create or replace function public.place_ratings_for(p_place uuid)
 RETURNS TABLE(profile_id uuid, rating smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select profile_id, rating from public.in_space_place_ratings where place_id = p_place;
$function$;

create or replace function public.place_visit_counts(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(place_id uuid, visits integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select v.place_id, count(*)::integer as visits
    from public.accepted_visits v
    join public.in_space_places p on p.id = v.place_id
   where p.deleted_at is null
     and case when p_profile is null
              then public.is_shared_visit(v.id)
              else exists (select 1 from public.visit_profiles vp
                            where vp.visit_id = v.id and vp.profile_id = p_profile) end
   group by v.place_id;
$function$;

create or replace function public.place_visit_counts_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(place_id uuid, visits integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select v.place_id, count(*)::integer as visits
    from public.accepted_visits v
    join public.in_space_places p on p.id = v.place_id
   where p.deleted_at is null
     and (coalesce(array_length(p_people, 1), 0) = 0
       or v.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                    where k.kind = 'visit'))
   group by v.place_id;
$function$;

create or replace function public.place_visit_people(p_place uuid)
 RETURNS TABLE(visit_id uuid, profile_id uuid, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select vp.visit_id, vp.profile_id, pr.display_name
    from public.in_space_visits v
    join public.visit_profiles vp on vp.visit_id = v.id
    join public.profiles pr on pr.id = vp.profile_id
   where v.place_id = p_place
   order by vp.visit_id, pr.display_name;
$function$;

create or replace function public.place_visit_stats(p_place uuid)
 RETURNS TABLE(visit_id uuid, photos integer, videos integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    v.id,
    (
      select count(*)::int
      from public.in_space_photos ph
      where ph.place_id = v.place_id
        and ph.deleted_at is null
        and ph.taken_at is not null
        and ph.taken_at::date between v.start_date and v.end_date
    ),
    (
      select count(*)::int
      from public.in_space_videos vd
      where vd.place_id = v.place_id
        and vd.taken_at is not null
        and vd.taken_at::date between v.start_date and v.end_date
    )
  from public.in_space_visits v
  where v.place_id = p_place
    and public.is_member();
$function$;

create or replace function public.place_visit_totals()
 RETURNS TABLE(place_id uuid, visits integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select v.place_id, count(*)::integer as visits
    from public.accepted_visits v
    join public.in_space_places p on p.id = v.place_id
   where p.deleted_at is null
   group by v.place_id;
$function$;

create or replace function public.race_stats(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket text, n integer, miles double precision, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.distance
      from public.visible_activities a
      join public.in_space_places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select b.bucket, count(*)::int as n, coalesce(sum(c.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from canon c
  cross join lateral (select public.race_bucket(c.distance/1609.344) as bucket) b
  group by b.bucket
  order by ord;
$function$;

create or replace function public.race_stats_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(bucket text, n integer, miles double precision, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- The race predicate stays INSIDE the collapse. If only one recording of a joint race
    -- carries is_race, that is the one that must survive — deduping first and filtering
    -- afterwards could drop the race entirely.
    select distinct on (coalesce(a.shared_group_id, a.id)) a.distance
      from public.visible_activities a
      join public.in_space_places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select b.bucket, count(*)::int as n, coalesce(sum(c.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from canon c
  cross join lateral (select public.race_bucket(c.distance/1609.344) as bucket) b
  group by b.bucket
  order by ord;
$function$;

create or replace function public.races_list(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, times integer, miles double precision, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.place_id, a.distance
      from public.visible_activities a
      join public.in_space_places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select p.id, p.name, count(c.*)::int as times,
    coalesce(sum(c.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(c.distance),0)/1609.344) / nullif(count(c.*),0)) as bucket
  from public.in_space_places p
  join canon c on c.place_id = p.id
  group by p.id, p.name
  having count(c.*) > 0
  order by p.name;
$function$;

create or replace function public.races_list_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, name text, times integer, miles double precision, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.place_id, a.distance
      from public.visible_activities a
      join public.in_space_places p on p.id = a.place_id
     where (a.is_race or p.categories @> array['race'])
       and (coalesce(array_length(p_people, 1), 0) = 0
              or coalesce(a.shared_group_id, a.id) in
                   (select k.key from public.people_memory_keys(p_people, p_mode) k
                     where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  -- `times` is the count that was doubled, and `bucket` divides miles BY times — so an
  -- uncollapsed set got the count wrong and the average distance right, which is why this
  -- never looked broken.
  select p.id, p.name, count(c.*)::int as times,
    coalesce(sum(c.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(c.distance),0)/1609.344) / nullif(count(c.*),0)) as bucket
  from public.in_space_places p
  join canon c on c.place_id = p.id
  group by p.id, p.name
  having count(c.*) > 0
  order by p.name;
$function$;

create or replace function public.rule_offer(p_activity uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lat double precision; v_lng double precision; v_name text; v_pt geography;
  v_n int; v_radius constant int := 1500;
begin
  perform public.assert_member();

  select a.lat, a.lng, btrim(a.name) into v_lat, v_lng, v_name
    from public.visible_activities a where a.id = p_activity;
  if v_lat is null or v_lng is null or coalesce(v_name,'') = '' then
    return jsonb_build_object('offer', false);
  end if;
  v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;

  -- Already covered by a rule? Then there is nothing to offer.
  if exists (
    select 1 from public.in_space_naming_rules r
     where r.auto_apply and r.name = v_name and r.center is not null
       and st_dwithin(r.center, v_pt, r.radius_m)) then
    return jsonb_build_object('offer', false, 'reason', 'already a rule');
  end if;

  -- How many activities near here has she APPROVED this same name for?
  select count(*) into v_n
    from public.visible_activities a
    join public.in_space_approved_fields af
      on af.subject_type = 'activity' and af.subject_id = a.id and af.field = 'name'
   where btrim(a.name) = v_name
     and a.geom is not null
     and st_dwithin(a.geom, v_pt, v_radius);

  return jsonb_build_object(
    'offer', v_n >= 3, 'name', v_name, 'learned_from', v_n, 'radius_m', v_radius);
end
$function$;

create or replace function public.search_photos(p_filter jsonb)
 RETURNS TABLE(photo_id uuid, place_id uuid, place_name text, city text, category text, taken_at timestamp with time zone, caption text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with f as (
    select
      case when p_filter ? 'categories'
           then array(select jsonb_array_elements_text(p_filter->'categories')) end as cats,
      case when p_filter ? 'cities'
           then array(select lower(jsonb_array_elements_text(p_filter->'cities'))) end as cities,
      case when p_filter ? 'states'
           then array(select lower(jsonb_array_elements_text(p_filter->'states'))) end as states,
      case when p_filter ? 'countries'
           then array(select lower(jsonb_array_elements_text(p_filter->'countries'))) end as countries,
      case when p_filter ? 'parks'
           then array(select lower(jsonb_array_elements_text(p_filter->'parks'))) end as parks,
      nullif(p_filter->>'year','')::int          as yr,
      nullif(p_filter->>'date_from','')::date    as date_from,
      nullif(p_filter->>'date_to','')::date      as date_to,
      nullif(p_filter->>'min_rating','')::int    as min_rating,
      nullif(p_filter->>'text','')               as txt
  )
  select ph.id, pl.id, pl.name, pl.city, pl.category, ph.taken_at, ph.caption
  from public.in_space_photos ph
  join public.in_space_places pl on pl.id = ph.place_id
  cross join f
  where public.is_member()
    and ph.deleted_at is null
    and pl.deleted_at is null
    and (f.cats is null
         or pl.category = any(f.cats)
         or pl.categories && f.cats
         or pl.activity_categories && f.cats)
    and (f.cities    is null or lower(pl.city)    = any(f.cities))
    and (f.states    is null or lower(pl.admin1)  = any(f.states))
    and (f.countries is null or lower(pl.country) = any(f.countries))
    and (f.parks     is null or lower(pl.park)    = any(f.parks))
    and (f.yr is null         or extract(year from ph.taken_at)::int = f.yr)
    and (f.date_from is null  or ph.taken_at >= f.date_from)
    and (f.date_to is null    or ph.taken_at < (f.date_to + 1))
    and (f.min_rating is null or coalesce(pl.rating,0) >= f.min_rating)
    and (f.txt is null
         or pl.name    ilike '%'||f.txt||'%'
         or pl.review  ilike '%'||f.txt||'%'
         or ph.caption ilike '%'||f.txt||'%')
  order by ph.taken_at desc nulls last
  limit 300;
$function$;

create or replace function public.settings_stats(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(trails_taken bigint, camping bigint, dining bigint, winery bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with mine as (
    select distinct p.id, p.categories
      from public.in_space_places p
      join public.accepted_visits v on v.place_id = p.id
     where p.deleted_at is null
       and case when p_profile is null
                then public.is_shared_visit(v.id)
                else exists (select 1 from public.visit_profiles vp
                              where vp.visit_id = v.id and vp.profile_id = p_profile) end
  )
  select
    (select count(*) from mine where categories && array['hiking','walking','running','biking'])::bigint,
    (select count(*) from mine where categories && array['camping'])::bigint,
    (select count(*) from mine where categories && array['dining'])::bigint,
    (select count(*) from mine where categories && array['winery'])::bigint;
$function$;

create or replace function public.settings_stats_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(trails_taken bigint, camping bigint, dining bigint, winery bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with mine as (
    select distinct p.id, p.categories
      from public.in_space_places p
      join public.accepted_visits v on v.place_id = p.id
     where p.deleted_at is null
       and (coalesce(array_length(p_people, 1), 0) = 0
              or v.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                           where k.kind = 'visit'))
  )
  select
    (select count(*) from mine where categories && array['hiking','walking','running','biking'])::bigint,
    (select count(*) from mine where categories && array['camping'])::bigint,
    (select count(*) from mine where categories && array['dining'])::bigint,
    (select count(*) from mine where categories && array['winery'])::bigint;
$function$;

create or replace function public.shared_outings(p_with uuid[])
 RETURNS TABLE(outings integer, my_miles numeric, first_together date, last_together date, restricted_rows integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with wanted as (
    -- The caller is always part of "we", without having to name themselves.
    select distinct x from unnest(coalesce(p_with, '{}'::uuid[]) || auth.uid()) x
                          where x is not null
  ),
  together as (
    -- A shared outing is a visit EVERY named person is on. Others may be too.
    -- This fact is OURS — it comes from visit_profiles, not from Strava.
    select v.id, v.place_id, v.start_date, v.end_date
      from public.accepted_visits v
     where v.start_date >= public.together_since()
       and not exists (
             select 1 from wanted w
              where not exists (select 1 from public.visit_profiles vp
                                 where vp.visit_id = v.id and vp.profile_id = w.x))
  ),
  mine as (
    -- MY activities on those days at those places. Only ever mine.
    select distinct a.id, a.distance
      from public.activities a
      join together t
        on a.place_id = t.place_id
       and a.start_date::date between t.start_date and t.end_date
     where public.is_member(a.space_id)
       and exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id and ap.profile_id = auth.uid())
  )
  select
    (select count(*)::integer from together),
    coalesce((select round((sum(distance) / 1609.344)::numeric, 1) from mine), 0),
    (select min(start_date) from together),
    (select max(end_date)   from together),
    -- Honest about what is NOT counted: their Strava-origin activities on the same
    -- outings, which we may not show.
    (select count(*)::integer
       from public.activities a
       join together t
         on a.place_id = t.place_id
        and a.start_date::date between t.start_date and t.end_date
      where public.is_member(a.space_id)
        and lower(coalesce(a.original_source, '')) = 'strava'
        and not exists (select 1 from public.activity_profiles ap
                         where ap.activity_id = a.id and ap.profile_id = auth.uid()));
$function$;

create or replace function public.spatial_members(p_container uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select p.id
  from public.in_space_places c
  join public.in_space_places p
    on c.boundary is not null
   and p.id <> c.id
   and not p.holds_children
   and p.counts_as_place
   and p.geom is not null
   and st_contains(c.boundary::geometry, p.geom::geometry)
  where c.id = p_container;
$function$;

create or replace function public.tracking_status()
 RETURNS TABLE(profile_id uuid, display_name text, last_ping timestamp with time zone, pings bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select p.id, p.display_name, max(lp.recorded_at) as last_ping, count(lp.id) as pings
  from public.profiles p
  left join public.in_space_location_pings lp on lp.profile_id = p.id
  where p.role in ('owner', 'editor')
  group by p.id, p.display_name
  order by p.display_name;
$function$;

create or replace function public.trip_attachment_candidates()
 RETURNS TABLE(visit_id uuid, place_name text, start_date date, end_date date, trip_visit_id uuid, trip_place_name text, trip_start date, trip_end date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select v.id, vp.name, v.start_date, v.end_date,
         t.id, tp.name, t.start_date, t.end_date
    from public.accepted_visits v
    join public.in_space_places vp on vp.id = v.place_id
    join public.accepted_visits t
      on t.id <> v.id
     and t.is_trip_qualified
     and v.start_date >= t.start_date
     and v.end_date   <= t.end_date
    join public.in_space_places tp on tp.id = t.place_id
   where v.parent_visit_id is null
     and not v.is_trip_qualified
     and vp.deleted_at is null
     and tp.deleted_at is null
   order by t.start_date, v.start_date;
$function$;

create or replace function public.trip_contents(p_visit uuid)
 RETURNS TABLE(place_id uuid, place_name text, visit_id uuid, start_date date, end_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select p.id, p.name, v.id, v.start_date, v.end_date
    from public.in_space_visits v
    join public.in_space_places p on p.id = v.place_id
   where v.parent_visit_id = p_visit
     and p.deleted_at is null
   order by v.start_date, p.name;
$function$;

create or replace function public.trips_list(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(visit_id uuid, place_id uuid, name text, start_date date, end_date date, nights integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select av.id, p.id, p.name, av.start_date, av.end_date,
         (av.end_date - av.start_date)::int as nights
    from public.accepted_visits av
    join public.in_space_places p on p.id = av.place_id
   where av.is_trip_qualified
     and av.is_headline
     and p.deleted_at is null
     and case
           when p_profile is null then public.is_shared_visit(av.id)
           else exists (select 1 from public.visit_profiles vp
                         where vp.visit_id = av.id and vp.profile_id = p_profile)
         end
   order by av.start_date desc;
$function$;

create or replace function public.trips_list_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(visit_id uuid, place_id uuid, name text, start_date date, end_date date, nights integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select av.id, p.id, p.name, av.start_date, av.end_date,
         (av.end_date - av.start_date)::int as nights
    from public.accepted_visits av
    join public.in_space_places p on p.id = av.place_id
   where av.is_trip_qualified
     and av.is_headline
     and p.deleted_at is null
     and (coalesce(array_length(p_people, 1), 0) = 0
            or av.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                              where k.kind = 'visit'))
   order by av.start_date desc;
$function$;

create or replace function public.visible_recording_of(p_activity uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.id
    from public.visible_activities v
    left join public.activities claimed
      on claimed.id = p_activity and public.is_member(claimed.space_id)
   where v.id = p_activity
      or (claimed.id is not null
          and coalesce(v.shared_group_id, v.id) = coalesce(claimed.shared_group_id, claimed.id))
   order by
     -- 1. anything that is NOT Strava-sourced, because it comes with no strings
     case when lower(coalesce(v.original_source, '')) <> 'strava' then 0 else 1 end,
     -- 2. the row actually asked about, so nothing changes for the ordinary case
     case when v.id = p_activity then 0 else 1 end,
     v.start_date, v.id
   limit 1;
$function$;

create or replace function public.visit_detail(p_visit uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select jsonb_build_object(
    'visit', to_jsonb(v) - 'geom',
    -- WHO WAS THERE, as rows. The page read `visit.solo_profile`, which can say one
    -- person or everybody and nothing in between (§0.3).
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                         order by pr.display_name)
                          from public.visit_profiles vp
                          join public.profiles pr on pr.id = vp.profile_id
                         where vp.visit_id = v.id), '[]'::jsonb),
    'place', jsonb_build_object(
        'id', p.id, 'name', p.name, 'admin1', p.admin1, 'country', p.country,
        'address', p.address, 'lat', p.lat, 'lng', p.lng, 'is_trail', p.is_trail),
    -- The activities OF THIS VISIT. activities.visit_id has held the answer since 0164;
    -- this used to re-derive it from dates and the place, and got it wrong whenever two
    -- visits to one place shared a day.
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'type', a.type, 'distance', a.distance,
               'elevation_gain', a.elevation_gain, 'moving_time', a.moving_time,
               'local_date', a.local_date, 'start_date', a.start_date,
               'place_id', a.place_id,
               'people', coalesce((select jsonb_agg(pr.display_name order by pr.display_name)
                                     from public.activity_profiles ap
                                     join public.profiles pr on pr.id = ap.profile_id
                                    where ap.activity_id = a.id), '[]'::jsonb))
               order by a.start_date)
        from public.visible_activities a
       where a.visit_id = v.id
         -- one row per outing: a duplicate recorded twice is still one thing you did
         and a.id = (select a2.id from public.visible_activities a2
                      where coalesce(a2.shared_group_id, a2.id) = coalesce(a.shared_group_id, a.id)
                      order by (a2.summary_polyline is not null) desc,
                               (a2.source = 'strava') desc, a2.id
                      limit 1)), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'taken_at', ph.taken_at, 'local_date', ph.local_date,
               'caption', ph.caption, 'pinned', coalesce(ph.visit_id = v.id, false))
               order by ph.taken_at)
        from public.in_space_photos ph
       where ph.deleted_at is null
         and (ph.visit_id = v.id
              or (ph.visit_id is null and ph.place_id = v.place_id
                  and coalesce(ph.local_date, ph.taken_at::date)
                      between v.start_date and v.end_date))), '[]'::jsonb),
    -- What is inside this trip. `counts_as_trip`, not raw is_trip: a multi-day visit is
    -- a trip whether or not anyone marked it (§0.4), and its contents should show.
    'contents', case when public.counts_as_trip(v.*) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'place_id', c.place_id, 'place_name', c.place_name,
               'visit_id', c.visit_id, 'start_date', c.start_date, 'end_date', c.end_date)
               order by c.start_date)
        from public.trip_contents(v.id) c), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.visits v
  join public.in_space_places p on p.id = v.place_id
  where v.id = p_visit
    and public.is_member(v.space_id);
$function$;

create or replace function public.visit_is_inside_trip(p_visit uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.in_space_visits v
                  where v.id = p_visit and v.parent_visit_id is not null);
$function$;

create or replace function public.wander_stats(p_profile uuid DEFAULT NULL::uuid)
 RETURNS TABLE(places_count integer, miles double precision, trips_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with qv as (
    select av.id, av.place_id, av.is_trip_qualified, av.is_headline
      from public.accepted_visits av
     where case
             when p_profile is null then public.is_shared_visit(av.id)
             else exists (select 1 from public.visit_profiles vp
                           where vp.visit_id = av.id and vp.profile_id = p_profile)
           end
  ),
  qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.visible_activities a
     where a.place_id is not null
       and case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.in_space_places p join qv on qv.place_id = p.id
      where p.counts_as_place
        and p.deleted_at is null)                                  as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    (select count(*)::int from qv
      where qv.is_trip_qualified and qv.is_headline)               as trips_count;
$function$;

create or replace function public.wander_stats_for_people(p_people uuid[], p_mode text DEFAULT 'all'::text)
 RETURNS TABLE(places_count integer, miles double precision, trips_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with qv as (
    select av.id, av.place_id, av.is_trip_qualified, av.is_headline
      from public.accepted_visits av
     where (coalesce(array_length(p_people, 1), 0) = 0
            or av.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                              where k.kind = 'visit'))
  ),
  qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.visible_activities a
     where a.place_id is not null
       and (coalesce(array_length(p_people, 1), 0) = 0
            or coalesce(a.shared_group_id, a.id) in
                 (select k.key from public.people_memory_keys(p_people, p_mode) k
                   where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.in_space_places p join qv on qv.place_id = p.id
      where p.counts_as_place
        and p.deleted_at is null)                                  as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    (select count(*)::int from qv
      where qv.is_trip_qualified and qv.is_headline)               as trips_count;
$function$;

create or replace function public.wishes_overview()
 RETURNS TABLE(place_id uuid, wanters uuid[], n integer, member_total integer, everyone boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with members as (
    select count(*)::int c from public.profiles
      where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)'
  )
  select w.place_id, array_agg(w.profile_id) as wanters, count(*)::int as n,
    (select c from members) as member_total,
    count(*) >= (select c from members) and (select c from members) >= 2 as everyone
  from public.in_space_place_wishes w
  group by w.place_id;
$function$;


-- ---------------------------------------------------------------------------
-- 3. THE ASSERTIONS.
--
--    ⚠️ NOT ONE OF THESE COUNTS ROWS. `scripts/db-test.sh` replays this chain from an
--    EMPTY schema where every production total is 0, and "expected exactly N" has broken
--    CI on this repository twice. Every check below is STRUCTURAL — it asks whether a
--    rule is written down, never how many rows happen to satisfy it.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
  leaky   text;
  drifted text;
begin
  -- 3a. Every view this file creates must exist and must still carry the boundary. A
  --     later `create or replace view` that drops the WHERE would turn all sixty-two
  --     readers back into leaks in one edit, and every behavioural test would still pass
  --     on a database holding one person's data — which is the exact shape of the bug
  --     0196 shipped and `the_readers_stay_enforced` was written to catch.
  select string_agg(v, ', ' order by v) into leaky
    from unnest(array[
      'approved_fields','entries','location_pings','memory_people','memory_subjects',
      'naming_rules','peak_bags','peaks','people','photos','place_membership',
      'place_ratings','place_wishes','places','suggestions','tag_claims','tagging_rules',
      'videos','visit_people','visits']) v
   where not exists (
     select 1 from pg_views
      where schemaname = 'public' and viewname = 'in_space_' || v
        and definition ilike '%is_member%'
        and definition ilike '%space_id%');

  if leaky is not null then
    raise exception
      'in_space_%% views missing or no longer filtering: %. Every reader in section 2 depends on that WHERE.', leaky;
  end if;

  -- 3b. A SCOPED VIEW IS `select *`, SO IT CAN DRIFT. Add a column to `places` and
  --     `in_space_places` silently does not have it, and the first reader to select that
  --     column fails at runtime rather than here. This is the check that turns a latent
  --     outage into a failed migration.
  select string_agg(t, ', ' order by t) into drifted
    from unnest(array[
      'approved_fields','entries','location_pings','memory_people','memory_subjects',
      'naming_rules','peak_bags','peaks','people','photos','place_membership',
      'place_ratings','place_wishes','places','suggestions','tag_claims','tagging_rules',
      'videos','visit_people','visits']) t
   where (select count(*) from pg_attribute
           where attrelid = ('public.' || t)::regclass and attnum > 0 and not attisdropped)
      <> (select count(*) from pg_attribute
           where attrelid = ('public.in_space_' || t)::regclass and attnum > 0 and not attisdropped);

  if drifted is not null then
    raise exception
      'These in_space_ views no longer expose the same columns as their tables: %. Re-create the view — `select *` was frozen when it was written.', drifted;
  end if;

  -- 3c. NO CLIENT ROLE MAY REACH A SCOPED VIEW. They are read from inside SECURITY DEFINER
  --     functions and from nowhere else. A grant to `authenticated` would put twenty new
  --     relations on the PostgREST surface, which is twenty doors nobody chose to open.
  select string_agg(c.relname, ', ' order by c.relname) into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'in\_space\_%'
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'));

  if missing is not null then
    raise exception
      'anon or authenticated can read these scoped views directly: %. Revoke — they are an internal substrate, not an API.', missing;
  end if;

  raise notice 'PASS: 20 in_space_ views state the boundary, expose their tables'' columns, and are reachable by no client role.';
end $$;

-- 3d. THE READERS THEMSELVES. Structural, and deliberately annoying in the same way
--     `the_readers_stay_enforced` is: a SECURITY DEFINER function that names a scoped base
--     table directly, and is not on this list with a reason, fails the migration.
--
--     This is the assertion that talks to whoever writes reader number sixty-three.
do $$
declare
  allowed constant text[] := array[
    -- THE SCOPED VIEWS THEMSELVES. Each must read its own table; that is its job.
    'is_member','is_editor_or_owner','is_owner','my_space_ids','current_space','default_space',
    -- THE TRIGGER THAT MUST NOT BE SCOPED. A block is bidirectional and global. Scoping
    -- this read would let a blocked tag through across a space boundary — the exact thing
    -- it refuses. See the header.
    'memory_people_refuse_a_blocked_tag',
    -- WRITE PATHS. Named, unclosed, and a WRITER audit rather than a reader one.
    'merge_nearby_dupes','move_visit_to_place',
    -- `visit_detail` keeps `public.visits v` because `counts_as_trip(v.*)` is typed to the
    -- table's composite and a view's row is a different type. It carries the clause inline.
    'visit_detail'
  ];
  unexpected text;
begin
  select string_agg(distinct p.proname, ', ' order by p.proname) into unexpected
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and pg_get_functiondef(p.oid) ~*
         '(from|join)[[:space:]]+(public\.)?(places|visits|photos|videos|entries|people|memory_people|memory_subjects|visit_people|peaks|peak_bags|place_ratings|place_wishes|place_membership|location_pings|suggestions|tag_claims|tagging_rules|naming_rules|approved_fields)[^A-Za-z0-9_]'
     -- A function that also states the boundary inline has already answered the question.
     and pg_get_functiondef(p.oid) !~* 'is_member[[:space:]]*\('
     and not (p.proname = any(allowed));

  if unexpected is not null then
    raise exception
      'These SECURITY DEFINER functions read a space-owned table directly and never name a space: %.
       SECURITY DEFINER BYPASSES RLS, so 0281''s policies will not save you.
       If it SHOWS rows to a person, read public.in_space_<table> instead — same columns, one prefix.
       If it must see across the boundary, add it to `allowed` in 0287 WITH A REASON.',
      unexpected;
  end if;

  raise notice 'PASS: every SECURITY DEFINER reader of a space-owned table either goes through a scoped relation or is exempted by name.';
end $$;

commit;
