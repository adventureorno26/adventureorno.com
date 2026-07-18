import { useEffect, useState } from 'react';
import {
  assignPhotoToPlace,
  fetchUnassignedPhotos,
  photosEnabled,
  uploadPhoto,
} from '../lib/photos';
import type { Photo, Place } from '../lib/types';
import { haversineMeters } from '../lib/geo';
import AuthedImg from './AuthedImg';

interface Props {
  places: Place[];
  onChanged: () => void;
}

/** Photos with no place yet (before Phase 3 clustering runs, or manual uploads
 *  without a place). Lets the user attach each to the nearest / chosen place. */
export default function UnassignedTray({ places, onChanged }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setPhotos(await fetchUnassignedPhotos());
    } catch {
      setPhotos([]);
    }
  }

  useEffect(() => {
    if (photosEnabled()) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!photosEnabled() || photos.length === 0) return null;

  function nearestPlaceId(p: Photo): string | null {
    let best: { id: string; d: number } | null = null;
    for (const pl of places) {
      const d = haversineMeters({ lat: p.lat, lng: p.lng }, { lat: pl.lat, lng: pl.lng });
      if (!best || d < best.d) best = { id: pl.id, d };
    }
    return best?.id ?? null;
  }

  async function assign(photo: Photo, placeId: string) {
    setBusy(true);
    await assignPhotoToPlace(photo.id, placeId);
    await refresh();
    onChanged();
    setBusy(false);
  }

  async function addFromDevice(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        await uploadPhoto(f); // no place — lands in the tray for assignment
      } catch {
        /* skip surfaced count below via refresh */
      }
    }
    await refresh();
    setBusy(false);
  }

  return (
    <div className={`tray ${open ? 'open' : ''}`}>
      <button className="tray-head" onClick={() => setOpen((v) => !v)}>
        📷 {photos.length} photo{photos.length > 1 ? 's' : ''} awaiting a place {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="tray-body">
          <label className="tray-add">
            + Add photos
            <input
              type="file"
              accept="image/jpeg,image/heic,image/heif"
              multiple
              hidden
              onChange={(e) => {
                void addFromDevice(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {photos.map((p) => {
            const nearest = nearestPlaceId(p);
            return (
              <div className="tray-item" key={p.id}>
                <AuthedImg photoId={p.id} size="thumb" className="tray-thumb" />
                <div className="tray-controls">
                  <select
                    defaultValue={nearest ?? ''}
                    disabled={busy}
                    onChange={(e) => e.target.value && void assign(p, e.target.value)}
                  >
                    <option value="" disabled>
                      Assign to place…
                    </option>
                    {places.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
