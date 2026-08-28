/**
 * The #28 feature seam must be honoured on the EXPORT path, not only in the UI.
 *
 * ── The defect this pins ──────────────────────────────────────────────────────────
 * `main.ts` removes a feature's buttons when its flag is off, and that was the whole of the kill
 * switch. But `crop` and `bates` are the two flagged features whose state PERSISTS: both are
 * written to IndexedDB (`documentModel`), restored on load (`documentLoader`), and replayed by
 * `exportPipeline` guarded only on the DATA (`docPage.crop`, `ctx.bates.enabled`) and never on the
 * flag. So a session created while the flag was on kept being cropped and stamped after the feature
 * was switched off — the switch killed the button, not the feature.
 *
 * That matters most for crop, which is destructive on a redaction-bearing page (the raster path
 * clips the canvas, discarding the cropped region for real). The seam was read in only four files,
 * none of them under `src/export/`.
 *
 * ── Why the flags are mocked rather than set via env ──────────────────────────────
 * `isEnabled` reads `import.meta.env` and localStorage, neither of which can be changed per-test
 * inside one vitest run. Mocking the seam is the seam's own contract.
 *
 * Be precise about what the flag-ON cases are: `vi.mock` replaces the module file-wide, so they run
 * against the MOCK returning true, not against the real `isEnabled`. They are still load-bearing —
 * they prove the gates are the only thing standing between the data and the output, so a flag-OFF
 * pass cannot come from crop/Bates being broken for some unrelated reason — but they do not verify
 * the real seam's default-ON behaviour. `tests/export/cropCropBox.test.ts` and
 * `tests/export/bates.test.ts` exercise these paths with no mock at all and cover that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { BuildPageCtx } from '../../src/export/exportPipeline';
import type { BatesSettings } from '../../src/export/batesStamp';

const enabled = vi.hoisted(() => ({ crop: true, bates: true } as Record<string, boolean>));
vi.mock('../../src/config/features', () => ({
  isEnabled: (f: string) => enabled[f] ?? true,
}));

const NO_WATERMARK: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};
const NO_INK = { getStrokes: () => [] } as unknown as BuildPageCtx['inkLayer'];
const SILENT = { warn() {}, silent() {}, info() {}, error() {} } as unknown as BuildPageCtx['reportError'];
const CROP = { x: 50, y: 100, width: 400, height: 500 };
// Field shapes copied from tests/export/bates.test.ts — `position` is 'br', not 'bottom-right'.
// Bates mode (not page mode) so the stamp is a distinctive literal to search the saved bytes for.
const BATES: BatesSettings = {
  enabled: true, mode: 'bates', prefix: 'ACMEFLAG-', startNumber: 1, digits: 6,
  position: 'br', fontSize: 10, color: '#555555',
};

async function exportPage(opts: { crop?: DocumentPage['crop']; bates?: BatesSettings }) {
  const { buildPageOverlays } = await import('../../src/export/exportPipeline');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const docPage: DocumentPage = {
    id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, ...(opts.crop ? { crop: opts.crop } : {}),
  };
  await buildPageOverlays({
    pdfDoc, page, docPage, elements: [],
    pdfLib: { rgb, degrees, StandardFonts },
    userRot: 0, sourceRot: 0,
    watermark: NO_WATERMARK, inkLayer: NO_INK, reportError: SILENT,
    ...(opts.bates ? { bates: opts.bates, pageNumber: 1, pageCount: 3 } : {}),
  } as BuildPageCtx);
  return page;
}

beforeEach(() => { enabled.crop = true; enabled.bates = true; });

describe('VITE_FEATURE_CROP gates the export path', () => {
  it('CONTROL: with the flag ON a restored crop is applied', async () => {
    const cb = (await exportPage({ crop: CROP })).getCropBox();
    expect(cb.width).toBeCloseTo(400);
    expect(cb.height).toBeCloseTo(500);
  });

  it('with the flag OFF a restored crop is NOT applied', async () => {
    enabled.crop = false;
    const cb = (await exportPage({ crop: CROP })).getCropBox();
    // Untouched → still the MediaBox.
    expect(cb.x).toBeCloseTo(0);
    expect(cb.y).toBeCloseTo(0);
    expect(cb.width).toBeCloseTo(600);
    expect(cb.height).toBeCloseTo(800);
  });
});

describe('VITE_FEATURE_BATES gates the export path', () => {
  /**
   * The observable is the FONT RESOURCE the stamp embeds, not the stamp text.
   *
   * The text itself is unreadable from the saved bytes: pdf-lib FlateDecode-compresses the content
   * stream it writes (measured on this exact fixture — `hasFlate: true`, `hasACME: false`), and it
   * is stored inside an object stream, so neither a plain `includes()` nor a zlib scan of the file
   * finds it. Both were tried and both returned false for a stamp that WAS drawn — precisely the
   * kind of "negative that cannot fail" this repo has been bitten by, so it is recorded rather than
   * left as a silently passing assertion.
   *
   * This fixture draws no elements, no watermark and no ink, so the Bates stamp is the ONLY thing
   * that can embed a font. Measured: flag ON → 1034 bytes with a Helvetica resource; flag OFF →
   * 677 bytes with none. That is a direct consequence of the draw, and it discriminates cleanly.
   * What it does NOT check is the stamp's text or position — `tests/export/bates.test.ts` covers
   * those purely, and duplicating them here would add nothing.
   */
  async function stampWasDrawn(bates: BatesSettings | undefined): Promise<boolean> {
    const page = await exportPage({ bates });
    const bytes = await page.doc.save();
    return new TextDecoder('latin1').decode(bytes).includes('Helvetica');
  }

  it('CONTROL: with the flag ON the stamp is drawn', async () => {
    expect(await stampWasDrawn(BATES)).toBe(true);
  });

  it('with the flag OFF the stamp is NOT drawn', async () => {
    enabled.bates = false;
    expect(await stampWasDrawn(BATES)).toBe(false);
  });
});
