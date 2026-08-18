-- 0221 — a duplicate card carries BOTH outings, because one and a uuid is not a question.
--
-- Erica, 2026-08-18: *"This is all fucked up and nonsensical, and the options are redundant
-- and make no sense."* She is describing the 36 cards waiting for her, and she is right —
-- every one of them is a `shared_group_id` proposal being rendered through the UI built for
-- NAMING something. What that produces on screen:
--
--     a heading reading   shared_group_id
--     one radio option    05f58fee-9dff-43fc-9371-3017c8f9fa31
--     an evidence line    "OpenStreetMap · 0 of 9 route points"      (meaningless here)
--     a "Never" button    per option
--     and a free-text box "Your own words"                            (type a uuid?)
--
-- There is no answer a person could give to that, and the whole point of the review queue
-- is that a person can answer it. The renderer is fixed separately; what the DATA was
-- missing is the other half of the comparison.
--
-- So a duplicate card now carries the counterpart activity in full — name, place, owner,
-- source, time, distance and its ROUTE — plus how far apart in minutes and percent, and
-- whose recordings these are. That is what makes "link them" or "not the same" answerable:
-- two shapes, two owners, two sources, side by side.
--
-- `mine` carries the same two facts for the card's own subject, so the screen can say
-- "yours, from Strava" against "Josh's, from a file" without a second round trip.
--
-- Both read `visible_activities`, so a card can never show a route the reader may not see.

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
      'activity',     case when gk.kind <> 'visit' then (
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
          from public.suggestions s
          join public.visible_activities b
            on b.id = coalesce((s.evidence ->> 'kept')::uuid, (s.proposed_value #>> '{}')::uuid)
          left join public.places bp on bp.id = b.place_id
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
  'The review cards. An activity card carries its route, its place and its ids (0219/0220); '
  'a duplicate proposal also carries the OTHER activity in full (0221), because "are these '
  'the same outing?" cannot be answered from one side and a uuid. Everything reads '
  'visible_activities, so a card can never show a route the reader may not see.';
