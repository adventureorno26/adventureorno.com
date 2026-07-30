import { describe, expect, it } from 'vitest';
import {
  clearPersistedUploads,
  forgetUpload,
  loadPendingUploads,
  persistUpload,
  type StoredUpload,
} from './uploadStore';

// In the test environment IndexedDB is absent (as in private mode or an unsupported
// browser). The durable store MUST degrade gracefully — never throw — so the upload
// queue keeps working in memory and only loses reload-persistence.
describe('uploadStore graceful degradation (no IndexedDB)', () => {
  const item: StoredUpload = {
    id: 'x1',
    name: 'a.jpg',
    file: new Blob(['bytes']),
    opts: { placeId: 'p1' },
    attempts: 0,
    createdAt: 1,
  };

  it('persistUpload returns false instead of throwing when storage is unavailable', async () => {
    await expect(persistUpload(item)).resolves.toBe(false);
  });

  it('loadPendingUploads returns an empty list and never throws', async () => {
    await expect(loadPendingUploads()).resolves.toEqual([]);
  });

  it('forgetUpload and clearPersistedUploads are safe no-ops', async () => {
    await expect(forgetUpload('x1')).resolves.toBeUndefined();
    await expect(clearPersistedUploads()).resolves.toBeUndefined();
  });
});
