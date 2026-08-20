-- 0230 — one person cannot start the same thing twice in the same second.
--
-- Erica, 2026-08-20: *"there are 58 activities asking me to review them but they are from my
-- garmin so clearly they are the same activity — this is a problem from uploading 2 files I
-- think, fix it."*
--
-- She is right, and the reason is mechanical: **Strava's copy came FROM the Garmin file.**
-- The watch wrote a start timestamp, Garmin kept it, Strava imported it — so her Garmin
-- original and her Strava record of the same outing begin at the *same second*. Measured
-- across the pending queue:
--
--     25  different people                          ← a real question, hers to answer
--      6  same person, 0–7s apart, within 1%
--      4  same person, 0–18s apart, distance differs ← Strava recomputes the total
--      4  same person, 5–15 min apart               ← genuinely ambiguous, still asked
--
-- Ten of the fourteen same-person cards are the same recording arriving twice, and every one
-- of them was a question with only one possible answer.
--
-- WHY 0216'S CONTENT KEY DID NOT CATCH THEM. It only applies when a file brings NO provider
-- key. A Garmin FIT brings `fit:garmin:<product>:<serial>:<created>`, so the key path was
-- taken, found no match — Strava's copy is keyed by its Strava id — and fell through to
-- Tier 2, which proposes. The two identities were both right and neither could see the other.
--
-- THE TEST ADDED HERE IS TIME, NOT DISTANCE. Distance is the wrong discriminator: Strava
-- recomputes it, so the same outing differs by a few percent (the 4 above). A start time is
-- copied verbatim through every hop. Same owner, same type, starting within sixty seconds is
-- not a resemblance — one person cannot begin two runs a minute apart.
--
-- STILL NARROW. It requires the SAME OWNER: two people who set off together are a joint
-- outing, not a duplicate, and that stays a person's decision (0224). And 60 seconds is
-- nowhere near the 11-minute gap in 0203's fixture, which remains a proposal.

create or replace function public.same_recording_of(
  p_owner uuid, p_type text, p_date timestamptz, p_exclude uuid default null)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id
    from public.activities a
   where p_owner is not null and p_date is not null
     and a.owner_profile = p_owner
     and (p_type is null or a.type = p_type)
     and a.start_date is not null
     and abs(extract(epoch from (a.start_date - p_date))) <= 60
     and (p_exclude is null or a.id <> p_exclude)
   order by abs(extract(epoch from (a.start_date - p_date))), a.created_at
   limit 1;
$function$;

comment on function public.same_recording_of is
  'The caller''s own recording of the same outing, found by START TIME within 60 seconds — '
  'not distance, which Strava recomputes. A Strava record inherits its timestamp from the '
  'Garmin file it came from, so the two agree to the second (0230).';

-- ---------------------------------------------------------------------------
-- Settle the ones already sitting in her queue.
-- ---------------------------------------------------------------------------
-- These are decided rather than proposed, because she decided: "clearly they are the same
-- activity — fix it". Only same-owner pairs inside the sixty-second window; everything else
-- in the queue is untouched, including all 25 joint outings.
do $$
declare v_linked int; v_closed int;
begin
  create temp table _certain on commit drop as
  select s.id as suggestion_id,
         s.subject_id as incoming,
         coalesce((s.evidence ->> 'kept')::uuid, (s.proposed_value #>> '{}')::uuid) as kept
    from public.suggestions s
   where s.status = 'pending' and s.field = 'shared_group_id';

  delete from _certain c
   using public.activities a, public.activities b
   where a.id = c.incoming and b.id = c.kept
     and not (a.owner_profile = b.owner_profile
              and a.type is not distinct from b.type
              and abs(extract(epoch from (a.start_date - b.start_date))) <= 60);

  update public.activities a
     set shared_group_id = coalesce(b.shared_group_id, b.id)
    from _certain c
    join public.activities b on b.id = c.kept
   where a.id = c.incoming and a.shared_group_id is null;
  get diagnostics v_linked = row_count;

  update public.suggestions s
     set status = 'approved', decided_at = now()
    from _certain c
   where s.id = c.suggestion_id;
  get diagnostics v_closed = row_count;

  raise notice '0230: linked % certain duplicates and closed % cards; every joint outing left alone',
    v_linked, v_closed;
end $$;
