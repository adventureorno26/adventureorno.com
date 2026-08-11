import { useState } from 'react';
import type { Entry, NewEntry } from '../lib/types';
import { CATEGORIES } from '../lib/categories';
import StarRating from './StarRating';

interface Props {
  placeId: string;
  existing?: Entry;
  defaultDate?: string; // pre-fill the date for a new spot (e.g. from the main card)
  onSave: (draft: NewEntry) => Promise<void>;
  onCancel: () => void;
}

/** Inline add/edit form for a spot. Its "Kind" is a category tag (Dining,
 *  Winery, …) which auto-tags the place; 'note' is a plain note. */
export default function EntryEditor({ placeId, existing, defaultDate, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<string>(existing?.kind ?? 'dining');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [url, setUrl] = useState(existing?.url ?? '');
  const [date, setDate] = useState(existing?.date ?? defaultDate ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [lat, setLat] = useState<number | null>(existing?.lat ?? null);
  const [lng, setLng] = useState<number | null>(existing?.lng ?? null);
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
        rating,
        url: url.trim() || null,
        date: date || null,
        address: address.trim() || null,
        lat,
        lng,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save entry.');
      setBusy(false);
    }
  }

  return (
    <form className="entry" onSubmit={submit}>
      <label>Kind (tags this place so it shows in the tag search)</label>
      <select className="kind-select" value={kind} onChange={(e) => setKind(e.target.value)}>
        {CATEGORIES.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
        <option value="note">Note</option>
      </select>

      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

      <label hidden>Address</label>
      <input
        hidden
        value={address}
        placeholder="Street address"
        onChange={(e) => {
          setAddress(e.target.value);
          // A hand-typed address no longer matches the searched coordinates;
          // clear them so Directions routes by the address text instead.
          setLat(null);
          setLng(null);
        }}
      />
      {(address.trim() || (lat != null && lng != null)) && (
        <a
          className="directions-btn sm"
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
          href={`https://maps.apple.com/?daddr=${encodeURIComponent(
            address.trim() || `${lat},${lng}`,
          )}${lat != null && lng != null ? `&sll=${lat},${lng}` : ''}&dirflg=d`}
          target="_blank"
          rel="noreferrer"
        >
          Directions to this spot
        </a>
      )}

      <label>Rating</label>
      <StarRating value={rating} onChange={setRating} />

      <label>Notes</label>
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
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Add spot'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
