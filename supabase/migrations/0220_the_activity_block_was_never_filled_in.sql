-- 0220 — the card's activity block was only ever filled in for one kind of card.
--
-- 0219 added the route, the place and the ids so a card could show WHERE it is. Verified
-- through the browser immediately afterwards, and every card came back with
-- `activity: null` — including the naming cards it was written for.
--
-- The cause predates 0219 and is one word. The block is built
--   `case when gk.kind = 'activity' then …`
-- where `kind` is the group_key's PREFIX. But the prefix names the kind of PROPOSAL, not
-- the kind of subject: today every pending card in production is `dedupe:<uuid>`, and the
-- importer writes `import-dup:<uuid>`. Only a card keyed `activity:<uuid>` ever matched, so
-- the name, type, distance and place were null on all 36 cards waiting right now.
--
-- Two lines above it, `subject_type` already gets this right —
--   `case when gk.kind = 'visit' then 'visit' else 'activity' end`
-- — so the card claimed to be about an activity and then carried nothing about it. This
-- makes the two agree, which also gives the DUPLICATE cards a route each: "are these the
-- same outing?" is a question about two shapes, and it was being asked with neither shown.

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
