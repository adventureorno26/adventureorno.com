-- 0173 — the last readers, and the one fact they all depended on: WHO DID IT.
--
-- 0172 finished the visit-shaped readers. The ones left over — miles, races, climbing,
-- photo matching, place attribution — do not count visits. They count ACTIVITIES, and
-- every one of them still asked `activities.solo_profile is null or = p_profile`, the
-- null-as-data predicate §0.3 exists to remove.
--
-- WHY ACTIVITIES NEED THEIR OWN PARTICIPANT ROWS, rather than borrowing the visit's.
-- The obvious shortcut is to say an activity was done by whoever was on its visit. The
-- data says otherwise: of 445 activities, 389 are attributed to ONE person, and 4 of
-- those sit on a visit BOTH members were on. Erica went to the trailhead; Josh ran it.
-- Reading miles off `visit_profiles` would have credited them both. An activity is a
-- route, and a route is run by whoever ran it — that is a fact of its own, so it gets a
-- table of its own.
--
--     activity_profiles(activity_id, profile_id)   — mirrors visit_profiles exactly
--
-- BACKFILL, AND WHY IT IS NOT THE CLEVERER ONE. The first version I measured also folded
-- in `also_profiles` and, for "Both" rows, the visit's participants. On production that
-- moved 11 activities across the shared/solo line: 2 solo activities became shared
-- because `also_profiles` named the other member, and 9 "Both" activities stopped being
-- shared because their visit records only one participant. §0.3: "null becomes the two
-- currently active member profiles only when the legacy row truly meant Both. Put
-- ambiguous rows into a review table; never guess additional participants."
--
-- So the backfill is the same rule `visits_sync_participants` already uses, and the 9
-- rows where the activity says Both but its visit says one person are written to
-- `activity_participant_review` for Erica to settle. Parity is therefore exact by
-- construction, and the disagreement is recorded instead of silently resolved.
--
-- ALSO FIXED HERE, the last two date-inference readers (§0.1):
--   * `visit_is_inside_trip` asked "does some marked trip's range contain this visit's
--     range?" — across every place, unrelated. It is now `parent_visit_id is not null`.
--   * `visit_detail` gathered a visit's activities by matching dates against the place,
--     even though `activities.visit_id` has existed since 0164 and 0167 filled it in. It
--     also branched on raw `is_trip` rather than `counts_as_trip`, so a multi-day visit
--     nobody had marked showed no contents.
--
-- ROLLBACK: previous definitions are in git history; drop activity_profiles,
-- activity_participant_review and is_shared_activity. Nothing is deleted by this
-- migration and `solo_profile` is untouched — it stays the source until §0.8 phase 8.

begin;

-- ---------------------------------------------------------------------------
-- 1. Who did the activity
-- ---------------------------------------------------------------------------
create table if not exists public.activity_profiles (
  activity_id uuid not null references public.activities(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id)   on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (activity_id, profile_id)
);

comment on table public.activity_profiles is
  'Who did this activity (§0.3). Separate from visit_profiles on purpose: one person '
  'can run a trail on a visit both people made, so the route''s participants are not '
  'the visit''s. Miles, races and climbing all count through this table.';

create index if not exists activity_profiles_profile_idx
  on public.activity_profiles(profile_id);

alter table public.activity_profiles enable row level security;
drop policy if exists activity_profiles_read on public.activity_profiles;
create policy activity_profiles_read on public.activity_profiles
  for select using (public.is_member());

revoke all on public.activity_profiles from public, anon;
grant select on public.activity_profiles to authenticated;

create table if not exists public.activity_participant_review (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz null
);

comment on table public.activity_participant_review is
  'Activities whose attribution could not be derived without guessing (§0.3). Nothing '
  'reads participants from here — it exists so an ambiguous row is visible rather than '
  'silently resolved one way.';

alter table public.activity_participant_review enable row level security;
drop policy if exists activity_participant_review_read on public.activity_participant_review;
create policy activity_participant_review_read on public.activity_participant_review
  for select using (public.is_member());

