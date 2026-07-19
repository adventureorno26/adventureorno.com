// Place categories — auto ones come from Strava activity types (hiking/running/
// biking), the rest are tagged manually on the place card.

import type { Place } from './types';

export interface Category {
  slug: string;
  label: string;
  icon: string;
  auto?: boolean; // derived from activities, not manually toggled
}

export const CATEGORIES: Category[] = [
  { slug: 'hiking', label: 'Hiking', icon: '🥾', auto: true },
  { slug: 'running', label: 'Running', icon: '🏃', auto: true },
  { slug: 'biking', label: 'Biking', icon: '🚴', auto: true },
  { slug: 'jeeping', label: 'Jeeping', icon: '🚙' },
  { slug: 'camping', label: 'Camping', icon: '🏕️' },
  { slug: 'beach', label: 'Beach', icon: '🏖️' },
  { slug: 'sunrise', label: 'Sunrise', icon: '🌅' },
  { slug: 'sunset', label: 'Sunset', icon: '🌇' },
  { slug: 'dining', label: 'Dining', icon: '🍽️' },
  { slug: 'winery', label: 'Winery', icon: '🍷' },
  { slug: 'brewery', label: 'Brewery', icon: '🍺' },
  { slug: 'viewpoint', label: 'Viewpoint', icon: '⛰️' },
  { slug: 'stay', label: 'Stay', icon: '🏨' },
];

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));
export const categoryIcon = (slug: string): string => BY_SLUG.get(slug)?.icon ?? '📍';
export const categoryLabel = (slug: string): string => BY_SLUG.get(slug)?.label ?? slug;

// Categories that can be toggled by hand (everything that isn't auto-derived).
export const MANUAL_CATEGORIES = CATEGORIES.filter((c) => !c.auto);

/** All categories for a place: manual ∪ auto (deduped, in CATEGORIES order). */
export function effectiveCategories(
  place: Pick<Place, 'categories' | 'activity_categories'>,
): string[] {
  const set = new Set([...(place.categories ?? []), ...(place.activity_categories ?? [])]);
  return CATEGORIES.filter((c) => set.has(c.slug)).map((c) => c.slug);
}

/** The icon to show as the map marker — first effective category, else a pin. */
export function primaryCategory(place: Pick<Place, 'categories' | 'activity_categories'>): string {
  return effectiveCategories(place)[0] ?? 'pin';
}
