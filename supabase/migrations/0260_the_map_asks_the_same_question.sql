-- 0260 — the map asks the same question the person page does.
--
-- §8b-i: *"A lightweight `People: Anyone` control opens a multi-select drawer"*, and
-- *"Remove `Together / Just me / Just Josh` as the permanent model."* The query behind it has
-- existed since 0255 and only a person's own page could ask it. This is the map asking.
--
-- THREE FUNCTIONS DRIVE THAT FILTER and all three had the same shape:
--
--     case when p_profile is null
--          then public.is_shared_visit(v.id)          -- "Together"
--          else exists (…participant row for p_profile…)   -- "Just one of us"
--     end
--
-- A single profile or nothing: the two-person model written into three places. Each gains a
-- people-aware sibling, and none of them re-implements the rule — the rule is lifted out of
-- `memories_with_people` into **`people_memory_keys`**, which answers "which memories match
-- these people, under ALL or ANY", and everything else consumes it. `memories_with_people` is
-- rewritten to call it too, so the map and the person page cannot disagree about who was
-- where.
--
-- WHAT "ANYONE" MEANS, and it is a real change to the default. `p_profile is null` meant
-- SHARED — only the visits both of them were on. An empty people list now means **no filter
-- at all**: everything you can see. "Together" is `ALL` with both of them selected, which is
-- the same set the old NULL produced and is now one tap rather than the default. That is what
-- §8b-i asks for, and it is the difference between a map that opens on your shared life and
-- one that opens on everything.
--
-- WHY THE OUTING KEY IS EXPANDED BACK OUT for the map lines. `people_memory_keys` returns the
-- CANONICAL outing — one key however many recordings — which is right for counting and wrong
-- for drawing: the representative recording may be the one WITHOUT a polyline, and the route
-- would vanish from the map. So `activity_lines_for_people` matches every recording in the
-- group and draws them all. Two lines on top of each other are invisible; a missing one is not.

create or replace function public.people_memory_keys(
  p_people uuid[], p_mode text default 'all')
returns table (kind text, key uuid, status text)
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
  select m.kind, m.key, m.status from matched m;
$function$;

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



comment on function public.people_memory_keys is
  'Which memories match these people, under ALL (everybody named was on it) or ANY (at least '
  'one was) — as (kind, canonical key). The one place that rule is written; the person page, '
  'the map markers, the visit counts and the map lines all consume it (0260).';

-- ---------------------------------------------------------------------------
-- The three the map filter runs on.
-- ---------------------------------------------------------------------------
create or replace function public.place_ids_for_people(
  p_people uuid[], p_mode text default 'all')
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select distinct p.id
    from public.places p
    join public.accepted_visits v on v.place_id = p.id
   where p.counts_as_place
     and p.deleted_at is null
     and (coalesce(array_length(p_people, 1), 0) = 0
       or v.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                    where k.kind = 'visit'));
$function$;

create or replace function public.place_visit_counts_for_people(
  p_people uuid[], p_mode text default 'all')
returns table (place_id uuid, visits integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select v.place_id, count(*)::integer as visits
    from public.accepted_visits v
    join public.places p on p.id = v.place_id
   where p.deleted_at is null
     and (coalesce(array_length(p_people, 1), 0) = 0
       or v.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                    where k.kind = 'visit'))
   group by v.place_id;
$function$;

create or replace function public.activity_lines_for_people(
  p_people uuid[], p_mode text default 'all')
returns table (id uuid, place_id uuid, type text, summary_polyline text, owner_profile uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select a.id, a.place_id, a.type, a.summary_polyline, a.owner_profile
    from public.visible_activities a
   where a.summary_polyline is not null
     and (coalesce(array_length(p_people, 1), 0) = 0
       -- EVERY recording in a matching group, not just the canonical one: the
       -- representative may be the copy without a route, and a missing line is a worse
       -- error than two drawn on top of each other.
       or coalesce(a.shared_group_id, a.id) in
            (select k.key from public.people_memory_keys(p_people, p_mode) k
              where k.kind = 'outing'));
$function$;

comment on function public.place_ids_for_people is
  'Which places to show for a set of people. An EMPTY list means "Anyone" — no filter at all '
  '— where the old place_ids_for_view(null) meant SHARED. "Together" is now ALL with both '
  'selected, one tap rather than the default (0260).';

revoke all on function public.people_memory_keys(uuid[], text) from public, anon;
revoke all on function public.place_ids_for_people(uuid[], text) from public, anon;
revoke all on function public.place_visit_counts_for_people(uuid[], text) from public, anon;
revoke all on function public.activity_lines_for_people(uuid[], text) from public, anon;
grant execute on function public.people_memory_keys(uuid[], text) to authenticated;
grant execute on function public.place_ids_for_people(uuid[], text) to authenticated;
grant execute on function public.place_visit_counts_for_people(uuid[], text) to authenticated;
grant execute on function public.activity_lines_for_people(uuid[], text) to authenticated;
