import { useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Place } from '../lib/types';
import AuthedImg from './AuthedImg';

/** Ambient "fly through our memories" mode, plus a one-tap "Surprise" that jumps
 *  to a random place. Both reuse the live map; captions show the place + photo. */
export default function Slideshow({
  mapRef,
  places,
}: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  places: Place[];
}) {
  const [on, setOn] = useState(false);
  const [current, setCurrent] = useState<Place | null>(null);
  const order = useRef<Place[]>([]);
  const idx = useRef(0);
  const timer = useRef<number>();

  // Only saved, non-bucket places that actually have a photo to show.
  const withPhotos = useMemo(
    () => places.filter((p) => p.cover_photo_id && p.saved && !p.bucket),
    [places],
  );

  function flyTo(p: Place) {
    setCurrent(p);
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 6.5, duration: 2600, essential: true });
  }

  function shuffled(): Place[] {
    // Index-seeded shuffle; fine for a slideshow.
    const a = [...withPhotos];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function surprise() {
    if (withPhotos.length === 0) return;
    flyTo(withPhotos[Math.floor(Math.random() * withPhotos.length)]);
  }

  useEffect(() => {
    window.clearInterval(timer.current);
    if (!on) return;
    order.current = shuffled();
    idx.current = 0;
    if (order.current.length === 0) {
      setOn(false);
      return;
    }
    const advance = () => {
      const list = order.current;
      flyTo(list[idx.current % list.length]);
      idx.current++;
    };
    advance();
    timer.current = window.setInterval(advance, 6000);
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  if (withPhotos.length === 0) return null;

  return (
    <>
      <div className="slideshow-controls">
        <button onClick={() => setOn((v) => !v)}>{on ? 'Stop' : 'Slideshow'}</button>
        {!on && <button onClick={surprise}>Surprise me</button>}
      </div>

      {on && current && (
        <div className="slideshow-caption">
          {current.cover_photo_id && (
            <AuthedImg photoId={current.cover_photo_id} size="thumb" className="slideshow-thumb" />
          )}
          <div className="slideshow-text">
            <div className="slideshow-name">{current.name}</div>
            <div className="slideshow-region">
              {[current.admin1, current.country].filter(Boolean).join(', ')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
