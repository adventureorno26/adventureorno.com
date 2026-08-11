// A category's label as a SECTION heading.
//
// Erica, 2026-08-11: "Restaurant should be Restaurants." A tag on a place is
// singular — one pill reading "Restaurant" is correct — but the section that lists
// them is plural, which is what the locked card shows ("Restaurants", "Beaches").
//
// English, not a library: the labels are a known short list from
// public.place_categories, and this handles every shape in it.

export function pluralLabel(label: string): string {
  const l = label.trim();
  if (!l) return l;
  // Already plural, or a word that does not take one (Camping, Hiking, Dining).
  if (/s$/i.test(l) || /ing$/i.test(l)) return l;
  // Beach → Beaches, Brunch → Brunches, Box → Boxes
  if (/(ch|sh|x|z)$/i.test(l)) return `${l}es`;
  // Winery → Wineries, but Bay → Bays (a vowel before the y keeps it)
  if (/[^aeiou]y$/i.test(l)) return `${l.slice(0, -1)}ies`;
  return `${l}s`;
}
