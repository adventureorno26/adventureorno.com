-- 0192 — `place_membership` becomes the record. `places.part_of` becomes the mirror.
--
-- THE DIRECTION FLIPS. Today the array on the place is the truth and the table is a copy:
-- `places_sync_membership` rebuilds `place_membership` from `part_of` on every update of
-- that place, which is why §8 says "a membership row alone does nothing and undoes
-- itself. Write part_of." That has been correct advice and it is what 0178 fixed a bug by
-- following. It is also the wrong way round for where this is going (§0.3), because rows
-- can say things an array cannot: when a membership began, and eventually why.
--
-- THIS IS NOT THE COLUMN DROP. `create_experience` and `rebuild_place_visits` still read
-- `part_of`, the exports still dump it, and dropping it here would be the same mistake as
-- assuming is_trip was a one-line removal. So the array is kept CORRECT, maintained the
-- other way about, and removed in a later step once its readers move.
--
-- WHY THE OLD TRIGGER MUST GO FIRST. While `places_sync_membership` exists, any row this
-- migration inserts into `place_membership` is deleted again the next time that place's
-- part_of is written — silently. Two triggers pointing at each other would also loop.
-- 0188 hit exactly this with the participant sync triggers; the order below is the lesson.
--
-- ROLLBACK: restore `places_sync_membership` from 0155 and drop
-- `membership_sync_part_of`. No information is lost either way — the array and the rows
-- carry the same pairs, and the migration refuses to run unless they already agree.

-- ---------------------------------------------------------------------------
-- 0. The two sides agree today. If they do not, stop: one of them holds
--    something the other does not, and this migration would pick a winner.
-- ---------------------------------------------------------------------------
do $$
declare only_array int; only_rows int;
begin
  select count(*) into only_array
    from public.places p, unnest(coalesce(p.part_of, '{}'::uuid[])) as par
   where not exists (select 1 from public.place_membership m
                      where m.child_id = p.id and m.parent_id = par);

  select count(*) into only_rows
    from public.place_membership m
   where not exists (select 1 from public.places p
                      where p.id = m.child_id
                        and m.parent_id = any(coalesce(p.part_of, '{}'::uuid[])));

  if only_array > 0 or only_rows > 0 then
    raise exception
      '0192: % membership(s) only in part_of and % only in place_membership. They must '
      'agree before the record moves, or one side''s truth is thrown away.',
      only_array, only_rows;
  end if;
  raise notice '0192: part_of and place_membership agree exactly';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Stop the old direction BEFORE writing any rows.
-- ---------------------------------------------------------------------------
drop trigger if exists places_sync_membership on public.places;

-- ---------------------------------------------------------------------------
-- 2. The array now follows the rows.
--
-- Kept because `create_experience`, `rebuild_place_visits` and the exports still read it.
-- It is a mirror now, and it says so.
-- ---------------------------------------------------------------------------
create or replace function public.sync_part_of_from_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_child uuid;
begin
  v_child := coalesce(new.child_id, old.child_id);
  update public.places p
     set part_of = coalesce(
           (select array_agg(distinct m.parent_id order by m.parent_id)
              from public.place_membership m
             where m.child_id = v_child),
           '{}'::uuid[])
   where p.id = v_child;
  return null;
end $function$;

comment on function public.sync_part_of_from_membership() is
  'Rebuilds places.part_of from place_membership. The ROWS are the record since 0192; '
  'the array is kept only until create_experience, rebuild_place_visits and the exports '
  'stop reading it.';

-- SECURITY DEFINER plus the default PUBLIC execute grant means anon could call this
-- directly. It is a trigger body, not an API. The authz matrix (0154) caught exactly
-- that, which is why that test sweeps every function rather than a list.
revoke all on function public.sync_part_of_from_membership() from public;
revoke all on function public.sync_part_of_from_membership() from anon;
revoke all on function public.sync_part_of_from_membership() from authenticated;

create trigger membership_sync_part_of
  after insert or update or delete on public.place_membership
  for each row execute function public.sync_part_of_from_membership();

