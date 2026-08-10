-- A RULE ONLY APPLIES WHEN THE ROUTE ITSELF AGREES.
--
-- The rule Erica learned is "Washington & Old Dominion Trail" within 1500 m of her
-- house. On a start-point geofence alone that would have auto-renamed **76**
-- activities — including neighbourhood street runs that never touched the W&OD. That
-- is the blanket-rename shape that caused every problem this rebuild exists to fix.
--
-- Her instruction (2026-08-10): "only apply the rule when the route scores that
-- trail." That is the right fix, and it is strictly better than shrinking the radius:
-- a geofence asks "did you start near here?", which is a weak proxy for "were you on
-- this trail?". The scorer already knows the real answer. With the route required to
-- agree, a wide radius becomes safe — it covers the whole trail — while a run round
-- the block simply never matches.
--
-- So the rule now needs BOTH: the start point inside the fence, AND the rule's name
-- among the names OpenStreetMap actually found along the route.

begin;

-- The single-argument version could apply a rule on the geofence alone, so it is
-- removed rather than left as a trap for the next caller.
drop function if exists public.apply_naming_rule(uuid);

create or replace function public.apply_naming_rule(p_activity uuid, p_candidates text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lat double precision; v_lng double precision; v_type text; v_cur text; v_pt geography;
  r public.naming_rules%rowtype;
begin
  -- Fail closed. No scored candidates (Overpass failed, or the route matched nothing)
  -- means we do not know where she was, and a rule must not fill that silence.
  if p_candidates is null or array_length(p_candidates, 1) is null then
    return jsonb_build_object('applied', false, 'reason', 'no route evidence');
  end if;

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
     -- THE ROUTE MUST AGREE. Case- and whitespace-insensitive so "W&OD Trail " from a
     -- rule matches "W&OD Trail" from OSM.
     and exists (
       select 1 from unnest(p_candidates) c
        where lower(btrim(c)) = lower(btrim(naming_rules.name)))
   order by st_distance(center, v_pt)
   limit 1;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'no rule the route agrees with');
  end if;

  if v_cur = btrim(r.name) then
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

  -- The audit row. An automatic name that leaves no trace is the thing being fixed.
  insert into public.suggestions
    (subject_type, subject_id, field, current_value, proposed_value, label, source,
     confidence, evidence, group_key, rank, status, decided_by, decided_at)
  values
    ('activity', p_activity, 'name', to_jsonb(v_cur), to_jsonb(btrim(r.name)),
     'Called it ' || r.name || ' because you always do here, and the route agrees',
     'rule', 1.0,
     jsonb_build_object('rule_id', r.id, 'learned_from', r.learned_from,
                        'radius_m', r.radius_m, 'route_agreed', true),
     'activity:' || p_activity::text, 0, 'approved', r.created_by, now())
  on conflict do nothing;

  return jsonb_build_object('applied', true, 'changed', true, 'name', r.name,
                            'rule_id', r.id, 'was', v_cur);
end
$function$;

revoke all on function public.apply_naming_rule(uuid, text[]) from public, anon;
grant execute on function public.apply_naming_rule(uuid, text[]) to authenticated;
grant execute on function public.apply_naming_rule(uuid, text[]) to service_role;

comment on function public.apply_naming_rule(uuid, text[]) is
  'Apply a learned naming rule, but only when the route scoring actually found that '
  'name along the route. A geofence alone is not evidence of where you were.';

commit;
