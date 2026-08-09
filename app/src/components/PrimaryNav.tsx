import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

// The app's single persistent primary navigation. Text-only (no icons, per
// Erica's standing preference), styled as a bottom-center glass pill to match
// the existing back-bar / stats-bar language. Rendered globally in App.tsx.
//
// Five destinations: Map (home), Places (the list — previously unreachable),
// Add, Timeline, and More (settings + Manage-data tools).
//
// Add is not a page. It opens the ONE add sheet over the map (?add=1), the same
// sheet the map's "+ Add" button opens — it used to be a separate five-step
// wizard at /add that could not add photos or import from Google Photos, which
// is how the app ended up with two different answers to "add something".

/** The Add sheet opens OVER the map, so while it is open the map is not the
 *  current tab — Add is. */
const addOpen = (search: string) => new URLSearchParams(search).get('add') === '1';

const TABS: { to: string; label: string; match?: (path: string, search: string) => boolean }[] = [
  { to: '/', label: 'Map', match: (p, s) => (p === '/' || p.startsWith('/place/')) && !addOpen(s) },
  { to: '/places', label: 'Places', match: (p) => p === '/places' || p === '/places/edit' },
  // Add is a sheet, not a page, so it highlights on its query flag rather than a path.
  { to: '/?add=1', label: 'Add', match: (_p, s) => addOpen(s) },
  { to: '/timeline', label: 'Timeline' },
  { to: '/settings', label: 'More', match: (p) => p === '/settings' || p.startsWith('/settings/') },
];

export default function PrimaryNav() {
  const { session, profile } = useAuth();
  const { pathname, search } = useLocation();

  // Only for signed-in members, and never over the login screen.
  if (!session || !profile || pathname === '/login') return null;

  return (
    <nav className="primary-nav" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.match ? t.match(pathname, search) : pathname === t.to && !addOpen(search);
        return (
          <NavLink
            key={t.to}
            to={t.to}
            className={`pnav-tab${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