revoke all on public.activity_participant_review from public, anon;
grant select on public.activity_participant_review to authenticated;

-- Backfill. Idempotent: re-running changes nothing.
insert into public.activity_profiles (activity_id, profile_id)
select a.id, a.solo_profile
  from public.activities a
 where a.solo_profile is not null
on conflict do nothing;

do $$
declare v_members uuid[];
begin
  select array_agg(id) into v_members from public.profiles
   where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)';

  if coalesce(array_length(v_members,1),0) between 1 and 2 then
    -- "Both" means every active member, exactly as it does for visits.
    insert into public.activity_profiles (activity_id, profile_id)
    select a.id, m
      from public.activities a cross join unnest(v_members) m
     where a.solo_profile is null
    on conflict do nothing;
  else
    insert into public.activity_participant_review (activity_id, reason)
    select a.id, 'solo_profile NULL and "both" is ambiguous with 3+ real members'
      from public.activities a where a.solo_profile is null
    on conflict (activity_id) do nothing;
  end if;
end $$;

-- The 9 rows where the activity says Both but its visit records one person. Recorded,
-- not resolved: attribution is Erica's to settle, and either answer changes her miles.
insert into public.activity_participant_review (activity_id, reason)
select a.id,
       'activity is attributed to Both, but its visit records only one participant'
  from public.activities a
 where a.solo_profile is null
   and a.visit_id is not null
   and exists (
     select 1 from public.activity_profiles ap
      where ap.activity_id = a.id
        and not exists (select 1 from public.visit_profiles vp
                         where vp.visit_id = a.visit_id and vp.profile_id = ap.profile_id))
on conflict (activity_id) do nothing;

-- Keep the mirror true while `solo_profile` still exists (§0.8: it is removed later,
-- after parity). Same shape as visits_sync_participants.
create or replace function public.activities_sync_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_members uuid[];
begin
  if tg_op = 'UPDATE' and new.solo_profile is not distinct from old.solo_profile then
    return new;
  end if;

  delete from public.activity_profiles where activity_id = new.id;

  if new.solo_profile is not null then
    insert into public.activity_profiles (activity_id, profile_id)
    values (new.id, new.solo_profile) on conflict do nothing;
  else
    select array_agg(id) into v_members from public.profiles
     where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)';
    if coalesce(array_length(v_members,1),0) between 1 and 2 then
      insert into public.activity_profiles (activity_id, profile_id)
      select new.id, m from unnest(v_members) m on conflict do nothing;
    else
      insert into public.activity_participant_review (activity_id, reason)
      values (new.id, 'solo_profile NULL and "both" is ambiguous with 3+ real members')
      on conflict (activity_id) do nothing;
    end if;
  end if;
  return new;
end $function$;

revoke all on function public.activities_sync_participants() from public, anon, authenticated;

drop trigger if exists activities_sync_participants on public.activities;
create trigger activities_sync_participants
  after insert or update of solo_profile on public.activities
  for each row execute function public.activities_sync_participants();

-- The activity twin of is_shared_visit: everyone real was on it.
create or replace function public.is_shared_activity(p_activity uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.profiles p
     where p.role in ('owner','editor')
       and coalesce(p.display_name,'') !~* '(test|bot)'
       and not exists (
         select 1 from public.activity_profiles ap
          where ap.activity_id = p_activity and ap.profile_id = p.id)
  );
$function$;

comment on function public.is_shared_activity(uuid) is
  'True when every real member did this activity — the honest reading of what '
  '`solo_profile IS NULL` used to assert (§0.3).';

