import { describe, expect, it } from 'vitest';
import { pluralLabel } from './plural';

describe('pluralLabel — category labels as section headings', () => {
  it('pluralises the one Erica named', () => {
    expect(pluralLabel('Restaurant')).toBe('Restaurants');
  });

  it('handles the sibilant endings', () => {
    expect(pluralLabel('Beach')).toBe('Beaches');
    expect(pluralLabel('Brunch')).toBe('Brunches');
  });

  it('handles a consonant + y, but leaves a vowel + y alone', () => {
    expect(pluralLabel('Winery')).toBe('Wineries');
    expect(pluralLabel('Brewery')).toBe('Breweries');
    expect(pluralLabel('Bay')).toBe('Bays');
  });

  it('leaves an -ing activity and an already-plural label as they are', () => {
    expect(pluralLabel('Camping')).toBe('Camping');
    expect(pluralLabel('Hiking')).toBe('Hiking');
    expect(pluralLabel('Places')).toBe('Places');
  });

  it('gives back empty for empty', () => {
    expect(pluralLabel('')).toBe('');
    expect(pluralLabel('  ')).toBe('');
  });
});
