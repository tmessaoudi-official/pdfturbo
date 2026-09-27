/**
 * Limits row 27 (D20) — Compress → "shrink images": the planner that decides which embedded JPEGs to shrink,
 * and to what size, and the in-place replacement.
 *
 * Every refusal case has a CONTROL that shrinks, so a planner that refused everything cannot pass. The JPEGs
 * here are headers only (SOI, SOF0, EOI): pdf-lib embeds by reading the SOF, and nothing in jsdom decodes
 * them — the re-encoder is injected. The real decode/re-encode runs in `compress-images.browser.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFDict, type PDFRef, type PDFPage } from '@cantoo/pdf-lib';
import { planImageDownsample, downsampleImages, targetSize, stripExif } from '../../src/export/imageDownsample';

function fakeJpeg(w: number, h: number, comps = 3): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * comps, 8, h >> 8, h & 255, w >> 8, w & 255, comps];
  for (let i = 0; i < comps; i++) sof.push(i + 1, 0x11, 0);
  return new Uint8Array([0xff, 0xd8, ...sof, 0xff, 0xd9]);
}

interface Built { doc: PDFDocument; ref: PDFRef }

/** One page, one JPEG named /Im0, the page content given verbatim; `tweak` edits the doc before the round-trip. */
async function build(content: string, opts: { w?: number; h?: number; comps?: number; tweak?: (doc: PDFDocument, page: PDFPage, ref: PDFRef) => void } = {}): Promise<Built> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(fakeJpeg(opts.w ?? 1200, opts.h ?? 900, opts.comps ?? 3));
  await img.embed();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: img.ref } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  opts.tweak?.(doc, page, img.ref);
  const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });
  return { doc: reloaded, ref: img.ref };
}

/** A Form XObject registered on the page as /Fm0, with its own resources naming /Im0. */
function addForm(doc: PDFDocument, page: PDFPage, ref: PDFRef, content: string, matrix?: number[]): PDFRef {
  const form = doc.context.stream(content, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1000, 1000],
    ...(matrix ? { Matrix: matrix } : {}),
    Resources: { XObject: { Im0: ref } },
  });
  const fref = doc.context.register(form);
  const res = page.node.lookup(PDFName.of('Resources'), PDFDict);
  (res.lookup(PDFName.of('XObject'), PDFDict)).set(PDFName.of('Fm0'), fref);
  return fref;
}

const sizes = async (b: Built, dpi = 150) =>
  (await planImageDownsample(b.doc, dpi)).map(p => [p.targetWidth, p.targetHeight]);

// 1200 × 900 drawn at 4 × 3 in (288 × 216 pt) is 300 DPI.
const AT_4IN = 'q 288 0 0 216 0 0 cm /Im0 Do Q';

describe('targetSize (row 27)', () => {
  it('shrinks to the target DPI on the lower-resolution axis', () => {
    expect(targetSize(1200, 900, 288, 216, 150)).toEqual({ w: 600, h: 450 });
    // x at 300 DPI, y at 200 DPI: the y axis decides, x keeps more than the target.
    expect(targetSize(1200, 900, 288, 324, 150)).toEqual({ w: 900, h: 675 });
  });
  it('leaves an image at or near the target alone', () => {
    expect(targetSize(1200, 900, 288, 216, 300)).toBeNull();
    expect(targetSize(1200, 900, 288, 216, 280)).toBeNull();   // factor 0.93 ≥ 0.9
    expect(targetSize(1200, 900, 0, 216, 150)).toBeNull();
  });
});

