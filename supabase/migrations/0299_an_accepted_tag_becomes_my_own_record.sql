-- 0299 — an accepted tag becomes my own record.
--
-- APPLIED TO PRODUCTION 2026-08-31, through `apply-migration.mjs`. Rehearsed against
-- production first in a transaction forced to abort, with the rollback proven (no
-- `materialise_accepted_outing`, `respond_to_memory_tag` back to its old body, no ledger
-- row, 629 activities).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- VERIFIED AFTER APPLYING: 629 activities, unchanged — this materialises on the NEXT
-- acceptance and back-fills nothing — and every capability measurement is byte-identical to
-- the morning's baseline across 0293 through 0299. Two tags are still `proposed`; nothing
-- was auto-accepted.
--
-- ⚠️ THERE IS NO LIVE CASE FOR THIS YET, and saying so is honest rather than deflating.
-- Every tag today is within one space (Erica's holds Erica and Test Bot; Josh owns his own),
-- so `materialise_accepted_outing` returns NULL on the `v_my_space = v_src.space_id` line
-- every time it is called. This is the floor item 7b — cross-account tagging — stands on:
-- STATE.md orders 2b BEFORE 3 precisely so that the first tag which ever crosses an account
-- boundary lands on a rule that already survives the tagger.
--
-- The second half of item 2b. `0294` did the first: removal RETRACTS instead of deleting, so
-- taking somebody off a card is a decision with a record. This is the other one, and it is
-- the half that survives a deletion rather than a removal.
--
-- Erica: *"we need to figure out a way to keep the stats if I approve a tag someone else has
-- made and then they defriend me or untag me."*
--
-- ---------------------------------------------------------------------------
-- WHY ACCEPTING IS NOT ENOUGH TODAY
-- ---------------------------------------------------------------------------
--
-- Accepting only flips `participation_status` on a row that lives inside the OTHER person's
-- subject, in the OTHER person's space. So:
--
--   * `memory_people.subject_id` is ON DELETE CASCADE — they delete the card, my
--     participation goes with it, and 0294's retraction never gets a chance to apply;
--   * after `0290` the participant views end in `is_member(s.space_id)` — the SUBJECT's
--     space — so once tagging crosses accounts I cannot even read back the thing I accepted.
--
-- THE APPROVED SHAPE (STATE.md §"AN ACCEPTED TAG IS MINE"): accepting materialises an
-- activity row owned by ME, in MY space, carrying the same `shared_group_id`. From then on
-- their untag, their block and their deletion cannot reach it.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DOES NOT DOUBLE-COUNT, WHICH IS THE WHOLE RISK
-- ---------------------------------------------------------------------------
--
-- `0292` established the rule and proved it on 56 rows: the canonical identity of an outing
-- is `coalesce(shared_group_id, id)`. A copy with a fresh id and a NULL group would be a
-- SECOND canonical key, and the 15-mile run would count as 30 — the exact thing §0.2 forbids.
--
-- So the copy carries the original's group, and where the original has none its own id is
-- written into it first. `0292` measured that this cannot move a number: every reader reads
-- `coalesce(shared_group_id, id)`, and that expression is unchanged by setting the column
-- from NULL to the row's own id.
--
-- It is load-bearing for a second reason that is easy to miss. `people_memory_keys` emits the
-- outing key as `coalesce(act.shared_group_id, act.id)`, and OUR STATS is the intersection of
-- those keys across people. Without the shared group my copy and their original would be two
-- different outings and the card would drop out of Our Stats entirely. With it, Our Stats
-- keeps working — and **correctly loses the card when they untag themselves**, because they
-- are then no longer tagged on anything in the group, which is what §0.2 says should happen.
--
-- ---------------------------------------------------------------------------
-- OUTINGS ONLY, AND THAT IS NOT AN OVERSIGHT
-- ---------------------------------------------------------------------------
--
-- `0292` had to answer this exact question and its finding governs here:
--
--     outings   `coalesce(shared_group_id, id)`  — a copy can be tied to its original ✅
--     visits    the key is `v.id`, and there is NO shared_group_id column on `visits` ❌
--     places    `count(distinct p.id)`, no such column either                          ❌
--
-- A materialised VISIT would count twice for anybody who could see both, with nothing in the
-- schema able to say they are the same memory. That is why Josh's membership of Erica's space
-- had to end, and it is why this file does not touch visits. STATE.md's approved wording is
-- already "when I accept a tag on someone's OUTING". **Accepted VISIT tags remain hostage to
-- whoever tagged them**, and that is the larger, separate change 0292 sized: a
-- `shared_group_id` on visits and places plus every reader taught to collapse on it.
--
-- ---------------------------------------------------------------------------
-- WHAT IS COPIED, AND WHAT IS DELIBERATELY NOT
-- ---------------------------------------------------------------------------
--
-- *"I keep the facts — date, distance, place — not their content. Their photos and their
-- route stay theirs."*
--
--   COPIED:      type · name · distance · moving/elapsed time · start_date (+ local) ·
--                lat/lng · elevation_gain · is_race · shared_group_id
--                (`local_date` and `geom` are GENERATED ALWAYS — derived from
--                 `start_date_local` and from lat/lng — so they follow and must not be
--                 listed; Postgres refuses a non-DEFAULT value for them.)
--   NOT COPIED:  summary_polyline and elevation_profile — their route, explicitly theirs;
--                strava_id — UNIQUE across the table, so a copy cannot carry it (0292);
--                athlete_id and source_id — their provenance, not mine;
--                visit_id — it points at a row in THEIR space;
--                place_id — the same, AND there is no way to keep it honestly. Pointing at
--                their place would cross the boundary `0292` §10(a) forbids; making a place
--                in my space would add one to my place count with no dedupe key to stop the
--                next acceptance adding another. **So the place is the one promised fact this
--                cannot carry**, said out loud rather than quietly dropped. Attaching the
--                copy to a place of my own is a deliberate act I can take afterwards.
--
-- `source` is set to `accepted-tag`. Checked rather than assumed: no reader FILTERS on
-- `activities.source` — `wander_stats[_for_people]` and `public_profile` use it only as a
-- tie-break in an ORDER BY (`(a.source = 'strava') desc`), so the value cannot exclude the
-- copy from a statistic. It loses that tie-break to the original, which is correct: where
-- both are visible the original's numbers are the ones with a recording behind them.
begin;

-- ---------------------------------------------------------------------------
-- 1. Materialise, if there is anything to materialise.
--
--    SECURITY DEFINER and called only from `respond_to_memory_tag`, which is one of the two
--    functions `0293` exempts from the cross-space write guard — an exemption recognised
--    through the PL/pgSQL call stack and therefore INHERITED by everything those two call.
--    That is exactly what lets the one write into the tagger's space below (stamping the
--    original's `shared_group_id`) go through, and nothing else gains from it.
-- ---------------------------------------------------------------------------
create or replace function public.materialise_accepted_outing(p_subject uuid, p_profile uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_src      public.activities%rowtype;
  v_my_space uuid;
  v_group    uuid;
  v_new      uuid;
begin
  select a.* into v_src
    from public.memory_subjects s
    join public.activities a on a.id = s.activity_id
   where s.id = p_subject and s.kind = 'outing';
  if not found then
    return null;                            -- a visit or a photo: outings only, see header
  end if;

  v_my_space := public.home_space_of(p_profile);
  if v_my_space is null or v_my_space = v_src.space_id then
    return null;                            -- already mine, or I am in no space at all
  end if;

  -- The canonical key. Writing the original's own id into a NULL group cannot move a number
  -- (0292): every reader reads `coalesce(shared_group_id, id)`.
  v_group := coalesce(v_src.shared_group_id, v_src.id);
  if v_src.shared_group_id is null then
    update public.activities set shared_group_id = v_group where id = v_src.id;
  end if;

  -- Idempotent. Answering twice, or accepting after a decline, must not make a second copy —
  -- that would be the double-count this whole file exists to avoid.
  if exists (select 1 from public.activities a
              where a.space_id = v_my_space
                and coalesce(a.shared_group_id, a.id) = v_group) then
    return null;
  end if;

  insert into public.activities (
    type, name, distance, moving_time, elapsed_time,
    start_date, start_date_local, lat, lng,
    elevation_gain, is_race, shared_group_id, owner_profile, space_id,
    source, original_source)
  values (
    v_src.type, v_src.name, v_src.distance, v_src.moving_time, v_src.elapsed_time,
    v_src.start_date, v_src.start_date_local, v_src.lat, v_src.lng,
    v_src.elevation_gain, v_src.is_race, v_group, p_profile, v_my_space,
    'accepted-tag', 'accepted-tag')
  returning id into v_new;

  -- `activities_default_participants` has already fired by now and made the subject and an
  -- `accepted` participation for the owner — but it stamps `own_recording`, which is what
  -- 0236 keys "not yours to delete" on and is simply untrue here: I accepted a tag, I did
  -- not record anything. Corrected to say what happened.
  update public.memory_people mp
     set evidence = 'accepted_tag', created_by = 'accept'
    from public.memory_subjects s
   where s.id = mp.subject_id
     and s.kind = 'outing' and s.activity_id = v_new
     and mp.evidence = 'own_recording';

  return v_new;
end
$fn$;
revoke all on function public.materialise_accepted_outing(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Accepting calls it. Declining does not.
--
--    The body is 0248's, unchanged except for the one call — the authorisation, the
--    "only the person named" lookup and the status flip are all exactly as they were.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_memory_tag(p_subject uuid, p_accept boolean)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_person uuid;
begin
  -- ONLY THE PERSON NAMED. The tag is about them; the owner already said their piece by
  -- making it.
  select mp.person_id into v_person
    from public.memory_people mp
    join public.people pe on pe.id = mp.person_id
   where mp.subject_id = p_subject
     and pe.linked_profile = auth.uid()
     and mp.participation_status = 'proposed';
  if v_person is null then raise exception 'no tag of yours to answer here'; end if;

  update public.memory_people
     set participation_status = case when p_accept then 'accepted' else 'declined' end,
         verification_status  = case when p_accept then 'confirmed_by_person'
                                     else verification_status end,
         decided_by = auth.uid(), decided_at = now()
   where subject_id = p_subject and person_id = v_person;

  -- AND IT BECOMES MINE. Only on accept: declining leaves nothing of theirs in my space,
  -- which is the point of declining.
  if p_accept then
    perform public.materialise_accepted_outing(p_subject, auth.uid());
  end if;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3. What must be true.
-- ---------------------------------------------------------------------------
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'respond_to_memory_tag';

  if v_def not like '%materialise_accepted_outing%' then
    raise exception '0299: respond_to_memory_tag does not materialise anything';
  end if;
  -- The authorisation must still be there. A rewrite that dropped it would be a far worse
  -- bug than the one this file fixes.
  if v_def not like '%no tag of yours to answer here%' then
    raise exception '0299: the "only the person named" check is gone';
  end if;

  -- 0293 exempts these two BY NAME through the call stack. If the signature ever moves, the
  -- cross-space stamp below fails closed rather than silently.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'respond_to_memory_tag'
                    and pg_get_function_identity_arguments(p.oid) = 'p_subject uuid, p_accept boolean') then
    raise exception '0299: respond_to_memory_tag no longer has the signature 0293 exempts';
  end if;

  raise notice '0299: accepting an outing tag now materialises the accepter''s own row';
end
$do$;

commit;
