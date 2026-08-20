-- 0246 — the list a visit is created with is the whole list.
--
-- 0245 gave `create_visit` its own participant insert instead of routing through
-- `set_visit_participants`, and lost one thing that function did: it DELETED first.
--
-- So `create_visit(place, …, array[b_id])` no longer produced a visit with B on it. It
-- produced a visit with whatever had already been written for it PLUS B — and
-- `0190_the_count_was_a_leftover` measured it exactly: a "both of us" count of 2 where 1 was
-- true, which is the same class of error the whole test exists to catch.
--
-- The list is the record, not an addition to one.

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
    -- REPLACES the set. `set_visit_participants` deleted first and this did not, so a row
    -- written by whatever populates a new visit survived alongside the list the caller
    -- passed: `create_visit(place, …, array[b])` produced a visit with A AND B on it, and
    -- 0190 measured a "both of us" count of 2 where 1 was true. Taking the list literally is
    -- the whole contract — it is the caller's record, not a suggestion to add to.
    delete from public.visit_profiles
     where visit_id = v_row.id and not (profile_id = any(p_profiles));
    update public.visits set solo_override = true where id = v_row.id;
  end if;

  if p_parent is not null then
    perform public.attach_child_visit(v_row.id, p_parent);
    select * into v_row from public.visits where id = v_row.id;
  end if;

  return v_row;
end $function$
;
