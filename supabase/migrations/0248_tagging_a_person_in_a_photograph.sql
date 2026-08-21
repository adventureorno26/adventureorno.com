-- 0248 — tagging a person in a photograph, which has never been possible.
--
-- The write door for 0247's model, and the last unbuilt piece of §3e Step 6: *"extend tagging
-- to visits, photos and places"*. Visits and places were done in 0240–0246. Photos never had
-- participants of any kind — 178 of them, and no way to say who is in one.
--
-- THE RULES, and each of them is one already settled today rather than a new invention:
--
--   YOURSELF          accepted, confirmed_by_person. Your own presence is yours to state
--                     (0236) and you are the person who would be asked.
--   SOMEBODY WITH AN
--   ACCOUNT           proposed. One person's word about another is a question (0240), and
--                     they answer it.
--   SOMEBODY WITHOUT  accepted, but verification stays `unverified` — FOREVER, and that is
--                     the honest state rather than a gap. There is nobody to ask, so the
--                     record says exactly what is known: the owner says so, nobody has
--                     confirmed it. It must never quietly read as confirmed.
--   REMOVING          retracts. Nothing is deleted wholesale, the same as everywhere else.
--
-- AND THE ONE §8b-i CALLS OUT BY NAME: **photo presence is not promoted to outing
-- participation.** Being in a photograph taken during a run does not put the run on your
-- statistics, and nothing here derives one from the other. A photo subject and an outing
-- subject are separate rows about separate claims; if that ever changes it will be because
-- somebody decided it, not because a join was convenient.
--
-- THE HOUSEHOLD BECOMES REPRESENTABLE. §8b-i: "there is no privileged Partner data type…
-- query, participation and statistics contracts are identical for every person." So a member
-- is reached the same way as anybody else — through a `people` row. The seed below gives each
-- real member a contact for themselves and for each other member, which is not inventing data:
-- it is writing down the household that already exists in `profiles`, in the shape everything
-- new reads. Without it the photo picker opens empty on a two-person app.

-- ---------------------------------------------------------------------------
-- First, a default 0247 set that the column would not accept.
-- ---------------------------------------------------------------------------
-- 0247 changed `people.kind`'s DEFAULT to 'person' and did not look at the CHECK beside it,
-- which permits child | adult | pet | other. Nothing broke, because nothing has inserted a
-- person since — the first row this migration writes was also the first to find out. Caught
-- by the apply, before the ledger row, so 0247 is on production with a default that no insert
-- could have used.
--
-- The vocabulary itself is worth keeping: child, adult and pet are things somebody might want
-- to say about who was there. What was missing is the value for having said nothing, which is
-- what a default is. 'person' becomes legal and stays the default; nothing else changes.
alter table public.people drop constraint if exists people_kind_valid;
alter table public.people add constraint people_kind_valid
  check (kind = any (array['person','child','adult','pet','other']));

