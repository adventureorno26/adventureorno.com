import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deletePlace, fetchPlaceDays, mergePlaces, updatePlace } from '../lib/data';
import type { Place, PlaceDay } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { photosEnabled } from '../lib/photos';
import AuthedImg from './AuthedImg';
import PhotoGallery from './PhotoGallery';
import StarRating from './StarRating';

interface Props {
  place: Place;
  allPlaces: Place[];
  onClose: () => void;
  onPlaceChanged: (place: Place) => void;
  onPlaceDeleted: (id: string) => void;
  onMerged: (loserId: string, winner: Place) => void;
}

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daySummary(d: PlaceDay): string {
  const parts: string[] = [];
  if (d.activities) parts.push(`${d.activities} route${d.activities > 1 ? 's' : ''}`);
  if (d.entries) parts.push(`${d.entries} spot${d.entries > 1 ? 's' : ''}`);
  if (d.photos) parts.push(`${d.photos} photo${d.photos > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'Visited';
}

export default function PlacePanel({
  place,
  allPlaces,
  onClose,
  onPlaceChanged,
  onPlaceDeleted,
  onMerged,
}: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [days, setDays] = useState<PlaceDay[] | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Header edit fields
  const [name, setName] = useState(place.name);
  const [country, setCountry] = useState(place.country ?? '');
  // Overall review (rating saves immediately; review has a Save button)
  const [review, setReview] = useState(place.review ?? '');

  useEffect(() => {
    setName(place.name);
    setCountry(place.country ?? '');
    setReview(place.review ?? '');
  }, [place]);

  useEffect(() => {
    let active = true;
    setDays(null);
    fetchPlaceDays(place.id)
      .then((rows) => active && setDays(rows))
      .catch(() => active && setDays([]));
    return () => {
      active = false;
    };
  }, [place.id]);

  async function patch(p: Parameters<typeof updatePlace>[1]) {
    try {
      const updated = await updatePlace(place.id, p);
      onPlaceChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  async function saveHeader() {
    await patch({ name: name.trim() || place.name, country: country.trim() || null, auto: false });
    setEditingHeader(false);
  }

  async function mergeFrom(loserId: string) {
    const loser = allPlaces.find((p) => p.id === loserId);
    if (!loser) return;
    if (!confirm(`Merge "${loser.name}" into "${place.name}"? "${loser.name}" will be deleted.`))
      return;
    try {
      await mergePlaces(loserId, place.id);
      onMerged(loserId, place);
      setMerging(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not merge places');
    }
  }

  async function removePlace() {
    if (!confirm(`Delete "${place.name}" and everything in it?`)) return;
    try {
      await deletePlace(place.id);
      onPlaceDeleted(place.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete place');
    }
  }

  const hasHero = Boolean(place.cover_photo_id) && photosEnabled();

  return (
    <aside className="panel">
      {hasHero ? (
        <div className="panel-hero">
          <AuthedImg photoId={place.cover_photo_id!} size="full" className="panel-hero-img" />
          <button className="close hero-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="hero-title">
            <h2>
              {place.name}
              {place.auto && !place.is_home && <span className="auto-badge">auto</span>}
            </h2>
          </div>
        </div>
      ) : (
        <div className="panel-head">
          <h2>
            {place.name}
            {place.auto && !place.is_home && (
              <span className="auto-badge" title="Auto-created by clustering">
                auto
              </span>
            )}
          </h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      )}
      <div className="meta">
        {[place.admin1, place.country].filter(Boolean).join(', ') || 'Unknown region'}
        {place.visit_count > 0 &&
          ` · ${place.visit_count} day${place.visit_count > 1 ? 's' : ''} here`}
      </div>

      {error && <div className="banner">{error}</div>}

      {/* Overall rating + review */}
      <div className="rating-row">
        <StarRating
          value={place.rating}
          readOnly={!canEdit}
          onChange={(n) => void patch({ rating: n })}
        />
      </div>
      {canEdit ? (
        <div>
          <textarea
            placeholder="Add a review of this place…"
            value={review}
            onChange={(e) => setReview(e.target.value)}
            style={{ minHeight: 60 }}
          />
          {review !== (place.review ?? '') && (
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button
                className="primary"
                onClick={() => void patch({ review: review.trim() || null })}
              >
                Save review
              </button>
              <button onClick={() => setReview(place.review ?? '')}>Cancel</button>
            </div>
          )}
        </div>
      ) : (
        place.review && <p className="body">{place.review}</p>
      )}

      {canEdit &&
        (editingHeader ? (
          <div className="entry">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} />
            <div className="btn-row">
              <button className="primary" onClick={() => void saveHeader()}>
                Save
              </button>
              <button onClick={() => setEditingHeader(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button onClick={() => setEditingHeader(true)}>Edit</button>
            <button onClick={() => setMerging((v) => !v)}>Merge…</button>
            <button className="danger" onClick={() => void removePlace()}>
              Delete
            </button>
          </div>
        ))}

      {merging && (
        <div className="entry">
          <label>Merge another place into this one (it will be deleted)</label>
          <select
            defaultValue=""
            onChange={(e) => e.target.value && void mergeFrom(e.target.value)}
          >
            <option value="" disabled>
              Choose a place to absorb…
            </option>
            {allPlaces
              .filter((p) => p.id !== place.id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.admin1 ? ` — ${p.admin1}` : ''}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Visits — each day links to the day view (map + spots) */}
      <h3 style={{ marginTop: 22 }}>Visits</h3>
      {days === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : days.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No dated visits yet.</p>
      ) : (
        <div className="visits">
          {days.map((d) => (
            <Link key={d.day} className="visit-row" to={`/place/${place.id}/day/${d.day}`}>
              <span className="visit-main">
                {d.label ? (
                  <>
                    <span className="visit-name">{d.label}</span>
                    <span className="visit-date sub">{dayLabel(d.day)}</span>
                  </>
                ) : (
                  <>
                    <span className="visit-date">{dayLabel(d.day)}</span>
                    <span className="visit-date sub">{daySummary(d)}</span>
                  </>
                )}
              </span>
              <span className="visit-arrow">›</span>
            </Link>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 22 }}>Photos</h3>
      <PhotoGallery place={place} />
    </aside>
  );
}
