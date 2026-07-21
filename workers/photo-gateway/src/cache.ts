// Edge-cache helpers for photo bytes (caches.default). Kept in their own module
// so they're unit-testable without importing the whole worker (wasm/exif deps).

// Synthetic cache key for a photo variant — not a real URL, just a stable key.
// Keyed by id + size so the two variants are cached and purged separately.
export function photoCacheKey(id: string, size: 'full' | 'thumb'): Request {
  return new Request(`https://cache.internal/photo/${id}/${size}`);
}

/** Purge BOTH cached variants of a photo. Awaited before a delete returns so a
 *  deleted photo never survives at the edge (rule #6). */
export async function purgePhotoCache(cache: Cache, id: string): Promise<void> {
  await Promise.all([
    cache.delete(photoCacheKey(id, 'full')),
    cache.delete(photoCacheKey(id, 'thumb')),
  ]);
}
