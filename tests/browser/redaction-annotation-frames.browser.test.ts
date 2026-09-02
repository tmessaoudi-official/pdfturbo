/**
 * The annotation strip must work on the THUMBNAIL path too — at every rotation and with a crop.
 * Its sibling `redaction-annotation-image-export.browser.test.ts` drives the other caller,
 * `downloadPageAsImage`, over the SAME fixture (`_redactedAnnotationFixture.ts`).
 *
 * `stripRedactedAnnotations` is called from two places. `rasterizePageWithRedactions` captures
 * the page's rotation BEFORE `buildPageOverlays` and passes `skipCropBox: true`, so its frame is
 * pristine. `_applyOverlaysToPage` did neither: it read `page.getRotation()` and
 * `getPageCropBox(page)` AFTER the call, and `buildPageOverlays` MUTATES both —
 * `page.setRotation(totalRot)` (exportPipeline.ts:232) and `page.setCropBox(effBox)` (:294).
 *
 * The result was a doubled rotation (`srcRot + 2·userRot`) and a narrowed crop box, so on any
 * rotated or cropped page the covered annotation was NOT stripped and pdf.js repainted it over
 * the burn — the very leak the strip exists to close, still live on `downloadPageAsImage` and
 * `renderThumbnailWithOverlays`, which are the only two callers where the strip has work to do
 * (every other caller routes a redaction-bearing page to the rasterizer instead).
 *
 * The previous guards ran at `rotation: 0` with no crop and so could not see it — the same
 * "a rotation bug shipped inside a rotation fix" shape CLAUDE.md already records for the
 * 2026-08-05 round.
 *
 * METHOD: assert no RED pixel survives ANYWHERE in the output, rather than sampling a computed
 * point. The covered annotation is the only red thing on the page, so this is rotation- and
 * crop-agnostic — no coordinate arithmetic of mine can accidentally mask the leak. The GREEN
 * control annotation must still be present, which is what stops a wholesale
 * `annotationMode: DISABLE` from passing.
 */
import { describe, it, expect } from 'vitest';
import { ExportService } from '../../src/export/exportService';
import { buildRedactedCtx, countColours, CROP } from './_redactedAnnotationFixture';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function thumbnailFor(
  opts: { rotation?: number; crop?: { x: number; y: number; width: number; height: number } },
): Promise<{ red: number; green: number }> {
  const ctx = await buildRedactedCtx(opts);
  // Scale 2 so the annotations cover enough pixels for the colour counts to be unambiguous.
  const url = await new ExportService(ctx).renderThumbnailWithOverlays(0, 2);
  expect(url).toBeTruthy();
  return countColours(url as string);
}

describe('annotation strip on the thumbnail path', () => {
  it('rotation 0, no crop (regression): red burned, green kept', async () => {
    const { red, green } = await thumbnailFor({});
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);

  for (const rotation of [90, 180, 270]) {
    it(`rotation ${rotation}: the covered annotation is still burned`, async () => {
      // Pre-fix the strip is handed srcRot + 2*userRot, so at 90/270 it tests a region rotated
      // 180 away from the truth, keeps the annotation, and pdf.js repaints it over the burn.
      const { red, green } = await thumbnailFor({ rotation });
      expect(red).toBe(0);
      expect(green).toBeGreaterThan(500);
    }, 60_000);
  }

  it('with a crop: the covered annotation is still burned', async () => {
    // Pre-fix getPageCropBox is read after setCropBox narrowed it, so the redaction maps into
    // the wrong frame and the annotation survives.
    const { red, green } = await thumbnailFor({ crop: { ...CROP } });
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);

  it('crop AND rotation together', async () => {
    const { red } = await thumbnailFor({ rotation: 90, crop: { ...CROP } });
    expect(red).toBe(0);
  }, 60_000);
});
