import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';
import { MAPTILER_STYLE_URL, reverseGeocode } from '../lib/maptiler';
import {
  createEntry,
  createPlace,
  deleteEntry,
  fetchEntriesForDay,
  fetchPlace,
  fetchPlaces,
  updateEntry,
} from '../lib/data';
import { fetchActivitiesForDay, reassignActivity, updateActivity } from '../lib/strava';
import { categoryIcon, categoryLabel } from '../lib/categories';
import type { Activity, Entry, NewEntry, Place } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import EntryEditor from '../components/EntryEditor';
import EntryPhotos from '../components/EntryPhotos';
import PhotoGallery from '../components/PhotoGallery';
import StarRating from '../components/StarRating';

const TYPE_COLORS: Record<string, string> = {
  Hike: '#4dd07a',
  Walk: '#22d3ee',
  Run: '#ff8a3d',
  Ride: '#c98bff',
};
const colorFor = (t: string): string => TYPE_COLORS[t] ?? '#3b82f6';
const fmtDist = (m: number): string => `${(m / 1609.344).toFixed(1)} mi`;
function fmtDur(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const min = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}
function dayLabel(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DayView() {
  const { id, date } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [place, setPlace] = useState<Place | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [editActId, setEditActId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('Run');

  async function saveActivity(a: Activity) {
    await updateActivity(a.id, editName.trim() || a.name || a.type, editType);
    setEditActId(null);
    await fetchActivitiesForDay(id!, date!).then(setActs);
  }

  async function loadEntries() {
    if (id && date) setEntries(await fetchEntriesForDay(id, date));
  }

  useEffect(() => {
    if (!id || !date) return;
    void fetchPlace(id).then(setPlace);
    void fetchActivitiesForDay(id, date).then(setActs);
    void loadEntries();
    if (canEdit)
      void fetchPlaces()
        .then(setAllPlaces)
        .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date]);

  // Move a misgrouped activity to another place — or split it out to a new place
  // at its own start coordinates.
  async function moveToExisting(a: Activity, placeId: string) {
    setMovingId(null);
    await reassignActivity(a.id, placeId);
    await Promise.all([
      fetchActivitiesForDay(id!, date!).then(setActs),
      fetchPlace(id!).then(setPlace),
    ]);
  }
  async function moveToNew(a: Activity) {
    setMovingId(null);
    const geo = await reverseGeocode(a.lng, a.lat).catch(() => null);
    const created = await createPlace({
      name: geo?.name ?? a.name ?? 'Moved activity',
      country: geo?.country ?? null,
      admin1: geo?.admin1 ?? null,
      lng: a.lng,
      lat: a.lat,
    });
    await reassignActivity(a.id, created.id);
    navigate(`/place/${created.id}`);
  }

  // Create the map ONCE (don't recreate on data load, or the drawn route is lost).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAPTILER_STYLE_URL,
      center: [-98, 39],
      zoom: 3,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => setMapReady(true));
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Draw the day's Strava route(s) whenever the map is ready and the data loads.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const bounds = new maplibregl.LngLatBounds();
    for (const a of acts) {
      if (!a.summary_polyline) continue;
      const coords = polyline.decode(a.summary_polyline).map(([lat, lng]) => {
        bounds.extend([lng, lat]);
        return [lng, lat] as [number, number];
      });
      if (coords.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { color: colorFor(a.type) },
      });
    }
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    const src = map.getSource('day') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource('day', { type: 'geojson', data });
      map.addLayer({
        id: 'day-line',
        type: 'line',
        source: 'day',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.9 },
      });
    }
    const mobile = window.innerWidth <= 640;
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: {
          top: 70,
          left: 30,
          right: mobile ? 30 : 380,
          bottom: mobile ? Math.round(window.innerHeight * 0.46) : 40,
        },
        maxZoom: 15,
      });
    } else if (place) {
      // No route that day → at least center on the place.
      map.easeTo({ center: [place.lng, place.lat], zoom: 12, duration: 0 });
    }
  }, [acts, mapReady, place]);

  // The spot's Kind is a category slug; a DB trigger tags the place from it, so
  // after saving we refetch the place to reflect any newly-added tag.
  async function addSpot(draft: NewEntry) {
    await createEntry({ ...draft, place_id: id!, date: draft.date || date! });
    setAdding(false);
    await Promise.all([loadEntries(), fetchPlace(id!).then(setPlace)]);
  }
  async function saveSpot(entryId: string, draft: NewEntry) {
    await updateEntry(entryId, draft);
    setEditingId(null);
    await Promise.all([loadEntries(), fetchPlace(id!).then(setPlace)]);
  }
  async function rate(e: Entry, n: number | null) {
    await updateEntry(e.id, { rating: n ?? undefined });
    await loadEntries();
  }
  async function remove(e: Entry) {
    if (!confirm(`Delete "${e.title}"?`)) return;
    await deleteEntry(e.id);
    await loadEntries();
  }

  return (
    <div className="routes-root">
      <div ref={containerRef} className="map-canvas" />
      <aside className="routes-panel">
        <Link className="back-bar" to={`/place/${id}`}>
          <span>{place?.name ?? 'Place'}</span>
        </Link>
        <h2 style={{ margin: '4px 0' }}>{date ? dayLabel(date) : ''}</h2>

        {/* Strava routes this day */}
        {acts.length > 0 && (
          <>
            <h3>Routes</h3>
            {acts.map((a) => (
              <div className="route-item" key={a.id}>
                <span className="route-dot" style={{ background: colorFor(a.type) }} />
                <div className="route-meta">
                  {editActId === a.id ? (
                    <div className="field-row" style={{ marginBottom: 4 }}>
                      <input
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveActivity(a);
                          if (e.key === 'Escape') setEditActId(null);
                        }}
                      />
                      <select
                        value={editType}
                        onChange={(e) => setEditType(e.target.value)}
                        style={{ width: 'auto' }}
                      >
                        <option value="Run">Run</option>
                        <option value="Hike">Hike</option>
                        <option value="Walk">Walk</option>
                        <option value="Ride">Ride</option>
                      </select>
                      <button
                        className="primary"
                        style={{ flex: 'none' }}
                        onClick={() => void saveActivity(a)}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <strong>
                      {a.name ?? a.type}
                      {canEdit && (
                        <button
                          className="title-edit"
                          title="Rename / fix type"
                          onClick={() => {
                            setEditName(a.name ?? '');
                            setEditType(a.type);
                            setEditActId(a.id);
                          }}
                        >
                          ✏️
                        </button>
                      )}
                    </strong>
                  )}
                  <div className="muted">
                    {a.type} · {fmtDist(a.distance)}
                    {a.moving_time ? ` · ${fmtDur(a.moving_time)}` : ''}
                  </div>
                  {a.strava_id && (
                    <a
                      href={`https://www.strava.com/activities/${a.strava_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Strava ↗
                    </a>
                  )}
                  {canEdit && (
                    <div className="route-move">
                      {movingId === a.id ? (
                        <div className="move-picker">
                          <select
                            defaultValue=""
                            onChange={(e) =>
                              e.target.value && void moveToExisting(a, e.target.value)
                            }
                          >
                            <option value="">Move to an existing place…</option>
                            {allPlaces
                              .filter((p) => p.id !== id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                          <div className="move-picker-row">
                            <button onClick={() => void moveToNew(a)}>＋ New place here</button>
                            <button onClick={() => setMovingId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button className="link-btn" onClick={() => setMovingId(a.id)}>
                          Wrong place? Move ↗
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Photos from this day */}
        {place && (
          <>
            <h3 style={{ marginTop: 18 }}>Photos and Videos this day</h3>
            <PhotoGallery place={place} day={date} />
          </>
        )}

        {/* Spots this day — restaurants, hotels, notes */}
        <h3 style={{ marginTop: 18 }}>Places &amp; spots</h3>
        {entries.length === 0 && !adding && (
          <p className="muted">No spots logged for this day yet.</p>
        )}
        {entries.map((e) =>
          editingId === e.id ? (
            <EntryEditor
              key={e.id}
              placeId={id!}
              existing={e}
              onSave={(d) => saveSpot(e.id, d)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="entry" key={e.id}>
              <div className="entry-head">
                <span className="kind">
                  {e.kind === 'note'
                    ? '📝 Note'
                    : `${categoryIcon(e.kind)} ${categoryLabel(e.kind)}`}
                </span>
                <StarRating
                  value={e.rating}
                  size={16}
                  readOnly={!canEdit}
                  onChange={(n) => void rate(e, n)}
                />
              </div>
              <strong>{e.title}</strong>
              {e.body && <p className="body">{e.body}</p>}
              {e.url && (
                <p style={{ margin: '6px 0 0' }}>
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.url}
                  </a>
                </p>
              )}
              <EntryPhotos
                entryId={e.id}
                placeId={id!}
                lat={place?.lat ?? 0}
                lng={place?.lng ?? 0}
                canEdit={canEdit}
              />
              {canEdit && (
                <div className="row-actions">
                  <button onClick={() => setEditingId(e.id)}>Edit</button>
                  <button className="danger" onClick={() => void remove(e)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ),
        )}

        {canEdit &&
          (adding ? (
            <EntryEditor placeId={id!} onSave={addSpot} onCancel={() => setAdding(false)} />
          ) : (
            <button className="primary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
              + Add a spot
            </button>
          ))}
      </aside>
    </div>
  );
}
