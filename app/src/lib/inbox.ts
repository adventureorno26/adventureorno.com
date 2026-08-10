// The Inbox: what a machine would like to call things, waiting for a person to say.
//
// Nothing here writes a value directly. Every mutation goes through a SECURITY
// DEFINER RPC so that writing the value and recording the decision happen together —
// a name written without its lock is exactly the state this whole design exists to
// prevent.
import { supabase } from './supabase';

export interface SuggestionOption {
  id: string;
  field: string;
  label: string;
  proposed: string;
  current: string | null;
  source: string;
  confidence: number | null;
  rank: number;
  evidence: {
    samples?: number;
    hits?: number;
    kind?: 'trail' | 'park';
    strength?: string | null;
    via?: string;
    trails?: { name: string; count: number }[];
    parks?: { name: string; count: number }[];
  } | null;
}

export interface InboxCard {
  group_key: string;
  subject_type: 'activity' | 'place' | 'visit' | 'photo';
  subject_id: string;
  created_at: string;
  activity: {
    name: string | null;
    type: string | null;
    distance: number | null;
    start_date: string | null;
    place: string | null;
  } | null;
  fields: SuggestionOption[];
}

export interface InboxCounts {
  cards: number;
  suggestions: number;
}

export async function fetchInbox(limit = 25): Promise<InboxCard[]> {
  const { data, error } = await supabase.rpc('inbox', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as unknown as InboxCard[];
}

export async function fetchInboxCounts(): Promise<InboxCounts> {
  const { data, error } = await supabase.rpc('inbox_counts');
  if (error) throw error;
  return (data ?? { cards: 0, suggestions: 0 }) as unknown as InboxCounts;
}

/** What was chosen for one field: an offered option, or her own words. */
export type Choice = { suggestion_id: string } | { value: string };

/**
 * Approve a card. One transaction: every chosen value written, every one locked.
 * Returns an undo token — the caller is expected to offer Undo immediately.
 */
export async function approveCard(
  groupKey: string,
  choices: Record<string, Choice>,
): Promise<string> {
  const { data, error } = await supabase.rpc('approve_card', {
    p_group_key: groupKey,
    p_choices: choices as unknown as Record<string, never>,
  });
  if (error) throw error;
  return (data as unknown as { undo_token: string }).undo_token;
}

/** Never offer this exact suggestion again. The row stays, marked rejected. */
export async function rejectSuggestion(id: string): Promise<void> {
  const { error } = await supabase.rpc('reject_suggestion', { p_id: id });
  if (error) throw error;
}

/** Put the previous values back AND remove the locks. Both, or it isn't undo. */
export async function undoApproval(token: string): Promise<void> {
  const { error } = await supabase.rpc('undo_approval', { p_token: token });
  if (error) throw error;
}

/** Ask the suggester to look at specific activities again. */
export async function requestSuggestions(activityIds: string[]): Promise<void> {
  const { error } = await supabase.functions.invoke('suggest', {
    body: { activity_ids: activityIds },
  });
  if (error) throw error;
}

/** Miles, the way the rest of the app says them. */
export function miles(distanceMeters: number | null | undefined): string | null {
  if (!distanceMeters || distanceMeters <= 0) return null;
  return `${(distanceMeters / 1609.344).toFixed(1)} mi`;
}

/**
 * The evidence line, in words rather than numbers alone.
 *
 * "7 of 9 route points" is the whole reason to trust a suggestion — a proposal you
 * cannot check is just another guess. Erica sees the reasoning, not a score.
 */
export function evidenceLine(o: SuggestionOption): string {
  const e = o.evidence;
  if (!e) return o.source === 'maptiler' ? 'Geocoder' : 'OpenStreetMap';
  if (e.via === 'maptiler midpoint') return 'Geocoder · middle of the route';
  const n = e.samples ?? 9;
  const hits = e.hits ?? 0;
  if (e.kind === 'trail') return `OpenStreetMap · underfoot at ${hits} of ${n} route points`;
  if (e.kind === 'park') return `OpenStreetMap · contains ${hits} of ${n} route points`;
  return `OpenStreetMap · ${hits} of ${n} route points`;
}
