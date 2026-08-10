import type { MapPerson } from '../lib/data';

/** "Together / Just me / Just Josh" toggle. Only appears once at least two people
 *  have added or recorded something. */
export default function PersonFilter({
  people,
  value,
  onChange,
  meId,
}: {
  people: MapPerson[];
  value: string | null;
  onChange: (id: string | null) => void;
  meId?: string;
}) {
  if (people.length < 2) return null;

  const label = (p: MapPerson) => (p.id === meId ? 'Just me' : `Just ${p.display_name ?? '…'}`);

  return (
    <div className="person-filter">
      <button className={value === null ? 'on' : ''} onClick={() => onChange(null)}>
        Together
      </button>
      {people.map((p) => (
        <button key={p.id} className={value === p.id ? 'on' : ''} onClick={() => onChange(p.id)}>
          {label(p)}
        </button>
      ))}
    </div>
  );
}
