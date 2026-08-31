-- 0288 — a code lets in ONE person, and says which of the four "no"s it is saying.
--
-- LOCAL disposable stack only (scripts/db-test.sh). Runs the RPCs under
-- `set local role authenticated` with fictional JWTs, so it exercises the REAL grants
-- and the REAL policies rather than superuser, which bypasses both.
--
-- NO "EXPECTED EXACTLY N" ASSERTIONS. This replays from an EMPTY schema where every
-- production count is zero. Everything below is a relation between two answers, a
-- property of one row we created in this transaction, or a "did this refuse".
--
-- Values travel between blocks in transaction-local GUCs rather than a temp table: the
-- blocks run as `authenticated`, which has no rights on a temp table postgres created,
-- and granting them would be more machinery than the test is worth.
--
-- What is pinned here, and why each one is worth a test:
--
--   1. A code is single-use. The second person to try it is refused. This is the
--      product promise; if it ever stops holding, one forwarded text message becomes
--      an unbounded number of accounts.
--   2. FOUR DISTINCT REFUSALS. unknown / expired / revoked / already-used need four
--      different actions from the person holding the code, so they must not collapse
--      into one sentence. Asserted PAIRWISE DISTINCT rather than by exact text: the
--      wording is UI copy and will be edited, the distinctness is the rule.
--   3. The conditional `update ... where redeemed_at is null` behind the row lock
--      really is a second gate — after a redemption it matches nothing. That is the
--      half of the race defence that survives a raised isolation level, where the
--      loser aborts instead of re-reading; the `for update` half needs two live
--      sessions and is proved outside this file (see the PR).
--   4. Redeeming again, by somebody who is already a member, is a NO-OP that does not
--      burn a second code. This is the refresh-the-page path and it must be free.
--   5. A code is a secret: another member cannot read it. The owner can.
--   6. A row inserts with triggers disabled — the 0285 restore path.

begin;

-- ---------------------------------------------------------------------------
-- Cast. A and B are ordinary members; C is the owner; N1 and N2 are two people
-- with a Google session and no account, which is the state this whole feature is
-- about.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0287000-0000-0000-0000-000000000001','a0287@example.invalid'),
  ('a0287000-0000-0000-0000-000000000002','b0287@example.invalid'),
  ('a0287000-0000-0000-0000-000000000003','c0287@example.invalid'),
  ('a0287000-0000-0000-0000-00000000000a','n1.0287@example.invalid'),
  ('a0287000-0000-0000-0000-00000000000b','n2.0287@example.invalid')
on conflict do nothing;

insert into public.profiles (id, role, display_name) values
  ('a0287000-0000-0000-0000-000000000001','editor','A0287'),
  ('a0287000-0000-0000-0000-000000000002','editor','B0287'),
  ('a0287000-0000-0000-0000-000000000003','owner','C0287')
on conflict (id) do update set role = excluded.role;

-- ---------------------------------------------------------------------------
-- A issues three codes: one to be used, one to be revoked, one to be expired.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0287000-0000-0000-0000-000000000001","role":"authenticated","email":"a0287@example.invalid"}';

do $$
declare c public.invite_codes; n int;
begin
  c := public.create_invite_code('For N1', 14, 'viewer');
  perform set_config('t0287.good', c.code, true);
  c := public.create_invite_code('To be revoked', 14, 'viewer');
  perform set_config('t0287.revoked', c.code, true);
  c := public.create_invite_code('To be expired', 14, 'editor');
  perform set_config('t0287.expired', c.code, true);

  -- The issuer's own list shows all three, and calls them live. A relation, not a
  -- fixture count: the three we just made, and nothing about anyone else's.
  select count(*) into n from public.list_my_invite_codes()
   where code in (current_setting('t0287.good'), current_setting('t0287.revoked'),
                  current_setting('t0287.expired'))
     and status = 'live';
  if n <> 3 then
    raise exception 'FAIL: A issued 3 codes but list_my_invite_codes calls % of them live', n;
  end if;

  -- Revoke one, and watch it change its mind about being live.
  perform public.revoke_invite_code(id) from public.invite_codes
   where code = current_setting('t0287.revoked');
  select count(*) into n from public.list_my_invite_codes()
   where code = current_setting('t0287.revoked') and status = 'revoked';
  if n <> 1 then
    raise exception 'FAIL: a revoked code did not report itself revoked';
  end if;

  raise notice 'PASS: an issuer can make codes, list them and take one back';
