import { useEffect, useMemo, useState } from 'react';
import { readGps, readTakenAt } from '../lib/photos';
import { haversineMeters } from '../lib/geo';
import type { Place } from '../lib/types';

interface Item {
  file: File;
  url: string;
  takenAt?: string;
  lat?: number;
  lng?: number;
  distM?: number; // metres from this place
  near: boolean; // within match radius
  dateMatch: boolean; // date falls in this place's visit window
  selected: boolean;
}

const NEAR_M = 3000; // within 3 km counts as "here"

function fmtDate(iso?: string): string {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Review picked photos against a place: each shows its own date + distance, and
 *  the ones near this place (or matching its visit dates) are pre-selected. Lets
 *  Erica confirm which actually belong here before uploading. */
export default function PhotoMatchReview({
  place,
  files,
  onConfirm,
  onCancel,
}: {
  place: Place;
  files: File[];
  onConfirm: (selected: File[]) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);

  // Visit window from the place's own span (a little slack on both ends).
  const [winStart, winEnd] = useMemo(() => {
    const s = place.first_visit ? new Date(place.first_visit + 'T00:00:00').getTime() : null;
    const e = place.last_visit ? new Date(place.last_visit + 'T23:59:59').getTime() : s;
    const slack = 2 * 24 * 3600 * 1000;
    return [s == null ? null : s - slack, e == null ? null : e + slack];
  }, [place.first_visit, place.last_visit]);

  useEffect(() => {
    let active = true;
    Promise.all(
      files.map(async (file) => {
        const [g, takenAt] = await Promise.all([
          readGps(file).catch(() => null),
          readTakenAt(file).catch(() => undefined),
        ]);
        const distM =
          g && place.lat != null && place.lng != null
            ? haversineMeters({ lat: g.lat, lng: g.lng }, { lat: place.lat, lng: place.lng })
            : undefined;
        const near = distM != null && distM <= NEAR_M;
        const t = takenAt ? new Date(takenAt).getTime() : null;
        const dateMatch =
          t != null && winStart != null && winEnd != null && t >= winStart && t <= winEnd;
        // Pre-select: clearly here, matches the dates, or we simply can't tell
        // (no GPS) — better to include and let her deselect than silently drop.
        const selected = near || dateMatch || distM == null;
        return {
          file,
          url: URL.createObjectURL(file),
          takenAt,
          lat: g?.lat,
          lng: g?.lng,
          distM,
          near,
          dateMatch,
          selected,
        } as Item;
      }),
    ).then((res) => {
      if (active) setItems(res);
      else res.forEach((r) => URL.revokeObjectURL(r.url));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function toggle(i: number) {
    setItems((cur) =>
      cur ? cur.map((it, idx) => (idx === i ? { ...it, selected: !it.selected } : it)) : cur,
    );
  }

  const chosen = items?.filter((it) => it.selected) ?? [];

  return (
    <div className="photo-match-overlay" role="dialog" aria-label="Match photos to this place">
      <div className="photo-match-card">
        <div className="photo-match-head">
          <b>Photos for {place.name}</b>
          <span className="label">
            {items ? `${chosen.length} of ${items.length} selected` : 'Reading photos…'}
          </span>
        </div>
        <p className="label" style={{ margin: '2px 0 10px' }}>
          Photos taken near here or on your visit dates are pre-checked. Uncheck any that don't
          belong.
        </p>
        {!items ? (
          <p className="label">Reading location &amp; date from each photo…</p>
        ) : (
          <div className="photo-match-grid">
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                className={`photo-match-cell ${it.selected ? 'on' : ''}`}
                onClick={() => toggle(i)}
              >
                <img src={it.url} alt="" />
                <span className="photo-match-check">{it.selected ? '✓' : ''}</span>
                <span className="photo-match-meta">
                  <span>{fmtDate(it.takenAt)}</span>
                  <span
                    className={
                      it.distM == null ? 'muted' : it.near ? 'match-near' : 'match-far'
                    }
                  >
                    {it.distM == null
                      ? 'No location'
                      : it.near
                        ? '📍 near here'
                        : `${(it.distM / 1000).toFixed(0)} km away`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={!items || chosen.length === 0}
            onClick={() => onConfirm(chosen.map((it) => it.file))}
          >
            Add {chosen.length || ''} photo{chosen.length === 1 ? '' : 's'}
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
