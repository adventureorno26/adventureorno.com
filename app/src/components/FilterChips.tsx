import { categoryLabel } from '../lib/categories';
import type { PersonContact } from '../lib/memoryPeople';
import type { PeopleSelection } from './PeopleFilter';

// Shows the currently-active map filters as removable chips, with a Reset, and
// explains an empty filtered result. Renders nothing when no filter is active.
export default function FilterChips({
  filterCat,
  peopleSel,
  people,
  visibleCount,
  onClearCat,
  onClearPerson,
  onReset,
}: {
  filterCat: string | null;
  peopleSel: PeopleSelection;
  people: PersonContact[];
  visibleCount: number;
  onClearCat: () => void;
  onClearPerson: () => void;
  onReset: () => void;
}) {
  const active = filterCat !== null || peopleSel.people.length > 0;
  if (!active) return null;

  // NAMES, JOINED BY THE MODE — because "Erica, Josh" is ambiguous and "Erica and Josh"
  // versus "Erica or Josh" is the whole difference between the two answers.
  const names = peopleSel.people.map(
    (id) => people.find((p) => p.id === id)?.display_name ?? 'them',
  );
  const personLabel = !names.length
    ? null
    : names.length === 1
      ? names[0]
      : names.join(peopleSel.mode === 'all' ? ' and ' : ' or ');

  return (
    <div className="filter-chips" role="region" aria-label="Active filters">
      <div className="fc-row">
        {filterCat && (
          <button className="fc-chip" onClick={onClearCat}>
            {categoryLabel(filterCat)}
            <span aria-hidden>×</span>
          </button>
        )}
        {personLabel && (
          <button className="fc-chip" onClick={onClearPerson}>
            {personLabel}
            <span aria-hidden>×</span>
          </button>
        )}
        <button className="fc-reset" onClick={onReset}>
          Reset filters
        </button>
      </div>
      {visibleCount === 0 && (
        <div className="fc-empty">
          No places match these filters.{' '}
          <button className="fc-reset inline" onClick={onReset}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}
