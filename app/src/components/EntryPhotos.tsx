import { useEffect, useState } from 'react';
import {
  fetchPhotosForEntry,
  fetchPhotosForPlace,
  linkPhotoToEntry,
  photosEnabled,
} from '../lib/photos';
import type { Photo } from '../lib/types';
import AuthedImg from './AuthedImg';

interface Props {
  entryId: string;
  placeId: string;
  canEdit: boolean;
}

/** Photos attached to a specific entry, with an attach/detach picker over the
 *  place's photos (Phase 5, task 3). */
export default function EntryPhotos({ entryId, placeId, canEdit }: Props) {
  const [linked, setLinked] = useState<Photo[]>([]);
  const [pool, setPool] = useState<Photo[] | null>(null);
  const [picking, setPicking] = useState(false);

  async function refresh() {
    setLinked(await fetchPhotosForEntry(entryId));
  }

  useEffect(() => {
    if (photosEnabled()) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  if (!photosEnabled()) return null;

  async function openPicker() {
    setPicking(true);
    if (pool === null) setPool(await fetchPhotosForPlace(placeId));
  }

  async function toggle(photo: Photo) {
    const isLinked = linked.some((p) => p.id === photo.id);
    await linkPhotoToEntry(photo.id, isLinked ? null : entryId);
    await refresh();
  }

  return (
    <div className="entry-photos">
      {linked.length > 0 && (
        <div className="entry-photo-strip">
          {linked.map((p) => (
            <AuthedImg key={p.id} photoId={p.id} size="thumb" className="entry-photo" />
          ))}
        </div>
      )}
      {canEdit && (
        <button
          className="link-photos-btn"
          onClick={() => (picking ? setPicking(false) : openPicker())}
        >
          📎 {picking ? 'Done' : linked.length ? 'Edit photos' : 'Attach photos'}
        </button>
      )}
      {picking && pool && (
        <div className="photo-picker">
          {pool.length === 0 ? (
            <span className="muted">No photos at this place yet.</span>
          ) : (
            pool.map((p) => {
              const on = linked.some((l) => l.id === p.id);
              return (
                <div
                  key={p.id}
                  className={`pick ${on ? 'on' : ''}`}
                  onClick={() => void toggle(p)}
                  title={on ? 'Detach' : 'Attach'}
                >
                  <AuthedImg photoId={p.id} size="thumb" />
                  {on && <span className="pick-check">✓</span>}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
