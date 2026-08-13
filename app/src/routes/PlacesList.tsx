import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fetchPlaces, updatePlace } from '../lib/data';
import {
  MANUAL_CATEGORIES,
  categoryIcon,
  categoryLabel,
  effectiveCategories,
} from '../lib/categories';
import { buildPlaceTree } from '../lib/containers';
import type { Place } from '../lib/types';
import StatsBar from '../components/StatsBar';

export default function PlacesList() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [places, setPlaces] = useState<Place[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState(MANUAL_CATEGORIES[0].slug);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [openContainers, setOpenContainers] = useState<Set<string>>(new Set());

  function load() {
    setFailed(false);
    fetchPlaces()
      .then((rows) => setPlaces(rows.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {
        setPlaces([]);
        setFailed(true);
      });
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? (places ?? []).filter(
          (p) =>
            p.name.toLowerCase().includes(s) ||
            (p.admin1 ?? '').toLowerCase().includes(s) ||
            (p.country ?? '').toLowerCase().includes(s),
        )
      : (places ?? []);
  }, [places, q]);

  // A container holds other places; it appears ONCE and lists each section
  // once. Searching flattens the list so a match can never hide inside a
  // collapsed container. (docs/STATE.md §2.)
  const tree = useMemo(() => buildPlaceTree(filtered), [filtered]);
  const searching = q.trim() !== '';
  const rows = useMemo(
    () =>
      searching
        ? filtered.map((p) => ({ place: p, sections: [] }))
        : tree.map((n) => ({ place: n.place, sections: n.sections })),
    [searching, filtered, tree],
  );

  function toggleContainer(id: string) {
    setOpenContainers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    const targets = (places ?? []).filter((p) => sel.has(p.id));
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

  // One row, whether it is a place, a container, or a section of one — a
  // section is a place in its own right and reads like every other row.
  function row(p: Place, sectionCount: number, open: boolean) {
    return (
      <div key={p.id} className={`place-row ${sel.has(p.id) ? 'sel' : ''}`}>
        {canEdit && (
          <input
            type="checkbox"
            checked={sel.has(p.id)}
            onChange={() => toggle(p.id)}
            // Without this every row's checkbox is just "checkbox" to a screen
            // reader — 183 identical, unselectable-by-name controls, and the
            // single largest accessibility defect in the app (axe: critical,
            // 366 nodes). The row's name is the only thing that distinguishes
            // them, and it drives a BULK tag/untag, so picking the wrong one
            // is destructive.
            aria-label={`Select ${p.name || 'unnamed place'}`}
            style={{ width: 'auto' }}
          />
        )}
        <Link to={`/place/${p.id}`} className="place-row-main">
          {/* An unnamed draft (the map's "drop a pin, name it on the card"
              flow) rendered as an empty span, so the row had no label and no
              tappable text — invisible and unopenable, which is exactly the
              state Data Health's "Unnamed places" signal wants you to fix.
              Label it like the rest of the app does instead of hiding it. */}
          <span className="place-row-name">{p.name || 'Unnamed place'}</span>
          <span className="place-row-sub">
            {[p.admin1, p.country].filter(Boolean).join(', ')}
            {p.rating ? ` · ${'★'.repeat(p.rating)}` : ''}
          </span>
        </Link>
        {/* Text, not a chevron — the disclosure says what is inside. */}
        {sectionCount > 0 && (
          <button
            type="button"
            className="place-row-open"
            aria-expanded={open}
            onClick={() => toggleContainer(p.id)}
          >
            {open ? 'Hide' : `${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}`}
          </button>
        )}
        <span className="place-row-cats">
          {effectiveCategories(p).map((s) => (
            <span key={s} title={categoryLabel(s)}>
              {categoryIcon(s)}
            </span>
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Places</h1>

      {/* STATS AT THE TOP OF PLACES (Erica, 2026-08-11: "the stats section was supposed
          to be moved to the top of places"). The same bar the map uses, so the numbers
          cannot disagree between the two pages — one component, one backend call. */}
      {places && places.length > 0 && (
        <StatsBar places={places} onFilterCategory={() => undefined} />
      )}

      <input
        placeholder="Search places…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ margin: '8px 0 14px' }}
      />

      {canEdit && filtered.length > 0 && (
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

      {/* Loading / failure / empty / no-match states — never a stranded blank page. */}
      {places === null ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 24 }}>Loading places…</p>
      ) : failed ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 24 }}>
          Couldn’t load places.{' '}
          <button
            onClick={load}
            type="button"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--accent, #38bdf8)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </p>
      ) : places.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 24 }}>
          No places yet. Add one from the <Link to="/">map</Link>.
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 24 }}>
          No places match “{q.trim()}”.
        </p>
      ) : null}

      <div className="place-rows">
        {rows.map(({ place: p, sections }) => {
          const open = openContainers.has(p.id);
          return (
            <Fragment key={p.id}>
              {row(p, sections.length, open)}
              {/* Opening a container gives its sections — each listed once,
                  each opening to its own card and its own dates. */}
              {open && sections.length > 0 && (
                <div className="place-sections">{sections.map((s) => row(s, 0, false))}</div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
