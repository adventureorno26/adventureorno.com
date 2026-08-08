// The two reaction marks Erica picked (2026-08-08), and their shapes.
// Kept out of the component file so that file only exports a component.
export const LOVE = '❤️'; // heart
export const CRUSHED = '\u{1f525}'; // flame

export const MARKS = [
  { emoji: LOVE, label: 'Love it', hue: '#f2385a' },
  { emoji: CRUSHED, label: 'Crushed it', hue: '#ff7a2f' },
] as const;

export const PATHS: Record<string, string> = {
  [LOVE]: 'M12 19.9 5.4 13.3a4.5 4.5 0 1 1 6.6-6.1 4.5 4.5 0 1 1 6.6 6.1Z',
  [CRUSHED]:
    'M12 2.8c4.6 3.4 6.4 6 6.4 9.4a6.4 6.4 0 0 1-12.8 0c0-1.9.8-3.5 1.9-4.7.3 1.3 1.1 2.1 2 2.1 1.4 0 2.5-1.6 2.5-6.8Z',
};

export function hueFor(emoji: string): string | undefined {
  return MARKS.find((m) => m.emoji === emoji)?.hue;
}
export function labelFor(emoji: string): string | undefined {
  return MARKS.find((m) => m.emoji === emoji)?.label;
}
