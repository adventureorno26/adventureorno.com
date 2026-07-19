// Place categories — auto ones come from Strava activity types (hiking/running/
// biking), the rest are tagged manually on the place card.

import type { Place } from './types';

export interface Category {
  slug: string;
  label: string;
  icon: string; // emoji, used in menus/chips/legend
  color: string; // pin color (map)
  auto?: boolean; // derived from activities, not manually toggled
}

export const CATEGORIES: Category[] = [
  { slug: 'hiking', label: 'Hiking', icon: '🥾', color: '#22c55e', auto: true },
  { slug: 'walking', label: 'Walking', icon: '🚶', color: '#4ade80', auto: true },
  { slug: 'running', label: 'Running', icon: '🏃', color: '#f97316', auto: true },
  { slug: 'biking', label: 'Biking', icon: '🚴', color: '#3b82f6', auto: true },
  { slug: 'jeeping', label: 'Jeeping', icon: '🚙', color: '#b45309' },
  { slug: 'camping', label: 'Camping', icon: '🏕️', color: '#10b981' },
  { slug: 'beach', label: 'Beach', icon: '🏖️', color: '#06b6d4' },
  { slug: 'sunrise', label: 'Sunrise', icon: '🌅', color: '#fbbf24' },
  { slug: 'sunset', label: 'Sunset', icon: '🌇', color: '#fb7185' },
  { slug: 'dining', label: 'Dining', icon: '🍽️', color: '#f59e0b' },
  { slug: 'winery', label: 'Winery', icon: '🍷', color: '#a855f7' },
  { slug: 'brewery', label: 'Brewery', icon: '🍺', color: '#ca8a04' },
  { slug: 'viewpoint', label: 'Viewpoint', icon: '⛰️', color: '#64748b' },
  { slug: 'stay', label: 'Stay', icon: '🏨', color: '#6366f1' },
];

export const categoryColor = (slug: string): string =>
  CATEGORIES.find((c) => c.slug === slug)?.color ?? '#38bdf8';

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

/** The icon to show as the map marker — first effective category, else the
 *  default pin (matches the 'pin-default' image added in MapView). */
export function primaryCategory(place: Pick<Place, 'categories' | 'activity_categories'>): string {
  return effectiveCategories(place)[0] ?? 'default';
}
