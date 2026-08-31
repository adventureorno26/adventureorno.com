// Invite codes — the door (migration 0288).
//
// A new person cannot sign up without a valid code. Erica, 2026-08-30: *"invite code
// first. new user sees whatever level of privacy each user as chosen. They can see
// public information."* So the code decides WHETHER you get an account; it decides
// nothing about what you can see once you have one.
//
// Every function here is a thin wrapper over one RPC. There is no client-side
// validation of a code beyond "they typed something", on purpose: only the database can
// tell unknown from expired from revoked from already-used, and each of those needs
// different words. The RPC raises a different sentence for each, and `whyItFailed`
// shows Postgres exception messages verbatim — so the copy the person reads lives in
// the migration, next to the rule that produced it.
import { supabase } from './supabase';

/**
 * The RPC names in 0288 are not in `database.types.ts` yet.
 *
 * `scripts/gen-types.mjs` regenerates that file from the LIVE (production) schema and
 * is the only writer of it, so an unapplied migration cannot appear there — and the
 * typed client rejects an RPC name it has never heard of at BUILD time, which is the
 * whole point of typing it (see supabase.ts).
 *
 * This is the one cast that buys the gap, named and in one place rather than `as any`
 * scattered about. WHEN 0288 IS DEPLOYED: run `npm run gen:types`, then delete this and
 * call `supabase.rpc` directly — the return types below are already the shapes the
 * generator will produce.
 */
type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc;

/** live → usable now. The other three are the reasons it is not. */
export type InviteCodeStatus = 'live' | 'expired' | 'revoked' | 'redeemed';

export interface InviteCode {
  id: string;
  code: string;
  note: string | null;
  role: 'viewer' | 'editor';
  status: InviteCodeStatus;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  /** Who this code let in, once it has let somebody in. */
  redeemed_name: string | null;
}

/** What `create_invite_code` returns — the raw row, code included. */
export interface NewInviteCode {
  id: string;
  code: string;
  note: string | null;
  role: 'viewer' | 'editor';
  expires_at: string;
}

/**
 * Group a code for reading aloud: XXXXX-XXXXX.
 *
 * Display only. Nothing is ever SENT in this form — `normalize_invite_code` in the
 * database throws the dashes away again, so the person may type it however they like.
 */
export function formatInviteCode(code: string): string {
  const c = code.trim().toUpperCase();
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

/** Issue one single-use code. Returns it in full — this is the only time it is shown. */
export async function createInviteCode(opts: {
  note?: string;
  expiresInDays?: number;
  role?: 'viewer' | 'editor';
}): Promise<NewInviteCode> {
  const { data, error } = await rpc('create_invite_code', {
    p_note: opts.note?.trim() || null,
    p_expires_in_days: opts.expiresInDays ?? 14,
    p_role: opts.role ?? 'viewer',
  });
  if (error) throw error;
  return data as NewInviteCode;
}

/** The caller's own codes, newest first, each with a status computed from the clock. */
export async function listMyInviteCodes(): Promise<InviteCode[]> {
  const { data, error } = await rpc('list_my_invite_codes');
  if (error) throw error;
  return (data ?? []) as InviteCode[];
}

/** Take back a code that has not been used. Idempotent; refuses a redeemed one. */
export async function revokeInviteCode(id: string): Promise<void> {
  const { error } = await rpc('revoke_invite_code', { p_id: id });
  if (error) throw error;
}

/**
 * Redeem a code for the currently signed-in Google account, creating the profile.
 *
 * The caller must already have a session — that is deliberate and not an oversight:
 * redemption's product is a profile keyed to `auth.uid()`, so signing in comes first.
 * Safe to call again after it has succeeded (it returns the existing profile without
 * touching a code).
 */
export async function redeemInviteCode(code: string): Promise<void> {
  const { error } = await rpc('redeem_invite_code', { p_code: code });
  if (error) throw error;
}
