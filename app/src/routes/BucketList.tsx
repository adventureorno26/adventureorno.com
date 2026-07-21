import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { createPlace, fetchBucketPlaces } from '../lib/data';
import { retrieveResult, type SearchResult } from '../lib/maptiler';
import { categoryIcon, categoryLabel, effectiveCategories } from '../lib/categories';
import type { Place } from '../lib/types';
import { BucketIcon, PinIcon } from '../components/Icons';
import MapSearch from '../components/MapSearch';
import BucketMap from '../components/BucketMap';

export default function BucketList() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    fetchBucketPlaces()
      .then(setPlaces)
      .catch(() => setMsg('Could not load your bucket list'));
  }
  useEffect(load, []);

  // Group by US state, or by country for everywhere else; both sorted A→Z.
  const groups = useMemo(() => {
    const map = new Map<string, { items: Place[]; isState: boolean }>();
    for (const p of places ?? []) {
      const isUS = (p.country ?? '').match(/^(United States|USA|US)$/i);
      const key = isUS ? p.admin1 ?? 'United States' : p.country ?? 'Other';
      if (!map.has(key)) map.set(key, { items: [], isState: Boolean(isUS) });
      map.get(key)!.items.push(p);
    }
    // US states first (A→Z), then other countries at the bottom (A→Z).
    return [...map.entries()]
      .sort((a, b) => {
        if (a[1].isState !== b[1].isState) return a[1].isState ? -1 : 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, g]) => ({
        label,
        items: g.items.sort((x, y) => x.name.localeCompare(y.name)),
      }));
  }, [places]);

  // Search → add a want-to-go place (flagged bucket = true; distinct map pin).
  async function addFromSearch(r: SearchResult) {
    setBusy(true);
    setMsg(null);
    try {
      const full = r.mapbox_id ? await retrieveResult(r).catch(() => r) : r;
      if (full.lat === 0 && full.lng === 0) {
        setMsg("Couldn't resolve that place — try another.");
        return;
      }
      await createPlace({
        name: full.name,
        country: full.country,
        admin1: full.admin1,
        address: full.address,
        lat: full.lat,
        lng: full.lng,
        bucket: true,
        saved: true,
      });
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add to bucket list');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1 className="bucket-title">
        <span className="bucket-title-ico">
          <BucketIcon size={22} />
        </span>
        Bucket List
      </h1>

      <BucketMap places={places ?? []} onAdded={load} />

      {canEdit && (
        <div className="card" style={{ margin: '14px 0 20px' }}>
          <div className="bucket-search">
            <MapSearch onPick={addFromSearch} />
          </div>
          {busy && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>Adding…</div>}
        </div>
      )}

      {msg && <div className="banner">{msg}</div>}

      {places === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : places.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Nothing here yet.</p>
      ) : (
        groups.map((g) => (
          <section key={g.label} style={{ marginTop: 18 }}>
            <h3 className="bucket-group-head">{g.label}</h3>
            <div className="trip-places">
              {g.items.map((p) => (
                <Link key={p.id} className="trip-place" to={`/place/${p.id}`}>
                  <span className="result-pin bucket">
                    <PinIcon size={14} />
                  </span>{' '}
                  {p.name}
                  <span className="place-row-cats" style={{ marginLeft: 6 }}>
                    {effectiveCategories(p).map((s) => (
                      <span key={s} title={categoryLabel(s)}>
                        {categoryIcon(s)}
                      </span>
                    ))}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
