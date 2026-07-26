// Global upload queue. Uploads run here instead of inline, so they survive route
// navigation (module-level state), keep going in the background while the app is
// open, retry on transient failures, and can be paused / resumed / retried /
// cancelled from one widget. Each file moves through a small state machine:
//   queued → uploading → done | skipped | failed (retryable) | canceled
//
// enqueueUpload() returns a promise that resolves when the file finishes, so
// existing call sites can `await` it exactly like uploadPhoto() and still get a
// completion report — the queue just schedules the work.
//
// (Reload-persistence via IndexedDB is a follow-up; this covers navigation +
// connection loss + background-while-open.)

import { uploadPhoto, type UploadResult } from './photos';

export type UploadState = 'queued' | 'uploading' | 'done' | 'skipped' | 'failed' | 'canceled';

export interface QItem {
  id: string;
  name: string;
  state: UploadState;
  attempts: number;
  error?: string;
  placeId?: string | null;
}

interface Internal extends QItem {
  file: File;
  opts: Parameters<typeof uploadPhoto>[1];
  resolve: (r: UploadResult) => void;
  canceled: boolean;
}

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

let items: Internal[] = [];
let active = 0;
let paused = false;
const subs = new Set<(items: QItem[], paused: boolean) => void>();

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

function emit() {
  const snap = items.map((i) => ({
    id: i.id,
    name: i.name,
    state: i.state,
    attempts: i.attempts,
    error: i.error,
    placeId: i.placeId,
  }));
  subs.forEach((f) => f(snap, paused));
}

export function subscribeQueue(f: (items: QItem[], paused: boolean) => void): () => void {
  subs.add(f);
  emit();
  return () => subs.delete(f);
}

export function enqueueUpload(
  file: File,
  opts: Parameters<typeof uploadPhoto>[1] = {},
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve) => {
    items.push({
      id: uid(),
      name: file.name,
      state: 'queued',
      attempts: 0,
      file,
      opts,
      resolve,
      canceled: false,
    });
    emit();
    pump();
  });
}

function pump() {
  if (paused) return;
  while (active < CONCURRENCY) {
    const next = items.find((i) => i.state === 'queued' && !i.canceled);
    if (!next) break;
    active++;
    next.state = 'uploading';
    next.attempts++;
    next.error = undefined;
    emit();
    uploadPhoto(next.file, next.opts).then(
      (r) => {
        active--;
        if (r.ok) {
          next.state = 'done';
          next.placeId = r.place_id ?? null;
        } else {
          next.state = 'skipped';
          next.error = r.skipped;
        }
        next.resolve(r);
        emit();
        pump();
      },
      (e) => {
        active--;
        if (next.attempts < MAX_ATTEMPTS && !next.canceled) {
          next.state = 'queued';
          next.error = 'retrying…';
          emit();
          setTimeout(pump, 1500 * next.attempts); // linear backoff
        } else {
          next.state = next.canceled ? 'canceled' : 'failed';
          next.error = next.canceled ? undefined : e instanceof Error ? e.message : String(e);
          next.resolve({ ok: false } as UploadResult);
          emit();
          pump();
        }
      },
    );
  }
}

export function pauseQueue() {
  paused = true;
  emit();
}
export function resumeQueue() {
  paused = false;
  emit();
  pump();
}
export function retryFailed() {
  for (const i of items) {
    if (i.state === 'failed') {
      i.state = 'queued';
      i.attempts = 0;
      i.error = undefined;
    }
  }
  emit();
  pump();
}
export function cancelItem(id: string) {
  const i = items.find((x) => x.id === id);
  if (!i) return;
  i.canceled = true;
  if (i.state === 'queued') {
    i.state = 'canceled';
    i.resolve({ ok: false } as UploadResult);
  }
  emit();
}
export function clearFinished() {
  items = items.filter((i) => i.state === 'queued' || i.state === 'uploading');
  emit();
}
