import { useState } from 'react';
import { ENTRY_KINDS, type Entry, type EntryKind, type NewEntry } from '../lib/types';

interface Props {
  placeId: string;
  existing?: Entry;
  onSave: (draft: NewEntry) => Promise<void>;
  onCancel: () => void;
}

/** Inline add/edit form for a single entry. */
export default function EntryEditor({ placeId, existing, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<EntryKind>(existing?.kind ?? 'restaurant');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [rating, setRating] = useState<string>(existing?.rating ? String(existing.rating) : '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [date, setDate] = useState(existing?.date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        place_id: placeId,
        kind,
        title: title.trim(),
        body: body.trim() || null,
        rating: rating ? Number(rating) : null,
        url: url.trim() || null,
        date: date || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save entry.');
      setBusy(false);
    }
  }

  return (
    <form className="entry" onSubmit={submit}>
      <div className="field-row">
        <div>
          <label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>
            {ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Rating</label>
          <select value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {'★'.repeat(n)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

      <label>Notes (markdown)</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} />

      <div className="field-row">
        <div>
          <label>Date</label>
          <input type="date" value={date ?? ''} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label>Link</label>
          <input
            type="url"
            value={url}
            placeholder="https://"
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="btn-row">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Add entry'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
