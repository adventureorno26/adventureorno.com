import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  deletePhoto,
  fetchPhotoObjectUrl,
  fetchPhotosForPlace,
  fetchPhotosForPlaceOnDay,
  mapPool,
  photosEnabled,
  setPhotoDate,
  uploadPhoto,
} from '../lib/photos';
import { updatePlace } from '../lib/data';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { deleteVideo, fetchVideosForPlace, uploadVideo } from '../lib/videos';
import type { Photo, Place, Video } from '../lib/types';
import AuthedImg from './AuthedImg';
import PhotoReactions from './PhotoReactions';
import VideoTile from './VideoTile';
import VideoPlayer from './VideoPlayer';
import PhotoMatchReview from './PhotoMatchReview';

interface Props {
  place: Place;
  // When set, the gallery shows only this date's photos and pins uploads to it.
  day?: string;
  // Fired after photos are added, so the parent can refresh the place (e.g. to
  // pick up the new cover photo and convert its map marker).
  onUploaded?: () => void;
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

export default function PhotoGallery({ place, day, onUploaded }: Props) {
  const { profile } = useAuth();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [playing, setPlaying] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [overridable, setOverridable] = useState<File[]>([]);
  const [pending, setPending] = useState<{ id: string; url: string }[]>([]); // optimistic previews
  const [lightIdx, setLightIdx] = useState<number | null>(null); // carousel position
  const [datingId, setDatingId] = useState<string | null>(null); // undated photo getting a date
  const [dragOver, setDragOver] = useState(false);
  const [pickMenu, setPickMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const touchX = useRef<number | null>(null);

  const load = (): Promise<Photo[]> =>
    day ? fetchPhotosForPlaceOnDay(place.id, day) : fetchPhotosForPlace(place.id);
  const loadVideos = () =>
    fetchVideosForPlace(place.id)
      .then((v) => setVideos(day ? v.filter((x) => (x.taken_at ?? '').slice(0, 10) === day) : v))
      .catch(() => setVideos([]));

  useEffect(() => {
    if (!photosEnabled()) return;
    let active = true;
    setPhotos(null);
    load()
      .then((rows) => active && setPhotos(rows))
      .catch(() => active && setPhotos([]));
    void loadVideos();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, day]);

  const canUpload = profile?.role === 'owner' || profile?.role === 'editor';
  const canGoogle = profile?.role === 'owner' && googlePhotosEnabled();
  const canDelete = (p: Photo): boolean =>
    profile?.role === 'owner' || p.uploaded_by === profile?.id;

  // Photos chosen for review before upload (place cards only — day view already
  // pins the date, so it uploads straight through).
  const [reviewFiles, setReviewFiles] = useState<File[] | null>(null);

  // Picked from Files/Google → show the location+date match review, unless we're
  // in day view (date fixed) or it's a single photo (nothing to sort).
  function handlePicked(files: File[]) {
    if (files.length === 0) return;
    if (day || files.length === 1) {
      void upload(files, true);
    } else {
      setReviewFiles(files);
    }
  }

  // Import straight from Google Photos → File[] → the review/upload path.
  async function addFromGoogle() {
    try {
      const files = await pickFromGooglePhotos((s) => setNote(s));
      setNote(null);
      if (files.length) handlePicked(files);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
    }
  }

  async function upload(files: File[], override: boolean) {
    if (files.length === 0) return;
    setBusy(true);
    setNote(null);
    const isVid = (f: File) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
    const imgFiles = files.filter((f) => !isVid(f));
    const vidFiles = files.filter(isVid);

    // Optimistic preview — show local thumbnails instantly while they upload.
    const previews = imgFiles.map((f) => ({
      id: `pending-${Math.random()}`,
      url: URL.createObjectURL(f),
    }));
    setPending(previews);

    let added = 0;
    let vids = 0;
    const skips: string[] = [];
    const retryable: File[] = [];

    // Photos upload in parallel (4 at a time) — the big speed win for albums.
    let done = 0;
    const total = imgFiles.length;
    const photoResults = await mapPool(
      imgFiles,
      async (file) => {
        const r = await uploadPhoto(file, {
          placeId: place.id,
          lat: place.lat,
          lng: place.lng,
          override,
          takenAt: day ? `${day}T12:00:00Z` : undefined,
        });
        done++;
        if (total > 1) setNote(`Uploading ${done} of ${total}…`);
        return r;
      },
      4,
    );
    photoResults.forEach((r, i) => {
      if (!r) {
        skips.push(`${imgFiles[i].name} failed`);
        return;
      }
      if (r.ok) added++;
      else if (r.skipped) {
        skips.push(`${imgFiles[i].name} ${SKIP_LABELS[r.skipped] ?? r.skipped}`);
        if (!override && OVERRIDABLE.has(r.skipped)) retryable.push(imgFiles[i]);
      }
    });

    // Videos are large — upload 2 at a time.
    const vidResults = await mapPool(
      vidFiles,
      (file) => uploadVideo(file, { placeId: place.id, lat: place.lat, lng: place.lng }),
      2,
    );
    vidResults.forEach((r) => r?.ok && vids++);

    previews.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
    if (added > 0) setPhotos(await load());
    if (vids > 0) await loadVideos();
    if (added > 0 || vids > 0) onUploaded?.();
    const parts: string[] = [];
    if (added) parts.push(`${added} photo${added > 1 ? 's' : ''} added`);
    if (vids) parts.push(`${vids} video${vids > 1 ? 's' : ''} added`);
    if (skips.length) parts.push(`Skipped: ${skips.join('; ')}`);
    setNote(parts.join(' · ') || 'Nothing to add');
    setOverridable(retryable);
    setBusy(false);
  }

  // Give an undated photo a date (click "Add date" on the thumb).
  async function applyDate(p: Photo, isoDate: string) {
    try {
      await setPhotoDate(p.id, isoDate);
      setDatingId(null);
      setPhotos(await load());
      onUploaded?.(); // dates can extend a visit / change the cover
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not set the date');
    }
  }

  async function setCover(p: Photo) {
    try {
      await updatePlace(place.id, { cover_photo_id: p.id });
      onUploaded?.(); // refresh the place so its map marker updates
      setNote('Cover photo updated.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not set cover');
    }
  }

  async function remove(p: Photo) {
    if (!confirm('Delete this photo permanently? It can never be re-added.')) return;
    try {
      await deletePhoto(p.id);
      setPhotos((prev) => (prev ?? []).filter((x) => x.id !== p.id));
      setLightIdx(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  // ---- Carousel (full-screen photo viewer) ----
  // Strict chronological order (newest first); photos with no EXIF date fall into
  // their upload-time position rather than clumping at the end, so scrolling the
  // carousel always moves through them by date. The gallery groups use the same
  // order, so the flat index the carousel uses matches what you see.
  const list = photos
    ? [...photos].sort((a, b) =>
        (b.taken_at ?? b.created_at ?? '').localeCompare(a.taken_at ?? a.created_at ?? ''),
      )
    : [];
  const openPhoto = lightIdx != null ? list[lightIdx] : null;
  const step = (d: number) =>
    setLightIdx((i) => (i == null || list.length === 0 ? i : (i + d + list.length) % list.length));

  async function download(p: Photo) {
    try {
      const url = await fetchPhotoObjectUrl(p.id, 'full');
      const a = document.createElement('a');
      a.href = url;
      a.download = `adventure-${(p.taken_at ?? '').slice(0, 10) || p.id.slice(0, 8)}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Download failed');
    }
  }

  async function removeVideo(v: Video) {
    if (!confirm('Delete this video permanently?')) return;
    try {
      await deleteVideo(v.id);
      setVideos((prev) => prev.filter((x) => x.id !== v.id));
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  // Keyboard nav for the carousel.
  useEffect(() => {
    if (lightIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightIdx(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightIdx, list.length]);

  function fmtTaken(p: Photo): string {
    if (!p.taken_at) return '';
    const d = new Date(p.taken_at);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Group photos for the gallery. On a place card we bucket by VISIT (a trip can
  // span several days) so each visit is one horizontal carousel; on a single-day
  // view we bucket by day. Every item keeps its flat `list` index so the
  // full-screen carousel still lines up. Within a group photos read oldest→newest.
  const dateOf = (p: Photo) => (p.taken_at ?? '').slice(0, 10);
  const dayLabel = (d: string) =>
    d === 'undated'
      ? 'Undated'
      : new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  const pushDayGroups = (items: { photo: Photo; idx: number }[], out: typeof photoGroups) => {
    const byDate = new Map<string, { photo: Photo; idx: number }[]>();
    for (const it of items) {
      const k = dateOf(it.photo) || 'undated';
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k)!.push(it);
    }
    [...byDate.keys()]
      .sort((a, b) => b.localeCompare(a)) // newest day first
      .forEach((k) => {
        const its = byDate
          .get(k)!
          .sort((a, b) => (a.photo.taken_at ?? '').localeCompare(b.photo.taken_at ?? ''));
        out.push({ key: `d-${k}`, label: dayLabel(k), items: its });
      });
  };

  const photoGroups: { key: string; label: string; items: { photo: Photo; idx: number }[] }[] = [];
  if (list.length) {
    const withIdx = list.map((photo, idx) => ({ photo, idx }));
    if (day) {
      pushDayGroups(withIdx, photoGroups); // day view: this one day
    } else {
      // Every place/trip/trail card: ONE horizontal scrollable row of all photos,
      // newest first. `list` (and thus withIdx) is already sorted newest → oldest.
      photoGroups.push({ key: 'all', label: '', items: withIdx });
    }
  }

  // Guard AFTER all hooks (hooks must run every render).
  if (!photosEnabled()) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        Photo uploads aren’t configured yet (needs the R2 Worker — see setup docs).
      </p>
    );
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
            handlePicked(Array.from(e.dataTransfer.files));
          }}
          onClick={() => setPickMenu((v) => !v)}
          role="button"
          tabIndex={0}
        >
          {busy ? 'Uploading…' : 'Click Or Drag Photos'}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/heic,image/heif,video/*"
            multiple
            hidden
            onChange={(e) => {
              handlePicked(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []), true);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {canUpload && pickMenu && (
        <div className="pick-menu">
          <button
            onClick={() => {
              setPickMenu(false);
              fileRef.current?.click();
            }}
          >
            Choose files
          </button>
          <button
            onClick={() => {
              setPickMenu(false);
              cameraRef.current?.click();
            }}
          >
            Take a photo
          </button>
          {canGoogle && (
            <button
              disabled={busy}
              onClick={() => {
                setPickMenu(false);
                void addFromGoogle();
              }}
            >
              Google Photos
            </button>
          )}
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

      {pending.length > 0 && (
        <div className="photo-date-group">
          <div className="photo-date">Uploading…</div>
          <div className="gallery">
            {pending.map((p) => (
              <div className="thumb uploading" key={p.id}>
                <img src={p.url} alt="" />
                <span className="thumb-spinner" />
              </div>
            ))}
          </div>
        </div>
      )}

      {photos === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading photos…</p>
      ) : photos.length === 0 && videos.length === 0 && pending.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No photos or videos yet.</p>
      ) : (
        <>
          {photoGroups.map((g) => (
            <div className="photo-date-group" key={g.key}>
              {g.label && <div className="photo-date">{g.label}</div>}
              <div className="gallery carousel">
                {g.items.map(({ photo: p, idx }) => (
                  <div
                    className={`thumb ${place.cover_photo_id === p.id ? 'is-cover' : ''}`}
                    key={p.id}
                  >
                    <AuthedImg photoId={p.id} size="thumb" onClick={() => setLightIdx(idx)} />
                    {canUpload && (
                      <button
                        className="thumb-cover"
                        title={
                          place.cover_photo_id === p.id
                            ? 'Cover photo'
                            : 'Set as cover (map marker)'
                        }
                        onClick={() => void setCover(p)}
                      >
                        {place.cover_photo_id === p.id ? '★' : '☆'}
                      </button>
                    )}
                    {canDelete(p) && (
                      <button
                        className="thumb-del"
                        title="Delete photo"
                        onClick={() => void remove(p)}
                      >
                        🗑
                      </button>
                    )}
                    {/* Undated photo → tap to add a date. */}
                    {canUpload &&
                      !p.taken_at &&
                      (datingId === p.id ? (
                        <input
                          type="date"
                          className="thumb-date-input"
                          autoFocus
                          onChange={(e) => e.target.value && void applyDate(p, e.target.value)}
                          onBlur={() => setDatingId(null)}
                        />
                      ) : (
                        <button className="thumb-date" onClick={() => setDatingId(p.id)}>
                          Add date
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {videos.length > 0 && (
            <div className="photo-date-group">
              <div className="photo-date">Videos</div>
              <div className="gallery">
                {videos.map((v) => (
                  <div className="thumb-wrap" key={v.id}>
                    <VideoTile id={v.id} onClick={() => setPlaying(v)} />
                    {canUpload && (
                      <button
                        className="thumb-del"
                        title="Delete video"
                        onClick={() => void removeVideo(v)}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}

      {openPhoto &&
        createPortal(
          <div
            className="lightbox"
            onClick={() => setLightIdx(null)}
            onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchX.current == null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
              touchX.current = null;
            }}
          >
            <button className="lightbox-close" onClick={() => setLightIdx(null)} title="Close">
              ×
            </button>

            {list.length > 1 && (
              <button
                className="lightbox-nav prev"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                title="Previous"
              >
                ‹
              </button>
            )}

            <AuthedImg
              key={openPhoto.id}
              photoId={openPhoto.id}
              size="full"
              alt=""
              className="lightbox-img"
            />

            {list.length > 1 && (
              <button
                className="lightbox-nav next"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                title="Next"
              >
                ›
              </button>
            )}

            {/* Date + count on one line; download as a compact icon. */}
            <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
              <span className="lightbox-meta">
                {fmtTaken(openPhoto)}
                {list.length > 1 && (
                  <span className="lightbox-count">
                    {fmtTaken(openPhoto) ? ' · ' : ''}
                    {(lightIdx ?? 0) + 1} / {list.length}
                  </span>
                )}
              </span>
              <button
                className="lightbox-dl"
                onClick={() => void download(openPhoto)}
                title="Download photo"
                aria-label="Download"
              >
                ⤓
              </button>
            </div>

            <PhotoReactions
              key={openPhoto.id}
              photoId={openPhoto.id}
              caption={openPhoto.caption}
              canEdit={canUpload}
            />
          </div>,
          document.body,
        )}

      {reviewFiles && (
        <PhotoMatchReview
          place={place}
          files={reviewFiles}
          onConfirm={(selected) => {
            setReviewFiles(null);
            void upload(selected, true);
          }}
          onCancel={() => setReviewFiles(null)}
        />
      )}
    </div>
  );
}
