-- 0254 — the person page reads the view, not the table.
--
-- `the_readers_stay_enforced` caught 0253 in CI:
--
--     These SECURITY DEFINER functions read public.activities directly and are not on the
--     allowlist: person_memories.
--
-- Right, and the right answer is not an allowlist entry. That test's own message says which:
-- *"If it SHOWS activities to a person, read public.visible_activities instead — same
-- columns, one word."* `person_memories` returns a name, a date and a distance — an outing's
-- CONTENT, not an id — so it is a reader in exactly the sense the guard means, and the two
-- functions on that list from yesterday (`set_place_solo`, `set_visit_participants`) are there
-- because they return nothing about an activity at all.
--
-- 0253 did call `can_see_activity`, so nothing leaked: the rule was enforced, in a second
-- place, by hand. That is the thing the guard is really about. Fifteen readers were moved onto
-- the view in 0196 precisely so the rule lives in ONE definition, and a sixteenth that
-- re-implements it correctly today is a sixteenth that can drift tomorrow.

create or replace function public.person_memories(
  p_person uuid,
  p_from   date default null,
  p_to     date default null)
returns table (
  kind         text,        -- 'photo' | 'outing' | 'visit'
  id           uuid,        -- the photo, the canonical activity, or the visit
  happened_on  date,
  title        text,
  place_id     uuid,
  place_name   text,
  distance     double precision,
  status       text         -- 'accepted' | 'proposed' — a question is never shown as a fact
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allowed as (
    -- Your own contact, the card that is you, or somebody attached to something you can
    -- already see. Anything else answers nothing at all rather than "no rows", which would
    -- be the same reply for "no memories" and "not your person".
    select pe.id, pe.linked_profile
      from public.people pe
     where pe.id = p_person
       and pe.deleted_at is null
       and (pe.owner_profile = auth.uid()
         or pe.linked_profile = auth.uid()
         or public.person_on_visible_memory(pe.id)
         or public.person_on_visible_visit(pe.id))
  ),

  -- ---- photographs (0247) --------------------------------------------------
  ph as (
    select 'photo'::text as kind,
           p.id,
           coalesce(p.local_date, (p.taken_at at time zone 'UTC')::date, p.created_at::date) as happened_on,
           nullif(btrim(coalesce(p.caption, '')), '') as title,
           p.place_id,
           pl.name as place_name,
           null::double precision as distance,
           mp.participation_status as status
      from allowed a
      join public.memory_people mp on mp.person_id = a.id
      join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'photo'
      join public.photos p on p.id = s.photo_id and p.deleted_at is null
      left join public.places pl on pl.id = p.place_id
     where mp.participation_status in ('accepted','proposed')
       and public.can_see_memory_subject(s.id)
  ),

  -- ---- outings, counted once however many recordings exist -----------------
  out_raw as (
    select distinct on (coalesce(act.shared_group_id, act.id))
           act.id,
           coalesce(act.local_date, (act.start_date at time zone 'UTC')::date) as happened_on,
           act.name,
           act.place_id,
           act.distance,
           ap.claim_status
      from allowed a
      join public.activity_profiles ap on ap.profile_id = a.linked_profile
      -- THE VIEW, NOT THE TABLE. `the_readers_stay_enforced` caught this reading
      -- `public.activities` directly and it was right to: this returns a name, a date and a
      -- distance, which is an outing's content rather than an id. `visible_activities` is the
      -- same rule (0228) said in one place, and the guard exists so that the next reader
      -- written by somebody who has never heard of Strava's terms cannot skip it.
      join public.visible_activities act on act.id = ap.activity_id
     where a.linked_profile is not null
       and coalesce(ap.claim_status, 'accepted') <> 'rejected'
     order by coalesce(act.shared_group_id, act.id), act.created_at
  ),
  outing as (
    select 'outing'::text, o.id, o.happened_on, o.name, o.place_id, pl.name, o.distance,
           case when coalesce(o.claim_status,'accepted') = 'proposed' then 'proposed'
                else 'accepted' end
      from out_raw o left join public.places pl on pl.id = o.place_id
  ),

  -- ---- visits --------------------------------------------------------------
  vis as (
    select 'visit'::text, v.id, v.start_date, null::text, v.place_id, pl.name,
           null::double precision,
           case when coalesce(vp.claim_status,'accepted') = 'proposed' then 'proposed'
                else 'accepted' end
      from allowed a
      join public.visit_profiles vp on vp.profile_id = a.linked_profile
      join public.visits v on v.id = vp.visit_id
      left join public.places pl on pl.id = v.place_id
     where a.linked_profile is not null
       and public.is_member()
  )

  select * from (
    select * from ph
    union all select * from outing
    union all select * from vis
  ) t
   where (p_from is null or t.happened_on >= p_from)
     and (p_to   is null or t.happened_on <= p_to)
   order by t.happened_on desc nulls last, t.kind;
$function$;

comment on function public.person_memories is
  'Everything you did with one person: photographs they are tagged in, and — when that person '
  'also has an account — the outings and visits they were on. Outings are counted ONCE however '
  'many recordings exist, and a photograph is never summed with them: being in a picture taken '
  'during a run is not being on the run (0253).';

revoke all on function public.person_memories(uuid, date, date) from public, anon;
grant execute on function public.person_memories(uuid, date, date) to authenticated;
