/**
 * Limits row 27 (D20) — Compress → "shrink images", real Chrome: the browser decodes, resizes and re-encodes
 * each qualifying JPEG, and the result replaces the image in place.
 *
 * Asserted on the OUTPUT file: the image's /Width and /Height (the structure), the colour of each of its four
 * quadrants as pdf.js renders it (the pixels), the text still extractable, an image already under the target
 * left BYTE-identical, a turned placement measured on the right axes, and an EXIF-rotated JPEG left unturned
 * (a PDF reader ignores EXIF, so the re-encode must too).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { PDFRawStream, PDFNumber, PDFRef } from '@cantoo/pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const QUAD = [[220, 40, 40], [40, 180, 60], [40, 70, 220], [230, 210, 40]]; // TL, TR, BL, BR

/** A w × h JPEG in four coloured quadrants with deterministic grain, so it compresses like a photo. */
async function quadJpeg(w: number, h: number, quality = 0.95): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  let seed = 7;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = QUAD[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)];
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = (seed % 25) - 12;
    const i = (y * w + x) * 4;
    img.data[i] = q[0] + n; img.data[i + 1] = q[1] + n; img.data[i + 2] = q[2] + n; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>(res => { c.toBlob(b => res(b as Blob), 'image/jpeg', quality); });
  return new Uint8Array(await blob.arrayBuffer());
}

/** The same JPEG with an EXIF APP1 saying Orientation 6 (turn 90° clockwise to display). */
function withExifOrientation6(jpeg: Uint8Array): Uint8Array {
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, ...jpeg.slice(2)]);
}

const PAGE: [number, number] = [612, 792];
// 1200 × 900 at 288 × 216 pt is 300 DPI; at 150 it shrinks to 600 × 450.
const MAIN = { x: 100, y: 300, width: 288, height: 216 };

interface Source { bytes: Uint8Array; names: Record<string, string>; images: Record<string, Uint8Array> }

async function makeSource(opts: { exif?: boolean; smask?: boolean } = {}): Promise<Source> {
  const { PDFDocument, StandardFonts, degrees, PDFName, PDFDict } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(PAGE);
  page.drawText('KEEPTEXT row 27', { x: 50, y: 740, size: 24, font });
  const main = await quadJpeg(1200, 900);
  const images = { main: opts.exif ? withExifOrientation6(main) : main, small: await quadJpeg(300, 225), turned: await quadJpeg(1200, 900) };
  const eMain = await doc.embedJpg(images.main);
  const eSmall = await doc.embedJpg(images.small);
  const eTurned = await doc.embedJpg(images.turned);
  page.drawImage(eMain, MAIN);
  page.drawImage(eSmall, { x: 420, y: 300, width: 144, height: 108 });            // 150 DPI: at the target
  page.drawImage(eTurned, { x: 500, y: 60, width: 288, height: 216, rotate: degrees(90) }); // turned, 300 DPI
  let bytes: Uint8Array = await doc.save({ useObjectStreams: false });
  if (opts.smask) bytes = await withHalfSMask(bytes, eMain.ref);
  // The XObject names on the page, per image (names survive the export's page copy).
  const x = page.node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  const names: Record<string, string> = {};
  for (const [k, v] of x.entries()) {
    const key = v === eMain.ref ? 'main' : v === eSmall.ref ? 'small' : v === eTurned.ref ? 'turned' : '';
    if (key) names[key] = k.decodeText();
  }
  return { bytes, names, images };
}

/**
 * Gives the image at `ref` a 4 × 3 soft mask whose left half is opaque and right half transparent — a mask far
 * smaller than the image, which is legal (the reader stretches it) and stays so after the image shrinks.
 */
async function withHalfSMask(bytes: Uint8Array, ref: PDFRef): Promise<Uint8Array> {
  const { PDFDocument, PDFName } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const mask = doc.context.flateStream(new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0]), {
    Type: 'XObject', Subtype: 'Image', Width: 4, Height: 3, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  const img = doc.context.lookup(ref) as PDFRawStream;
  img.dict.set(PDFName.of('SMask'), doc.context.register(mask));
  return doc.save({ useObjectStreams: false });
}

function buildProbe(srcBytes: Uint8Array) {
  const infos: string[] = [];
  const errors: string[] = [];
  const downloaded: Blob[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: srcBytes }]]),
      watermark: { enabled: false },
    },
    elements: [], formValues: {}, currentFilename: 'doc.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: {
      info: (k: string) => infos.push(k), warn: () => {},
      error: (k: string, e?: unknown) => errors.push(`${k}: ${e instanceof Error ? e.message : String(e)}`),
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob) => void })._downloadBlob = b => downloaded.push(b);
  return { svc, infos, errors, downloaded };
}

