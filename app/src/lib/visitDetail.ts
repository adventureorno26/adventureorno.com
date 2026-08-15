// Everything one visit contains, and the edits you can make to it.
//
// A visit is the occasion; photos and activities are what you did during it. The
// server decides membership (visit_detail), because the rules are not obvious: a
// photo belongs to a visit because its LOCAL day falls inside it, or because
// someone pinned it there, and a duplicate outing recorded twice is still one
// thing you did.

import { supabase, sqlNull } from './supabase';

export interface VisitActivity {
  id: string;
  name: string | null;
  type: string;
  distance: number;
  elevation_gain: number | null;
  moving_time: number | null;
  local_date: string | null;
  start_date: string | null;
  place_id: string | null;
}

export interface VisitPhoto {
  id: string;
  taken_at: string | null;
  local_date: string | null;
  caption: string | null;
  /** True when someone put this photo on this visit by hand, rather than it
   *  landing here because of its date. */
  pinned: boolean;
}

export interface VisitContent {
  place_id: string;
  place_name: string;
  visit_id: string;
  start_date: string;
  end_date: string;
}

export interface VisitDetail {
  visit: {
    id: string;
    place_id: string;
    start_date: string;
    end_date: string;
    note: string | null;
    is_trip: boolean;
    manual: boolean;
    status: string;
    solo_profile: string | null;
    solo_override: boolean;
  };
  /** Who was on this visit, as rows (0186). Replaces reading `visit.solo_profile`,
   *  which can say one person or everybody and nothing in between. */
  people: { id: string; name: string | null }[];
  place: {
    id: string;
    name: string;
    admin1: string | null;
    country: string | null;
    address: string | null;
    lat: number;
    lng: number;
    is_trail: boolean;
  };
  activities: VisitActivity[];
  photos: VisitPhoto[];
  /** For a marked trip: the places you went to during it, derived from its dates. */
  contents: VisitContent[];
}

export async function fetchVisitDetail(visitId: string): Promise<VisitDetail | null> {
  const { data, error } = await supabase.rpc('visit_detail', { p_visit: visitId });
  if (error) throw error;
  return (data as VisitDetail | null) ?? null;
}

/** Move a whole visit to a different place — "it is in the wrong place". */
export async function setVisitPlace(visitId: string, placeId: string): Promise<void> {
  const { error } = await supabase.rpc('set_visit_place', {
    p_visit: visitId,
    p_place: placeId,
  });
  if (error) throw error;
}

/** Put a photo on this visit, or pass null to let its own date decide again.
 *  The photo's date is never changed. */
export async function setPhotoVisit(photoId: string, visitId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_photo_visit', {
    p_photo: photoId,
    p_visit: sqlNull(visitId), // null lets the photo's own date decide again
  });
  if (error) throw error;
}

export async function setVisitNote(visitId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('set_visit_note', { p_visit: visitId, p_note: note });
  if (error) throw error;
}
