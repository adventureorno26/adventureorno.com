// Tiny global snackbar (for undo after a delete, etc.). Any module can call
// showSnack(); a single <Snackbar /> mounted in App subscribes and renders it.

export interface SnackState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Sub = (s: SnackState | null) => void;

let current: SnackState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<Sub>();

function emit() {
  subs.forEach((f) => f(current));
}

export function showSnack(s: SnackState, ms = 6000): void {
  if (timer) clearTimeout(timer);
  current = s;
  emit();
  timer = setTimeout(() => {
    current = null;
    emit();
  }, ms);
}

export function hideSnack(): void {
  if (timer) clearTimeout(timer);
  current = null;
  emit();
}

export function subscribeSnack(f: Sub): () => void {
  subs.add(f);
  f(current);
  return () => subs.delete(f);
}
