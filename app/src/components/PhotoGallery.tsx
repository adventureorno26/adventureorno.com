import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  deletePhoto,
  fetchPhotosForPlace,
  fetchPhotosForPlaceOnDay,
  photosEnabled,
  uploadPhoto,
} from '../lib/photos';
import type { Photo, Place } from '../lib/types';
import AuthedImg from './AuthedImg';

interface Props {
  place: Place;
  // When set, the gallery shows only this date's photos and pins uploads to it.
  day?: string;
}

const SKIP_LABELS: Record<string, string> = {
  deleted: 'was deleted before and can’t be re-added',
  duplicate: 'is already here',
  no_gps: 'has no GPS location',
  screenshot: 'looks like a screenshot',
  home_zone: 'is inside the home zone',
  undecodable: 'could not be read as an image',
};
// Skips a deliberate manual upload is allowed to override.
const OVERRIDABLE = new Set(['screenshot', 'home_zone']);

export default function PhotoGallery({ place, day }: Props) {
  const { profile } = useAuth();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [overridable, setOverridable] = useState<File[]>([]);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = (): Promise<Photo[]> =>
    day ? fetchPhotosForPlaceOnDay(place.id, day) : fetchPhotosForPlace(place.id);

  useEffect(() => {
    if (!photosEnabled()) return;
    let active = true;
    setPhotos(null);
    load()
      .then((rows) => active && setPhotos(rows))
      .catch(() => active && setPhotos([]));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, day]);

  if (!photosEnabled()) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        Photo uploads aren’t configured yet (needs the R2 Worker — see setup docs).
      </p>
    );
  }

  const canUpload = profile?.role === 'owner' || profile?.role === 'editor';
  const canDelete = (p: Photo): boolean =>
    profile?.role === 'owner' || p.uploaded_by === profile?.id;

  async function upload(files: File[], override: boolean) {
    if (files.length === 0) return;
    setBusy(true);
    setNote(null);
    let added = 0;
    const skips: string[] = [];
    const retryable: File[] = [];
    for (const file of files) {
      try {
        const r = await uploadPhoto(file, {
          placeId: place.id,
          lat: place.lat,
          lng: place.lng,
          override,
          takenAt: day ? `${day}T12:00:00Z` : undefined,
        });
        if (r.ok) added++;
        else if (r.skipped) {
          skips.push(`${file.name} ${SKIP_LABELS[r.skipped] ?? r.skipped}`);
          if (!override && OVERRIDABLE.has(r.skipped)) retryable.push(file);
        }
      } catch (e) {
        skips.push(`${file.name} failed: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    if (added > 0) setPhotos(await load());
    const parts: string[] = [];
    if (added) parts.push(`${added} photo${added > 1 ? 's' : ''} added`);
    if (skips.length) parts.push(`Skipped: ${skips.join('; ')}`);
    setNote(parts.join(' · ') || 'Nothing to add');
    setOverridable(retryable);
    setBusy(false);
  }

  async function remove(p: Photo) {
    if (!confirm('Delete this photo permanently? It can never be re-added.')) return;
    try {
      await deletePhoto(p.id);
      setPhotos((prev) => (prev ?? []).filter((x) => x.id !== p.id));
      if (lightbox?.id === p.id) setLightbox(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div>
      {canUpload && (
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(Array.from(e.dataTransfer.files), false);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          {busy ? 'Uploading…' : 'Drag photos here, or click to choose'}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/heic,image/heif"
            multiple
            hidden
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []), false);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {note && (
        <div className="banner" style={{ marginTop: 8 }}>
          {note}
          {overridable.length > 0 && (
            <button
              style={{ marginLeft: 8 }}
              disabled={busy}
              onClick={() => void upload(overridable, true)}
            >
              Upload {overridable.length} anyway
            </button>
          )}
        </div>
      )}

      {photos === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading photos…</p>
      ) : photos.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No photos yet.</p>
      ) : (
        <div className="gallery">
          {photos.map((p) => (
            <div className="thumb" key={p.id}>
              <AuthedImg photoId={p.id} size="thumb" onClick={() => setLightbox(p)} />
              {canDelete(p) && (
                <button className="thumb-del" title="Delete photo" onClick={() => void remove(p)}>
                  🗑
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <AuthedImg photoId={lightbox.id} size="full" alt="" className="lightbox-img" />
          <button className="lightbox-close" onClick={() => setLightbox(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
