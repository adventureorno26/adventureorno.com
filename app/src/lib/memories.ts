// "On this day" memories: places you visited on today's calendar day in a
// previous year (e.g. "1 year ago today you were in Lisbon").
import { supabase } from './supabase';

export interface Memory {
  placeId: string;
  placeName: string;
  admin1: string | null;
  date: string; // the past visit's start_date
  yearsAgo: number;
}

interface VisitRow {
  start_date: string;
  place_id: string;
  places: { name: string; admin1: string | null } | null;
}

export async function fetchOnThisDay(today = new Date()): Promise<Memory[]> {
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const year = today.getFullYear();
  const { data, error } = await supabase
    .from('visits')
    .select('start_date, place_id, places(name, admin1)')
    .order('start_date', { ascending: false });
  if (error) return [];
  const rows = (data ?? []) as unknown as VisitRow[];
  const seen = new Set<string>();
  const out: Memory[] = [];
  for (const r of rows) {
    if (!r.start_date || !r.places) continue;
    const [y, m, d] = r.start_date.slice(0, 10).split('-');
    if (m !== mm || d !== dd) continue;
    const yearsAgo = year - Number(y);
    if (yearsAgo < 1) continue; // only prior years
    const key = `${r.place_id}-${yearsAgo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      placeId: r.place_id,
      placeName: r.places.name,
      admin1: r.places.admin1,
      date: r.start_date,
      yearsAgo,
    });
  }
  return out.sort((a, b) => a.yearsAgo - b.yearsAgo);
}
