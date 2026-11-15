// @vitest-environment jsdom
// The privacy page names what the app stores (phone-signature-pad row 8, panel round 5 S2): every localStorage and
// sessionStorage key the CODE writes is named in a <code> under the right storage kind, in EACH language block of
// public/privacy.html, and every IndexedDB object store the code creates has its <li data-storage="…">. The reverse holds
// too: every key the page names is one the code (or a library listed below) writes. The keys are read from the code's
// own constants, never from the page.
//
// Bound, hand-listed rather than scanned: storage written by LIBRARIES — i18next's language detector writes `i18nextLng`
// (pinned below to `caches: ['localStorage']` in src/utils/i18n.ts), tesseract.js keeps the OCR language data in its own
// IndexedDB, workbox keeps its expiration list in its own IndexedDB and the precache in Cache Storage. The page describes
// those three in prose; this test does not see a change in what a library stores.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../..');
type Kind = 'localStorage' | 'sessionStorage';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });
}
const shipped = (): string[] => [
  ...walk(join(ROOT, 'src')),
  join(ROOT, 'index.html'),
  join(ROOT, 'pad.html'),
  ...readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.html')).map((n) => join(ROOT, 'public', n)),
];
// Comments out, strings kept (a key is a string).
const uncomment = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** A key argument: a literal, or an identifier bound ONCE in the file by `const X = '…'`. Anything else throws. */
function resolveKey(arg: string, src: string, file: string): string {
  const lit = /^(['"])(.*)\1$/.exec(arg);
  if (lit) return lit[2];
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) throw new Error(`${file}: storage key "${arg}" is neither a literal nor a constant — name it in a const`);
  const vals = new Set([...src.matchAll(new RegExp(`\\bconst\\s+${arg}\\s*=\\s*(['"])(.*?)\\1`, 'g'))].map((m) => m[2]));
  if (vals.size !== 1) throw new Error(`${file}: storage key constant ${arg} resolves to ${vals.size} values`);
  return [...vals][0];
}

const LAYOUT_WRAPPER = 'src/ui/layoutStorage.ts';

export interface Stored { keys: Map<string, Kind>; stores: Set<string> }

/** What the shipped code writes, read from its own source. Exported for the sabotage fixtures below. */
export function scanStored(files: Array<{ file: string; src: string }>): Stored {
  const keys = new Map<string, Kind>();
  const stores = new Set<string>();
  const add = (k: string, kind: Kind, file: string) => {
    if (keys.has(k) && keys.get(k) !== kind) throw new Error(`${file}: ${k} written to both kinds`);
    keys.set(k, kind);
  };
  for (const { file, src: raw } of files) {
    const src = uncomment(raw);
    // Every storage access must be one of the four calls (or the i18n detector's string): a bracket or a property
    // access would escape the scan below.
    for (const m of src.matchAll(/(['"`]?)\b(localStorage|sessionStorage)\b(?!\s*\.(?:getItem|setItem|removeItem|clear)\s*\()/g)) {
      if (m[1]) continue; // inside a string ('localStorage' in i18n's detector options)
      throw new Error(`${file}: an unrecognised ${m[2]} access — only getItem/setItem/removeItem/clear are scanned`);
    }
    // The wrapper itself writes its `key` PARAMETER; its callers' keys are read below instead.
    if (file !== LAYOUT_WRAPPER) {
      for (const m of src.matchAll(/\b(localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*([^,]+?)\s*,/g)) add(resolveKey(m[2], src, file), m[1] as Kind, file);
    }
    // The ILayoutStorage wrapper takes the key as a parameter: its callers' save() keys are localStorage keys.
    if (/from\s+['"][./]*(?:ui\/)?layoutStorage['"]/.test(src)) {
      for (const m of src.matchAll(/[sS]torage\s*\.\s*save\s*\(\s*([^,]+?)\s*,/g)) add(resolveKey(m[1], src, file), 'localStorage', file);
    }
    for (const m of src.matchAll(/\bcreateObjectStore\s*\(\s*([^,)]+?)\s*[,)]/g)) stores.add(resolveKey(m[1], src, file));
  }
  return { keys, stores };
}

const LIBRARY_KEYS: ReadonlyMap<string, Kind> = new Map([['i18nextLng', 'localStorage']]);

function pageBlocks(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (['en', 'fr', 'ar'] as const).map((lang) => {
    // The header's title carries .lc-xx too: the language block is main's div.
    const block = doc.querySelector(`main > div.lc-${lang}`);
    if (!block) throw new Error(`privacy.html: no main > div.lc-${lang} block`);
    const named = new Map<string, Kind>();
    for (const li of block.querySelectorAll('li')) {
      const first = li.firstElementChild;
      const kind = first?.tagName === 'STRONG' ? first.textContent?.trim() : undefined;
      if (kind !== 'localStorage' && kind !== 'sessionStorage') continue;
      for (const c of li.querySelectorAll('code')) named.set(c.textContent ?? '', kind);
    }
    const stores = new Set([...block.querySelectorAll<HTMLElement>('[data-storage]')].map((e) => e.dataset.storage ?? ''));
    return { lang, named, stores };
  });
}

/** Every finding, in words — empty when the page and the code agree. */
export function privacyGaps(stored: Stored, html: string): string[] {
  const want = new Map([...stored.keys, ...LIBRARY_KEYS]);
  const gaps: string[] = [];
  for (const { lang, named, stores } of pageBlocks(html)) {
    for (const [k, kind] of want) if (named.get(k) !== kind) gaps.push(`${lang}: ${kind} key ${k} ${named.has(k) ? `listed under ${named.get(k)}` : 'not named'}`);
    for (const [k] of named) if (!want.has(k)) gaps.push(`${lang}: names ${k}, which nothing writes`);
    for (const s of stored.stores) if (!stores.has(s)) gaps.push(`${lang}: IndexedDB store ${s} has no data-storage entry`);
    for (const s of stores) if (!stored.stores.has(s)) gaps.push(`${lang}: data-storage="${s}" names no store the code creates`);
  }
  return gaps;
}

const read = (p: string) => readFileSync(p, 'utf8');
// An HTML page's own scripts only: its prose names the storage kinds too (privacy.html's list).
const scriptsOf = (html: string) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
const realFiles = () => shipped().map((file) => ({ file: file.slice(ROOT.length + 1), src: file.endsWith('.html') ? scriptsOf(read(file)) : read(file) }));
const PRIVACY = () => read(join(ROOT, 'public/privacy.html'));

describe('privacy.html names what the app stores (row 8, S2)', () => {
  it('the scan finds what the code writes today (a vacuous scan would pass any page)', () => {
    const { keys, stores } = scanStored(realFiles());
    expect(Object.fromEntries([...keys].sort())).toEqual({
      i18nextLng: 'localStorage', // the legal pages' own language switcher
      'pdfturbo.recentColors': 'localStorage',
      pdfturbo_privacy_toast_shown: 'sessionStorage',
      pdfturbo_storage_notice: 'localStorage',
      pdfturbo_toolbar_order: 'localStorage', // through ILayoutStorage
    });
    expect([...stores].sort()).toEqual(['recent', 'state']);
  });

  it('i18next writes i18nextLng to localStorage — the library key this test lists by hand', () => {
    expect(read(join(ROOT, 'src/utils/i18n.ts'))).toMatch(/caches:[^\n]*\['localStorage'\]/);
  });

  it('every key and store is named in EACH language block, under the right kind, and the page names nothing else', () => {
    expect(privacyGaps(scanStored(realFiles()), PRIVACY())).toEqual([]);
  });

  // The two shapes that once escaped by hand, and a one-language omission: each must be caught.
  describe('the guard catches', () => {
    const withFile = (file: string, src: string) => [...realFiles(), { file, src }];
    it('a new object store', () => {
      const gaps = privacyGaps(scanStored(withFile('src/infra/x.ts', "const S = 'drafts'; db.createObjectStore(S);")), PRIVACY());
      expect(gaps).toEqual(['en: IndexedDB store drafts has no data-storage entry', 'fr: IndexedDB store drafts has no data-storage entry', 'ar: IndexedDB store drafts has no data-storage entry']);
    });
    it('a key written through the layoutStorage wrapper', () => {
      const src = "import { LocalLayoutStorage } from '../ui/layoutStorage';\nconst K = 'pdfturbo_panel_width';\nthis._storage.save(K, '3');";
      expect(privacyGaps(scanStored(withFile('src/ui/x.ts', src)), PRIVACY())).toHaveLength(3);
    });
    it('a key missing from the Arabic block only', () => {
      const html = PRIVACY().replace(/(<div class="lc lc-ar"[\s\S]*?)<code>pdfturbo_storage_notice<\/code>/, '$1<b>x</b>');
      expect(html).not.toBe(PRIVACY());
      expect(privacyGaps(scanStored(realFiles()), html)).toEqual(['ar: localStorage key pdfturbo_storage_notice not named']);
    });
    it('a key that cannot be read, and an access the scan does not model', () => {
      expect(() => scanStored([{ file: 'a.ts', src: 'localStorage.setItem(`k${n}`, v);' }])).toThrow(/neither a literal nor a constant/);
      expect(() => scanStored([{ file: 'b.ts', src: "localStorage['k'] = v;" }])).toThrow(/unrecognised localStorage access/);
    });
  });
});