-- ---------------------------------------------------------------------------
-- 2. The activity readers count through it
-- ---------------------------------------------------------------------------
create or replace function public.race_stats(p_profile uuid default null)
returns table(bucket text, n integer, miles double precision, ord integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select b.bucket, count(*)::int as n, coalesce(sum(a.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from public.activities a
  join public.places p on p.id = a.place_id
  cross join lateral (select public.race_bucket(a.distance/1609.344) as bucket) b
  where (a.is_race or p.categories @> array['race'])
    and case when p_profile is null
             then public.is_shared_activity(a.id)
             else exists (select 1 from public.activity_profiles ap
                           where ap.activity_id = a.id and ap.profile_id = p_profile) end
  group by b.bucket
  order by ord;
$function$;

create or replace function public.races_list(p_profile uuid default null)
returns table(id uuid, name text, times integer, miles double precision, bucket text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select p.id, p.name, count(a.*)::int as times,
    coalesce(sum(a.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(a.distance),0)/1609.344) / nullif(count(a.*),0)) as bucket
  from public.places p
  join public.activities a on a.place_id = p.id
  where (a.is_race or p.categories @> array['race'])
    and case when p_profile is null
             then public.is_shared_activity(a.id)
             else exists (select 1 from public.activity_profiles ap
                           where ap.activity_id = a.id and ap.profile_id = p_profile) end
  group by p.id, p.name
  having count(a.*) > 0
  order by p.name;
$function$;

create or replace function public.mileage_by_person(p_profile uuid default null)
returns table(type text, activity_count bigint, meters double precision, miles numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once: the same run recorded by two people shares a
    -- shared_group_id (0140/0141).
    select distinct on (coalesce(a.shared_group_id, a.id)) a.type, a.distance
      from public.activities a
     where case when p_profile is null
                then public.is_shared_activity(a.id)
                else exists (select 1 from public.activity_profiles ap
                              where ap.activity_id = a.id and ap.profile_id = p_profile) end
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$function$;

create or replace function public.climbing_stats(p_profile uuid default null)
returns table(total_ft integer, everests double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.elevation_gain
      from public.activities a
     where a.elevation_gain is not null
       and (p_profile is null
            or exists (select 1 from public.activity_profiles ap
                        where ap.activity_id = a.id and ap.profile_id = p_profile))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select round(coalesce(sum(elevation_gain),0)*3.28084)::int,
         round((coalesce(sum(elevation_gain),0)/8848.86)::numeric,2)::float
    from qa;
$function$;

-- wander_stats: 0168 moved its places and trips onto the canonical model but left the
-- MILES half reading solo_profile. This finishes it.
create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count integer, miles double precision, trips_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
      from public.activities a
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
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place
        and p.deleted_at is null)                                  as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    (select count(*)::int from qv
      where qv.is_trip_qualified and qv.is_headline)               as trips_count;
$function$;

-- match_photo branch 3: "an activity of mine". also_profiles and owner_profile stay in
-- the test — they are how a shared import is recognised — but membership now comes from
-- the participant rows rather than from a null.
create or replace function public.match_photo(
  p_taken_at timestamptz,
  p_lat double precision default null,
  p_lng double precision default null
) returns table(place_id uuid, name text, meters double precision, reason text, score double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    from location_pings lp, photo, me
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
    from places pl, photo, me
    where photo.g is not null and pl.geom is not null
      and (pl.saved or pl.created_by = me.uid)
      and st_dwithin(pl.geom, photo.g, 5000)

    union all
    select pl.id, pl.name,
           st_distance(pl.geom, np.pg) as meters,
           'you were here then'::text as reason,
           greatest(0, 95 - st_distance(pl.geom, np.pg) / 40 - np.dt / 900) as score
    from places pl, near_ping np, me
    where (pl.saved or pl.created_by = me.uid) and pl.geom is not null
      and st_dwithin(pl.geom, np.pg, 5000)

    union all
    select pl.id, pl.name,
           0::double precision as meters,
           ('same time as ' || coalesce(a.name, a.type))::text as reason,
           greatest(0, 85 - abs(extract(epoch from (a.start_date - photo.t))) / 3600) as score
    from activities a
    join places pl on pl.id = a.place_id, photo, me
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
    from places pl, photo, me
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

-- A place belongs to one person when every visit to it was that person's alone.
create or replace function public.place_attribution()
returns table(place_id uuid, solo_profile uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select v.place_id,
         case when count(*) filter (where pc.n <> 1) = 0
               and count(distinct pc.only_one) = 1
              then (array_agg(distinct pc.only_one))[1] end
    from public.visits v
    cross join lateral (
      select count(*) as n, (array_agg(vp.profile_id))[1] as only_one
        from public.visit_profiles vp where vp.visit_id = v.id
    ) pc
   group by v.place_id;
$function$;

comment on function public.place_attribution() is
  'A place''s attribution, derived from its visits'' participants (§0.3). One person only '
  'when EVERY visit was that person alone; otherwise null, meaning shared.';

-- ---------------------------------------------------------------------------
-- 3. The last two date-inference readers (§0.1)
-- ---------------------------------------------------------------------------
create or replace function public.visit_is_inside_trip(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.visits v
                  where v.id = p_visit and v.parent_visit_id is not null);
$function$;

comment on function public.visit_is_inside_trip(uuid) is
  'Is this visit grouped inside a trip? EXPLICITLY, via parent_visit_id. It used to ask '
  'whether any marked trip''s dates happened to contain this visit''s dates, at any '
  'place — which made unrelated visits look contained (§0.1).';

create or replace function public.visit_detail(p_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select jsonb_build_object(
    'visit', to_jsonb(v) - 'geom',
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
               'place_id', a.place_id, 'solo_profile', a.solo_profile,
               'people', coalesce((select jsonb_agg(pr.display_name order by pr.display_name)
                                     from public.activity_profiles ap
                                     join public.profiles pr on pr.id = ap.profile_id
                                    where ap.activity_id = a.id), '[]'::jsonb))
               order by a.start_date)
        from public.activities a
       where a.visit_id = v.id
         -- one row per outing: a duplicate recorded twice is still one thing you did
         and a.id = (select a2.id from public.activities a2
                      where coalesce(a2.shared_group_id, a2.id) = coalesce(a.shared_group_id, a.id)
                      order by (a2.summary_polyline is not null) desc,
                               (a2.source = 'strava') desc, a2.id
                      limit 1)), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'taken_at', ph.taken_at, 'local_date', ph.local_date,
               'caption', ph.caption, 'pinned', coalesce(ph.visit_id = v.id, false))
               order by ph.taken_at)
        from public.photos ph
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
  join public.places p on p.id = v.place_id
  where v.id = p_visit;
$function$;

-- The inference does not disappear — it is DEMOTED to a suggestion.
--
-- On production, 15 visits currently look "inside a trip" purely because their dates
-- fall within one, and 0 are explicitly attached. Removing the inference is correct
-- (§0.1), but silently losing 15 groupings Erica has been seeing is not. So the same
-- query becomes a proposal she can accept: it never changes a count, never writes
-- anything, and appears nowhere in a statistic.
create or replace function public.trip_attachment_candidates()
returns table(visit_id uuid, place_name text, start_date date, end_date date,
              trip_visit_id uuid, trip_place_name text,
              trip_start date, trip_end date)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select v.id, vp.name, v.start_date, v.end_date,
         t.id, tp.name, t.start_date, t.end_date
    from public.accepted_visits v
    join public.places vp on vp.id = v.place_id
    join public.accepted_visits t
      on t.id <> v.id
     and t.is_trip_qualified
     and v.start_date >= t.start_date
     and v.end_date   <= t.end_date
    join public.places tp on tp.id = t.place_id
   where v.parent_visit_id is null
     and not v.is_trip_qualified
     and vp.deleted_at is null
     and tp.deleted_at is null
   order by t.start_date, v.start_date;
$function$;

comment on function public.trip_attachment_candidates() is
  'SUGGESTIONS ONLY (§0.1). Visits whose dates sit inside a trip but which nobody has '
  'grouped there. This is the query the statistics used to treat as fact; it now '
  'proposes, and a human attaches. Nothing counts through it.';

do $$
declare f text;
begin
  foreach f in array array[
    'race_stats(uuid)','races_list(uuid)','mileage_by_person(uuid)','climbing_stats(uuid)',
    'wander_stats(uuid)','place_attribution()','visit_is_inside_trip(uuid)',
    'visit_detail(uuid)','is_shared_activity(uuid)','trip_attachment_candidates()',
    'match_photo(timestamptz,double precision,double precision)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
