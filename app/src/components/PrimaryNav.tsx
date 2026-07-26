import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

// The app's single persistent primary navigation. Text-only (no icons, per
// Erica's standing preference), styled as a bottom-center glass pill to match
// the existing back-bar / stats-bar language. Rendered globally in App.tsx.
//
// Five destinations: Map (home), Places (the list — previously unreachable),
// Add (the guided add flow), Timeline, and More (settings + Manage-data tools).

const TABS: { to: string; label: string; match?: (path: string) => boolean }[] = [
  { to: '/', label: 'Map', match: (p) => p === '/' || p.startsWith('/place/') },
  { to: '/places', label: 'Places', match: (p) => p === '/places' || p === '/places/edit' },
  { to: '/add', label: 'Add' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/settings', label: 'More', match: (p) => p === '/settings' || p.startsWith('/settings/') },
];

export default function PrimaryNav() {
  const { session, profile } = useAuth();
  const { pathname } = useLocation();

  // Only for signed-in members, and never over the login screen.
  if (!session || !profile || pathname === '/login') return null;

  return (
    <nav className="primary-nav" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.match ? t.match(pathname) : pathname === t.to;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            className={`pnav-tab${active ? ' active' : ''}${t.to === '/add' ? ' pnav-add' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
