/**
 * WS1-1b/1c — `PDFTurboApp.onSignRectPicked` and `_pageGeomForSign`, driven for real.
 *
 * Both were shipped as **UNCERTIFIED-BY-EXECUTION** on 2026-08-29. The crop-origin fix
 * (`displayRectToPageUserSpaceRect` instead of its crop-relative sibling) was pinned only as a
 * pure function in `tests/utils/signRectPageSpace.test.ts`; nothing drove the production caller,
 * so reverting the fix's EFFECT there left the whole jsdom suite green. The only existing test
 * touching this path, `tests/handlers/drawingHandlerSignRect.test.ts`, stubs the method with
 * `vi.fn()` — it pins that the handler calls it, not what it does.
 *
 * WHY `Object.create` RATHER THAN A SEAM: the plan offered extracting the method's body behind a
 * testable seam if booting the app proved heavy. It does not need to be — `src/core/pdfTurboApp.ts`
 * imports cleanly under jsdom, so a prototype-only instance with own-property stubs shadowing
 * `setMode` / `_reopenSignModal` drives the REAL `onSignRectPicked` and the REAL
 * `_pageGeomForSign`. Reshaping production code for testability is the worse trade when the
 * untouched code can be driven as-is.
 *
 * THE 1c PIN IS THE CONTRACT, NOT THE CALL. `_pageGeomForSign` passes `{ scale: 1, rotation: 0 }`
 * deliberately, but it reads only `vp.viewBox`, and pdf.js stores `viewBox` verbatim regardless of
 * rotation — so no input makes `rotation: 0` change the result today, and an assertion on the call
 * arguments alone would be a guard that fails on a harmless edit and passes on a harmful one. What
 * the caller actually depends on is: **the returned box is the UNROTATED content box, carrying its
 * origin.** That is what is asserted below, at `/Rotate 90` where the wrong choice
 * (`[0, 0, vp.width, vp.height]`) is both origin-less and dimension-swapped. The call-argument
 * assertion is kept alongside it, labelled for what it is: intent documentation.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';

/** An inset CropBox: 300×400 of content whose origin is (50,70) — the frame the bug ignored. */
const VIEW_BOX = [50, 70, 350, 470];

type Loose = Record<string, unknown>;
interface Geom { viewBox: number[]; srcRot: number }

function makeApp(opts: {
  srcRot?: number; pageRotation?: number; blank?: boolean;
  /** Limits row 16: elements on the page (a redaction makes the assembly rasterise it). */
  elements?: Array<{ type: string; pageId: string }>;
  /** Limits row 16: the assembled page's box. Unset → it must not be asked for. */
  assembled?: () => Promise<{ x: number; y: number; width: number; height: number }>;
  crop?: { x: number; y: number; width: number; height: number };
} = {}) {
  const srcRot = opts.srcRot ?? 0;
  const app = Object.create(PDFTurboApp.prototype) as PDFTurboApp;
  const a = app as unknown as Loose;

  const field = () => ({ value: '' }) as HTMLInputElement;
  const ui = { signX: field(), signY: field(), signW: field(), signH: field(), signPage: field() };

  // A faithful pdf.js stub: `viewBox` comes back verbatim whatever the rotation, while
  // width/height swap at 90/270. A stub that rotated viewBox would make the 1c assertion pass for
  // the wrong reason; one that returned fixed dims would hide the swap entirely.
  const getViewport = vi.fn((p: { scale: number; rotation?: number }) => {
    const w = VIEW_BOX[2] - VIEW_BOX[0], h = VIEW_BOX[3] - VIEW_BOX[1];
    const rot = ((((p.rotation ?? srcRot) % 360) + 360) % 360);
    const swap = rot === 90 || rot === 270;
    return { viewBox: VIEW_BOX.slice(), width: (swap ? h : w) * p.scale, height: (swap ? w : h) * p.scale };
  });

  const currentPage = opts.blank
    ? { id: 'p1', sourcePdfId: 'blank', blankWidth: 200, blankHeight: 300, rotation: opts.pageRotation ?? 0 }
    : { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: opts.pageRotation ?? 0, crop: opts.crop };

  a.documentModel = {
    currentPage, currentPageIndex: 0,
    sourcePdfs: new Map([['s1', { doc: { getPage: () => Promise.resolve({ rotate: srcRot, getViewport }) } }]]),
  };
  // `ui` is a prototype GETTER (`get ui() { return this.uiController.refs }`), so a plain
  // assignment throws. Defining an own data property shadows it — and keeps the whole
  // uiController out of the picture, which is the point of the prototype-only instance.
  Object.defineProperty(a, 'ui', { value: ui, configurable: true });
  a.setMode = vi.fn();
  a._reopenSignModal = vi.fn();
  a.elements = opts.elements ?? [];
  a.assembledPageBox = vi.fn(opts.assembled ?? (() => Promise.reject(new Error('assembledPageBox must not be called'))));

  return {
    app, ui, getViewport, assemble: a.assembledPageBox as ReturnType<typeof vi.fn>,
    setMode: a.setMode as ReturnType<typeof vi.fn>,
    reopen: a._reopenSignModal as ReturnType<typeof vi.fn>,
    pageGeom: () => (a._pageGeomForSign as (p: unknown) => Promise<Geom | null>).call(app, currentPage),
  };
}

