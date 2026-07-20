import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { MAPTILER_STYLE_URL, reverseGeocode } from '../lib/maptiler';
import { createPlace } from '../lib/data';
import type { Place } from '../lib/types';

/** Interactive map on the bucket page: pan/zoom, tap a city label or anywhere to
 *  drop a want-to-go pin (opens its card to edit), and tap an existing pin to
 *  open it. Same feel as the main map, scoped to bucket-list places. */
export default function BucketMap({ places, onAdded }: { places: Place[]; onAdded: () => void }) {
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

      map.on('click', async (e) => {
        // Tapped an existing pin → open it.
        const onPin = map.queryRenderedFeatures(e.point, { layers: ['bpins'] });
        if (onPin.length > 0) {
          const id = onPin[0].properties?.id as string | undefined;
          if (id) navigate(`/place/${id}`);
          return;
        }
        // Tapped a city/town label → use its name; else reverse-geocode the spot.
        const label = map.queryRenderedFeatures(e.point).find((f) => {
          const lid = f.layer.id;
          return (
            f.geometry.type === 'Point' &&
            f.properties &&
            (f.properties.name || f.properties['name:en'] || f.properties.name_en) &&
            lid !== 'bpins'
          );
        });
        const { lng, lat } = e.lngLat;
        const presetName = label
          ? ((label.properties!.name ||
              label.properties!['name:en'] ||
              label.properties!.name_en) as string)
          : undefined;
        try {
          const geo = presetName ? null : await reverseGeocode(lng, lat).catch(() => null);
          const created = await createPlace({
            name: presetName ?? geo?.name ?? 'New place',
            country: geo?.country ?? null,
            admin1: geo?.admin1 ?? null,
            lng,
            lat,
            bucket: true,
          });
          onAdded();
          navigate(`/place/${created.id}`);
        } catch {
          /* ignore add errors */
        }
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
      <span className="bucket-map-hint">Tap a place or city to add it</span>
    </div>
  );
}
