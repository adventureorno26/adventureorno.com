import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import { fetchPlace } from '../lib/data';
import { fetchActivitiesForPlace } from '../lib/strava';
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

  useEffect(() => {
    if (!id) return;
    void fetchPlace(id).then(setPlace);
    void fetchActivitiesForPlace(id).then(setActivities);
  }, [id]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAPTILER_STYLE_URL,
      center: place ? [place.lng, place.lat] : [0, 20],
      zoom: 10,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [place]);

  // Draw the decoded polylines once map + activities are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || activities.length === 0) return;

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
          properties: { color: colorFor(a.type), id: a.id },
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
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.9 },
        });
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [activities]);

  return (
    <div className="routes-root">
      <div ref={containerRef} className="map-canvas" />
      <aside className="routes-panel">
        <p>
          <Link to={`/place/${id}`}>← {place?.name ?? 'Place'}</Link>
        </p>
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