-- ---------------------------------------------------------------------------
-- 3. The two simple writers write rows.
-- ---------------------------------------------------------------------------
create or replace function public.add_to_container(p_child uuid, p_parent uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  if p_child = p_parent then return; end if;
  -- The ROW is the record now (0192); the trigger puts it in the array.
  insert into public.place_membership (child_id, parent_id)
  values (p_child, p_parent)
  on conflict do nothing;
end $function$;

create or replace function public.remove_from_container(p_child uuid, p_parent uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  delete from public.place_membership
   where child_id = p_child and parent_id = p_parent;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. add_place_to_visit. Patched rather than reproduced: it is long, and copying
--    it here to change one statement invites errors in the parts that are not
--    changing. The assertion below stops the migration if it has drifted.
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  old_txt constant text :=
    'update public.places
       set part_of = (select array_agg(distinct x)
                        from unnest(coalesce(part_of, ''{}''::uuid[]) || v_parent.id) x)
     where id = v_place.id';
  new_txt constant text :=
    'insert into public.place_membership (child_id, parent_id)
     select v_place.id, v_parent.id
      where v_parent.id <> v_place.id
     on conflict do nothing';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'add_place_to_visit';
  if src is null then raise exception '0192: add_place_to_visit not found'; end if;
  if position(old_txt in src) = 0 then
    raise exception '0192: add_place_to_visit does not contain the expected part_of write';
  end if;

  -- The statement it replaces carried a trailing `and v_parent.id <> all (...)` guard on
  -- the UPDATE. `on conflict do nothing` plus the self-check above says the same thing.
  src := replace(src, old_txt, new_txt);
  -- Remove the now-dangling tail of the old UPDATE, whatever remains of it, up to its ';'
  src := regexp_replace(
           src,
           'on conflict do nothing\s+and v_parent\.id <> all \([^;]*\);',
           'on conflict do nothing;',
           'n');
  execute src;
  raise notice '0192: add_place_to_visit writes a membership row';
end $$;

-- ---------------------------------------------------------------------------
-- 5. merge_places_auto repoints memberships instead of rewriting an array.
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  old_txt constant text :=
    'update public.places set part_of = (
    select array_agg(distinct e) from unnest(array_replace(part_of, p_loser, p_winner)) e
    where e is not null and e <> id
  ) where p_loser = any(part_of);';
  new_txt constant text :=
    '-- Anything inside the loser is now inside the winner, and the loser''s own
  -- memberships come with it. A place cannot contain itself.
  update public.place_membership set parent_id = p_winner
   where parent_id = p_loser and child_id <> p_winner;
  update public.place_membership set child_id = p_winner
   where child_id = p_loser and parent_id <> p_winner;
  delete from public.place_membership where child_id = p_loser or parent_id = p_loser;
  delete from public.place_membership where child_id = parent_id;';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'merge_places_auto';
  if position(old_txt in src) = 0 then
    raise exception '0192: merge_places_auto does not contain the expected part_of rewrite';
  end if;
  execute replace(src, old_txt, new_txt);
  raise notice '0192: merge_places_auto repoints membership rows';
end $$;


-- ---------------------------------------------------------------------------
-- 5b. create_experience. THE ONE THAT WOULD HAVE BROKEN QUIETLY.
--
-- The new-place card's "Part of a trail?" sends part_of in the place payload, and this
-- function writes that array straight into the INSERT. Under the old direction the
-- places trigger turned it into rows; with that trigger gone, the array would have been
-- written and NO MEMBERSHIP ROW CREATED — the card would have kept accepting the answer
-- and quietly dropped it. The 0129 test caught this, which is the whole reason that test
-- exists.
--
-- The INSERT keeps writing the array (it is the mirror, and it is the same data), and
-- the rows are written straight after, so both sides agree without the trigger firing.
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  old_txt constant text := '    returning id into v_place;
  end if;';
  new_txt constant text := '    returning id into v_place;

    -- THE ROWS ARE THE RECORD (0192). The array above is the mirror; without this the
    -- card''s "Part of a trail?" would be accepted and silently dropped.
    insert into public.place_membership (child_id, parent_id)
    select v_place, pid from unnest(v_partof) pid where pid <> v_place
    on conflict do nothing;
  end if;';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_experience';
  if position(old_txt in src) = 0 then
    raise exception '0192: create_experience does not end its place INSERT as expected';
  end if;
  execute replace(src, old_txt, new_txt);
  raise notice '0192: create_experience writes membership rows for part_of';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Bring the array in line once, through the new path, and check it held.
-- ---------------------------------------------------------------------------
update public.places p
   set part_of = coalesce(
         (select array_agg(distinct m.parent_id order by m.parent_id)
            from public.place_membership m where m.child_id = p.id),
         '{}'::uuid[])
 where p.part_of is distinct from coalesce(
         (select array_agg(distinct m.parent_id order by m.parent_id)
            from public.place_membership m where m.child_id = p.id),
         '{}'::uuid[]);

do $$
declare bad int;
begin
  select count(*) into bad
    from public.places p
   where coalesce(array_length(p.part_of, 1), 0)
         <> (select count(*) from public.place_membership m where m.child_id = p.id);
  if bad > 0 then
    raise exception '0192: % place(s) still disagree after the backfill', bad;
  end if;
  raise notice '0192: the array matches the rows on every place';
end $$;