-- ---------------------------------------------------------------------------
-- The household, in the shape the new model reads.
-- ---------------------------------------------------------------------------
insert into public.people (display_name, kind, owner_profile, linked_profile, favourite, created_by)
select coalesce(nullif(btrim(q.display_name), ''), 'Someone'),
       'person', p.id, q.id, true, p.id
  from public.profiles p
  join public.profiles q on true
 where p.role in ('owner','editor') and coalesce(p.display_name,'') !~* '(test|bot)'
   and q.role in ('owner','editor') and coalesce(q.display_name,'') !~* '(test|bot)'
   and not exists (select 1 from public.people e
                    where e.owner_profile = p.id and e.linked_profile = q.id
                      and e.deleted_at is null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Your people.
-- ---------------------------------------------------------------------------
create or replace function public.my_people()
returns table (id uuid, display_name text, linked_profile uuid, favourite boolean, is_me boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select pe.id, pe.display_name, pe.linked_profile, pe.favourite,
         pe.linked_profile is not distinct from auth.uid()
    from public.people pe
   where pe.owner_profile = auth.uid()
     and pe.deleted_at is null
   order by (pe.linked_profile is not distinct from auth.uid()) desc,
            pe.favourite desc, lower(pe.display_name);
$function$;

comment on function public.my_people is
  'The people you can tag: your own contacts, you first, then favourites. A contact needs no '
  'account — that is the whole point of 0247.';

create or replace function public.add_contact(
  p_display_name text, p_linked_profile uuid default null, p_favourite boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'a person needs a name'; end if;
  if p_linked_profile is not null
     and not exists (select 1 from public.profiles where id = p_linked_profile) then
    raise exception 'no such account';
  end if;

  -- Naming somebody you have already recorded returns the person you already have, rather
  -- than a second row that splits their memories in half.
  if p_linked_profile is not null then
    select id into v_id from public.people
     where owner_profile = auth.uid() and linked_profile = p_linked_profile
       and deleted_at is null limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.people (display_name, kind, owner_profile, linked_profile, favourite, created_by)
  values (v_name, 'person', auth.uid(), p_linked_profile, coalesce(p_favourite, false), auth.uid())
  returning id into v_id;
  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- Registering a photo, and saying who is in it.
-- ---------------------------------------------------------------------------
create or replace function public.photo_subject(p_photo uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select id into v_id from public.memory_subjects where photo_id = p_photo;
  if v_id is not null then return v_id; end if;
  if not exists (select 1 from public.photos where id = p_photo and deleted_at is null) then
    raise exception 'no such photo';
  end if;
  insert into public.memory_subjects (kind, owner_profile, photo_id)
  values ('photo', auth.uid(), p_photo)
  on conflict (photo_id) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.memory_subjects where photo_id = p_photo; end if;
  return v_id;
end $function$;

create or replace function public.tag_person_on_photo(p_photo uuid, p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subject uuid;
  v_linked  uuid;
  v_status  text;
  v_verif   text;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select linked_profile into v_linked from public.people
   where id = p_person and owner_profile = auth.uid() and deleted_at is null;
  if not found then raise exception 'that is not one of your people'; end if;

  v_subject := public.photo_subject(p_photo);

  if v_linked is not distinct from auth.uid() then
    -- YOURSELF. Yours to state, and you are the person who would be asked.
    v_status := 'accepted'; v_verif := 'confirmed_by_person';
  elsif v_linked is null then
    -- SOMEBODY WITHOUT AN ACCOUNT. There is nobody to ask, so it is the owner's statement
    -- and it says so: accepted, and unverified — which is the truth, not a gap.
    v_status := 'accepted'; v_verif := 'unverified';
  else
    -- SOMEBODY WHO CAN ANSWER. One person's word about another is a question.
    v_status := 'proposed'; v_verif := 'unverified';
  end if;

  insert into public.memory_people
    (subject_id, person_id, tagged_by, participation_status, verification_status,
     decided_by, decided_at)
  values (v_subject, p_person, auth.uid(), v_status, v_verif,
          case when v_verif = 'confirmed_by_person' then auth.uid() end,
          case when v_verif = 'confirmed_by_person' then now() end)
  on conflict (subject_id, person_id) do update
    -- Re-tagging reopens a tag that was RETRACTED and leaves a DECLINED one alone: "I am not
    -- in that photograph" is answered once (0241).
    set participation_status = v_status, tagged_by = auth.uid()
  where public.memory_people.participation_status = 'retracted';

  return jsonb_build_object('subject', v_subject, 'participation', v_status,
                            'verification', v_verif, 'asked', v_status = 'proposed');
end $function$;

create or replace function public.untag_person_on_photo(p_photo uuid, p_person uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.memory_people mp
     set participation_status = 'retracted', decided_by = auth.uid(), decided_at = now()
    from public.memory_subjects s
   where s.id = mp.subject_id
     and s.photo_id = p_photo
     and s.owner_profile = auth.uid()
     and mp.person_id = p_person
     and mp.participation_status in ('proposed','accepted');
end $function$;

create or replace function public.photo_people(p_photo uuid)
returns table (person_id uuid, display_name text, participation_status text,
               verification_status text, linked_profile uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select pe.id, pe.display_name, mp.participation_status, mp.verification_status, pe.linked_profile
    from public.memory_subjects s
    join public.memory_people mp on mp.subject_id = s.id
    join public.people pe on pe.id = mp.person_id
   where s.photo_id = p_photo
     and public.can_see_memory_subject(s.id)
     and mp.participation_status in ('proposed','accepted')
   order by lower(pe.display_name);
$function$;

-- ---------------------------------------------------------------------------
-- Answering.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_memory_tag(p_subject uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_person uuid;
begin
  -- ONLY THE PERSON NAMED. The tag is about them; the owner already said their piece by
  -- making it.
  select mp.person_id into v_person
    from public.memory_people mp
    join public.people pe on pe.id = mp.person_id
   where mp.subject_id = p_subject
     and pe.linked_profile = auth.uid()
     and mp.participation_status = 'proposed';
  if v_person is null then raise exception 'no tag of yours to answer here'; end if;

  update public.memory_people
     set participation_status = case when p_accept then 'accepted' else 'declined' end,
         verification_status  = case when p_accept then 'confirmed_by_person'
                                     else verification_status end,
         decided_by = auth.uid(), decided_at = now()
   where subject_id = p_subject and person_id = v_person;
end $function$;

create or replace function public.my_memory_tags_to_confirm()
returns table (subject_id uuid, kind text, photo_id uuid, tagged_by text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.kind, s.photo_id, who.display_name, mp.created_at
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id
    join public.people pe on pe.id = mp.person_id
    left join public.profiles who on who.id = mp.tagged_by
   where pe.linked_profile = auth.uid()
     and mp.participation_status = 'proposed'
   order by mp.created_at desc;
$function$;

revoke all on function public.my_people() from public, anon;
revoke all on function public.add_contact(text, uuid, boolean) from public, anon;
revoke all on function public.photo_subject(uuid) from public, anon;
revoke all on function public.tag_person_on_photo(uuid, uuid) from public, anon;
revoke all on function public.untag_person_on_photo(uuid, uuid) from public, anon;
revoke all on function public.photo_people(uuid) from public, anon;
revoke all on function public.respond_to_memory_tag(uuid, boolean) from public, anon;
revoke all on function public.my_memory_tags_to_confirm() from public, anon;
grant execute on function public.my_people() to authenticated;
grant execute on function public.add_contact(text, uuid, boolean) to authenticated;
grant execute on function public.photo_subject(uuid) to authenticated;
grant execute on function public.tag_person_on_photo(uuid, uuid) to authenticated;
grant execute on function public.untag_person_on_photo(uuid, uuid) to authenticated;
grant execute on function public.photo_people(uuid) to authenticated;
grant execute on function public.respond_to_memory_tag(uuid, boolean) to authenticated;
grant execute on function public.my_memory_tags_to_confirm() to authenticated;
