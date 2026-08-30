import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrash, restorePlace, type TrashItem } from '../lib/data';
import { restorePhoto } from '../lib/photos';
import AuthedImg from '../components/AuthedImg';

/** Trash — places & photos deleted in the last 30 days, restorable to where they
 *  were. After 30 days a nightly purge removes them for good. */
export default function Trash() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetchTrash()
      .then(setItems)
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function restore(it: TrashItem) {
    setBusy(it.id);
    try {
      if (it.kind === 'place') await restorePlace(it.id);
      else await restorePhoto(it.id);
      setItems((cur) => (cur ? cur.filter((x) => x.id !== it.id) : cur));
    } catch {
      /* ignore */
    }
    setBusy(null);
  }

  const rel = (iso: string): string => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d <= 0 ? 'today' : `${d}d ago`;
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings/data">
        <span>Settings</span>
      </Link>
      <h1>Trash</h1>
      <p className="label" style={{ margin: '0 0 12px' }}>
        Deleted places and photos are kept here for 30 days, then permanently removed. Restore
        anything to put it back where it was.
      </p>

      {items === null ? (
        <p className="label">Loading…</p>
      ) : items.length === 0 ? (
        <p className="label">Trash is empty.</p>
      ) : (
        <div className="trash-list">
          {items.map((it) => (
            <div key={`${it.kind}-${it.id}`} className="trash-row">
              {it.kind === 'photo' ? (
                <AuthedImg photoId={it.id} size="thumb" alt="" className="trash-thumb" />
              ) : (
                <span className="trash-badge">Place</span>
              )}
              <div className="trash-main">
                <b>{it.label}</b>
                <span className="label">
                  {it.kind} · deleted {rel(it.deleted_at)}
                </span>
              </div>
              <button disabled={busy === it.id} onClick={() => void restore(it)}>
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
