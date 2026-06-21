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
    return raw ? (JSON.parse(raw) as string[]) : _mem;
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
