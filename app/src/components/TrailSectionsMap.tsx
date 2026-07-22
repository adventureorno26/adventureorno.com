import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import polyline from '@mapbox/polyline';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import { fetchActivitiesForPlace } from '../lib/strava';
import type { Place } from '../lib/types';

const TYPE_COLORS: Record<string, string> = {
  Hike: '#4dd07a',
  Walk: '#4f9dff',
  Run: '#ff8a3d',
  Ride: '#c98bff',
};

/** One fitted map showing every section of a trail — each member place's route(s)
 *  plus a dot at its location, zoomed to the whole trail. Members-only (not all
 *  hikes everywhere). Tapping a dot opens that section. Renders nothing until it
 *  has at least one section to plot. */
export default function TrailSectionsMap({
  trail,
  sections,
}: {
  trail: Place;
  sections: Place[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const navigate = useNavigate();
  const [hasData, setHasData] = useState<boolean | null>(null);
  const sectionIds = sections.map((s) => s.id).join(',');

  useEffect(() => {
    let cancelled = false;
    async function build() {
      const lines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const dots: GeoJSON.Feature<GeoJSON.Point>[] = [];
      const bounds = new maplibregl.LngLatBounds();

      const perSection = await Promise.all(
        sections.map((s) => fetchActivitiesForPlace(s.id).catch(() => [])),
      );
      sections.forEach((s, i) => {
        if (s.lat != null && s.lng != null) {
          bounds.extend([s.lng, s.lat]);
          dots.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
            properties: { id: s.id, name: s.name },
          });
        }
        for (const a of perSection[i]) {
          if (!a.summary_polyline) continue;
          const coords = polyline.decode(a.summary_polyline).map(([la, ln]) => {
            bounds.extend([ln, la]);
            return [ln, la] as [number, number];
          });
          if (coords.length < 2) continue;
          lines.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { color: TYPE_COLORS[a.type] ?? '#ffcc4d' },
          });
        }
      });

      if (cancelled) return;
      if (dots.length === 0 || bounds.isEmpty()) {
        setHasData(false);
        return;
      }
      setHasData(true);
      requestAnimationFrame(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAPTILER_STYLE_URL,
          center: [trail.lng, trail.lat],
          zoom: 9,
          interactive: true,
          attributionControl: false,
        });
        mapRef.current = map;
        map.on('load', () => {
          map.addSource('trail-lines', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: lines },
          });
          map.addLayer({
            id: 'trail-lines',
            type: 'line',
            source: 'trail-lines',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.95 },
          });
          map.addSource('trail-dots', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: dots },
          });
          map.addLayer({
            id: 'trail-dots',
            type: 'circle',
            source: 'trail-dots',
            paint: {
              'circle-radius': 6,
              'circle-color': '#ffffff',
              'circle-stroke-color': '#2f7d5b',
              'circle-stroke-width': 3,
            },
          });
          map.on('click', 'trail-dots', (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (id) navigate(`/place/${id}`);
          });
          map.on('mouseenter', 'trail-dots', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'trail-dots', () => {
            map.getCanvas().style.cursor = '';
          });
          map.fitBounds(bounds, { padding: 30, maxZoom: 13, animate: false });
        });
      });
    }
    void build();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail.id, sectionIds]);

  if (hasData === false) return null;

  return (
    <div className="trail-sections-map">
      <div ref={containerRef} className="trail-sections-canvas" />
    </div>
  );
}
