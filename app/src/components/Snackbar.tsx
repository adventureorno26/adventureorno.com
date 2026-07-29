import { useEffect, useState } from 'react';
import { hideSnack, subscribeSnack, type SnackState } from '../lib/snackbar';

/** Renders the global snackbar (undo after delete, etc.). Mount once in App. */
export default function Snackbar() {
  const [snack, setSnack] = useState<SnackState | null>(null);
  useEffect(() => subscribeSnack(setSnack), []);
  if (!snack) return null;
  return (
    <div className="snackbar" role="status">
      <span>{snack.message}</span>
      {snack.actionLabel && (
        <button
          onClick={() => {
            snack.onAction?.();
            hideSnack();
          }}
        >
          {snack.actionLabel}
        </button>
      )}
    </div>
  );
}
