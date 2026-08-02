// Durable persistence for the upload queue. Pending uploads (the original File bytes
// + their options) are written to IndexedDB so they survive a page reload or browser
// restart and can resume on next launch. Raw IndexedDB — no dependency. All access is
// wrapped so that when IndexedDB is unavailable (private mode, disabled, quota) the
// queue still works in memory; durability just degrades to best-effort.

const DB_NAME = 'aon-uploads';
const STORE = 'pending';
const VERSION = 1;

export interface UploadOpts {
  placeId?: string;
  lat?: number;
  lng?: number;
  override?: boolean;
  takenAt?: string;
}

export interface StoredUpload {
  id: string;
  name: string;
  file: Blob; // a File is a Blob; structured-clone persists the bytes
  opts: UploadOpts;
  attempts: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Persist a pending upload. Returns false (never throws) if storage failed — e.g.
 *  quota exceeded or IndexedDB unavailable — so the caller can warn but still queue. */
export async function persistUpload(u: StoredUpload): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(u));
    return true;
  } catch {
    return false;
  }
}

/** Remove a finished/cancelled upload from durable storage. Best-effort. */
export async function forgetUpload(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore — nothing to recover */
  }
}

/** Every upload still pending durable storage, oldest first (for resume on launch). */
export async function loadPendingUploads(): Promise<StoredUpload[]> {
  try {
    const all = await run<StoredUpload[]>(
      'readonly',
      (s) => s.getAll() as IDBRequest<StoredUpload[]>,
    );
    return (all ?? []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/** Wipe all durable uploads (used on sign-out so one account's bytes never resume
 *  under another session). Best-effort. */
export async function clearPersistedUploads(): Promise<void> {
  try {
    await run('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
