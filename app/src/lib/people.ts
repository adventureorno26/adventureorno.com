// People: members + invites. Reads go through RLS (owner-only tables); sending
// an invite calls the owner-only `invite` Edge Function.

import { supabase } from './supabase';
import type { Invite, Profile, Role } from './types';

export async function fetchMembers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, display_name, created_at')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function fetchInvites(): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, email, role, accepted_at, created_at, expires_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Invite[];
}

export async function sendInvite(email: string, role: Role): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      role,
      redirectTo: `${window.location.origin}/login`,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Invite failed (${res.status})`);
  }
}

/** Revoke a pending invite (delete the row). */
export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.from('invites').delete().eq('id', id);
  if (error) throw error;
}

/** Remove a member's access by deleting their profile (no profile = no access).
 *  Owner-only via RLS; the owner can't remove themselves in the UI. */
export async function removeMember(profileId: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', profileId);
  if (error) throw error;
}
