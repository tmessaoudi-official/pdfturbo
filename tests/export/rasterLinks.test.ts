/**
 * A4 — links on the redaction (raster) export path.
 *
 * A page carrying a redaction is exported as ONE image (`rasterizePageWithRedactions`), so every
 * `/Link` on it — the source's own and the ones an overlay text box adds — used to be lost. The
 * ruling (docs/plans/limits-walkthrough.plan.md, A4): re-add every link that does not meet a
 * redaction, in the clipped output frame; a covered link must never come back.
 *
 * These are the pure halves, pinned in jsdom so every fail-closed branch is cheap to reach:
 *   `collectSafeUriLinks` — which links survive (URI only, sanitised, clear of every redaction);
 *   `mapLinkRectToRaster` — where a surviving link lands on the output page.
 * The real-browser half (every rotation, a crop, pixels under each re-added rect) is
 * `tests/browser/redaction-raster-links.browser.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { collectSafeUriLinks, mapLinkRectToRaster } from '../../src/export/exportPipeline';

type Rect = [number, number, number, number];

async function pageWith(build: (ctx: import('@cantoo/pdf-lib').PDFContext, lib: typeof import('@cantoo/pdf-lib')) => unknown[] | unknown) {
  const lib = await import('@cantoo/pdf-lib');
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([300, 600]);
  const made = build(doc.context, lib);
  if (Array.isArray(made)) {
    const arr = lib.PDFArray.withContext(doc.context);
    for (const m of made) arr.push(m as import('@cantoo/pdf-lib').PDFObject);
    page.node.set(lib.PDFName.of('Annots'), arr);
  } else if (made !== undefined) {
    page.node.set(lib.PDFName.of('Annots'), made as import('@cantoo/pdf-lib').PDFObject);
  }
  return page;
}

function uriLink(ctx: import('@cantoo/pdf-lib').PDFContext, lib: typeof import('@cantoo/pdf-lib'), rect: Rect, url: string, subtype = 'Link') {
  return ctx.register(ctx.obj({
    Type: lib.PDFName.of('Annot'), Subtype: lib.PDFName.of(subtype),
    Rect: ctx.obj(rect),
    A: ctx.obj({ S: lib.PDFName.of('URI'), URI: lib.PDFString.of(url) }),
  }));
}

// A redaction in the convention `annotationRectRedacted` takes: x absolute, y DOWN from pageTopY.
const TOP = 600;
const RED = [{ x: 200, y: 440, width: 90, height: 70 }]; // covers y-up 90..160

describe('collectSafeUriLinks — which links may be re-added', () => {
  it('keeps a URI link clear of every redaction, with its rect and url', async () => {
    const page = await pageWith((ctx, lib) => [uriLink(ctx, lib, [20, 520, 80, 560], 'https://safe.example/a')]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([{ rect: [20, 520, 80, 560], url: 'https://safe.example/a' }]);
  });

  it('drops a link that meets a redaction — a covered link must never come back', async () => {
    const page = await pageWith((ctx, lib) => [uriLink(ctx, lib, [210, 100, 280, 150], 'https://covered.example/')]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([]);
  });

  it('drops a link whose /Rect is stored with reversed corners and meets a redaction', async () => {
    const page = await pageWith((ctx, lib) => [uriLink(ctx, lib, [280, 150, 210, 100], 'https://covered.example/')]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([]);
  });

  it('normalises a reversed rect it keeps', async () => {
    const page = await pageWith((ctx, lib) => [uriLink(ctx, lib, [80, 560, 20, 520], 'https://safe.example/')]);
    expect(collectSafeUriLinks(page, RED, TOP)[0].rect).toEqual([20, 520, 80, 560]);
  });

  it('never re-adds a scheme the link sanitiser refuses (javascript:)', async () => {
    const page = await pageWith((ctx, lib) => [uriLink(ctx, lib, [20, 520, 80, 560], 'javascript:alert(1)')]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([]);
  });

  it('never re-adds a GoTo link — its destination does not exist in the image page', async () => {
    const page = await pageWith((ctx, lib) => [ctx.register(ctx.obj({
      Type: lib.PDFName.of('Annot'), Subtype: lib.PDFName.of('Link'), Rect: ctx.obj([20, 520, 80, 560]),
      A: ctx.obj({ S: lib.PDFName.of('GoTo'), D: ctx.obj([0, lib.PDFName.of('Fit')]) }),
    }))]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([]);
  });

  it('ignores a URI action on a non-Link annotation (a widget is gone once the page is an image)', async () => {
    const page = await pageWith((ctx, lib) => [uriLink(ctx, lib, [20, 520, 80, 560], 'https://safe.example/', 'Widget')]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([]);
  });

  it('reads an indirect /A and a hex-string /URI', async () => {
    const page = await pageWith((ctx, lib) => {
      const action = ctx.register(ctx.obj({ S: lib.PDFName.of('URI'), URI: lib.PDFHexString.fromText('https://hex.example/') }));
      return [ctx.register(ctx.obj({
        Type: lib.PDFName.of('Annot'), Subtype: lib.PDFName.of('Link'), Rect: ctx.obj([20, 520, 80, 560]), A: action,
      }))];
    });
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([{ rect: [20, 520, 80, 560], url: 'https://hex.example/' }]);
  });

  it('reads a /Subtype and /S that are indirect references (legal, and must not drop the link)', async () => {
    const page = await pageWith((ctx, lib) => [ctx.register(ctx.obj({
      Type: lib.PDFName.of('Annot'), Subtype: ctx.register(lib.PDFName.of('Link')), Rect: ctx.obj([20, 520, 80, 560]),
      A: ctx.obj({ S: ctx.register(lib.PDFName.of('URI')), URI: lib.PDFString.of('https://ind.example/') }),
    }))]);
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([{ rect: [20, 520, 80, 560], url: 'https://ind.example/' }]);
  });

  it('skips a link whose /Rect cannot be read (fail closed: it is simply not re-added)', async () => {
    const page = await pageWith((ctx, lib) => [
      ctx.register(ctx.obj({
        Type: lib.PDFName.of('Annot'), Subtype: lib.PDFName.of('Link'), Rect: lib.PDFString.of('nope'),
        A: ctx.obj({ S: lib.PDFName.of('URI'), URI: lib.PDFString.of('https://x.example/') }),
      })),
      ctx.register(ctx.obj({
        Type: lib.PDFName.of('Annot'), Subtype: lib.PDFName.of('Link'), Rect: ctx.obj([0, 0, 10]),
        A: ctx.obj({ S: lib.PDFName.of('URI'), URI: lib.PDFString.of('https://y.example/') }),
      })),
    ]);
    expect(collectSafeUriLinks(page, [], TOP)).toEqual([]);
  });

  it('skips a wrong-typed /Annots entry and keeps reading the rest', async () => {
    const page = await pageWith((ctx, lib) => [lib.PDFNumber.of(7), uriLink(ctx, lib, [20, 520, 80, 560], 'https://safe.example/')]);
    expect(collectSafeUriLinks(page, RED, TOP)).toHaveLength(1);
  });

  it('returns nothing when /Annots is not an array', async () => {
    const page = await pageWith((_ctx, lib) => lib.PDFNumber.of(3));
    expect(collectSafeUriLinks(page, RED, TOP)).toEqual([]);
  });

  it('keeps every clear link when the page has no redaction list entries', async () => {
    const page = await pageWith((ctx, lib) => [
      uriLink(ctx, lib, [20, 520, 80, 560], 'https://a.example/'),
      uriLink(ctx, lib, [210, 100, 280, 150], 'https://b.example/'),
    ]);
    expect(collectSafeUriLinks(page, [], TOP).map(l => l.url)).toEqual(['https://a.example/', 'https://b.example/']);
  });
});

describe('mapLinkRectToRaster — where a kept link lands on the image page', () => {
  // A viewport-like mapping: scale 2, y flipped against a 600pt page (rotation 0).
  const toCanvas = (x: number, y: number): [number, number] => [x * 2, (600 - y) * 2];

  it('maps user space through the viewport, then back to image-page points (y up)', () => {
    expect(mapLinkRectToRaster([20, 520, 80, 560], toCanvas, 0, 0, 2, 300, 600))
      .toEqual({ x: 20, y: 520, w: 60, h: 40 });
  });

  it('subtracts the crop clip offset', () => {
    // clip at canvas (40, 40) → image page is (300-20)×(600-20) points; the link stays whole.
    expect(mapLinkRectToRaster([20, 520, 80, 560], toCanvas, 40, 40, 2, 280, 580))
      .toEqual({ x: 0, y: 520, w: 60, h: 40 });
  });

  it('clips a rect that crosses the image edge instead of emitting negative coordinates', () => {
    const r = mapLinkRectToRaster([20, 520, 80, 560], toCanvas, 100, 0, 2, 250, 600);
    expect(r).toEqual({ x: 0, y: 520, w: 30, h: 40 });
  });

  it('drops a rect that falls wholly outside the image page', () => {
    expect(mapLinkRectToRaster([20, 520, 80, 560], toCanvas, 200, 0, 2, 200, 600)).toBeNull();
  });

  it('drops a zero-area rect', () => {
    expect(mapLinkRectToRaster([20, 520, 20, 560], toCanvas, 0, 0, 2, 300, 600)).toBeNull();
  });

  it('uses all four corners, so a rotated mapping yields the right box', () => {
    // 90° clockwise viewport on a 300×600 page, scale 1: (x,y) → (y, x).
    const rot90 = (x: number, y: number): [number, number] => [y, x];
    expect(mapLinkRectToRaster([20, 520, 80, 560], rot90, 0, 0, 1, 600, 300))
      .toEqual({ x: 520, y: 220, w: 40, h: 60 });
  });
});
