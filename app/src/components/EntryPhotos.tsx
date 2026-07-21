import { useEffect, useRef, useState } from 'react';
import {
  fetchPhotosForEntry,
  fetchPhotosForPlace,
  linkPhotoToEntry,
  photosEnabled,
  uploadPhoto,
} from '../lib/photos';
import type { Photo } from '../lib/types';
import AuthedImg from './AuthedImg';

interface Props {
  entryId: string;
  placeId: string;
  lat: number;
  lng: number;
  canEdit: boolean;
}

/** Photos attached to a specific entry: attach/detach from the place's photos,
 *  OR upload new photos straight onto this spot. */
export default function EntryPhotos({ entryId, placeId, lat, lng, canEdit }: Props) {
  const [linked, setLinked] = useState<Photo[]>([]);
  const [pool, setPool] = useState<Photo[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  // Upload new photos and attach them to this spot.
  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setNote(null);
    let added = 0;
    for (const file of files) {
      try {
        const r = await uploadPhoto(file, { placeId, lat, lng, override: true });
        if (r.ok && r.id) {
          await linkPhotoToEntry(r.id, entryId);
          added++;
        }
      } catch {
        /* skip this file */
      }
    }
    await refresh();
    setPool(null); // pool is stale after new uploads
    setNote(added ? `${added} photo${added > 1 ? 's' : ''} added` : 'Nothing added');
    setBusy(false);
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
        <div className="entry-photo-actions">
          <button
            className="link-photos-btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Uploading…' : '⬆ Upload photos'}
          </button>
          <button
            className="link-photos-btn"
            onClick={() => (picking ? setPicking(false) : openPicker())}
          >
            📎 {picking ? 'Done' : linked.length ? 'Edit attached' : 'Attach existing'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/heic,image/heif"
            multiple
            hidden
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
      )}
      {note && <span className="muted">{note}</span>}
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
