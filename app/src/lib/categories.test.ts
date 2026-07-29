import { describe, it, expect } from 'vitest';
import {
  applyCategories,
  categoryColor,
  categoryIcon,
  categoryLabel,
  effectiveCategories,
  isContainerSlug,
  primaryCategory,
} from './categories';

// NOTE: applyCategories() mutates module-level state (live bindings), so the
// describe block that calls it runs LAST — earlier tests assert the built-in
// registry. vitest isolates modules per file, so this doesn't leak to others.

describe('category lookups (built-in registry)', () => {
  it('resolves label/icon/color by slug', () => {
    expect(categoryLabel('dining')).toBe('Restaurant');
    expect(categoryIcon('hiking')).toBe('🥾');
    expect(categoryColor('biking')).toBe('#3b82f6');
  });

  it('falls back for unknown slugs', () => {
    expect(categoryLabel('mystery')).toBe('mystery'); // slug itself
    expect(categoryIcon('mystery')).toBe('📍'); // default pin
    expect(categoryColor('mystery')).toBe('#38bdf8'); // default color
  });

  it('knows which slugs are containers', () => {
    expect(isContainerSlug('trip')).toBe(true);
    expect(isContainerSlug('trail')).toBe(true);
    expect(isContainerSlug('hiking')).toBe(false);
  });
});

describe('effectiveCategories', () => {
  it('unions manual + auto categories in registry order', () => {
    // hiking (index 0) precedes dining (index 9) regardless of input order.
    expect(
      effectiveCategories({ categories: ['dining'], activity_categories: ['hiking'] }),
    ).toEqual(['hiking', 'dining']);
  });

  it('dedupes a slug present in both manual and auto', () => {
    expect(effectiveCategories({ categories: ['beach'], activity_categories: ['beach'] })).toEqual([
      'beach',
    ]);
  });

  it('drops slugs not in the registry and handles empties', () => {
    expect(
      effectiveCategories({ categories: ['not-a-real-slug'], activity_categories: [] }),
    ).toEqual([]);
    expect(effectiveCategories({ categories: [], activity_categories: [] })).toEqual([]);
  });

  it('primaryCategory is the first effective slug, else "default"', () => {
    expect(primaryCategory({ categories: [], activity_categories: ['running'] })).toBe('running');
    expect(primaryCategory({ categories: [], activity_categories: [] })).toBe('default');
  });
});

describe('applyCategories (mutates registry — runs last)', () => {
  it('ignores an empty row set (keeps built-ins)', () => {
    applyCategories([]);
    expect(categoryLabel('dining')).toBe('Restaurant');
  });

  it('replaces the registry from DB rows and fills missing fields', () => {
    applyCategories([
      // deliberately sparse: missing icon/color/review, is_auto/is_container set
      { slug: 'kayaking', label: 'Kayaking' } as never,
      { slug: 'road', label: 'Road Trip', is_container: true, is_auto: true } as never,
    ]);

    expect(categoryLabel('kayaking')).toBe('Kayaking');
    expect(categoryIcon('kayaking')).toBe(''); // icon ?? ''
    expect(categoryColor('kayaking')).toBe('#38bdf8'); // color ?? default
    expect(isContainerSlug('road')).toBe(true);

    // Old built-ins are gone after replacement.
    expect(categoryLabel('dining')).toBe('dining'); // no longer known → slug fallback

    // is_auto controls the manual/auto split → effectiveCategories still orders
    // by the new registry (kayaking index 0 before road index 1).
    expect(
      effectiveCategories({ categories: ['road'], activity_categories: ['kayaking'] }),
    ).toEqual(['kayaking', 'road']);
  });
});
