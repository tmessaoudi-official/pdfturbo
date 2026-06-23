const KEY = 'pdfturbo.recentColors';
const MAX = 8;

export const COLOR_PRESETS: readonly string[] = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#ff9900',
  '#ffff00',
  '#00cc00',
  '#0066ff',
  '#9900ff',
  '#888888',
  '#a52a2a',
];

let _mem: string[] = [];

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return _mem;
    // #QA-2026-06-23 P2: a corrupted value (e.g. `{}` or `"x"`) must not crash the startup
    // swatch-row spread (`[...COLOR_PRESETS, ...getRecentColors()]`). Validate the shape.
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : _mem;
  } catch {
    return _mem;
  }
}

function write(list: string[]): void {
  _mem = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export function getRecentColors(): string[] {
  return read();
}

export function pushRecentColor(hex: string): void {
  const norm = hex.toLowerCase();
  const next = [norm, ...read().filter((c) => c.toLowerCase() !== norm)].slice(0, MAX);
  write(next);
}
