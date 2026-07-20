import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import type { Place } from '../lib/types';

/** Small map above the bucket list: framed on the densest cluster of pins when
 *  compact, expands to show every pin on hover/click. */
export default function BucketMiniMap({ places }: { places: Place[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Bounds of every pin, and of the "most added" region (largest admin1/country group).
  function allBounds() {
    const b = new maplibregl.LngLatBounds();
    for (const p of places) b.extend([p.lng, p.lat]);
    return b;
  }
  function denseBounds() {
    const groups = new Map<string, Place[]>();
    for (const p of places) {
      const k = p.admin1 ?? p.country ?? '—';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    // The "most added" region = the largest group of pins.
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? places;
    const b = new maplibregl.LngLatBounds();
    for (const p of best) b.extend([p.lng, p.lat]);
    return b;
  }

  useEffect(() => {
    if (!ref.current || mapRef.current || places.length === 0) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: MAPTILER_STYLE_URL,
      interactive: false,
      attributionControl: false,
      bounds: denseBounds(),
      fitBoundsOptions: { padding: 26, maxZoom: 9 },
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('bucket', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: places.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: {},
          })),
        },
      });
      map.addLayer({
        id: 'bucket-dots',
        type: 'circle',
        source: 'bucket',
        paint: {
          'circle-radius': 5,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  // Reframe when expanding/collapsing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    const target = expanded ? allBounds() : denseBounds();
    if (!target.isEmpty()) {
      map.fitBounds(target, { padding: expanded ? 40 : 26, maxZoom: expanded ? 12 : 9, duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  if (places.length === 0) return null;

  return (
    <div
      className={`bucket-mini ${expanded ? 'expanded' : ''}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onClick={() => setExpanded((v) => !v)}
    >
      <div ref={ref} className="bucket-mini-canvas" />
      {!expanded && <span className="bucket-mini-hint">Hover to see all ⤢</span>}
    </div>
  );
}