describe('planImageDownsample — where the image is drawn (row 27)', () => {
  it('measures a plain placement', async () => {
    expect(await sizes(await build(AT_4IN))).toEqual([[600, 450]]);
  });

  it('takes the LARGEST of several placements', async () => {
    expect(await sizes(await build(`q 144 0 0 108 0 0 cm /Im0 Do Q ${AT_4IN}`))).toEqual([[600, 450]]);
    expect(await sizes(await build(`${AT_4IN} q 144 0 0 108 0 0 cm /Im0 Do Q`))).toEqual([[600, 450]]);
  });

  it('composes cm in PDF order (inner first): a turned, unevenly scaled wide image', async () => {
    // Outer cm stretches x by 4; inner cm turns the image 90°. The image's x axis ends up 72 pt long and its
    // y axis 288 pt: 1200 px over 1 in and 300 px over 4 in — 75 DPI on y, so nothing to shrink at 150.
    // The reversed order gives 300 DPI on both axes and would shrink it.
    const content = 'q 4 0 0 1 0 0 cm 0 72 -72 0 100 0 cm /Im0 Do Q';
    const b = await build(content, { w: 1200, h: 300 });
    expect(await sizes(b, 150)).toEqual([]);
    expect(await sizes(b, 50)).toEqual([[800, 200]]);
  });

  it('applies a form /Matrix to what the form draws', async () => {
    const b = await build('q /Fm0 Do Q', { tweak: (doc, page, ref) => addForm(doc, page, ref, 'q 144 0 0 108 0 0 cm /Im0 Do Q', [2, 0, 0, 2, 0, 0]) });
    expect(await sizes(b)).toEqual([[600, 450]]);
  });

  it('a form left with an open q does not leak its cm into the page', async () => {
    const b = await build(`/Fm0 Do ${AT_4IN}`, { tweak: (doc, page, ref) => addForm(doc, page, ref, 'q 0.5 0 0 0.5 0 0 cm') });
    expect(await sizes(b)).toEqual([[600, 450]]);
  });

  it('counts /UserUnit: 144 × 108 units at UserUnit 2 is 4 × 3 in', async () => {
    const b = await build('q 144 0 0 108 0 0 cm /Im0 Do Q', { tweak: (_d, page) => page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)) });
    expect(await sizes(b)).toEqual([[600, 450]]);
  });

  it('a stream with a malformed cm measures nothing it draws (CONTROL: the same stream well-formed)', async () => {
    expect(await sizes(await build(`${AT_4IN} q 1 2 cm /Im0 Do Q`))).toEqual([]);
    expect(await sizes(await build(`${AT_4IN} q 1 0 0 1 0 0 cm /Im0 Do Q`))).toEqual([[600, 450]]);
  });

  it('a draw whose name does not resolve makes the page images unmeasured', async () => {
    expect(await sizes(await build(`${AT_4IN} q 999 0 0 999 0 0 cm /Missing Do Q`))).toEqual([]);
  });

  it('resolves a #-escaped name', async () => {
    expect(await sizes(await build('q 288 0 0 216 0 0 cm /Im#30 Do Q'))).toEqual([[600, 450]]);
  });
});

