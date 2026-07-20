// Join-request flow: a signed-in user with no profile asks to join; the owner
// approves them as viewer or contributor (editor) from Settings.
import { supabase } from './supabase';

export interface JoinRequest {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
}

const COLS = 'id, user_id, email, display_name, note, status, created_at';

/** Create/refresh the current user's request to join. */
export async function submitJoinRequest(note: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const meta = user.user_metadata ?? {};
  const { error } = await supabase.from('join_requests').upsert(
    {
      user_id: user.id,
      email: user.email ?? null,
      display_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
      note: note.trim() || null,
      status: 'pending',
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
}

export async function fetchMyJoinRequest(): Promise<JoinRequest | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('join_requests')
    .select(COLS)
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as JoinRequest) ?? null;
}

/** Owner: pending requests to review. */
export async function fetchPendingJoinRequests(): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from('join_requests')
    .select(COLS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as JoinRequest[];
}

export async function approveJoinRequest(id: string, role: 'viewer' | 'editor'): Promise<void> {
  const { error } = await supabase.rpc('approve_join_request', { p_id: id, p_role: role });
  if (error) throw error;
}

export async function denyJoinRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('deny_join_request', { p_id: id });
  if (error) throw error;
}
