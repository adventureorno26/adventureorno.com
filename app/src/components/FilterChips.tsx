import { categoryLabel } from '../lib/categories';
import type { PersonContact } from '../lib/memoryPeople';
import type { PeopleSelection } from '../lib/statsScope';

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
  peopleSel: PeopleSelection | null;
  people: PersonContact[];
  visibleCount: number;
  onClearCat: () => void;
  onClearPerson: () => void;
  onReset: () => void;
}) {
  // MY STATS IS NOT A FILTER, it is where everything opens (§0.2) — so the chip appears
  // only once somebody else is in the scope. It used to appear whenever anybody was
  // selected, which under the new default would mean a permanent "Erica ×" chip offering
  // to clear a filter nobody applied.
  const others = peopleSel
    ? peopleSel.people
        .map((id) => people.find((p) => p.id === id))
        .filter((p): p is PersonContact => !!p && !p.is_me)
    : [];
  const active = filterCat !== null || others.length > 0;
  if (!active) return null;

  // NAMES, JOINED BY "and" — Our Stats is the overlap, so it is only ever "and". The old
  // control could also ask for "or", which is two people's histories shuffled together.
  const names = others.map((p) => p.display_name);
  const personLabel = !names.length
    ? null
    : names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

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
