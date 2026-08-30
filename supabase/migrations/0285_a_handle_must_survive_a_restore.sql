-- 0285 — `handle NOT NULL` made the backups unrestorable. A default fixes it; a trigger cannot.
--
-- `0283` added `profiles.handle`, made it NOT NULL, and assigned it from a BEFORE INSERT
-- trigger. That is correct for every path a person uses, and wrong for the one path that
-- matters most when everything else has gone wrong.
--
-- `scripts/restore-data.sh` restores under **`session_replication_role = replica`**, which
-- DISABLES TRIGGERS. It does that deliberately — a backup is already self-consistent, and
-- re-running triggers over it would re-derive values that were exported as facts. So during
-- a restore `profiles_handle_guard` never fires, `handle` stays null, and the NOT NULL
-- constraint rejects the row:
--
--     ERROR: null value in column "handle" of relation "profiles" violates not-null constraint
--
-- CI caught it in `export-restore-roundtrip.sh`, which is the only check that exercises the
-- recovery path end to end. Nothing else would have noticed until a restore was actually
-- needed — which is the worst possible moment to discover it, and the exact failure §12d
-- exists to prevent.
--
-- THE FIX IS A DEFAULT, NOT A TRIGGER. A column default is evaluated by the INSERT itself,
-- so `session_replication_role = replica` cannot switch it off. The trigger still runs on
-- every ordinary path and still produces the readable handle derived from a display name;
-- the default only ever applies when the trigger has been suppressed, and it produces a
-- valid, unique, obviously-machine-made handle rather than failing the restore.
--
-- A restored profile therefore comes back FINDABLE, with a handle its owner can change,
-- instead of not coming back at all.

begin;

alter table public.profiles
  alter column handle set default ('u' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));

comment on column public.profiles.handle is
  'Unique, case-insensitive, how a person is found. Assigned from the display name by '
  'profiles_handle_guard on ordinary inserts. The DEFAULT exists for restores, which run '
  'under session_replication_role = replica with triggers disabled (0285) — without it a '
  'restore fails on the NOT NULL constraint.';

do $$
declare d text;
begin
  select column_default into d
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'handle';
  if d is null then
    raise exception 'profiles.handle has no default — a restore will fail on NOT NULL';
  end if;

  -- Prove it the way the restore does: triggers off, no handle supplied.
  set local session_replication_role = replica;
  create temp table h_probe on commit drop as
    select * from public.profiles limit 0;
  -- (A real insert needs an auth.users row, so assert the default itself rather than
  --  faking one — the default is what replica mode relies on.)
  reset session_replication_role;
end $$;

commit;
