import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { MAPTILER_STYLE_URL, reverseGeocode } from '../lib/maptiler';
import { createPlaceAtomic } from '../lib/data';
import { showSnack } from '../lib/snackbar';
import type { Place } from '../lib/types';

/** Map on the bucket page: pan/zoom your want-to-go pins, tap one to open its
 *  card, and tap a city/place NAME on the map to add it (empty clicks do nothing,
 *  so you can pan without accidental adds). */
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

      // Tapping an existing pin opens its card. Tapping a city/place NAME adds it
      // (empty map clicks do nothing → no accidental adds while panning).
      map.on('click', async (e) => {
        const onPin = map.queryRenderedFeatures(e.point, { layers: ['bpins'] });
        if (onPin.length > 0) {
          const id = onPin[0].properties?.id as string | undefined;
          if (id) navigate(`/place/${id}`);
          return;
        }
        const label = map.queryRenderedFeatures(e.point).find((f) => {
          const nm = f.properties?.name || f.properties?.['name:en'] || f.properties?.name_en;
          return f.geometry.type === 'Point' && nm && f.layer.id !== 'bpins';
        });
        if (!label) return; // empty click → nothing
        const name = (label.properties!.name ||
          label.properties!['name:en'] ||
          label.properties!.name_en) as string;
        const { lng, lat } = e.lngLat;
        try {
          const geo = await reverseGeocode(lng, lat).catch(() => null);
          await createPlaceAtomic({
            name,
            country: geo?.country ?? null,
            admin1: geo?.admin1 ?? null,
            lng,
            lat,
            bucket: true,
            saved: true,
          });
          onAdded(); // refresh the bucket map/list; stay on this page (no jump to main map)
          showSnack({ message: `Added ${name} to your bucket list.` });
        } catch (e) {
          // Tapping a label and getting NOTHING back is indistinguishable from a
          // mis-tap, so a failed add used to look like "the map ignored me".
          showSnack({
            message:
              e instanceof Error ? `Could not add ${name}: ${e.message}` : `Could not add ${name}.`,
          });
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
      <span className="bucket-map-hint">Tap a place name to add it</span>
    </div>
  );
}
