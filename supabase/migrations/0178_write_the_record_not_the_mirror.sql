-- 0178 — write the record, not the mirror.
--
-- `add_place_to_visit` (0164, mine) added a place to a trip by inserting straight into
-- `place_membership`, with a comment stating that place_membership is canonical.
--
-- IT IS THE OTHER WAY ROUND. `places.part_of` (uuid[]) is the record of membership, and
-- the `places_sync_membership` trigger REBUILDS `place_membership` from that array
-- whenever `part_of` changes:
--
--     delete from place_membership m
--      where m.child_id = NEW.id
--        and m.parent_id <> all (coalesce(NEW.part_of, '{}'));
--
-- So a row inserted straight into the mirror is real right up until anyone edits that
-- place's containers — and then the trigger deletes it, for not being in the array,
-- with no error. "Add a restaurant to this trip", then change the restaurant's
-- containers later, and it quietly leaves the trip.
--
-- This is the project's most expensive recurring bug, written down in §8 as
-- derived-vs-source: one fact with two mechanisms, and the write goes to the copy. It
-- has already cost a full debugging session at least four times, and once destroyed
-- apparent work — Erica re-approving a deletion that never took.
--
-- NOTHING IS DAMAGED YET. Production has 19 membership rows, ZERO not backed by
-- part_of, because the activity dropdown that calls this has not shipped. Fixed before
-- it could bite rather than after.
--
-- ROLLBACK: the previous definition is in git history (0164).

begin;

CREATE OR REPLACE FUNCTION public.add_place_to_visit(p_visit uuid, p_option text, p_name text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text)
 RETURNS places
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opt    public.activity_options;
  v_visit  public.visits;
  v_parent public.places;
  v_place  public.places;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'a place needs a name'; end if;

  select * into v_opt from public.activity_options where slug = p_option and active;
  if v_opt.slug is null then raise exception 'unknown activity option: %', p_option; end if;
  if v_opt.kind <> 'place' then
    raise exception 'option % creates a route — call add_activity_to_visit', p_option;
  end if;

  select * into v_visit from public.visits where id = p_visit;
  if v_visit.id is null then raise exception 'no such visit'; end if;
  select * into v_parent from public.places where id = v_visit.place_id;

  -- Reuse an existing child of the same name before creating another one.
  select p.* into v_place
    from public.places p
    join public.place_membership m on m.child_id = p.id and m.parent_id = v_parent.id
   where lower(btrim(p.name)) = lower(btrim(p_name)) and p.deleted_at is null
   limit 1;

  if v_place.id is null then
    insert into public.places (name, lat, lng, saved, categories, created_by)
    values (btrim(p_name),
            coalesce(p_lat, v_parent.lat), coalesce(p_lng, v_parent.lng),
            true, array[v_opt.place_category], auth.uid())
    returning * into v_place;

    -- A place that now holds a child IS a container. The existing membership guard
    -- refuses a parent without holds_children, and it is right to: this is the flag
    -- that says the parent can hold things. Setting it here keeps the flag TRUE to
    -- the fact instead of leaving it to drift — the derived-vs-source bug that has
    -- bitten this project repeatedly (§8).
    update public.places set holds_children = true
     where id = v_parent.id and not coalesce(holds_children, false);

    -- WRITE part_of, NOT place_membership. I had this backwards in 0164, and the
    -- comment there confidently said the opposite: `places.part_of` is the RECORD of
    -- membership, and `places_sync_membership` REBUILDS place_membership from that
    -- array whenever part_of changes. A row inserted straight into the mirror looks
    -- right until anyone edits that place's containers, at which point the trigger
    -- deletes it for not being in the array — silently.
    update public.places
       set part_of = (select array_agg(distinct x)
                        from unnest(coalesce(part_of, '{}'::uuid[]) || v_parent.id) x)
     where id = v_place.id
       and v_parent.id <> all (coalesce(part_of, '{}'::uuid[]));
  end if;

  -- Its dates are visits to it — Erica's words. Same day as the parent visit.
  insert into public.visits (place_id, start_date, end_date, status, manual, source,
                             accepted_at, accepted_by, solo_profile, parent_visit_id)
  select v_place.id, v_visit.start_date, v_visit.end_date, 'taken', true, 'manual',
         now(), auth.uid(), v_visit.solo_profile,
         case when public.counts_as_trip(v_visit.*) then v_visit.id else null end
  where not exists (
    select 1 from public.visits x
     where x.place_id = v_place.id and x.start_date = v_visit.start_date
  );

  return v_place;
end $function$

;

comment on function public.add_place_to_visit(uuid, text, text, double precision, double precision, text) is
  'Add a place (restaurant, winery, bar) to a visit and give it its own visit on the '
  'same day. Membership is written to places.part_of — the RECORD — and mirrored into '
  'place_membership by the places_sync_membership trigger. Never write the mirror (§8).';

revoke all on function public.add_place_to_visit(uuid, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.add_place_to_visit(uuid, text, text, double precision, double precision, text) to authenticated;

commit;
