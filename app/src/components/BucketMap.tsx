import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { MAPTILER_STYLE_URL } from '../lib/maptiler';
import type { Place } from '../lib/types';

/** Map on the bucket page: pan/zoom your want-to-go pins and tap one to open its
 *  card. Adding places is done from the search box (not by clicking the map). */
export default function BucketMap({ places }: { places: Place[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const navigate = useNavigate();
  const placesRef = useRef(places);
  placesRef.current = places;

  function dotsData(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: placesRef.current.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { id: p.id },
      })),
    };
  }

  // Init once.
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of places) bounds.extend([p.lng, p.lat]);
    const map = new maplibregl.Map({
      container: ref.current,
      style: MAPTILER_STYLE_URL,
      bounds: bounds.isEmpty() ? undefined : bounds,
      center: bounds.isEmpty() ? [-98, 39] : undefined,
      zoom: bounds.isEmpty() ? 3 : undefined,
      fitBoundsOptions: { padding: 40, maxZoom: 9 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      map.addSource('bpins', { type: 'geojson', data: dotsData() });
      map.addLayer({
        id: 'bpins',
        type: 'circle',
        source: 'bpins',
        paint: {
          'circle-radius': 6,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });

      map.on('mouseenter', 'bpins', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'bpins', () => (map.getCanvas().style.cursor = ''));

      // Only an existing pin opens its card. Clicking the map does NOT add a
      // place — use the search box for that (avoids accidental additions).
      map.on('click', 'bpins', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) navigate(`/place/${id}`);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pins in sync as the list changes.
  useEffect(() => {
    const src = mapRef.current?.getSource('bpins') as GeoJSONSource | undefined;
    src?.setData(dotsData());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  return (
    <div className="bucket-map">
      <div ref={ref} className="bucket-map-canvas" />
      <span className="bucket-map-hint">Tap a pin to open it</span>
    </div>
  );
}
