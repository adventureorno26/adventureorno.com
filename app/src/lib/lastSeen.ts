// WHERE WE ARE — last seen, and honest about it.
//
// The Snap-Map-shaped feature Erica asked for, built on the pings the app
// already collects. The honesty matters more than the feature: a web app cannot
// track in the background on iOS, so a position can be hours or days old. Every
// reading here carries its age, and anything past a day is treated as stale
// rather than shown as if it were current.

import { supabase } from './supabase';

export interface LastSeen {
  profile_id: string;
  display_name: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
  age_seconds: number;
  /** Their most recent photo — every marker in this app is a photo. */
  photo_id: string | null;
  is_me: boolean;
}

/** Older than this and it is history, not a location. */
export const STALE_AFTER_SECONDS = 24 * 60 * 60;

export function isStale(l: Pick<LastSeen, 'age_seconds'>): boolean {
  return l.age_seconds >= STALE_AFTER_SECONDS;
}

/**
 * "4 minutes ago" / "2 hours ago" / "yesterday" / "3 days ago".
 *
 * Deliberately coarse past an hour: minute-precision on a reading that is
 * eleven hours old implies a confidence the data does not have.
 */
export function ageLabel(seconds: number): string {
  if (seconds < 90) return 'just now';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

/** Everyone's last known position. Member-gated; respects ghost mode. */
export async function fetchLastSeen(): Promise<LastSeen[]> {
  const { data, error } = await supabase.rpc('last_seen');
  if (error) return [];
  return (data ?? []).map((r: LastSeen) => ({ ...r, age_seconds: Number(r.age_seconds) }));
}

/** Turn your own sharing on or off. Never affects anyone else. */
export async function setShareLocation(share: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_share_location', { p_share: share });
  if (error) throw error;
}

/** Whether the signed-in person is currently sharing. */
export async function fetchShareLocation(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) return true;
  const { data: row, error } = await supabase
    .from('profiles')
    .select('share_location')
    .eq('id', id)
    .maybeSingle();
  if (error || !row) return true;
  return (row as { share_location: boolean }).share_location;
}
