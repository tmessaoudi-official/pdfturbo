/**
 * WS1-1a — the annotation strip on `downloadPageAsImage`, driven END-TO-END.
 *
 * This closes a dimension the 2026-08-29 milestone shipped as **UNCERTIFIED-BY-EXECUTION**.
 * `_applyOverlaysToPage` has exactly two callers where `stripRedactedAnnotations` has work to do:
 * `renderThumbnailWithOverlays` (driven by the sibling `redaction-annotation-frames` file) and
 * `downloadPageAsImage` (this one). Until now only the thumbnail was driven end-to-end; the image
 * export was covered solely by `tests/export/imageExportOptions.test.ts`, which stubs pdf.js at
 * the module seam and therefore pins the option → viewport/format/save-name wiring, not the
 * pixels. Reverting the frame fix left this path green.
 *
 * That is the same "a concern solved in half the places it applies" shape CLAUDE.md keeps
 * recording, applied to the TEST surface rather than the source: the fix was shared, the proof
 * was not.
 *
 * METHOD (identical to the thumbnail guard, deliberately): assert no RED pixel survives ANYWHERE
 * in the exported image rather than sampling a computed point — the covered annotation is the
 * only red thing on the page, so no coordinate arithmetic of the test's own can mask a leak. The
 * GREEN control must still be present, which is what fails an over-reaching fix (a wholesale
 * `annotationMode: DISABLE` would satisfy the leak assertion alone).
 *
 * CAPTURE: the export writes through `pickSaveTarget` → `writeToHandle`, so a fake
 * `showSaveFilePicker` returning a handle whose `createWritable().write()` keeps the Blob is the
 * least invasive interception — and unlike the recorded `delete window.showSaveFilePicker`
 * workaround it does not fire a real anchor download in a real browser. The write happens inside
 * a `toBlob` callback that `downloadPageAsImage` does NOT await, so the test awaits the capture,
 * not the call.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ExportService } from '../../src/export/exportService';
import { buildRedactedCtx, countColours, CROP } from './_redactedAnnotationFixture';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Picker = typeof globalThis & { showSaveFilePicker?: unknown };
const ORIGINAL_PICKER = (globalThis as Picker).showSaveFilePicker;

afterEach(() => {
  if (ORIGINAL_PICKER === undefined) delete (globalThis as Picker).showSaveFilePicker;
  else (globalThis as Picker).showSaveFilePicker = ORIGINAL_PICKER;
});

/**
 * Fail loudly instead of hanging. Without this a bailed export (missing source entry, no 2D
 * context, a pdf-lib throw) never settles the capture and the case reads as an opaque 60s
 * timeout — the failure mode CLAUDE.md records for the leaked IndexedDB connection.
 */
function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} never settled in ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

async function exportImageFor(
  opts: { rotation?: number; crop?: { x: number; y: number; width: number; height: number } },
): Promise<{ red: number; green: number }> {
  let settle!: (b: Blob) => void;
  let fail!: (e: Error) => void;
  const captured = new Promise<Blob>((res, rej) => { settle = res; fail = rej; });

  const ctx = await buildRedactedCtx({
    ...opts,
    onError: (key, err) => fail(new Error(`export reported ${key}: ${String(err ?? '')}`)),
  });

  (globalThis as Picker).showSaveFilePicker = () => Promise.resolve({
    name: 'page.png',
    createWritable: () => Promise.resolve({
      write: (d: Blob) => { settle(d); return Promise.resolve(); },
      close: () => Promise.resolve(),
    }),
  });

  // Scale 2 so the annotations cover enough pixels for the colour counts to be unambiguous;
  // PNG so the comparison is against lossless pixels rather than JPEG's smeared edges.
  await new ExportService(ctx).downloadPageAsImage(0, { scale: 2, format: 'png' });
  const blob = await withDeadline(captured, 45_000, 'the exported image');
  expect(blob.size).toBeGreaterThan(0);
  return countColours(blob);
}

describe('annotation strip on downloadPageAsImage (WS1-1a)', () => {
  it('rotation 0, no crop (regression): red burned, green kept', async () => {
    const { red, green } = await exportImageFor({});
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);

  for (const rotation of [90, 180, 270]) {
    it(`rotation ${rotation}: the covered annotation is still burned`, async () => {
      // Pre-fix the strip is handed srcRot + 2*userRot, so at 90/270 it tests a region rotated
      // 180 away from the truth, keeps the annotation, and pdf.js repaints it over the burn.
      const { red, green } = await exportImageFor({ rotation });
      expect(red).toBe(0);
      expect(green).toBeGreaterThan(500);
    }, 60_000);
  }

  it('with a crop: the covered annotation is still burned', async () => {
    // Pre-fix getPageCropBox is read after setCropBox narrowed it, so the redaction maps into
    // the wrong frame and the annotation survives.
    const { red, green } = await exportImageFor({ crop: { ...CROP } });
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);

  it('crop AND rotation together', async () => {
    const { red } = await exportImageFor({ rotation: 90, crop: { ...CROP } });
    expect(red).toBe(0);
  }, 60_000);
});
