import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  addBoardItem,
  addSharedLink,
  deleteBoardItem,
  deleteSharedLink,
  fetchBoardItems,
  fetchSharedLinks,
  setBoardItemDone,
} from '../lib/hub';
import type { BoardItem, BoardKind, SharedLink } from '../lib/types';

const BOARDS: { key: BoardKind; label: string; hint: string }[] = [
  { key: 'drink', label: 'Want to drink', hint: 'Wine, cocktails… (paste a CellarTracker/Vivino link)' },
  { key: 'eat', label: 'Want to eat', hint: 'Restaurants, dishes to try' },
  { key: 'watch', label: 'Want to watch', hint: 'Movies & shows (Letterboxd link works)' },
  { key: 'visit', label: 'Want to visit', hint: 'Places & experiences' },
  { key: 'listen', label: 'Listen together', hint: 'Paste a song.link / Odesli link — opens in either app' },
];

function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export default function SharedHub() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [links, setLinks] = useState<SharedLink[]>([]);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [lLabel, setLLabel] = useState('');
  const [lUrl, setLUrl] = useState('');

  function load() {
    fetchSharedLinks().then(setLinks).catch(() => setLinks([]));
    fetchBoardItems().then(setItems).catch(() => setItems([]));
  }
  useEffect(load, []);

  async function onAddLink() {
    if (!lLabel.trim() || !lUrl.trim()) return;
    try {
      const row = await addSharedLink(lLabel.trim(), normalizeUrl(lUrl));
      setLinks((prev) => [...prev, row]);
      setLLabel('');
      setLUrl('');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add link');
    }
  }
  async function onDeleteLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    try {
      await deleteSharedLink(id);
    } catch {
      load();
    }
  }

  return (
    <div className="shared-hub">
      {msg && <div className="banner">{msg}</div>}

      {/* Reference links both of you share. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Shared links</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Your joint accounts & lists — CellarTracker cellar, grocery list, watchlist…
        </p>
        <div className="hub-links">
          {links.length === 0 && <p className="muted" style={{ fontSize: 13 }}>None yet.</p>}
          {links.map((l) => (
            <div key={l.id} className="hub-link-row">
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
              {canEdit && (
                <button className="link-btn" onClick={() => void onDeleteLink(l.id)}>
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="field-row" style={{ marginTop: 10 }}>
            <input placeholder="Label" value={lLabel} onChange={(e) => setLLabel(e.target.value)} />
            <input
              placeholder="https://…"
              value={lUrl}
              onChange={(e) => setLUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void onAddLink()}
            />
            <button className="primary" style={{ flex: 'none' }} onClick={() => void onAddLink()}>
              Add
            </button>
          </div>
        )}
      </div>

      {/* Want-to boards. */}
      {BOARDS.map((b) => (
        <Board
          key={b.key}
          board={b.key}
          label={b.label}
          hint={b.hint}
          canEdit={canEdit}
          items={items.filter((i) => i.board === b.key)}
          onChanged={load}
          setItems={setItems}
        />
      ))}
    </div>
  );
}

function Board({
  board,
  label,
  hint,
  canEdit,
  items,
  onChanged,
  setItems,
}: {
  board: BoardKind;
  label: string;
  hint: string;
  canEdit: boolean;
  items: BoardItem[];
  onChanged: () => void;
  setItems: React.Dispatch<React.SetStateAction<BoardItem[]>>;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  async function add() {
    if (!title.trim()) return;
    try {
      const row = await addBoardItem(board, title.trim(), url.trim() ? normalizeUrl(url) : undefined);
      setItems((prev) => [row, ...prev]);
      setTitle('');
      setUrl('');
    } catch {
      onChanged();
    }
  }
  async function toggle(it: BoardItem) {
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)),
    );
    try {
      await setBoardItemDone(it.id, !it.done);
    } catch {
      onChanged();
    }
  }
  async function remove(it: BoardItem) {
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    try {
      await deleteBoardItem(it.id);
    } catch {
      onChanged();
    }
  }

  return (
    <div className="card board-card">
      <h3 style={{ marginTop: 0 }}>{label}</h3>
      {canEdit && (
        <div className="field-row">
          <input
            placeholder="Add something…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <input
            placeholder="link (optional)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <button className="primary" style={{ flex: 'none' }} onClick={() => void add()}>
            Add
          </button>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {hint}
      </p>
      <div className="board-items">
        {open.length === 0 && done.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>Nothing here yet.</p>
        )}
        {open.map((it) => (
          <div key={it.id} className="board-item">
            {canEdit && (
              <input type="checkbox" checked={false} onChange={() => void toggle(it)} title="Mark done" />
            )}
            <span className="board-item-title">
              {it.url ? (
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
              ) : (
                it.title
              )}
            </span>
            {canEdit && (
              <button className="link-btn" onClick={() => void remove(it)}>
                remove
              </button>
            )}
          </div>
        ))}
        {done.map((it) => (
          <div key={it.id} className="board-item done">
            {canEdit && (
              <input type="checkbox" checked onChange={() => void toggle(it)} title="Mark not done" />
            )}
            <span className="board-item-title">{it.title}</span>
            {canEdit && (
              <button className="link-btn" onClick={() => void remove(it)}>
                remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
