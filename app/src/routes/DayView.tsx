import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import {
  createEntry,
  deleteEntry,
  fetchEntriesForDay,
  fetchPlace,
  updateEntry,
} from '../lib/data';
import { fetchActivitiesForDay } from '../lib/strava';
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
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [place, setPlace] = useState<Place | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function loadEntries() {
    if (id && date) setEntries(await fetchEntriesForDay(id, date));
  }

  useEffect(() => {
    if (!id || !date) return;
    void fetchPlace(id).then(setPlace);
    void fetchActivitiesForDay(id, date).then(setActs);
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date]);

  // Map init + draw the day's routes.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAPTILER_STYLE_URL,
      center: place ? [place.lng, place.lat] : [0, 20],
      zoom: 11,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [place]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || acts.length === 0) return;
    const draw = () => {
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
      if (!bounds.isEmpty()) {
        const mobile = window.innerWidth <= 640;
        map.fitBounds(bounds, {
          padding: {
            top: 70,
            left: 30,
            right: mobile ? 30 : 380,
            bottom: mobile ? Math.round(window.innerHeight * 0.46) : 40,
          },
          maxZoom: 15,
        });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [acts]);

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
                  <strong>{a.name ?? a.type}</strong>
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
                </div>
              </div>
            ))}
          </>
        )}

        {/* Photos from this day */}
        {place && (
          <>
            <h3 style={{ marginTop: 18 }}>Photos this day</h3>
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
              <EntryPhotos entryId={e.id} placeId={id!} canEdit={canEdit} />
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
