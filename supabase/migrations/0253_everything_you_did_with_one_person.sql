-- 0253 — everything you did with one person, through one door.
--
-- §8b-i asks for two things and 0247 only delivered the first:
--
--   "A user can tag any person, FIND ANYONE TAGGED IN THEIR PHOTOS/MEMORIES, retrieve
--    everything they did with one or several people, and use that same selection for
--    statistics."
--
-- Tagging without retrieval is half a feature: you can now say who is in a photograph and
-- there is no way to ask "show me the ones with Mum in them". `/people/:personId` is already
-- a target route in the approved navigation; this is what it reads.
--
-- ONE FUNCTION ON PURPOSE, and it is the reason to write this now rather than after the big
-- migration. A person's memories currently live in three places — `memory_people` for photos
-- (0247), `activity_profiles` for outings and `visit_profiles` for visits — and §8b-i says
-- the last two are "migration inputs, not the final commercial API". When they are folded into
-- the registry, ONE function changes and every screen that asked follows. A second reader
-- written straight against `activity_profiles` today is a second thing to find and repoint
-- later, and the one that gets missed is how a screen ends up reading a table nobody maintains.
--
-- CANONICAL OUTINGS, per the statistics contract: "Multiple Garmin, Strava, file or
-- person-owned recordings still count once." Her Garmin original and Strava's copy of the same
-- run are one outing here, keyed by `shared_group_id`, or the page would tell somebody they
-- did the same run twice.
--
-- AND A PHOTOGRAPH IS NOT AN OUTING. §8b-i names it: "photo presence not silently promoted to
-- outing participation." They come back as different `kind`s and are never summed together;
-- being in a picture taken during a run puts nothing on anybody's mileage.
--
-- AUTHORIZATION IS NOT OPTIONAL HERE. SECURITY DEFINER, so every branch states its own rule:
-- photos through `can_see_memory_subject`, outings through `can_see_activity` (0228 — an
-- outing whose owner has not chosen to share it is not here), visits by membership. And the
-- PERSON has to be one you may read at all, or this would be a way to enumerate somebody
-- else's private contacts by trying ids.
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
      join public.activities act on act.id = ap.activity_id
     where a.linked_profile is not null
       and coalesce(ap.claim_status, 'accepted') <> 'rejected'
       and public.can_see_activity(act.id)
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