async function shrink(src: Source): Promise<Uint8Array> {
  const p = buildProbe(src.bytes);
  await p.svc.compressAndDownload({ mode: 'images', dpi: 150, quality: 0.8 });
  expect(p.errors).toEqual([]);
  expect(p.downloaded).toHaveLength(1);
  return new Uint8Array(await p.downloaded[0].arrayBuffer());
}

async function imageIn(out: Uint8Array, name: string) {
  const { PDFDocument, PDFName, PDFDict } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(out, { updateMetadata: false });
  const x = doc.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  const s = doc.context.lookup(x.get(PDFName.of(name))) as PDFRawStream;
  const num = (k: string) => (s.dict.lookup(PDFName.of(k)) as PDFNumber).asNumber();
  return { width: num('Width'), height: num('Height'), bytes: s.getContents() };
}

/** RGB at display point (x, y) of page 1 rendered at scale 1. */
async function sampler(bytes: Uint8Array) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  await page.render({ canvas, viewport: vp }).promise;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const text = (await page.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('');
  await doc.loadingTask.destroy();
  return { text, at: (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)) };
}

/** Quadrant centres of MAIN in display space (y down). */
const QCENTRES = (() => {
  const top = PAGE[1] - (MAIN.y + MAIN.height);
  const xs = [MAIN.x + MAIN.width / 4, MAIN.x + (3 * MAIN.width) / 4];
  const ys = [top + MAIN.height / 4, top + (3 * MAIN.height) / 4];
  return [[xs[0], ys[0]], [xs[1], ys[0]], [xs[0], ys[1]], [xs[1], ys[1]]];
})();

describe('Compress → shrink images, real Chrome (row 27)', () => {
  it('shrinks a 300 DPI JPEG to 150 DPI in place, colours and text intact, and the file gets smaller', async () => {
    const src = await makeSource();
    const out = await shrink(src);
    const img = await imageIn(out, src.names.main);
    expect([img.width, img.height]).toEqual([600, 450]);
    expect(out.length).toBeLessThan(src.bytes.length);
    const before = await sampler(src.bytes), after = await sampler(out);
    expect(after.text).toContain('KEEPTEXT');
    QCENTRES.forEach(([x, y], i) => {
      const a = after.at(Math.round(x), Math.round(y)), b = before.at(Math.round(x), Math.round(y));
      a.forEach((v, c) => expect(Math.abs(v - b[c]), `quadrant ${i} channel ${c}: ${a} vs ${b}`).toBeLessThanOrEqual(16));
      QUAD[i].forEach((v, c) => expect(Math.abs(a[c] - v), `quadrant ${i} channel ${c} vs drawn`).toBeLessThanOrEqual(20));
    });
  });

  it('measures a turned placement on its own axes, and leaves an image already at the target byte-identical', async () => {
    const src = await makeSource();
    const out = await shrink(src);
    const turned = await imageIn(out, src.names.turned);
    expect([turned.width, turned.height]).toEqual([600, 450]);
    const small = await imageIn(out, src.names.small);
    expect([small.width, small.height]).toEqual([300, 225]);
    expect(small.bytes).toEqual(src.images.small);
  });

  it('keeps a plain soft mask: the shrunk image still shows only where the (smaller, stretched) mask is opaque', async () => {
    const src = await makeSource({ smask: true });
    const out = await shrink(src);
    const img = await imageIn(out, src.names.main);
    expect([img.width, img.height]).toEqual([600, 450]);
    const before = await sampler(src.bytes), after = await sampler(out);
    QCENTRES.forEach(([x, y], i) => {
      const a = after.at(Math.round(x), Math.round(y)), b = before.at(Math.round(x), Math.round(y));
      const want = i % 2 === 0 ? QUAD[i] : [255, 255, 255]; // left quadrants drawn, right ones masked out
      want.forEach((v, c) => expect(Math.abs(a[c] - v), `quadrant ${i} channel ${c}: ${a}`).toBeLessThanOrEqual(20));
      a.forEach((v, c) => expect(Math.abs(v - b[c]), `quadrant ${i} channel ${c} vs before`).toBeLessThanOrEqual(16));
    });
  });

  it('ignores EXIF orientation, as a PDF reader does: an Orientation-6 JPEG comes out unturned', async () => {
    const src = await makeSource({ exif: true });
    const out = await shrink(src);
    const img = await imageIn(out, src.names.main);
    expect([img.width, img.height]).toEqual([600, 450]);
    const after = await sampler(out);
    QCENTRES.forEach(([x, y], i) => {
      const a = after.at(Math.round(x), Math.round(y));
      QUAD[i].forEach((v, c) => expect(Math.abs(a[c] - v), `quadrant ${i} channel ${c}: ${a}`).toBeLessThanOrEqual(20));
    });
  });
});
