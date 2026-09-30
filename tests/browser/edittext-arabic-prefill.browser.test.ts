/**
 * Limits row 40 — the edit-text tool's Arabic overlay is pre-filled with `clusterBaselineRun`'s text, and that text
 * must be in LOGICAL order: the Arabic overlay renderer shapes it from there. pdf.js returns a glyph-positioned RTL
 * word as one item per glyph in visual order (Chrome), and a split RTL line as several logical-order items
 * (LibreOffice); joining by ascending x reversed the word — measured before the fix on the Chrome file: 19 of 157 runs
 * right, 70 reversed.
 *
 * Oracle: the TYPED text of each fixture (the `.fodt` and the HTML in `scripts/gen-arabic-fixture.mjs`), never a
 * reading of the PDF. Every Arabic run pdf.js yields is clustered from each of its items, and the run's text — folded
 * and with spaces removed, since pdf.js does not always put the inter-item space in an item — must occur in what was
 * typed.
 *
 * Excluded by name, all row-19 bounds of the extraction itself (the DOCX export has them too): a run carrying a
 * vowel mark (pdf.js splits items at the marks), the `الله` ligature (extracted `اهلل`), the lam-alef line of the
 * LibreOffice file, and Chrome's punctuation drawn inside an Arabic item (`.نظام`).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withPdfjsAssets } from '../../src/utils/pdfjsParams';
import { clusterBaselineRun } from '../../src/handlers/textEditHandler';
import { isArabicText } from '../../src/utils/flowDoc';
import libreOfficeUrl from '../fixtures/bidi/mixed-bidi.pdf?url';
import chromeUrl from '../fixtures/corpus-public/arabic-allcases.pdf?url';
import fodt from '../fixtures/bidi/mixed-bidi.fodt?raw';
import generator from '../../scripts/gen-arabic-fixture.mjs?raw';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Item = { str: string; transform: number[]; width: number; height: number; fontName: string; dir?: string };

const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const esc = (s: string) => [...s].map(c => { const n = c.codePointAt(0) ?? 0; return n < 128 ? c : `<${n.toString(16)}>`; }).join('');

/** A named extraction bound (see the header), not a prefill defect. */
const bounded = (text: string) =>
  /\p{Mn}/u.test(text) || text.includes('اهلل') || text.includes('كالم') || /^[.:،]|[.:،]$/.test(text.trim());

async function runs(url: string): Promise<string[]> {
  const doc = await pdfjsLib.getDocument(withPdfjsAssets({ url })).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items as Item[];
    for (const it of items) if (it.str.trim() && isArabicText(it.str)) out.push(clusterBaselineRun(items, it).text);
  }
  await doc.loadingTask.destroy();
  return out;
}

describe('edit-text Arabic prefill is in logical order (limits row 40)', () => {
  it.each([
    ['LibreOffice (split logical-order items)', libreOfficeUrl, stripTags(fodt), 10],
    ['Chrome (one item per glyph, visual order)', chromeUrl, stripTags(generator), 150],
  ] as const)('%s: every run reads as typed', async (_n, url, typed, floor) => {
    const all = await runs(url);
    expect(all.length).toBeGreaterThanOrEqual(floor);
    const ref = squash(typed);
    const checked = all.filter(t => !bounded(t));
    // Non-vacuity: most runs are checked, and the RTL ones really are multi-letter words.
    expect(checked.length * 2).toBeGreaterThan(all.length);
    const wrong = checked.filter(t => !ref.includes(squash(t))).map(esc);
    expect(wrong).toEqual([]);
  });
});

describe('edit-text Arabic prefill keeps the word spaces pdf.js put in no item (limits row 51)', () => {
  it('LibreOffice (word-level items): every checked run occurs in the typed text WITH its spaces', async () => {
    const spaced = (x: string) => x.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const ref = spaced(stripTags(fodt));
    const checked = (await runs(libreOfficeUrl)).filter(t => !bounded(t));
    // Non-vacuity: a run of several words really is among them, so a closed-up join cannot pass by being short.
    expect(checked.some(t => spaced(t).split(' ').length >= 2)).toBe(true);
    expect(checked.filter(t => !ref.includes(spaced(t))).map(esc)).toEqual([]);
  });
});
