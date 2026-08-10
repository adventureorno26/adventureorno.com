import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// MapLibre 6 dropped the default export; the namespace import keeps every
// maplibregl.X call site below working unchanged.
import * as maplibregl from 'maplibre-gl';
import polyline from '@mapbox/polyline';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import { fetchActivitiesForPlace } from '../lib/strava';
import { fetchPlacePings, walkSegments } from '../lib/walks';
import type { Place } from '../lib/types';

const TYPE_COLORS: Record<string, string> = {
  Hike: '#4dd07a',
  Walk: '#4f9dff',
  Run: '#ff8a3d',
  Ride: '#c98bff',
};

/** Small non-interactive map at the bottom of a place card overlaying that
 *  place's walking/hiking/running routes (Strava + passive pings). Tap to open
 *  the full-screen Routes view. Renders nothing when there's no route data. */
export default function RouteMiniMap({ place }: { place: Place }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const navigate = useNavigate();
  const [hasData, setHasData] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function build() {
      const [acts, pings] = await Promise.all([
        fetchActivitiesForPlace(place.id).catch(() => []),
        fetchPlacePings(place.id).catch(() => []),
      ]);
      if (cancelled) return;
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const bounds = new maplibregl.LngLatBounds();
      for (const a of acts) {
        if (!a.summary_polyline) continue;
        const coords = polyline.decode(a.summary_polyline).map(([la, ln]) => {
          bounds.extend([ln, la]);
          return [ln, la] as [number, number];
        });
        if (coords.length < 2) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { color: TYPE_COLORS[a.type] ?? '#ffcc4d', dash: 0 },
        });
      }
      // Passive walks from pings (dashed to distinguish from logged activities).
      for (const seg of walkSegments(pings)) {
        for (const c of seg) bounds.extend(c);
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: seg },
          properties: { color: '#4f9dff', dash: 1 },
        });
      }
      if (features.length === 0 || bounds.isEmpty()) {
        setHasData(false);
        return;
      }
      setHasData(true);
      // Build the map now that we know there's something to show.
      requestAnimationFrame(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAPTILER_STYLE_URL,
          center: [place.lng, place.lat],
          zoom: 11,
          interactive: false,
          attributionControl: false,
        });
        mapRef.current = map;
        map.on('load', () => {
          map.addSource('mini-routes', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          });
          map.addLayer({
            id: 'mini-solid',
            type: 'line',
            source: 'mini-routes',
            filter: ['==', ['get', 'dash'], 0],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.95 },
          });
          map.addLayer({
            id: 'mini-dash',
            type: 'line',
            source: 'mini-routes',
            filter: ['==', ['get', 'dash'], 1],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 2.5,
              'line-opacity': 0.8,
              'line-dasharray': [2, 2],
            },
          });
          map.fitBounds(bounds, { padding: 22, maxZoom: 14, animate: false });
        });
      });
    }
    void build();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [place.id, place.lat, place.lng]);

  if (hasData === false) return null;

  return (
    <div className="route-mini">
      <h3 style={{ marginTop: 22 }}>Routes here</h3>
      <button
        className="route-mini-map"
        onClick={() => navigate(`/place/${place.id}/routes`)}
        aria-label="Open full routes map"
        title="Tap to enlarge"
      >
        <div ref={containerRef} className="route-mini-canvas" />
        <span className="route-mini-hint">Tap to enlarge ⤢</span>
      </button>
    </div>
  );
}
