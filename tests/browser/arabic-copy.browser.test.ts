/**
 * Arabic text-layer COPY reconstruction over REAL pdf.js items (real Chrome).
 *
 * `reconstructLogicalText` rebuilds logical, spaced, base-letter text from selected
 * glyph-span geometry. pdf.js v6 emits Arabic as mostly per-glyph items in visual
 * position order, but MULTI-char runs keep native (logical) char order — so the old
 * blanket reverse scrambled words ("السلام"→"السمال"). The fix orders spans by reading
 * position and folds NFKC-only (no per-item reversal). This feeds reconstructLogicalText
 * SpanGeom synthesized from real getTextContent items (the same multi-char tokenization
 * the live text layer sees) and asserts pure-Arabic words AND an embedded Latin token
 * come back correct.
 *
 * Brackets (limits row 43) are asserted against the TYPED text of both producers: Chrome's ToUnicode stores the
 * mirrored SHAPE (`)RTL(` before the fix), LibreOffice's the logical character (its row was voted left-to-right).
 *
 * Ceiling (documented partial): the "الله" ligature item reorders — not asserted as correct.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fixtureUrl from '../fixtures/corpus-public/arabic-allcases.pdf?url';
import libreUrl from '../fixtures/bidi/mixed-bidi.pdf?url';
import { reconstructLogicalText, type SpanGeom } from '../../src/utils/rtlClipboard';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

describe('Arabic copy reconstruction over real pdf.js items (real Chrome)', () => {
  it('reconstructs logical Arabic words + keeps embedded Latin intact', async () => {
    const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    // Synthesize SpanGeom from real items (top grows downward via -baselineY).
    const spans: SpanGeom[] = (content.items as { str: string; transform: number[]; width: number; height: number }[])
      .filter((ti) => typeof ti.str === 'string' && ti.str.length > 0)
      .map((ti) => ({
        text: ti.str,
        left: ti.transform[4],
        right: ti.transform[4] + ti.width,
        top: -ti.transform[5],
        height: ti.height || 10,
      }));

    const logical = reconstructLogicalText(spans);

    // Pure-Arabic words reconstruct correctly (were scrambled by the old blanket reverse).
    expect(logical).toContain('السلام');
    expect(logical).toContain('العربية');
    expect(logical).toContain('الحروف');
    // Embedded LTR token and number inside RTL lines stay intact (not reversed).
    expect(logical).toContain('PDFturbo');
    expect(logical).toContain('100%');
  });

  async function copyOf(url: string, page: number): Promise<string> {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const content = await (await pdf.getPage(page)).getTextContent();
    const spans: SpanGeom[] = (content.items as { str: string; transform: number[]; width: number; height: number }[])
      .filter((ti) => typeof ti.str === 'string' && ti.str.length > 0)
      .map((ti) => ({
        text: ti.str, left: ti.transform[4], right: ti.transform[4] + ti.width, top: -ti.transform[5], height: ti.height || 10,
      }));
    return reconstructLogicalText(spans);
  }

  it('Chrome (bracket glyph SHAPES): every bracketed Arabic heading copies as typed (limits row 43)', async () => {
    const logical = await copyOf(fixtureUrl, 1);
    expect(logical).toContain('فقرة عربية خالصة (RTL)');
    expect(logical).toContain('نص مختلط عربي ولاتيني وأرقام (bidi)');
    expect(logical).toContain('جدول بالعربية (table RTL)');
    expect(logical).not.toContain(')RTL(');
  });

  it('LibreOffice (LOGICAL bracket characters): the bracketed line copies as typed, not in visual order (limits row 43)', async () => {
    const logical = await copyOf(libreUrl, 1);
    // The optional space is limits row 54, not this row: LibreOffice's word-level items make the median span width so
    // large that a 3.6pt space gap (a real space) falls under the 0.4 × median threshold, so `النص (RTL)` loses it.
    expect(logical).toMatch(/النص ?\(RTL\) هنا/);
  });

  it('an LTR line keeps its brackets (control)', async () => {
    expect(await copyOf(fixtureUrl, 2)).toContain('(LTR control)');
  });
});
