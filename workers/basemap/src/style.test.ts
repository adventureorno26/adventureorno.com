// NO ICONS. Erica's rule, and the only exception in the whole app is the heart and the
// flame on a photo. The basemap theme paints POI and town markers from a sprite sheet,
// so the style has to have them taken out before it is served.
import { describe, expect, it } from 'vitest';
import { withoutIcons, buildStyle, themeFrom } from './style';

const layer = (id: string, layout: Record<string, unknown>) => ({ id, layout });

describe('taking the icons out', () => {
  it('keeps the WORDS when a layer draws both', () => {
    // places_locality draws the town dot AND the town name in one layer. Dropping the
    // whole layer — which is what I did first — takes every city label off the map.
    const out = withoutIcons([
      layer('places_locality', {
        'icon-image': 'townspot',
        'icon-size': 0.7,
        'text-field': '{name}',
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].layout).not.toHaveProperty('icon-image');
    expect(out[0].layout).not.toHaveProperty('icon-size');
    expect(out[0].layout).toHaveProperty('text-field');
  });

  it('drops a layer that was only ever an icon', () => {
    expect(withoutIcons([layer('poi_dots', { 'icon-image': 'dot' })])).toHaveLength(0);
  });

  it('leaves layers that draw no icon completely alone', () => {
    const roads = layer('roads', { 'line-cap': 'round' });
    expect(withoutIcons([roads])[0]).toBe(roads);
  });

  it('cleans up a stray icon property with no icon behind it', () => {
    // places_country carries icon-padding without an icon-image. It never drew
    // anything, but leaving it makes "there are no icons" impossible to assert.
    const out = withoutIcons([
      layer('places_country', { 'icon-padding': 2, 'text-field': '{name}' }),
    ]);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0].layout!).some((k) => k.startsWith('icon-'))).toBe(false);
    expect(out[0].layout).toHaveProperty('text-field');
  });

  it('leaves nothing icon-shaped in a whole style', () => {
    const out = withoutIcons([
      layer('a', { 'icon-image': 'x', 'text-field': '{name}' }),
      layer('b', { 'icon-image': 'y' }),
      layer('c', { 'line-width': 1 }),
    ]);
    expect(out.map((l) => l.id)).toEqual(['a', 'c']);
    expect(out.some((l) => Object.keys(l.layout ?? {}).some((k) => k.startsWith('icon-')))).toBe(
      false,
    );
  });
});

describe('two themes, and the words in both', () => {
  // Erica chose INK for dark and DAYLIGHT 2 for light on 2026-08-15, from renders of
  // this exact layer set. The preview and the product have to be the same map, so these
  // pin the values she actually looked at.
  const dark = buildStyle('https://x.test', 'dark') as {
    layers: {
      id: string;
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    }[];
  };
  const light = buildStyle('https://x.test', 'light') as typeof dark;
  const layer = (s: typeof dark, id: string) => s.layers.find((l) => l.id === id)!;

  it('paints Ink for dark — the card’s own ground', () => {
    expect(layer(dark, 'earth').paint!['background-color']).toBe('#0e1728');
    expect(layer(dark, 'water').paint!['fill-color']).toBe('#16324f');
  });

  it('paints Daylight 2 for light', () => {
    expect(layer(light, 'earth').paint!['background-color']).toBe('#f8f9fa');
    expect(layer(light, 'water').paint!['fill-color']).toBe('#8ccbf9');
    expect(layer(light, 'parks').paint!['fill-color']).toBe('#b4dfb4');
  });

  it('gives the light theme road casings and the dark theme none', () => {
    // Without a casing a white road on a near-white ground simply disappears. The dark
    // theme needs none: its roads are already lighter than the ground.
    expect(light.layers.some((l) => l.id.startsWith('casing'))).toBe(true);
    expect(dark.layers.some((l) => l.id.startsWith('casing'))).toBe(false);
  });

  it('uses the modern lettering in BOTH themes', () => {
    for (const s of [dark, light]) {
      expect(layer(s, 'place-labels').layout!['text-font']).toEqual(['Noto Sans Medium']);
      expect(layer(s, 'place-labels').layout!['text-letter-spacing']).toBe(-0.012);
      expect(layer(s, 'water-labels').layout!['text-font']).toEqual(['Noto Sans Italic']);
      expect(layer(s, 'place-labels').paint!['text-halo-width']).toBe(1.1);
    }
  });

  it('never asks for a font the glyph server cannot serve', () => {
    // Noto Sans Bold is not published upstream — it answers 502 — so asking for it puts
    // unlabelled tiles on the map with nothing to say why.
    const fonts = JSON.stringify([dark, light]).match(/Noto Sans [A-Za-z]+/g) ?? [];
    expect(new Set(fonts)).toEqual(
      new Set(['Noto Sans Medium', 'Noto Sans Italic', 'Noto Sans Regular']),
    );
  });

  it('defaults to dark, including for a typo', () => {
    expect(themeFrom('light')).toBe('light');
    expect(themeFrom('dark')).toBe('dark');
    expect(themeFrom('lightt')).toBe('dark');
    expect(themeFrom(null)).toBe('dark');
  });

  it('has no icon anywhere in either theme', () => {
    expect(JSON.stringify([dark, light])).not.toMatch(/"icon-/);
  });
});
