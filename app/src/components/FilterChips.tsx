import { categoryLabel } from '../lib/categories';
import type { MapPerson } from '../lib/data';

// Shows the currently-active map filters as removable chips, with a Reset, and
// explains an empty filtered result. Renders nothing when no filter is active.
export default function FilterChips({
  filterCat,
  personFilter,
  people,
  meId,
  visibleCount,
  onClearCat,
  onClearPerson,
  onReset,
}: {
  filterCat: string | null;
  personFilter: string | null;
  people: MapPerson[];
  meId?: string;
  visibleCount: number;
  onClearCat: () => void;
  onClearPerson: () => void;
  onReset: () => void;
}) {
  const active = filterCat !== null || personFilter !== null;
  if (!active) return null;

  const personLabel =
    personFilter == null
      ? null
      : personFilter === meId
        ? 'Just me'
        : `Just ${people.find((p) => p.id === personFilter)?.display_name ?? 'them'}`;

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
