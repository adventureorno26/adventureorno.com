// Place categories — auto ones come from Strava activity types (hiking/running/
// biking), the rest are tagged manually on the place card.

import type { Place } from './types';

export interface Category {
  slug: string;
  label: string;
  icon: string; // emoji, used in menus/chips/legend
  color: string; // pin color (map)
  review: string; // heading for that category's reviews section on a place card
  auto?: boolean; // derived from activities, not manually toggled
}

// Built-in fallback set. At app boot, applyCategories() replaces this with the
// DB-backed list (public.place_categories) so custom tags Erica adds in Settings
// appear everywhere. `let` (not const) so ES-module live bindings propagate the
// merged list to every synchronous consumer after load.
const BUILT_IN: Category[] = [
  {
    slug: 'hiking',
    label: 'Hiking',
    icon: '🥾',
    color: '#22c55e',
    review: 'Hiking Trail Reviews',
    auto: true,
  },
  {
    slug: 'walking',
    label: 'Walking',
    icon: '🚶',
    color: '#4ade80',
    review: 'Walking Trail Reviews',
    auto: true,
  },
  {
    slug: 'running',
    label: 'Running',
    icon: '🏃',
    color: '#f97316',
    review: 'Running Trail Reviews',
    auto: true,
  },
  {
    slug: 'biking',
    label: 'Biking',
    icon: '🚴',
    color: '#3b82f6',
    review: 'Biking Trail Reviews',
    auto: true,
  },
  {
    slug: 'jeeping',
    label: 'Jeeping',
    icon: '🚙',
    color: '#b45309',
    review: 'Jeeping Trail Reviews',
  },
  { slug: 'camping', label: 'Camping', icon: '🏕️', color: '#10b981', review: 'Campsite Reviews' },
  { slug: 'beach', label: 'Beach', icon: '🏖️', color: '#06b6d4', review: 'Beach Reviews' },
  {
    slug: 'sunrise',
    label: 'Sunrise',
    icon: '🌅',
    color: '#fbbf24',
    review: 'Sunrise Spot Reviews',
  },
  { slug: 'sunset', label: 'Sunset', icon: '🌇', color: '#fb7185', review: 'Sunset Spot Reviews' },
  {
    slug: 'dining',
    label: 'Restaurant',
    icon: '🍽️',
    color: '#f59e0b',
    review: 'Restaurant Reviews',
  },
  { slug: 'winery', label: 'Winery', icon: '🍷', color: '#a855f7', review: 'Winery Reviews' },
  { slug: 'brewery', label: 'Brewery', icon: '🍺', color: '#ca8a04', review: 'Brewery Reviews' },
  {
    slug: 'viewpoint',
    label: 'Viewpoint',
    icon: '⛰️',
    color: '#64748b',
    review: 'Viewpoint Reviews',
  },
  { slug: 'stay', label: 'Hotel', icon: '🏨', color: '#6366f1', review: 'Hotel Reviews' },
  // A race is its own place; each running is an activity under it. No icon.
  { slug: 'race', label: 'Race', icon: '', color: '#f97316', review: 'Race Notes' },
  // Container kinds — a place that holds other places (its members via part_of).
  // No icon (per Erica). A Trip has dates; a Trail is a route.
  { slug: 'trip', label: 'Trip', icon: '', color: '#ec4899', review: 'Trip Notes' },
  { slug: 'trail', label: 'Trail', icon: '', color: '#0d9488', review: 'Trail Notes' },
];

// The live registry. Starts as the built-ins; applyCategories() swaps in the DB
// list at boot. Exported as `let` so consumers see updates via live bindings.
export let CATEGORIES: Category[] = [...BUILT_IN];
export let CONTAINER_SLUGS: string[] = ['trip', 'trail'];
export let MANUAL_CATEGORIES: Category[] = BUILT_IN.filter((c) => !c.auto);
let BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

/** Replace the runtime category list from DB rows (public.place_categories). */
export function applyCategories(
  rows: Array<
    Category & { is_auto?: boolean; is_container?: boolean; sort_order?: number }
  >,
): void {
  if (!rows || rows.length === 0) return;
  CATEGORIES = rows.map((r) => ({
    slug: r.slug,
    label: r.label,
    icon: r.icon ?? '',
    color: r.color ?? '#38bdf8',
    review: r.review ?? `${r.label} Reviews`,
    auto: r.is_auto ?? r.auto,
  }));
  CONTAINER_SLUGS = rows.filter((r) => r.is_container).map((r) => r.slug);
  MANUAL_CATEGORIES = CATEGORIES.filter((c) => !c.auto);
  BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));
}

export const isContainerSlug = (slug: string): boolean => CONTAINER_SLUGS.includes(slug);

export const categoryColor = (slug: string): string => BY_SLUG.get(slug)?.color ?? '#38bdf8';
export const categoryIcon = (slug: string): string => BY_SLUG.get(slug)?.icon ?? '📍';
export const categoryLabel = (slug: string): string => BY_SLUG.get(slug)?.label ?? slug;

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
