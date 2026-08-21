-- The map's people filter must answer what the old three-button one did, and then more.
--
-- §8b-i replaced `Together / Just me / Just Josh` with a selection. The risk in that is not
-- the new answers — it is the old ones quietly changing: she has been reading these numbers
-- for months, and "Together" meaning something slightly different from last week is the kind
-- of error nobody reports because it looks like data.
--
-- So this pins the equivalence at the moment of the switch:
--
--     old place_ids_for_view(null)          ==  new place_ids_for_people([both], 'all')
--     old place_ids_for_view(profile)       ==  new place_ids_for_people([that one], 'any')
--
-- and the same for the visit counts and for `wander_stats`. When the old six are finally
-- retired, this test retires with them — and until then it is what says the swap was even.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0260-0000-0000-0000-000000000001','e0260@example.invalid'),
  ('eeee0260-0000-0000-0000-000000000002','j0260@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0260-0000-0000-0000-000000000001','E0260','owner'),
  ('eeee0260-0000-0000-0000-000000000002','J0260','editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'eeee0260-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0260-0000-0000-0000-000000000002';
  me uuid; him uuid; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  me  := public.add_contact('Me 0260', e_id);
  him := public.add_contact('J0260', j_id);

  -- ---- TOGETHER: the old null, and the new ALL over both ---------------------
  select count(*) into n from (
    select public.place_ids_for_view(null)
    except select public.place_ids_for_people(array[me, him], 'all')
    union all
    select public.place_ids_for_people(array[me, him], 'all')
    except select public.place_ids_for_view(null)) t;
  if n <> 0 then
    raise exception 'FAIL: "Together" changed meaning — % places differ', n;
  end if;

  -- ---- JUST ONE PERSON: the old profile, and the new ANY over one ------------
  select count(*) into n from (
    select public.place_ids_for_view(e_id)
    except select public.place_ids_for_people(array[me], 'any')
    union all
    select public.place_ids_for_people(array[me], 'any')
    except select public.place_ids_for_view(e_id)) t;
  if n <> 0 then
    raise exception 'FAIL: "Just me" changed meaning — % places differ', n;
  end if;

  -- ---- the counts beside the markers agree too -------------------------------
  if exists (
    select 1 from public.place_visit_counts(null) o
    full join public.place_visit_counts_for_people(array[me, him], 'all') p
      on p.place_id = o.place_id
     where coalesce(o.visits, -1) is distinct from coalesce(p.visits, -1)) then
    raise exception 'FAIL: the visit-count badges disagree between old Together and new';
  end if;

  -- ---- AND THE NUMBERS ON TOP OF THEM ---------------------------------------
  -- The stats bar sits on this same map. Half a conversion is a screen whose markers say
  -- one thing and whose miles say another.
  if (select round(miles::numeric) from public.wander_stats(null))
     is distinct from
     (select round(miles::numeric) from public.wander_stats_for_people(array[me, him], 'all')) then
    raise exception 'FAIL: the miles under "Together" changed';
  end if;
  if (select round(miles::numeric) from public.wander_stats(e_id))
     is distinct from
     (select round(miles::numeric) from public.wander_stats_for_people(array[me], 'any')) then
    raise exception 'FAIL: the miles under "Just me" changed';
  end if;

  -- ---- ANYONE IS NEW, AND IS A SUPERSET --------------------------------------
  -- The old control could not ask this at all: `null` meant SHARED, not "everything".
  if (select count(*) from public.place_ids_for_people('{}', 'any'))
     < (select count(*) from public.place_ids_for_people(array[me, him], 'all')) then
    raise exception 'FAIL: "Anyone" showed fewer places than "Together"';
  end if;
end $$;

do $$ begin raise notice 'PASS 0260: Together and Just-me mean exactly what they meant, the counts and miles agree with the markers, and Anyone is a superset'; end $$;

rollback;
