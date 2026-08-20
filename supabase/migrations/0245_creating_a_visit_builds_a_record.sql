-- 0245 — creating a visit builds a record; the picker makes a statement.
--
-- 0240 made `set_visit_participants` ASK rather than assert, and `create_visit` calls it. Five
-- regression tests failed in CI, none of them about tagging: evidence routes (0166), one way
-- to change a visit (0169), the trip rules (0170), merging (0185) and the visit counts (0190).
-- Every one had built a visit with two people in order to test something else, and every one
-- now got a visit with one.
--
-- The right line is not "the picker asks and everything else asks too". It is:
--
--     A PERSON'S WORD ABOUT SOMEBODY ELSE IS A QUESTION.
--     A RECORD BEING CONSTRUCTED FROM A LIST ITS CALLER ALREADY HOLDS IS NOT.
--
-- `set_visit_solo` and `set_place_solo` are the first: pressing "Just Josh" on a visit that
-- already exists is one person saying something about another, and 0039 is what happens when
-- the app files that as a fact. `create_visit` is the second — the evidence routes, the trip
-- grouping, the restore path. Making it ask would mean a visit created "with both of us"
-- contains one person until the other answers.
--
-- AND NO LIVE SCREEN CALLS IT: `addVisit` is deprecated with zero callers and does not pass
-- participants at all. Every person-facing "who was there" goes through a picker. The rows it
-- writes say `evidence = 'created_with'` rather than claiming somebody decided something, so
-- if that ever stops being true it is visible in the data.

create or replace function public.create_visit(p_place uuid, p_start date, p_end date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_profiles uuid[] DEFAULT NULL::uuid[], p_trip boolean DEFAULT false, p_parent uuid DEFAULT NULL::uuid, p_client_key text DEFAULT NULL::text)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.visits; v_end date;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- A retry of the same save is the same visit, not a second one.
  if p_client_key is not null then
    select * into v_row from public.visits where client_key = p_client_key;
    if v_row.id is not null then return v_row; end if;
  end if;

  if not exists (select 1 from public.places where id = p_place and deleted_at is null) then
    raise exception 'no such place';
  end if;

  v_end := coalesce(p_end, p_start);
  if v_end < p_start then raise exception 'the end date is before the start date'; end if;

  insert into public.visits (place_id, start_date, end_date, note, status, manual,
                             trip_marked, client_key)
  values (p_place, p_start, v_end, nullif(btrim(coalesce(p_note,'')), ''), 'taken', true,
          coalesce(p_trip, false), p_client_key)
  returning * into v_row;

  -- Participants BEFORE grouping: attaching checks that everyone on the child was on
  -- the parent, so the rows have to exist first (0170).
  -- WRITES THE ROWS. It does NOT go through `set_visit_participants`, which since 0240 turns
  -- naming somebody else into a question they must answer.
  --
  -- That is right for the PICKER — pressing "Just Josh" on a visit that already exists is one
  -- person saying something about another, and 0039 is what happens when the app treats that
  -- as a fact. It is wrong here. `create_visit` CONSTRUCTS a record from a list its caller
  -- already holds: the evidence routes in 0166, the trip grouping in 0170, the restore path,
  -- and the fixtures that build a visit in order to test something else entirely. Making all
  -- of those ask would mean a visit created "with both of us" contains one person until the
  -- other answers, and five tests about other subjects would each have to perform an
  -- acceptance to say anything at all.
  --
  -- SAFE BECAUSE OF WHO CALLS IT: no live UI path does. `addVisit` is deprecated with zero
  -- callers and does not pass participants at all; every person-facing "who was there" runs
  -- through `set_visit_solo` or `set_place_solo`, which ask. If a screen ever calls this with
  -- a person's word about somebody else, it belongs on the asking path instead — which is
  -- why the evidence says `created_with` rather than pretending anybody decided.
  if p_profiles is not null and coalesce(array_length(p_profiles, 1), 0) > 0 then
    if exists (select 1 from unnest(p_profiles) x
                where not exists (select 1 from public.profiles p where p.id = x)) then
      raise exception 'unknown profile in the participant list';
    end if;
    insert into public.visit_profiles
      (visit_id, profile_id, claim_status, evidence, created_by)
    select v_row.id, x, 'accepted', 'created_with', 'user'
      from unnest(p_profiles) x
    on conflict (visit_id, profile_id) do nothing;
    update public.visits set solo_override = true where id = v_row.id;
  end if;

  if p_parent is not null then
    perform public.attach_child_visit(v_row.id, p_parent);
    select * into v_row from public.visits where id = v_row.id;
  end if;

  return v_row;
end $function$

;
