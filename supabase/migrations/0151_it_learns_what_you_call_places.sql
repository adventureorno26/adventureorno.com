-- IT LEARNS WHAT YOU CALL A PLACE, AND STOPS ASKING.
--
-- Step 7 of docs/INGEST-BUILD-PLAN.md. You do the same runs constantly — 76 activities
-- called "Loudoun County Running", most of them on the W&OD. Without this, the Inbox
-- asks you the same question 76 times, which is the complaint this whole rebuild
-- started from.
--
-- The rule that keeps it honest: an auto-applied rule STILL writes a `suggestions` row
-- with status='approved', source='rule', and an `approved_fields` row with via='rule'.
-- So every automatic name remains visible, attributable and undoable. Silent
-- automation is what caused all of this; this is automation that shows its working.

begin;

create table if not exists public.naming_rules (
  id            uuid primary key default gen_random_uuid(),
  center        geography(Point,4326),                        -- a geofence…
  radius_m      int check (radius_m between 50 and 20000),
  place_id      uuid references public.places(id) on delete cascade,  -- …or a place
  activity_type text,                    -- null = any type
  name          text not null,
  learned_from  int not null default 0,  -- how many approvals taught it
  auto_apply    boolean not null default false,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  check (center is not null or place_id is not null)
);

comment on table public.naming_rules is
  'What Erica calls routes in a given area. Applying one is still recorded as a '
  'suggestion and an approval, so an automatic name is never silent.';

create index if not exists naming_rules_center_idx on public.naming_rules using gist (center);

alter table public.naming_rules enable row level security;
drop policy if exists naming_rules_select on public.naming_rules;
create policy naming_rules_select on public.naming_rules
  for select using (public.is_member());
revoke all on table public.naming_rules from public, anon;
grant select on table public.naming_rules to authenticated;
grant all on table public.naming_rules to service_role;

