/**
 * Arabic find/search across REAL pdf.js per-glyph text items (real Chrome).
 *
 * pdf.js v6 emits Arabic source as mostly ONE item per glyph in VISUAL position order
 * (multi-char runs keep native/logical char order), as presentation forms — so the
 * per-item matcher used to find ZERO Arabic matches (a logical multi-glyph query never
 * fits one item.str). `TextSearchHandler` now reconstructs per-line logical text spanning
 * items (`buildLogicalLines`) and matches there. jsdom can't run getTextContent on an
 * embedded-font PDF; this proves the fix end-to-end against the real extraction layer.
 *
 * Fixture: tests/fixtures/corpus-public/arabic-allcases.pdf (Chrome print-to-PDF of a
 * comprehensive Arabic page — gen: scripts/gen-arabic-fixture.mjs). Ceiling: special
 * ligatures (e.g. "الله") and mixed LTR-in-RTL runs reconstruct imperfectly (documented).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fixtureUrl from '../fixtures/corpus-public/arabic-allcases.pdf?url';
import { TextSearchHandler } from '../../src/handlers/textSearchHandler';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

describe('Arabic search across per-glyph text items (real Chrome)', () => {
  it('finds logical Arabic words; Latin unaffected; nonsense returns 0', async () => {
    const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const handler = new TextSearchHandler();

    async function countAll(q: string): Promise<number> {
      let n = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        // eslint-disable-next-line no-await-in-loop
        const page = await pdf.getPage(i);
        const id = `p${i}`;
        // eslint-disable-next-line no-await-in-loop
        await handler.buildIndex(page, id);
        const viewport = page.getViewport({ scale: 1 });
        n += handler.search(q, id, viewport, 1).length;
      }
      return n;
    }

    // Pure-Arabic words that pdf.js splits across per-glyph items — were 0 before the fix.
    expect(await countAll('السلام')).toBeGreaterThan(0);
    expect(await countAll('العربية')).toBeGreaterThan(0);
    expect(await countAll('الحروف')).toBeGreaterThan(0);
    expect(await countAll('عليكم')).toBeGreaterThan(0);
    // Latin in the same document is unaffected by the Arabic line pass.
    expect(await countAll('PDFturbo')).toBeGreaterThan(0);
    // A word that is not present must not over-match.
    expect(await countAll('زقاقمستحيل')).toBe(0);
  });
});
