import { describe, expect, it } from 'vitest';
import { photoCacheKey, purgePhotoCache } from './cache';

describe('photo edge cache', () => {
  it('keys the two size variants separately', () => {
    expect(new URL(photoCacheKey('abc', 'full').url).pathname).toBe('/photo/abc/full');
    expect(new URL(photoCacheKey('abc', 'thumb').url).pathname).toBe('/photo/abc/thumb');
  });

  it('delete purges BOTH cached variants (rule #6)', async () => {
    const deleted: string[] = [];
    const mockCache = {
      delete: async (req: Request) => {
        deleted.push(new URL(req.url).pathname);
        return true;
      },
    } as unknown as Cache;

    await purgePhotoCache(mockCache, 'abc');

    expect(deleted).toContain('/photo/abc/full');
    expect(deleted).toContain('/photo/abc/thumb');
    expect(deleted).toHaveLength(2);
  });
});
