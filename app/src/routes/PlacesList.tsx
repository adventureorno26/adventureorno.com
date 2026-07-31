import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fetchPlaces, updatePlace } from '../lib/data';
import {
  MANUAL_CATEGORIES,
  categoryIcon,
  categoryLabel,
  effectiveCategories,
} from '../lib/categories';
import type { Place } from '../lib/types';

export default function PlacesList() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [places, setPlaces] = useState<Place[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState(MANUAL_CATEGORIES[0].slug);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetchPlaces()
      .then((rows) => setPlaces(rows.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setMsg('Could not load places'));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? places.filter(
          (p) =>
            p.name.toLowerCase().includes(s) ||
            (p.admin1 ?? '').toLowerCase().includes(s) ||
            (p.country ?? '').toLowerCase().includes(s),
        )
      : places;
  }, [places, q]);

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allShownSelected = filtered.length > 0 && filtered.every((p) => sel.has(p.id));
  function toggleAll() {
    setSel(allShownSelected ? new Set() : new Set(filtered.map((p) => p.id)));
  }

  async function applyTag(add: boolean) {
    if (sel.size === 0) return;
    setBusy(true);
    setMsg(null);
    const targets = places.filter((p) => sel.has(p.id));
    await Promise.all(
      targets.map((p) => {
        const cur = p.categories ?? [];
        const next = add ? [...new Set([...cur, tag])] : cur.filter((c) => c !== tag);
        return updatePlace(p.id, { categories: next }).catch(() => undefined);
      }),
    );
    setMsg(
      `${add ? 'Added' : 'Removed'} ${categoryLabel(tag)} ${add ? 'to' : 'from'} ${sel.size} place${sel.size > 1 ? 's' : ''}.`,
    );
    setSel(new Set());
    setBusy(false);
    load();
  }

  return (
    <div style={{ maxWidth: 760, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Places</h1>

      <input
        placeholder="Search places…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ margin: '8px 0 14px' }}
      />

      {canEdit && (
        <div className="bulk-bar card">
          <label style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={toggleAll}
              style={{ width: 'auto', marginRight: 6 }}
            />
            Select all ({filtered.length})
          </label>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>{sel.size} selected</span>
          <div className="spacer" style={{ flex: 1 }} />
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label="Tag to apply to the selected places"
            style={{ width: 'auto' }}
          >
            {MANUAL_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={busy || sel.size === 0}
            onClick={() => void applyTag(true)}
          >
            Add tag
          </button>
          <button disabled={busy || sel.size === 0} onClick={() => void applyTag(false)}>
            Remove
          </button>
        </div>
      )}
      {msg && <div className="banner">{msg}</div>}

      <div className="place-rows">
        {filtered.map((p) => (
          <div key={p.id} className={`place-row ${sel.has(p.id) ? 'sel' : ''}`}>
            {canEdit && (
              <input
                type="checkbox"
                checked={sel.has(p.id)}
                onChange={() => toggle(p.id)}
                style={{ width: 'auto' }}
              />
            )}
            <Link to={`/place/${p.id}`} className="place-row-main">
              <span className="place-row-name">{p.name}</span>
              <span className="place-row-sub">
                {[p.admin1, p.country].filter(Boolean).join(', ')}
                {p.rating ? ` · ${'★'.repeat(p.rating)}` : ''}
              </span>
            </Link>
            <span className="place-row-cats">
              {effectiveCategories(p).map((s) => (
                <span key={s} title={categoryLabel(s)}>
                  {categoryIcon(s)}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