describe('planImageDownsample — which images qualify (row 27)', () => {
  it('a gray JPEG qualifies and is marked for an RGB colour space', async () => {
    const plans = await planImageDownsample((await build(AT_4IN, { comps: 1 })).doc, 150);
    expect(plans.map(p => p.toRgb)).toEqual([true]);
  });

  it('refuses CMYK, /Decode, /DecodeParms, a colour-key /Mask and an SMask with /Matte', async () => {
    expect(await sizes(await build(AT_4IN, { comps: 4 }))).toEqual([]);
    const edit = (f: (d: PDFDict, doc: PDFDocument) => void) => build(AT_4IN, {
      tweak: (doc, _p, ref) => f((doc.context.lookup(ref) as PDFRawStream).dict, doc),
    });
    expect(await sizes(await edit((d, doc) => d.set(PDFName.of('Decode'), doc.context.obj([1, 0, 1, 0, 1, 0]))))).toEqual([]);
    expect(await sizes(await edit((d, doc) => d.set(PDFName.of('DecodeParms'), doc.context.obj({ ColorTransform: 0 }))))).toEqual([]);
    expect(await sizes(await edit((d, doc) => d.set(PDFName.of('Mask'), doc.context.obj([0, 10, 0, 10, 0, 10]))))).toEqual([]);
    expect(await sizes(await edit((d, doc) => d.set(PDFName.of('SMask'), doc.context.register(
      doc.context.stream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Matte: [0, 0, 0] })))))).toEqual([]);
    // CONTROL: an SMask without /Matte may have its own size.
    expect(await sizes(await edit((d, doc) => d.set(PDFName.of('SMask'), doc.context.register(
      doc.context.stream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })))))).toEqual([[600, 450]]);
  });

  it('an image also drawn by an annotation appearance is left alone (CONTROL: an appearance drawing nothing)', async () => {
    const withAp = (xobjects: boolean) => build(AT_4IN, {
      tweak: (doc, page, ref) => {
        const ap = doc.context.register(doc.context.stream('q 999 0 0 999 0 0 cm /Im0 Do Q', {
          Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: xobjects ? { XObject: { Im0: ref } } : {},
        }));
        const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10], AP: { N: ap } }));
        page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
      },
    });
    expect(await sizes(await withAp(true))).toEqual([]);
    expect(await sizes(await withAp(false))).toEqual([[600, 450]]);
  });

  it('an image that is another image\'s mask is left alone', async () => {
    const b = await build(AT_4IN, {
      tweak: (doc, page, ref) => {
        const other = doc.context.register(doc.context.stream(new Uint8Array(3), {
          Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: ref,
        }));
        const x = page.node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
        x.set(PDFName.of('Im1'), other);
      },
    });
    expect(await sizes(b)).toEqual([]);
  });

  it('a Resources dictionary shared with an annotation appearance counts as drawn there', async () => {
    const b = await build(AT_4IN, {
      tweak: (doc, page) => {
        const resRef = doc.context.register(page.node.lookup(PDFName.of('Resources'), PDFDict));
        page.node.set(PDFName.of('Resources'), resRef);
        const ap = doc.context.register(doc.context.stream('q 999 0 0 999 0 0 cm /Im0 Do Q', {
          Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: resRef,
        }));
        const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10], AP: { N: ap } }));
        page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
      },
    });
    expect(await sizes(b)).toEqual([]);
  });
});

describe('downsampleImages — the replacement (row 27)', () => {
  it('replaces under the SAME object number with the new size, and rewrites gray as DeviceRGB', async () => {
    const { doc, ref } = await build(AT_4IN, { comps: 1 });
    const calls: number[][] = [];
    const n = await downsampleImages(doc, 150, 0.7, async (_b, w, h, q) => { calls.push([w, h, q]); return new Uint8Array(5); });
    expect(n).toBe(1);
    expect(calls).toEqual([[600, 450, 0.7]]);
    const s = (doc.context.lookup(ref) as PDFRawStream);
    expect(s.getContents()).toEqual(new Uint8Array(5));
    expect(s.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber()).toBe(600);
    expect(s.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber()).toBe(450);
    expect(s.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    // The page still draws that object.
    const x = doc.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    expect(x.get(PDFName.of('Im0'))).toBe(ref);
  });

  it('keeps the original when the re-encode is not smaller, or cannot decode', async () => {
    for (const out of [new Uint8Array(4096), null]) {
      const { doc, ref } = await build(AT_4IN);
      const before = (doc.context.lookup(ref) as PDFRawStream);
      expect(await downsampleImages(doc, 150, 0.7, async () => out)).toBe(0);
      expect(doc.context.lookup(ref)).toBe(before);
    }
  });
});

describe('stripExif (row 27)', () => {
  const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
  const EXIF = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0]);
  const XMP = seg(0xe1, [...'http://ns.adobe.com/xap/1.0/'].map(c => c.charCodeAt(0)).concat([0]));
  const JFIF = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
  const SCAN = [0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9];

  it('removes the EXIF APP1 and keeps every other segment and the scan byte for byte', () => {
    const out = stripExif(new Uint8Array([0xff, 0xd8, ...EXIF, ...JFIF, ...XMP, ...SCAN]));
    expect(Array.from(out)).toEqual([0xff, 0xd8, ...JFIF, ...XMP, ...SCAN]);
  });

  it('returns the same bytes when there is nothing to strip, or the header does not parse', () => {
    const plain = new Uint8Array([0xff, 0xd8, ...JFIF, ...SCAN]);
    expect(stripExif(plain)).toBe(plain);
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x45]);
    expect(stripExif(truncated)).toBe(truncated);
  });
});
