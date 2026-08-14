-- 0185 — merging two visits that were always one occasion.
--
-- Erica's Rome photos, 27 March to 2 April, were split in the photo sorter because it
-- keyed groups on the calendar month (fixed for new work in the client, 2026-08-14).
-- Nothing was saved that time, but the app has no way to fix it when something IS
-- saved that way — `merge_places` exists for places and there is NOTHING for visits.
--
-- WHAT MERGING A VISIT HAS TO MOVE. A visit is the occasion, and everything hangs off
-- it: photos, videos, activities, participants, companions, evidence, and any visits
-- grouped inside it. Moving only the row would strand every one of those.
--
-- THE DATES WIDEN rather than being chosen. Two visits that were one stay cover the
-- union of their days — 27–31 March merged with 1–2 April is 27 March to 2 April, not
-- one range or the other. That can turn a single-day visit into a multi-day one, which
-- under §0.4 makes it a trip; that is correct, and it is the whole reason the split was
-- wrong.
--
-- IT REFUSES ACROSS PLACES. Merging visits to two different places would silently move
-- photographs to somewhere they were not taken. Moving a visit to another place is
-- `move_visit_to_place`, a different decision, made deliberately.
--
-- PARTICIPANTS UNION rather than intersect: if Josh was on one half of the stay, he was
-- on the stay.
--
-- ROLLBACK: drop function public.merge_visits(uuid, uuid). It cannot restore a merge
-- that has happened — the caller should confirm first, which is why the UI asks.

begin;

create or replace function public.merge_visits(p_keep uuid, p_absorb uuid)
returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_keep public.visits; v_absorb public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_keep = p_absorb then raise exception 'those are the same visit'; end if;

  select * into v_keep   from public.visits where id = p_keep   for update;
  select * into v_absorb from public.visits where id = p_absorb for update;
  if v_keep.id is null or v_absorb.id is null then raise exception 'no such visit'; end if;

  if v_keep.place_id <> v_absorb.place_id then
    raise exception 'those visits are to different places — move one first if that is what you mean';
  end if;

  -- WIDEN THE DATES FIRST. The 0170 parent/child trigger refuses a child that falls
  -- outside its trip's range, and a visit grouped inside the absorbed half is very
  -- likely outside the surviving half's ORIGINAL dates — that is what made them look
  -- like two stays. Repointing before widening fails with "the visit falls outside the
  -- trip's dates", which is the trigger doing its job on my own bad ordering.
  update public.visits
     set start_date = least(v_keep.start_date, v_absorb.start_date),
         end_date   = greatest(coalesce(v_keep.end_date, v_keep.start_date),
                               coalesce(v_absorb.end_date, v_absorb.start_date)),
         note       = coalesce(nullif(btrim(coalesce(v_keep.note, '')), ''),
                               nullif(btrim(coalesce(v_absorb.note, '')), '')),
         manual     = true
   where id = p_keep
  returning * into v_keep;

  -- THEN UNION THE PEOPLE, still before repointing. 0170 also refuses a child holding
  -- someone the trip does not: a visit grouped inside the absorbed half carries that
  -- half's participants, so if Josh was only on those days, moving the child first
  -- fails with "someone on that visit was not on the trip". Both refusals are the
  -- constraint working — the merge simply has to happen in the order the model implies.
  insert into public.visit_profiles (visit_id, profile_id)
  select p_keep, profile_id from public.visit_profiles where visit_id = p_absorb
  on conflict do nothing;

  insert into public.visit_people (visit_id, person_id)
  select p_keep, person_id from public.visit_people where visit_id = p_absorb
  on conflict do nothing;

  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  select p_keep, evidence_type, evidence_id, evidence_date, source_key
    from public.visit_evidence where visit_id = p_absorb
  on conflict do nothing;

  -- Nothing may be left pointing at the visit that is about to go.
  update public.photos      set visit_id = p_keep where visit_id = p_absorb;
  update public.videos      set visit_id = p_keep where visit_id = p_absorb;
  update public.activities  set visit_id = p_keep where visit_id = p_absorb;
  update public.visits      set parent_visit_id = p_keep where parent_visit_id = p_absorb;

  delete from public.visits where id = p_absorb;

  return v_keep;
end $function$;

comment on function public.merge_visits(uuid, uuid) is
  'Merge two visits to the SAME place into one occasion: photos, videos, activities, '
  'participants, companions, evidence and anything grouped inside move across, and the '
  'dates widen to cover both. Refuses across places — that is move_visit_to_place.';

revoke all on function public.merge_visits(uuid, uuid) from public, anon;
grant execute on function public.merge_visits(uuid, uuid) to authenticated;

commit;