const values = (ui: ReturnType<typeof makeApp>['ui']) => ({
  x: ui.signX.value, y: ui.signY.value, w: ui.signW.value, h: ui.signH.value, page: ui.signPage.value,
});

describe('onSignRectPicked — the sign-rect prefill (WS1-1b)', () => {
  it('emits ABSOLUTE user space on an inset-CropBox page, not crop-relative', async () => {
    const { app, ui } = makeApp();
    // Drawn 100×50 at display (10,20) on a 300×400 crop whose origin is (50,70).
    // Crop-relative (the bug): y flips to 400-(20+50) = 330, giving (10,330).
    // Absolute (correct):     translate by the origin, giving (60,400).
    await app.onSignRectPicked({ x: 10, y: 20, width: 100, height: 50 });
    expect(values(ui)).toEqual({ x: '60', y: '400', w: '100', h: '50', page: '1' });
  });

  it('composes the page /Rotate with the user rotation', async () => {
    // The invariant rather than a hand-derived rotated rect: /Rotate 90 + user 0 must equal
    // /Rotate 0 + user 90, since only their SUM reaches the mapper. Dropping either term breaks
    // one side. The rot-0 comparison keeps it non-vacuous.
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const fromSource = makeApp({ srcRot: 90 });
    const fromUser = makeApp({ srcRot: 0, pageRotation: 90 });
    const upright = makeApp();
    await fromSource.app.onSignRectPicked({ ...rect });
    await fromUser.app.onSignRectPicked({ ...rect });
    await upright.app.onSignRectPicked({ ...rect });

    expect(values(fromSource.ui)).toEqual(values(fromUser.ui));
    expect(values(fromSource.ui)).not.toEqual(values(upright.ui));
  });

  it('leaves the fields untouched on a cancelled pick, and still reopens the modal', async () => {
    const { app, ui, reopen, setMode } = makeApp();
    await app.onSignRectPicked(null);
    expect(values(ui)).toEqual({ x: '', y: '', w: '', h: '', page: '' });
    // The contract that stops the user being stranded in `signRect` with no modal.
    expect(setMode).toHaveBeenCalledWith('select');
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it('refuses a degenerate pick rather than writing a sub-point rect', async () => {
    const { app, ui } = makeApp();
    await app.onSignRectPicked({ x: 10, y: 20, width: 0.4, height: 0.4 });
    expect(values(ui)).toEqual({ x: '', y: '', w: '', h: '', page: '' });
  });
});

describe('_pageGeomForSign — the frame the prefill is built on (WS1-1c)', () => {
  it('returns the UNROTATED content box WITH its origin, on a /Rotate 90 page', async () => {
    const { pageGeom } = makeApp({ srcRot: 90 });
    const geom = await pageGeom();
    // The two ways to get this wrong, both of which this rejects:
    //   [0, 0, 300, 400] — dimensions instead of an extent (the origin silently lost),
    //   [0, 0, 400, 300] — the rotated viewport dims (what the default `rotation` would give).
    expect(geom?.viewBox).toEqual(VIEW_BOX);
    expect(geom?.srcRot).toBe(90);
  });

  it('asks pdf.js for the unrotated viewport [intent documentation, not behaviour]', async () => {
    // `viewBox` is rotation-invariant, so this cannot fail for a reason that matters TODAY. It is
    // here so that a refactor to `vp.width`/`vp.height` — the only way `rotation: 0` ever becomes
    // load-bearing — has to change this line deliberately. Read it as a comment with teeth.
    const { pageGeom, getViewport } = makeApp({ srcRot: 90 });
    await pageGeom();
    expect(getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 0 });
  });

  it('falls back to the blank page dimensions at the origin', async () => {
    const { pageGeom } = makeApp({ blank: true });
    expect(await pageGeom()).toEqual({ viewBox: [0, 0, 200, 300], srcRot: 0 });
  });
});

/** The box of the raster page the redaction path adds: origin (0,0). */
const rasterAssembly = (w: number, h: number) => Promise.resolve({ x: 0, y: 0, width: w, height: h });
const REDACTED = [{ type: 'redaction', pageId: 'p1' }];

describe('onSignRectPicked on a page the assembly RASTERISES (limits row 16, C9)', () => {
  it('maps onto the assembled page box, not the source page: origin dropped', async () => {
    // The raster page is the displayed 300×400 view at (0,0). Drawn 100×50 at display (10,20):
    // x = 10, y = 400 - (20 + 50) = 330 — where the source mapping would add the (50,70) origin.
    const { app, ui, assemble } = makeApp({ elements: REDACTED, assembled: () => rasterAssembly(300, 400) });
    await app.onSignRectPicked({ x: 10, y: 20, width: 100, height: 50 });
    expect(assemble).toHaveBeenCalledWith(0);
    expect(values(ui)).toEqual({ x: '10', y: '330', w: '100', h: '50', page: '1' });
  });

  it('at /Rotate 90 maps onto the SWAPPED box with no rotation — the shape the source mapping gets wrong', async () => {
    // Displayed view is 400×300 (swapped); the raster page is 400×300 upright. Display (10,20,100,50) →
    // x 10, y 300 - 70 = 230. The source mapping would rotate it instead.
    const { app, ui } = makeApp({ srcRot: 90, elements: REDACTED, assembled: () => rasterAssembly(400, 300) });
    await app.onSignRectPicked({ x: 10, y: 20, width: 100, height: 50 });
    expect(values(ui)).toEqual({ x: '10', y: '230', w: '100', h: '50', page: '1' });
  });

  it('scales proportionally when the raster page is not exactly the displayed size (the rasteriser rounds)', async () => {
    const { app, ui } = makeApp({ elements: REDACTED, assembled: () => rasterAssembly(600, 800) });
    await app.onSignRectPicked({ x: 10, y: 20, width: 100, height: 50 });
    expect(values(ui)).toEqual({ x: '20', y: '660', w: '200', h: '100', page: '1' });
  });

  it('on a cropped page maps from the crop window, which is all the raster page holds', async () => {
    // Crop (content space, y-down) 100×200 at (40,60) of the 300×400 view; the raster page is that window.
    // Display (50,70,60,40) sits (10,10) into the window: x 10, y 200 - (10 + 40) = 150.
    const crop = { x: 40, y: 60, width: 100, height: 200 };
    const { app, ui } = makeApp({ elements: REDACTED, crop, assembled: () => rasterAssembly(100, 200) });
    await app.onSignRectPicked({ x: 50, y: 70, width: 60, height: 40 });
    expect(values(ui)).toEqual({ x: '10', y: '150', w: '60', h: '40', page: '1' });
  });

  it('a redaction on ANOTHER page does not assemble, and keeps the absolute source mapping (control)', async () => {
    const { app, ui, assemble } = makeApp({ elements: [{ type: 'redaction', pageId: 'p2' }] });
    await app.onSignRectPicked({ x: 10, y: 20, width: 100, height: 50 });
    expect(assemble).not.toHaveBeenCalled();
    expect(values(ui)).toEqual({ x: '60', y: '400', w: '100', h: '50', page: '1' });
  });

  it('an assembly that fails leaves the fields untouched and still reopens the modal (signing reports it)', async () => {
    const { app, ui, reopen } = makeApp({ elements: REDACTED, assembled: () => Promise.reject(new Error('refused')) });
    await app.onSignRectPicked({ x: 10, y: 20, width: 100, height: 50 });
    expect(values(ui)).toEqual({ x: '', y: '', w: '', h: '', page: '' });
    expect(reopen).toHaveBeenCalledTimes(1);
  });
});