-- ---------------------------------------------------------------------------
-- 1. Should we offer to learn a rule?
-- ---------------------------------------------------------------------------
-- Only after the SAME name has been approved for the SAME area three times. Twice can
-- be coincidence; three times is a habit. Returns the count so the card can say why.
create or replace function public.rule_offer(p_activity uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_lat double precision; v_lng double precision; v_name text; v_pt geography;
  v_n int; v_radius constant int := 1500;
begin
  perform public.assert_member();

  select a.lat, a.lng, btrim(a.name) into v_lat, v_lng, v_name
    from public.activities a where a.id = p_activity;
  if v_lat is null or v_lng is null or coalesce(v_name,'') = '' then
    return jsonb_build_object('offer', false);
  end if;
  v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;

  -- Already covered by a rule? Then there is nothing to offer.
  if exists (
    select 1 from public.naming_rules r
     where r.auto_apply and r.name = v_name and r.center is not null
       and st_dwithin(r.center, v_pt, r.radius_m)) then
    return jsonb_build_object('offer', false, 'reason', 'already a rule');
  end if;

  -- How many activities near here has she APPROVED this same name for?
  select count(*) into v_n
    from public.activities a
    join public.approved_fields af
      on af.subject_type = 'activity' and af.subject_id = a.id and af.field = 'name'
   where btrim(a.name) = v_name
     and a.geom is not null
     and st_dwithin(a.geom, v_pt, v_radius);

  return jsonb_build_object(
    'offer', v_n >= 3, 'name', v_name, 'learned_from', v_n, 'radius_m', v_radius);
end
$function$;

revoke all on function public.rule_offer(uuid) from public, anon;
grant execute on function public.rule_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Learn it.
-- ---------------------------------------------------------------------------
create or replace function public.learn_rule(
  p_activity uuid, p_name text default null, p_radius_m int default 1500
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_lat double precision; v_lng double precision; v_name text; v_n int; v_id uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select a.lat, a.lng, coalesce(nullif(btrim(p_name), ''), btrim(a.name))
    into v_lat, v_lng, v_name
    from public.activities a where a.id = p_activity;
  if v_lat is null or v_lng is null then
    raise exception 'that activity has no start point to build a rule around'
      using errcode = '22023';
  end if;
  if coalesce(v_name, '') = '' then
    raise exception 'a rule needs a name' using errcode = '22023';
  end if;

  select count(*) into v_n
    from public.activities a
    join public.approved_fields af
      on af.subject_type = 'activity' and af.subject_id = a.id and af.field = 'name'
   where btrim(a.name) = v_name and a.geom is not null
     and st_dwithin(a.geom, st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography, p_radius_m);

  insert into public.naming_rules
    (center, radius_m, activity_type, name, learned_from, auto_apply, created_by)
  values
    (st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography,
     greatest(50, least(20000, p_radius_m)), null, v_name, v_n, true, v_me)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'rule_id', v_id, 'name', v_name, 'learned_from', v_n);
end
$function$;

revoke all on function public.learn_rule(uuid, text, int) from public, anon;
grant execute on function public.learn_rule(uuid, text, int) to authenticated;

-- Changing her mind is a first-class operation, here as everywhere else.
create or replace function public.forget_rule(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.naming_rules where id = p_id;
  return jsonb_build_object('ok', true, 'forgotten', found);
end
$function$;

revoke all on function public.forget_rule(uuid) from public, anon;
grant execute on function public.forget_rule(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Apply a rule — loudly.
-- ---------------------------------------------------------------------------
-- Called by the suggester before it reaches for Overpass. If a rule covers this route,
-- the name is written AND an audit trail is left: a suggestions row marked approved
-- and sourced 'rule', plus an approved_fields row via='rule'. Undo is the ordinary
-- clear_approval, and the suggestion row shows exactly what did it and why.
create or replace function public.apply_naming_rule(p_activity uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lat double precision; v_lng double precision; v_type text; v_cur text; v_pt geography;
  r public.naming_rules%rowtype;
begin
  select a.lat, a.lng, a.type, btrim(a.name) into v_lat, v_lng, v_type, v_cur
    from public.activities a where a.id = p_activity;
  if v_lat is null or v_lng is null then return jsonb_build_object('applied', false); end if;

  -- A decision already made is never re-litigated, not even by her own rule.
  if not public.may_autowrite('activity', p_activity, 'name') then
    return jsonb_build_object('applied', false, 'reason', 'already decided');
  end if;

  v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
  select * into r from public.naming_rules
   where auto_apply and center is not null
     and (activity_type is null or activity_type = v_type)
     and st_dwithin(center, v_pt, radius_m)
   order by st_distance(center, v_pt)
   limit 1;
  if not found then return jsonb_build_object('applied', false); end if;

  if v_cur = btrim(r.name) then
    -- Already right. Still record the decision so the Inbox stops considering it.
    insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
    values ('activity', p_activity, 'name', to_jsonb(btrim(r.name)), r.created_by, 'rule')
    on conflict (subject_type, subject_id, field) do nothing;
    return jsonb_build_object('applied', true, 'changed', false, 'name', r.name);
  end if;

  update public.activities set name = btrim(r.name) where id = p_activity;

  insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
  values ('activity', p_activity, 'name', to_jsonb(btrim(r.name)), r.created_by, 'rule')
  on conflict (subject_type, subject_id, field)
    do update set value = excluded.value, approved_by = excluded.approved_by,
                  approved_at = now(), via = 'rule';

  -- THE AUDIT ROW. An automatic name that leaves no trace is the thing we are fixing.
  insert into public.suggestions
    (subject_type, subject_id, field, current_value, proposed_value, label, source,
     confidence, evidence, group_key, rank, status, decided_by, decided_at)
  values
    ('activity', p_activity, 'name', to_jsonb(v_cur), to_jsonb(btrim(r.name)),
     'Called it ' || r.name || ' because you always do here', 'rule',
     1.0, jsonb_build_object('rule_id', r.id, 'learned_from', r.learned_from,
                             'radius_m', r.radius_m),
     'activity:' || p_activity::text, 0, 'approved', r.created_by, now())
  on conflict do nothing;

  return jsonb_build_object('applied', true, 'changed', true, 'name', r.name,
                            'rule_id', r.id, 'was', v_cur);
end
$function$;

revoke all on function public.apply_naming_rule(uuid) from public, anon;
grant execute on function public.apply_naming_rule(uuid) to authenticated;
grant execute on function public.apply_naming_rule(uuid) to service_role;

-- What rules exist, for a Settings/Inbox list and for "forget this".
create or replace function public.naming_rules_list()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'radius_m', r.radius_m,
           'learned_from', r.learned_from, 'auto_apply', r.auto_apply,
           'activity_type', r.activity_type, 'created_at', r.created_at)
         order by r.created_at desc), '[]'::jsonb)
    from public.naming_rules r;
$function$;

revoke all on function public.naming_rules_list() from public, anon;
grant execute on function public.naming_rules_list() to authenticated;

commit;
