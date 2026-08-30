// WHAT THE BLANK CARD FILLS IN FOR YOU — and what it refuses to fill in.
//
// Erica, 2026-08-30:
//   "The date should always be pre-filled to the date I am adding the card, or the
//    date the picture being added was taken... and I should be able to edit the dates."
//   "my vision is more that I can click on my location on the map and the place I am
//    at will be suggested in the add card we already built. ie, if I am at a restaurant
//    the name of the restaurant will already be in the card after I hit add, then I can
//    change it as needed."
//
// Two rules run through everything here:
//   1. A SUGGESTION NEVER OVERWRITES WHAT YOU TYPED. It fills a field you have not
//      touched, and that is all it ever does.
//   2. A WRONG SUGGESTION IS WORSE THAN A BLANK FIELD. A pin dropped on a highway in
//      Kansas used to offer "Coffey County" as the place's name, because reverse
//      geocoding answers with the area you are inside. Anything that is not a named
//      venue is discarded here rather than typed into the card for her to delete.
//
// A date-only string parses as UTC midnight and renders as the PREVIOUS day west of
// Greenwich (docs/STATE.md §8), so every date below is built from LOCAL components.

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today, as the browser's own calendar day — the day she is adding the card. */
export function todayLocalDate(now: Date = new Date()): string {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** The calendar day a photo was taken, from its EXIF/`taken_at` timestamp. Null when
 *  there is no usable timestamp — the caller then keeps whatever it already had. */
export function localDateOf(takenAt: string | null | undefined): string | null {
  if (!takenAt) return null;
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return null;
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// OpenStreetMap classes that are NEVER the place you are standing in: the county, the
// road, the suburb, the rail line you happen to be inside or beside. `place` covers
// place/house (a house number) and place/suburb alike. Everything else — amenity,
// shop, tourism, leisure, historic, natural, building, aeroway… — is a real feature,
// and a real feature with a name is a place worth suggesting.
const NOT_A_VENUE = new Set([
  'boundary',
  'highway',
  'landuse',
  'place',
  'railway',
  'route',
  'waterway',
]);

/** The name to suggest for a place, or null when nothing found is confident enough.
 *  `category` is OpenStreetMap's "class/type" as `fetchPoiDetails` returns it. */
export function suggestedPlaceName(
  poi: { name: string | null; category: string | null } | null,
): string | null {
  const name = poi?.name?.trim();
  if (!name) return null;
  const osmClass = (poi?.category ?? '').split('/')[0];
  if (NOT_A_VENUE.has(osmClass)) return null;
  return name;
}

/** Apply a suggestion to a field. It fills what is still untouched and nothing else:
 *  once she has typed in the field, the field is hers. */
export function prefill(
  current: string,
  suggestion: string | null | undefined,
  edited: boolean,
): string {
  if (edited) return current;
  const s = suggestion?.trim();
  return s ? s : current;
}
