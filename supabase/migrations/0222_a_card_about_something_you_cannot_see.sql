-- 0222 — the queue stopped handing her cards about things she is not allowed to see.
--
-- Erica, 2026-08-18: *"This is all fucked up and nonsensical."* 0221 gave duplicate cards
-- their comparison, and checking the result through her own session found the larger half
-- of the problem:
--
--     cards her queue returned        33
--       both sides visible            18
--       NO VISIBLE ACTIVITY AT ALL    15
--
-- Fifteen of her cards were about **Josh's Strava recordings**, correctly hidden from her
-- by the rule 0200 exists to enforce. The card had nothing to render, so it fell back to
-- "Something to name", a section headed `shared_group_id`, and a bare uuid — the "random
-- letters" she has been asked to approve. Pressing Save on one would have linked two
-- activities, one of them invisible to her.
--
-- The guard was never wrong. `visible_activities` did its job everywhere it was used; what
-- nobody had asked is whether a SUGGESTION about a hidden row should exist as a card. It
-- should not: a review queue is a list of questions a person can answer, and this is the
-- one property it was missing.
--
-- Note what this does NOT do: it does not delete the suggestions. Josh's own queue can
-- still show them — they are his recordings — and if the two are ever linked through a
-- shared outing they become visible to her again. Nothing is decided on anyone's behalf.

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
  'the same outing?" cannot be answered from one side and a uuid. A card whose subject — '
  'or whose counterpart — the reader may not see is NOT RETURNED AT ALL (0222): fifteen of '
  'Erica''s thirty-three were about Josh''s Strava recordings and rendered as a bare uuid.';