end $$;
reset role;

-- Age one of them out. Done as superuser on purpose: there is deliberately no UPDATE
-- policy on this table, so nothing in the app can do this — only the clock can.
update public.invite_codes
   set expires_at = now() - interval '1 day'
 where code = current_setting('t0287.expired');

-- ---------------------------------------------------------------------------
-- A code is a secret. B is a member and still cannot read A's codes; C, the owner,
-- can. (`invite_codes_select_own` is the only policy that grants a read.)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0287000-0000-0000-0000-000000000002","role":"authenticated","email":"b0287@example.invalid"}';
do $$
declare n int;
begin
  select count(*) into n from public.invite_codes
   where code in (current_setting('t0287.good'), current_setting('t0287.revoked'),
                  current_setting('t0287.expired'));
  if n <> 0 then
    raise exception 'FAIL: a member could read % of another member''s codes', n;
  end if;
  -- And listing is scoped to the caller, so B sees none of A's either.
  select count(*) into n from public.list_my_invite_codes()
   where code in (current_setting('t0287.good'), current_setting('t0287.revoked'),
                  current_setting('t0287.expired'));
  if n <> 0 then
    raise exception 'FAIL: list_my_invite_codes leaked % of another member''s codes', n;
  end if;
  raise notice 'PASS: one member cannot read another member''s invite codes';
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0287000-0000-0000-0000-000000000003","role":"authenticated","email":"c0287@example.invalid"}';
do $$
declare n int;
begin
  select count(*) into n from public.invite_codes
   where code in (current_setting('t0287.good'), current_setting('t0287.revoked'),
                  current_setting('t0287.expired'));
  if n <> 3 then
    raise exception 'FAIL: the owner should see all three codes, saw %', n;
  end if;
  raise notice 'PASS: the owner can see the codes that have been issued';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- THE FOUR REFUSALS, collected as N1 — who has a session and no account.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0287000-0000-0000-0000-00000000000a","role":"authenticated","email":"n1.0287@example.invalid"}';

do $$
begin
  -- (i) unknown
  begin
    perform public.redeem_invite_code('ZZZZZZZZZZ');
    raise exception 'FAIL: an invented code was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    perform set_config('t0287.msg_unknown', sqlerrm, true);
  end;

  -- (ii) revoked
  begin
    perform public.redeem_invite_code(current_setting('t0287.revoked'));
    raise exception 'FAIL: a revoked code was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    perform set_config('t0287.msg_revoked', sqlerrm, true);
  end;

  -- (iii) expired
  begin
    perform public.redeem_invite_code(current_setting('t0287.expired'));
    raise exception 'FAIL: an expired code was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    perform set_config('t0287.msg_expired', sqlerrm, true);
  end;

  -- None of the three refusals may have created an account, and none of them may have
  -- burned the code they refused.
  if exists (select 1 from public.profiles where id = 'a0287000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: a refused code still made an account';
  end if;

  raise notice 'PASS: unknown, revoked and expired codes are each refused';
end $$;
reset role;

-- The refused codes were not spent. Checked as superuser, because by design the person
-- who was refused cannot read them.
do $$
begin
  if exists (select 1 from public.invite_codes
              where code in (current_setting('t0287.revoked'), current_setting('t0287.expired'))
                and redeemed_at is not null) then
    raise exception 'FAIL: a refused code was marked redeemed anyway';
  end if;
  raise notice 'PASS: a refused code costs nothing — it is not spent';
end $$;

-- N1 uses the good one. Typed the way a person types it: lower case, with a dash.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0287000-0000-0000-0000-00000000000a","role":"authenticated","email":"n1.0287@example.invalid"}';
do $$
declare p public.profiles;
begin
  p := public.redeem_invite_code(
         lower(substr(current_setting('t0287.good'), 1, 5)) || '-' ||
         lower(substr(current_setting('t0287.good'), 6)));
  if p.id <> 'a0287000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: redeeming made a profile for the wrong person';
  end if;
  if p.role <> 'viewer' then
    raise exception 'FAIL: the code said viewer, the profile says %', p.role;
  end if;
  raise notice 'PASS: a code typed in lower case with a dash still opens the door';
end $$;

-- Redeeming again, as somebody who is now a member, is free: it returns the profile
-- and does NOT spend the second code.
do $$
declare p public.profiles;
begin
  p := public.redeem_invite_code(current_setting('t0287.expired'));
  if p.id <> 'a0287000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: a member redeeming again got somebody else''s profile';
  end if;
  raise notice 'PASS: redeeming when you are already in returns your own profile';
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.invite_codes
              where code = current_setting('t0287.expired') and redeemed_at is not null) then
    raise exception 'FAIL: a member re-redeeming burned a code they did not need';
  end if;
  raise notice 'PASS: an already-member''s second redemption spends nothing';
