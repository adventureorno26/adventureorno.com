-- 0255 — one or several people, ALL or ANY, through the same door.
--
-- §8b-i, the sentence 0253 only half-answered: *"retrieve everything they did with ONE OR
-- SEVERAL PEOPLE, and use that same selection for statistics."* And, separately:
--
--   "Remove `Together / Just me / Just Josh` as the permanent model; **Together is a people
--    query with ALL selected**."
--
-- So the general question is the primitive and one person is the degenerate case, not the
-- other way round. `person_memories` becomes a wrapper over this, which is the whole point:
-- one place implements authorization, canonical outings and the photo/outing separation, and
-- there is nothing to keep in step.
--
-- ALL vs ANY, and it matters:
--
--   ALL  everybody named was on it        → "what did we do together"
--   ANY  at least one of them was         → "anything involving any of these people"
--
-- CANONICAL FIRST, THEN COUNT. Her Garmin original and Strava's copy are two rows for one
-- outing. Counting participants BEFORE collapsing them means an outing both people were on
-- looks like two half-matches, and an ALL query drops it — the outing they actually did
-- together is the one that disappears. So every recording maps to its canonical id first, and
-- the distinct-people count is taken per outing rather than per recording.
--
-- A PHOTOGRAPH STAYS A PHOTOGRAPH. §8b-i: photo presence is not promoted to outing
-- participation, and an ALL query over [me, Mum] does not turn a picture of Mum into an outing
-- I was on.
create or replace function public.memories_with_people(
  p_people uuid[],
  p_mode   text default 'all',
  p_from   date default null,
  p_to     date default null)
returns table (
  kind         text,
  id           uuid,
  happened_on  date,
  title        text,
  place_id     uuid,
  place_name   text,
  distance     double precision,
  status       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with wanted as (
    -- Only people you may read at all. Anything else contributes nothing rather than
    -- answering, so this cannot be used to find out whether an id is somebody's contact.
    select pe.id, pe.linked_profile
      from public.people pe
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
      join public.memory_people mp on mp.person_id = w.id
      join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'photo'
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
      join public.visits v on v.id = vp.visit_id
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

  select * from (
    -- photographs
    select m.kind, p.id,
           coalesce(p.local_date, (p.taken_at at time zone 'UTC')::date, p.created_at::date),
           nullif(btrim(coalesce(p.caption, '')), ''), p.place_id, pl.name,
           null::double precision, m.status
      from matched m
      join public.photos p on p.id = m.key and p.deleted_at is null
      left join public.places pl on pl.id = p.place_id
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
      left join public.places pl on pl.id = act.place_id
     where m.kind = 'outing'

    union all
    select m.kind, v.id, v.start_date, null::text, v.place_id, pl.name,
           null::double precision, m.status
      from matched m
      join public.visits v on v.id = m.key
      left join public.places pl on pl.id = v.place_id
     where m.kind = 'visit'
  ) t(kind, id, happened_on, title, place_id, place_name, distance, status)
   where (p_from is null or t.happened_on >= p_from)
     and (p_to   is null or t.happened_on <= p_to)
   order by t.happened_on desc nulls last, t.kind;
$function$;

comment on function public.memories_with_people is
  'Everything done with ONE OR SEVERAL people. ALL = everybody named was on it ("together"); '
  'ANY = at least one was. Outings collapse to one per canonical recording BEFORE the people '
  'are counted — otherwise an outing two people were on looks like two half-matches and an '
  'ALL query drops exactly the outings they did together (0255).';

-- One person is the degenerate case, not a separate implementation.
create or replace function public.person_memories(
  p_person uuid,
  p_from   date default null,
  p_to     date default null)
returns table (
  kind         text,
  id           uuid,
  happened_on  date,
  title        text,
  place_id     uuid,
  place_name   text,
  distance     double precision,
  status       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select * from public.memories_with_people(array[p_person], 'any', p_from, p_to);
$function$;

comment on function public.person_memories is
  'Everything one person did that you may see. A wrapper over memories_with_people since '
  '0255 — one implementation of authorization, canonical outings and the photo/outing '
  'separation, so there is nothing to keep in step.';

revoke all on function public.memories_with_people(uuid[], text, date, date) from public, anon;
grant execute on function public.memories_with_people(uuid[], text, date, date) to authenticated;
