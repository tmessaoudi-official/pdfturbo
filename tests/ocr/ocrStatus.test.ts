/**
 * Limits row 12 (B6) — tesseract's progress `status` is mapped to one of TWO translated labels.
 *
 * The status strings are tesseract.js internals, not an API, so the mapper must degrade safely: an
 * unknown or empty status returns `null`, and the caller keeps whatever label it already shows — never a
 * raw English engine string in a French UI, never an empty label.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ocrStatusLabelKey, OCR_LABEL_LOADING, OCR_LABEL_RECOGNIZING } from '../../src/ocr/ocrStatus';

/** Every status tesseract.js 7.0.0 emits (read from node_modules/tesseract.js/src/worker-script). */
const LOADING = ['loading tesseract core', 'initializing tesseract', 'loading language traineddata', 'initializing api'];

describe('ocrStatusLabelKey', () => {
  it.each(LOADING)('"%s" → loading the model', (s) => {
    expect(ocrStatusLabelKey(s)).toBe(OCR_LABEL_LOADING);
  });

  it('"recognizing text" → recognizing', () => {
    expect(ocrStatusLabelKey('recognizing text')).toBe(OCR_LABEL_RECOGNIZING);
  });

  it('an unknown or empty status keeps the current label (null)', () => {
    for (const s of ['', 'something new', 'done']) expect(ocrStatusLabelKey(s)).toBeNull();
  });

  it('every status tesseract.js emits today is one of the known ones', () => {
    // Non-vacuity against the installed engine: read the strings out of its source rather than trusting
    // the list above. A tesseract.js bump that adds a status reds here, not silently in the UI.
    const root = resolve(__dirname, '../../node_modules/tesseract.js/src/worker-script');
    const src = ['index.js', 'browser/getCore.js'].map(f => readFileSync(resolve(root, f), 'utf8')).join('\n');
    const found = new Set([...src.matchAll(/statusText = '([^']+)'|status: '([^']+)'/g)].map(m => m[1] ?? m[2]));
    expect(found.size).toBeGreaterThanOrEqual(5);
    for (const s of found) expect(ocrStatusLabelKey(s), s).not.toBeNull();
  });

  it('both labels are translated in every locale', () => {
    for (const lang of ['en', 'fr', 'ar']) {
      const json = JSON.parse(readFileSync(resolve(__dirname, `../../locales/${lang}.json`), 'utf8'));
      for (const key of [OCR_LABEL_LOADING, OCR_LABEL_RECOGNIZING]) {
        const v = key.split('.').reduce((o: Record<string, unknown>, k) => o?.[k] as Record<string, unknown>, json) as unknown;
        expect(typeof v === 'string' && v.trim().length > 0, `${lang} ${key}`).toBe(true);
      }
    }
  });
});
