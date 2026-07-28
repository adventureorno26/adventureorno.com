import { useEffect, useState } from 'react';
import {
  cancelItem,
  clearFinished,
  pauseQueue,
  resumeQueue,
  retryFailed,
  subscribeQueue,
  type QItem,
} from '../lib/uploadQueue';

const DONE = new Set(['done', 'skipped', 'canceled']);

/** Floating upload-queue widget — shows every in-flight upload with progress and
 *  pause / resume / retry / cancel. Mounted once in App so it survives navigation
 *  and keeps running in the background while the app is open. */
export default function UploadQueue() {
  const [items, setItems] = useState<QItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(
    () =>
      subscribeQueue((it, p) => {
        setItems(it);
        setPaused(p);
      }),
    [],
  );
  if (items.length === 0) return null;

  const done = items.filter((i) => DONE.has(i.state)).length;
  const failed = items.filter((i) => i.state === 'failed').length;
  const inflight = items.filter((i) => i.state === 'uploading' || i.state === 'queued').length;
  const total = items.length;
  const pct = Math.round((done / total) * 100);
  const summary =
    inflight > 0
      ? `${paused ? 'Paused' : 'Uploading'} · ${done}/${total}`
      : failed > 0
        ? `${failed} failed · ${done} done`
        : `Uploaded ${done}`;

  return (
    <div className="uq">
      {/* Screen-reader progress: announces the coarse status politely. */}
      <div className="sr-only" role="status" aria-live="polite">
        {summary}
      </div>
      <button className="uq-head" onClick={() => setOpen((o) => !o)}>
        <b>{summary}</b>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      <div className="uq-bar">
        <div className="uq-fill" style={{ width: `${pct}%` }} />
      </div>
      {open && (
        <>
          <div className="uq-list">
            {items.slice(-8).map((i) => (
              <div key={i.id} className={`uq-item uq-${i.state}`}>
                <span className="uq-name">{i.name}</span>
                <span className="label">
                  {i.state}
                  {i.error ? ` · ${i.error}` : ''}
                </span>
                {(i.state === 'queued' || i.state === 'uploading') && (
                  <button className="uq-x" onClick={() => cancelItem(i.id)} aria-label="Cancel">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="uq-actions">
            {inflight > 0 &&
              (paused ? (
                <button onClick={resumeQueue}>Resume</button>
              ) : (
                <button onClick={pauseQueue}>Pause</button>
              ))}
            {failed > 0 && <button onClick={retryFailed}>Retry failed</button>}
            {inflight === 0 && <button onClick={clearFinished}>Clear</button>}
          </div>
        </>
      )}
    </div>
  );
}
