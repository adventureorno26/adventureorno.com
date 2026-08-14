-- 0174 — nobody writes around the rules.
--
-- PART 1 — ANY SIGNED-IN USER COULD HAVE EMPTIED EVERY TABLE.
--
-- Supabase's default ACL grants `arwdDxtm` on every new table in `public` to BOTH
-- `anon` and `authenticated`. The `D` is TRUNCATE, and **TRUNCATE does not consult row
-- level security**. Every RLS policy in this database is written as a row predicate —
-- `is_member()`, `is_editor_or_owner()` — and every one of them is bypassed by a single
-- TRUNCATE. 45 tables were reachable that way, `visits` and `photos` among them.
--
-- Erica's first rule for this project is never to mass-delete. The database was one
-- statement away from doing it on behalf of anyone who could sign in.
--
-- `anon` is worse and simpler: it needed nothing. Every policy in `public` is gated on
-- membership, and the edge functions that use the publishable key always pass the
-- caller's Authorization header, so they act as `authenticated`, never as `anon`. It
-- held full privileges on all 45 tables purely because that is the default.
--
-- FIXED AT THE SOURCE, not table by table. The reason every migration since 0001 has
-- had to remember `revoke all ... from public, anon` is that the DEFAULT hands it out
-- again for each new table. One forgotten line silently publishes a table. So the
-- default itself changes: new tables arrive closed, and a migration that wants
-- `authenticated` to read must say so. Forgetting now fails loudly with "permission
-- denied" instead of quietly exposing data.
--
-- PART 2 — the visit mutations that had no RPC (§0.3, §0.6).
--
-- `edit_visit`, `set_visit_dates`, `set_visit_participants`, `attach_child_visit` and
-- the rest all went through guarded functions. Creating, deleting and restoring a visit
-- did not — the browser wrote the table directly. That is how a delete could silently
-- orphan five child visits: `parent_visit_id` is `on delete set null`, so deleting a
-- Cape Cod week freed everything grouped inside it with no error and no record.
--
--   create_visit   — validates, sets participants, honours an idempotency key
--   delete_visit   — REFUSES to orphan children unless explicitly told to detach them,
--                    and returns a complete snapshot so Undo can restore everything
--   restore_visit  — takes that snapshot back, including participants and grouping
--   attach_visit_evidence / detach_visit_evidence — the write half of 0166
--
-- ROLLBACK: re-grant with `grant all on all tables in schema public to anon,
-- authenticated` and restore the default privileges; drop the five functions and
-- `visits.client_key`. Note that rolling PART 1 back re-opens TRUNCATE.

begin;

-- ---------------------------------------------------------------------------
-- 1. Close what was never meant to be open
-- ---------------------------------------------------------------------------
revoke truncate on all tables in schema public from authenticated;
revoke all     on all tables in schema public from anon;

-- ...and stop handing it out again for every table created from here on.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate on tables from authenticated;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- 2. An idempotency handle for creating a visit (§0.3)
-- ---------------------------------------------------------------------------
alter table public.visits add column if not exists client_key text;

comment on column public.visits.client_key is
  'Stable per-attempt identity from the client. A retried save after a dropped '
  'connection returns the SAME visit instead of logging a second one (§0.3).';

create unique index if not exists visits_client_key_idx
  on public.visits(client_key) where client_key is not null;

-- ---------------------------------------------------------------------------
-- 3. Create
-- ---------------------------------------------------------------------------
create or replace function public.create_visit(
  p_place      uuid,
  p_start      date,
  p_end        date default null,
  p_note       text default null,
  p_profiles   uuid[] default null,
  p_trip       boolean default false,
  p_parent     uuid default null,
  p_client_key text default null
) returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_profiles is not null then
    perform public.set_visit_participants(v_row.id, p_profiles);
  end if;

  if p_parent is not null then
    perform public.attach_child_visit(v_row.id, p_parent);
    select * into v_row from public.visits where id = v_row.id;
  end if;

  return v_row;
end $function$;

comment on function public.create_visit(uuid, date, date, text, uuid[], boolean, uuid, text) is
  'Log a visit (§0.3). Validates the range, sets participants explicitly, groups it '
  'under a trip if asked, and is idempotent on client_key so a retried save cannot '
  'produce a duplicate.';

-- ---------------------------------------------------------------------------
-- 4. Delete — and never silently orphan what was inside it
-- ---------------------------------------------------------------------------
create or replace function public.delete_visit(
  p_visit    uuid,
  p_children text default 'refuse'   -- 'refuse' | 'detach'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visits; v_kids uuid[]; v_snapshot jsonb;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_children not in ('refuse','detach') then
    raise exception 'p_children must be refuse or detach';
  end if;

  select * into v_row from public.visits where id = p_visit for update;
  if v_row.id is null then raise exception 'no such visit'; end if;

  select coalesce(array_agg(id), '{}') into v_kids
    from public.visits where parent_visit_id = p_visit;

  -- `parent_visit_id` is ON DELETE SET NULL, so without this the visits grouped inside
  -- a trip would quietly come loose and nothing would say so.
  if array_length(v_kids, 1) > 0 and p_children = 'refuse' then
    raise exception 'this trip still contains % visit(s) — detach them first, or say so explicitly',
      array_length(v_kids, 1);
  end if;

  -- Everything needed to put it back, captured before the row goes.
  v_snapshot := jsonb_build_object(
    'visit', to_jsonb(v_row) - 'geom',
    'profiles', coalesce((select jsonb_agg(vp.profile_id)
                            from public.visit_profiles vp where vp.visit_id = p_visit), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(vpe.person_id)
                          from public.visit_people vpe where vpe.visit_id = p_visit), '[]'::jsonb),
    'children', to_jsonb(v_kids),
    'evidence', coalesce((select jsonb_agg(to_jsonb(e))
                            from public.visit_evidence e where e.visit_id = p_visit), '[]'::jsonb));

  if array_length(v_kids, 1) > 0 then
    perform public.detach_child_visit(k) from unnest(v_kids) k;
  end if;

  delete from public.visits where id = p_visit;
  return v_snapshot;
