-- 0181 — the day the card asks for is the day it records.
--
-- The "+ Add an activity" form asks which day, defaulting to a day of the visit. Both
-- RPCs ignored it: `add_activity_to_visit` stamped the activity with the visit's
-- START date, and `add_place_to_visit` gave the new place a visit spanning the parent's
-- ENTIRE range.
--
-- On a single-day visit nobody would notice. On a week away it is wrong in the way that
-- matters most here: the run was on the Tuesday, not on the day you arrived, and dinner
-- on one evening read as a six-day visit to the restaurant — which then counts as a
-- multi-day visit, and under §0.4 a multi-day visit IS a trip. A dinner would have
-- become a trip.
--
-- A control that collects a value and discards it is the exact shape of bug that has
-- cost this project the most trust, so it is fixed before the control ships rather than
-- after someone notices the dates are wrong.
--
-- `p_day` is optional and defaults to the visit's first day, so every existing caller
-- behaves exactly as before. It must fall inside the visit; asking for a day outside it
-- is an error rather than a silent clamp.
--
-- ROLLBACK: previous definitions are in git history (0164, then 0178 for the place one).

begin;

CREATE OR REPLACE FUNCTION public.add_activity_to_visit(p_visit uuid, p_option text, p_name text DEFAULT NULL::text, p_distance_m double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text, p_day date DEFAULT NULL::date)
 RETURNS activities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date;
  v_opt   public.activity_options;
  v_visit public.visits;
  v_row   public.activities;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_opt from public.activity_options where slug = p_option and active;
  if v_opt.slug is null then raise exception 'unknown activity option: %', p_option; end if;
  if v_opt.kind <> 'route' then
    raise exception 'option % creates a place — call add_place_to_visit', p_option;
  end if;

  select * into v_visit from public.visits where id = p_visit;
  if v_visit.id is null then raise exception 'no such visit'; end if;

  -- WHICH DAY. The card asks for it, so it has to mean something: on a week away, the
  -- run was on the Tuesday, not on the day the trip started. Defaults to the visit's
  -- first day and must fall inside it.
  v_day := coalesce(p_day, v_visit.start_date);
  if v_day < v_visit.start_date or v_day > coalesce(v_visit.end_date, v_visit.start_date) then
    raise exception 'that day is outside this visit (% to %)',
      v_visit.start_date, coalesce(v_visit.end_date, v_visit.start_date);
  end if;

  -- Idempotent retry: same key, same visit, same activity.
  if p_client_key is not null then
    -- source_id is the table's EXISTING external-identity column (Strava and imports
    -- already use it). Reusing it beats adding a second idempotency key that half the
    -- writers would forget.
    select * into v_row from public.activities
     where visit_id = p_visit and source_id = p_client_key limit 1;
    if v_row.id is not null then return v_row; end if;
  end if;

  -- local_date is GENERATED from start_date (0143) — it cannot be written, and the
  -- generated value is the one that is correct west of Greenwich anyway.
  insert into public.activities (place_id, visit_id, type, name, distance, start_date,
                                 source, source_id, solo_profile)
  values (v_visit.place_id, p_visit, v_opt.activity_type,
          coalesce(p_name, v_opt.label), coalesce(p_distance_m, 0),
          v_day::timestamptz,
          'manual', p_client_key, v_visit.solo_profile)
  returning * into v_row;

  return v_row;
end $function$

;

CREATE OR REPLACE FUNCTION public.add_place_to_visit(p_visit uuid, p_option text, p_name text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text, p_day date DEFAULT NULL::date)
 RETURNS places
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date;
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

  -- The restaurant was on ONE day of the trip, not for the whole week. It used to
  -- inherit the parent's entire range, so a dinner on the Tuesday of a San Diego week
  -- read as a six-day visit to the restaurant.
  v_day := coalesce(p_day, v_visit.start_date);
  if v_day < v_visit.start_date or v_day > coalesce(v_visit.end_date, v_visit.start_date) then
    raise exception 'that day is outside this visit (% to %)',
      v_visit.start_date, coalesce(v_visit.end_date, v_visit.start_date);
  end if;
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
  select v_place.id, v_day, v_day, 'taken', true, 'manual',
         now(), auth.uid(), v_visit.solo_profile,
         case when public.counts_as_trip(v_visit.*) then v_visit.id else null end
  where not exists (
    select 1 from public.visits x
     where x.place_id = v_place.id and x.start_date = v_day
  );

  return v_place;
end $function$

;

do $$
declare f text;
begin
  foreach f in array array[
    'add_activity_to_visit(uuid,text,text,double precision,text,date)',
    'add_place_to_visit(uuid,text,text,double precision,double precision,text,date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- The old signatures would still resolve for a caller that omits the new argument,
-- which is two functions with one name and a silent choice between them.
drop function if exists public.add_activity_to_visit(uuid, text, text, double precision, text);
drop function if exists public.add_place_to_visit(uuid, text, text, double precision, double precision, text);

commit;
