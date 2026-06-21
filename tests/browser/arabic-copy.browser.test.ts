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
 * Ceiling (asserted as documented partial): neutral brackets mirror ("(RTL)"→")RTL(")
 * and the "الله" ligature item reorders — not asserted as correct.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fixtureUrl from '../fixtures/corpus-public/arabic-allcases.pdf?url';
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
});