end $function$;

comment on function public.delete_visit(uuid, text) is
  'Delete a visit and return everything needed to undo it. Refuses by default when the '
  'visit still contains others, because the foreign key would silently set their '
  'parent to NULL and nothing would record that it happened.';

-- ---------------------------------------------------------------------------
-- 5. Restore — Undo puts back what was actually there
-- ---------------------------------------------------------------------------
create or replace function public.restore_visit(p_snapshot jsonb)
returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_in    public.visits;
  v_row   public.visits;
  v_profs uuid[];
  v_kids  uuid[];
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_snapshot is null or p_snapshot->'visit' is null then
    raise exception 'restore_visit needs the snapshot delete_visit returned';
  end if;

  v_in := jsonb_populate_record(null::public.visits, p_snapshot->'visit');
  if v_in.place_id is null then raise exception 'the snapshot has no place'; end if;

  -- Reuse the original id when it is still free, so anything that kept a reference
  -- (a photo, an activity, a link someone copied) points at the restored visit.
  if exists (select 1 from public.visits where id = v_in.id) then
    v_in.id := gen_random_uuid();
  end if;

  insert into public.visits (id, place_id, start_date, end_date, note, status, manual,
                             trip_marked, solo_profile, solo_override, source, client_key)
  values (v_in.id, v_in.place_id, v_in.start_date, v_in.end_date, v_in.note,
          coalesce(v_in.status,'taken'), true, coalesce(v_in.trip_marked,false),
          v_in.solo_profile, v_in.solo_override, v_in.source, null)
  returning * into v_row;

  select coalesce(array_agg((x)::uuid), '{}') into v_profs
    from jsonb_array_elements_text(coalesce(p_snapshot->'profiles','[]'::jsonb)) x;
  if array_length(v_profs,1) > 0 then
    perform public.set_visit_participants(v_row.id, v_profs);
  end if;

  insert into public.visit_people (visit_id, person_id)
  select v_row.id, (x)::uuid
    from jsonb_array_elements_text(coalesce(p_snapshot->'people','[]'::jsonb)) x
  on conflict do nothing;

  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  select v_row.id, e->>'evidence_type', (e->>'evidence_id')::uuid,
         (e->>'evidence_date')::date, e->>'source_key'
    from jsonb_array_elements(coalesce(p_snapshot->'evidence','[]'::jsonb)) e
  on conflict do nothing;

  -- Put back what was inside it, and its own place in a larger trip.
  select coalesce(array_agg((x)::uuid), '{}') into v_kids
    from jsonb_array_elements_text(coalesce(p_snapshot->'children','[]'::jsonb)) x;
  if array_length(v_kids,1) > 0 and public.counts_as_trip(v_row.*) then
    perform public.attach_child_visit(k, v_row.id)
       from unnest(v_kids) k
      where exists (select 1 from public.visits where id = k);
  end if;

  if v_in.parent_visit_id is not null
     and exists (select 1 from public.visits where id = v_in.parent_visit_id) then
    perform public.attach_child_visit(v_row.id, v_in.parent_visit_id);
    select * into v_row from public.visits where id = v_row.id;
  end if;

  return v_row;
end $function$;

comment on function public.restore_visit(jsonb) is
  'Undo a delete_visit from its snapshot: dates, note, attribution, participants, '
  'companions, evidence, what it contained and what contained it. The old id is reused '
  'when free so existing references still resolve.';

-- ---------------------------------------------------------------------------
-- 6. Evidence gets a write path (0166 created the table read-only)
-- ---------------------------------------------------------------------------
create or replace function public.attach_visit_evidence(
  p_visit      uuid,
  p_type       text,
  p_evidence   uuid,
  p_date       date default null,
  p_source_key text default null
) returns public.visit_evidence
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visit_evidence;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_type not in ('photo','activity','location_ping','entry') then
    raise exception 'unknown evidence type %', p_type;
  end if;
  if not exists (select 1 from public.visits where id = p_visit) then
    raise exception 'no such visit';
  end if;

  -- The same import retried attaches the same evidence, not a second copy (§0.3).
  if p_source_key is not null then
    select * into v_row from public.visit_evidence
     where evidence_type = p_type and source_key = p_source_key;
    if v_row.visit_id is not null then return v_row; end if;
  end if;

  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  values (p_visit, p_type, p_evidence, p_date, p_source_key)
  on conflict (visit_id, evidence_type, evidence_id) do update
    set evidence_date = coalesce(excluded.evidence_date, public.visit_evidence.evidence_date)
  returning * into v_row;

  return v_row;
end $function$;

create or replace function public.detach_visit_evidence(
  p_visit uuid, p_type text, p_evidence uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Deleting evidence never deletes the visit: an accepted decision outlives its
  -- reason (§0.9, 0166).
  delete from public.visit_evidence
   where visit_id = p_visit and evidence_type = p_type and evidence_id = p_evidence;
end $function$;

-- ---------------------------------------------------------------------------
-- 7. Grants — explicit now that nothing is implied
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'create_visit(uuid,date,date,text,uuid[],boolean,uuid,text)',
    'delete_visit(uuid,text)',
    'restore_visit(jsonb)',
    'attach_visit_evidence(uuid,text,uuid,date,text)',
    'detach_visit_evidence(uuid,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
