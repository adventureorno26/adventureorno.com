-- 0277 — `purge_trash()` deletes the row and orphans the R2 object forever.
--
-- THE GAP, found by reconciling R2 against the database rather than by reading either:
--
--   * a deleted photo is SOFT-deleted first — `deleted_at` set, row and objects intact;
--   * `purge_trash()` (nightly, 04:30) hard-deletes any `photos` row 30 days into trash;
--   * **nothing deletes its R2 objects.** SQL cannot reach R2, `purge_trash` is SQL, and
--     the Worker's `/reconcile` endpoint is explicitly `dry_run: true` — it counts orphans
--     and deletes nothing, by design and by its own comment.
--
-- So the moment a photo is purged, its `photos/<id>.jpg` and `thumbs/<id>.jpg` become
-- objects no row references and no code will ever remove. Today R2 and the database agree
-- exactly — 179 live rows, 358 referenced keys, **0 orphans, 0 missing** — because nothing
-- has been purged yet. One photo is 22 days into trash. In 8 days it becomes the first.
--
-- Business rule #6 says deletion "removes the R2 objects and DB row". Through the Worker's
-- `/delete` that is true. Through the trash-then-purge path it is not, and the difference
-- has never been visible because the second half of that path has not fired yet.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- It does NOT delete anything from R2, and it does not schedule anything that will.
-- Automatically and irreversibly destroying the bytes of Erica's photos is not a change to
-- make on an agent's judgement — §11 calls this data "irreplaceable and private", and a bug
-- in an automatic purger is unrecoverable in a way a bug in a report is not.
--
-- Instead it makes the leak **recorded instead of silent**: `purge_trash()` now writes every
-- R2 key it is about to orphan into `purged_media` before deleting the row. Nothing is lost,
-- nothing is deleted, and "which objects should not be there" becomes a query rather than an
-- archaeology exercise against a bucket. Draining it — by hand, or by a job that has been
-- agreed — is then a decision with a list attached.

begin;

create table if not exists public.purged_media (
  id            uuid primary key default gen_random_uuid(),
  media_key     text not null,
  photo_id      uuid,
  sha256        text,
  purged_at     timestamptz not null default now(),
  -- Set by whoever removes the object. Null means "still in R2, still owed a deletion".
  deleted_from_r2_at timestamptz,
  unique (media_key)
);

comment on table public.purged_media is
  'R2 keys orphaned by purge_trash(). The row is gone; the object is not. Nothing here is '
  'deleted automatically — see 0277. deleted_from_r2_at is stamped by whoever removes it.';

-- Deny-all: RLS on, no policy. Operator data, reachable by the service role only. This is
-- the same intended shape as the three existing `rls_enabled_no_policy` INFO advisors in
-- §6c, and it adds a fourth on purpose.
alter table public.purged_media enable row level security;
revoke all on table public.purged_media from public, anon, authenticated;

create index if not exists purged_media_outstanding_idx
  on public.purged_media (purged_at) where deleted_from_r2_at is null;

create or replace function public.purge_trash()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.deleted_hashes (sha256, deleted_at)
    select sha256, now() from public.photos
    where deleted_at is not null and deleted_at < now() - interval '30 days' and sha256 is not null
      and not exists (select 1 from public.deleted_hashes d where d.sha256 = photos.sha256);

  -- NEW (0277): record what is about to be orphaned, BEFORE the row that names it goes.
  -- After the delete there is nothing left that knows these keys existed.
  insert into public.purged_media (media_key, photo_id, sha256)
    select k.key, p.id, p.sha256
      from public.photos p
      cross join lateral (values (p.r2_key), (p.thumb_key)) as k(key)
     where p.deleted_at is not null
       and p.deleted_at < now() - interval '30 days'
       and k.key is not null
    on conflict (media_key) do nothing;

  delete from public.photos where deleted_at is not null and deleted_at < now() - interval '30 days';
  delete from public.places where deleted_at is not null and deleted_at < now() - interval '30 days';
end $function$;

-- 0274's lesson, applied without being told twice: CREATE OR REPLACE keeps the existing
-- grants, but assert the definer function is still not anon-callable rather than assume it.
do $$
declare n int;
begin
  if has_function_privilege('anon', 'public.purge_trash()', 'EXECUTE') then
    raise exception 'anon can execute purge_trash()';
  end if;

  if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                  where ns.nspname='public' and c.relname='purged_media' and c.relrowsecurity) then
    raise exception 'purged_media does not have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.purged_media', 'SELECT')
     or has_table_privilege('authenticated', 'public.purged_media', 'SELECT') then
    raise exception 'purged_media is readable by anon or authenticated';
  end if;

  -- The function must still name both key columns, or this migration recorded nothing.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='purge_trash'
     and pg_get_functiondef(p.oid) like '%purged_media%'
     and pg_get_functiondef(p.oid) like '%r2_key%'
     and pg_get_functiondef(p.oid) like '%thumb_key%';
  if n <> 1 then raise exception 'purge_trash does not record both media keys'; end if;
end $$;

commit;
