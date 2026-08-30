import { categoryLabel } from '../lib/categories';
import type { PersonContact } from '../lib/memoryPeople';
import { scopeNames, type PeopleSelection } from '../lib/statsScope';

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
  //
  // THIS IS WHERE THE MAP NAMES WHO OUR STATS IS ABOUT, and since 2026-08-30 it is the only
  // place: the scope control below carries the two scope words and nobody's name. A chip
  // and a pill are not the same thing — the chip says what is currently narrowing the map
  // and clears it; the pill offered to SELECT a person, which is the third scope asked on a
  // screen about me (§0.2: "never a pill on my map").
  //
  // NAMES, JOINED BY "and" — Our Stats is the overlap, so it is only ever "and". The old
  // control could also ask for "or", which is two people's histories shuffled together.
  // The joining lives in lib/statsScope so this row and the scope's own sentence cannot
  // read a set of people out differently.
  const personLabel = peopleSel ? scopeNames(peopleSel, people) : '';
  const active = filterCat !== null || personLabel !== '';
  if (!active) return null;

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
