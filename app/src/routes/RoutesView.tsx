import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import { fetchPlace } from '../lib/data';
import { fetchActivitiesForPlace } from '../lib/strava';
import { fetchPlacePings, walkSegments } from '../lib/walks';
import type { Activity, Place } from '../lib/types';

// Color by activity type (business rule: color by type).
const TYPE_COLORS: Record<string, string> = {
  Hike: '#4dd07a',
  Walk: '#4f9dff',
  Run: '#ff8a3d',
  Ride: '#c98bff',
};
function colorFor(type: string): string {
  return TYPE_COLORS[type] ?? '#ffcc4d';
}

function fmtDist(m: number): string {
  return `${(m / 1609.344).toFixed(1)} mi`;
}
function fmtDur(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const min = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export default function RoutesView() {
  const { id } = useParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [walks, setWalks] = useState<[number, number][][]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!id) return;
    void fetchPlace(id).then(setPlace);
    void fetchActivitiesForPlace(id).then(setActivities);
    void fetchPlacePings(id)
      .then((pings) => setWalks(walkSegments(pings)))
      .catch(() => setWalks([]));
  }, [id]);

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

  // Draw the decoded polylines once the map is ready and data has loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const draw = () => {
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const bounds = new maplibregl.LngLatBounds();
      for (const a of activities) {
        if (!a.summary_polyline) continue;
        const coords = polyline.decode(a.summary_polyline).map(([lat, lng]) => {
          bounds.extend([lng, lat]);
          return [lng, lat] as [number, number];
        });
        if (coords.length < 2) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { color: colorFor(a.type), dash: 0 },
        });
      }
      // Passive walks (from location pings, driving/flying excluded) — dashed blue.
      for (const seg of walks) {
        for (const c of seg) bounds.extend(c);
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: seg },
          properties: { color: '#4f9dff', dash: 1 },
        });
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      const src = map.getSource('routes') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource('routes', { type: 'geojson', data });
        map.addLayer({
          id: 'routes-line',
          type: 'line',
          source: 'routes',
          filter: ['==', ['get', 'dash'], 0],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.9 },
        });
        map.addLayer({
          id: 'routes-walks',
          type: 'line',
          source: 'routes',
          filter: ['==', ['get', 'dash'], 1],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.85,
            'line-dasharray': [2, 2],
          },
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
          maxZoom: 14,
        });
      }
    };

    draw();
  }, [activities, walks, mapReady]);

  return (
    <div className="routes-root">
      <div ref={containerRef} className="map-canvas" />
      <aside className="routes-panel">
        <Link className="back-bar" to={`/place/${id}`}>
          <span>{place?.name ?? 'Place'}</span>
        </Link>
        <h2>
          Routes {activities.length > 0 && <span className="muted">({activities.length})</span>}
        </h2>
        {activities.length === 0 ? (
          <p className="muted">No Strava activities recorded here yet.</p>
        ) : (
          activities.map((a) => (
            <div className="route-item" key={a.id}>
              <span className="route-dot" style={{ background: colorFor(a.type) }} />
              <div className="route-meta">
                <strong>{a.name ?? a.type}</strong>
                <div className="muted">
                  {a.type} · {fmtDist(a.distance)}
                  {a.moving_time ? ` · ${fmtDur(a.moving_time)}` : ''}
                  {a.start_date ? ` · ${a.start_date.slice(0, 10)}` : ''}
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
          ))
        )}
      </aside>
    </div>
  );
}