end $$;

-- ---------------------------------------------------------------------------
-- (iv) already used — the single-use promise, from the second person's side.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0287000-0000-0000-0000-00000000000b","role":"authenticated","email":"n2.0287@example.invalid"}';
do $$
begin
  begin
    perform public.redeem_invite_code(current_setting('t0287.good'));
    raise exception 'FAIL: two people got in on one single-use code';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    perform set_config('t0287.msg_used', sqlerrm, true);
  end;

  if exists (select 1 from public.profiles where id = 'a0287000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: the second person got an account from a spent code';
  end if;
  raise notice 'PASS: a single-use code lets in one person and refuses the next';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- The four refusals are four different sentences.
-- ---------------------------------------------------------------------------
do $$
declare msgs text[];
begin
  msgs := array[current_setting('t0287.msg_unknown'), current_setting('t0287.msg_expired'),
                current_setting('t0287.msg_revoked'), current_setting('t0287.msg_used')];
  if (select count(distinct m) from unnest(msgs) m) <> 4 then
    raise exception 'FAIL: the four refusals did not produce four distinct sentences — '
                    'a person cannot tell mistyped from expired from spent';
  end if;
  -- And none of them is empty or a bare SQLSTATE.
  if exists (select 1 from unnest(msgs) m where m is null or length(m) < 20) then
    raise exception 'FAIL: a refusal message is too short to tell anybody what to do';
  end if;
  raise notice 'PASS: unknown, expired, revoked and already-used each say something different';
end $$;

-- ---------------------------------------------------------------------------
-- The second gate behind the row lock. Once a code is spent, the conditional UPDATE
-- the RPC runs matches nothing — which is what makes the loser of a race lose even
-- where it never had to wait for a lock.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  update public.invite_codes
     set redeemed_at = now(), redeemed_by = 'a0287000-0000-0000-0000-00000000000b'
   where code = current_setting('t0287.good') and redeemed_at is null;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: the "where redeemed_at is null" guard matched a spent code';
  end if;

  -- And the record still names the one person it let in.
  if not exists (select 1 from public.invite_codes
                  where code = current_setting('t0287.good')
                    and redeemed_by = 'a0287000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: the spent code does not record who it let in';
  end if;
  raise notice 'PASS: a spent code cannot be claimed a second time';
end $$;

-- ---------------------------------------------------------------------------
-- The 0285 restore path: triggers disabled, only the supplied column supplied.
-- ---------------------------------------------------------------------------
do $$
declare c text;
begin
  set local session_replication_role = replica;
  insert into public.invite_codes (issued_by)
  values ('a0287000-0000-0000-0000-000000000001')
  returning code into c;
  reset session_replication_role;

  if c is null or c !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'FAIL: an insert with triggers disabled produced code %', coalesce(c, '<null>');
  end if;
  raise notice 'PASS: a row inserts with triggers disabled — a restore will not fail on NOT NULL';
end $$;

rollback;
