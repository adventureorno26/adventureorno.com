-- 0130 — Stop naming places automatically. You name them; you own the name.
--
-- Erica: "turn the nightly geocoder thing off ... The nightly backup should still run
-- but stop the automation process for places until we have fixed the process. In fact,
-- I would prefer being given a suggested place name when I add photos, and choosing
-- either the suggestion or a name of my own creation. Once chosen, a name should only
-- be manually changed by the user who added it in their own space, and in the shared
-- space of both it should be either of us."
--
-- PART 1 — THE AUTOMATION IS OFF
--   Two scheduled jobs named places without anyone asking:
--     geocode-new-places-nightly   '50 * * * *'  -- HOURLY, despite the name
--     merge-nearby-dupes           '30 4 * * *'
--   Both are unscheduled here. That is the whole reason names kept reverting and the
--   same corrections had to be made repeatedly: a person fixed a name, and within the
--   hour the geocoder or the dupe-merger overwrote it.
--
--   NOTHING ELSE IS TOUCHED. The remaining jobs stay exactly as they are:
--     dedupe-joint-outings, purge-trash, rebuild-revealed-area.
--   The nightly BACKUP is not a pg_cron job at all (it writes to
--   onedrive:AdventureOrNo-Backups), so it is untouched by this migration and keeps
--   running. Nothing here deletes any data.
--
--   Naming moves to the moment of adding: the client reverse-geocodes and OFFERS a
--   name, and a person accepts it or types their own. `reverseGeocode` already exists
--   in app/src/lib/maptiler.ts, so the suggestion needs no server job.
--
-- PART 2 — A NAME BELONGS TO WHOEVER GAVE IT, IN THE SPACE THEY GAVE IT
--   0129 added name_locked, which stops AUTOMATION. This adds who and where:
--     named_by   — the profile that chose the name
--     name_scope — the space it was named in: a profile id for a personal space,
--                  NULL for the shared "Both" space
--   The rule, exactly as stated:
--     * named in a PERSONAL space  -> only that person may rename it
--     * named in the SHARED space  -> either of us may rename it
--   NULL scope meaning "shared" matches the rest of the schema, where a visit with
--   solo_profile IS NULL is a Both visit. Automation is not a person and is blocked
--   in every space by name_locked.

-- ------------------------------------------------------- part 1: automation is off
select cron.unschedule('geocode-new-places-nightly')
 where exists (select 1 from cron.job where jobname = 'geocode-new-places-nightly');

select cron.unschedule('merge-nearby-dupes')
 where exists (select 1 from cron.job where jobname = 'merge-nearby-dupes');

-- merge_nearby_dupes stays callable BY HAND (Manage data) — it is only the unattended
-- schedule that was doing damage.

-- ------------------------------------------------------------ part 2: name ownership
alter table public.places
  add column if not exists named_by uuid references public.profiles(id) on delete set null,
  add column if not exists name_scope uuid references public.profiles(id) on delete set null;

comment on column public.places.named_by is
  'The profile that chose this name.';
comment on column public.places.name_scope is
  'The space the name was given in: a profile id = that person''s own space (only they may rename); NULL = the shared Both space (either member may rename).';

-- Who may rename a place, given the caller and the space the name lives in.
create or replace function public.can_rename_place(p_place uuid, p_caller uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
           -- never named by a person yet, so it is anyone's to name
           when not coalesce(p.name_locked, false) then true
           -- named in the shared space -> either of us
           when p.name_scope is null then true
           -- named in someone's own space -> only them
           else p.name_scope = p_caller
         end
    from public.places p
   where p.id = p_place;
$function$;

create or replace function public.set_place_name(
  p_place uuid,
  p_name  text,
  p_scope uuid default null      -- the space the caller is naming in; NULL = Both
)
returns public.places
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.places;
  v_me  uuid := auth.uid();
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a place needs a name';
  end if;

  -- You cannot rename a place someone named in their own space.
  if not public.can_rename_place(p_place, v_me) then
    raise exception 'this place was named in another person''s space; only they can rename it'
      using errcode = '42501';
  end if;

  -- A personal scope may only ever be your own — you cannot name INTO someone
  -- else's space and lock them out of their own place.
  if p_scope is not null and p_scope <> v_me then
    raise exception 'you can only name a place in your own space or the shared one'
      using errcode = '42501';
  end if;

  update public.places
     set name = btrim(p_name),
         name_locked = true,       -- automation must never touch it again
         named_by = v_me,
         name_scope = p_scope,
         auto = false,
         needs_geocode = false     -- and the geocoder must not re-derive it
   where id = p_place
  returning * into v_row;

  if v_row.id is null then raise exception 'place % not found', p_place; end if;
  return v_row;
end $function$;

-- Remove the 2-argument version from 0129 so there is no ambiguous overload and no
-- path that sets a name without recording who owns it.
drop function if exists public.set_place_name(uuid, text);

revoke all on function public.set_place_name(uuid, text, uuid) from public;
revoke all on function public.set_place_name(uuid, text, uuid) from anon;
grant execute on function public.set_place_name(uuid, text, uuid) to authenticated;
grant execute on function public.set_place_name(uuid, text, uuid) to service_role;

revoke all on function public.can_rename_place(uuid, uuid) from public;
revoke all on function public.can_rename_place(uuid, uuid) from anon;
grant execute on function public.can_rename_place(uuid, uuid) to authenticated;
grant execute on function public.can_rename_place(uuid, uuid) to service_role;

-- Existing human-named places are shared: both of you have been curating them
-- together, so neither gets locked out of a name that predates this rule.
update public.places
   set name_scope = null
 where name_locked and name_scope is null;

-- Nothing still queued for the geocoder, since it no longer runs.
update public.places set needs_geocode = false where needs_geocode;
