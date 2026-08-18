-- 0219 — a card you are asked to name must show you WHERE it is.
--
-- Erica, 2026-08-18: *"the settings section for something to name should show more
-- information than a string of letters. Maybe a map with the course on it — geocoded at
-- all? I can't click on it to see it so I can't rename a string of letters I have no idea
-- where the route is."*
--
-- She is right, and the cause is in this function. `inbox()` returned an activity as
-- `{name, type, distance, start_date, place}` — five facts, none of which is a location.
-- When the name is an auto-generated string and the place is still "New place", the card
-- asks her to name something she cannot identify, and there is no way to open it and look.
-- Answering it would be guessing, which is the one thing this whole design exists to stop.
--
-- So the card now carries the ROUTE and the IDs: the summary polyline it was drawn from,
-- its start point, and the ids needed to link straight to the place or the day. The screen
-- can draw the shape and offer a way in.
--
-- Still through `visible_activities`, so the Strava rule is unchanged — a card can only
-- ever show a route the person looking at it is allowed to see.
create or replace function public.inbox(
  p_limit integer default 25,
  p_cursor timestamp with time zone default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select coalesce(jsonb_agg(c.card order by c.newest desc), '[]'::jsonb)
  from (
    select
      g.group_key,
      max(g.created_at) as newest,
      split_part(g.group_key, ':', 1) as kind,
      nullif(split_part(g.group_key, ':', 2), '')::uuid as subject
    from public.suggestions g
    where g.status = 'pending'
      and (p_cursor is null or g.created_at < p_cursor)
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
      'activity',     case when gk.kind = 'activity' then (
                        select jsonb_build_object(
                                 'name', a.name, 'type', a.type, 'distance', a.distance,
                                 'start_date', a.start_date, 'place', p.name,
                                 -- what the card was missing
                                 'place_id', a.place_id, 'lat', a.lat, 'lng', a.lng,
                                 'polyline', a.summary_polyline)
                          from public.visible_activities a
                          left join public.places p on p.id = a.place_id
                         where a.id = gk.subject) end,
      'visit',        case when gk.kind = 'visit' then (
                        select jsonb_build_object(
                                 'place', p.name, 'start_date', v.start_date,
                                 'end_date', v.end_date, 'place_id', v.place_id)
                          from public.visits v
                          left join public.places p on p.id = v.place_id
                         where v.id = gk.subject) end,
      'fields',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'field', s.field, 'label', s.label,
                   'proposed', s.proposed_value, 'current', s.current_value,
                   'source', s.source, 'confidence', s.confidence,
                   'evidence', s.evidence, 'rank', s.rank)
                 order by s.field, s.rank)
          from public.suggestions s
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
          from public.suggestions s
          join public.photos ph on ph.id = s.subject_id
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type = 'photo' and ph.deleted_at is null), '[]'::jsonb)
    ) as card, gk.newest
  ) c;
$function$;

comment on function public.inbox is
  'The review cards. Each activity card carries its ROUTE and its ids as well as its name, '
  'because a card that asks you to name something must show you where it is (0219) — and '
  'still reads visible_activities, so it can never show a route you may not see.';
