import { useEffect, useRef } from 'react';

// Accessibility helper for modal dialogs: moves focus into the dialog on open,
// closes on Escape, and traps Tab focus inside it (so keyboard users can't wander
// behind the modal). Attach the returned ref to the dialog container element,
// which should also carry role="dialog" aria-modal="true".
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  // Keep the latest onClose without re-running the mount effect (which would
  // steal focus on every keystroke as the closure identity changes).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prevFocus = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => n.offsetParent !== null);

    // Focus the first field/control, else the container itself.
    const first = focusables()[0];
    (first ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      // Restore focus to whatever opened the dialog.
      prevFocus?.focus?.();
    };
    // Mount-only: focus/trap setup shouldn't re-run as onClose identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
