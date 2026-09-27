/**
 * Limits row 23 (D12, real pdf.js) — "Flatten & download" draws source annotations into their page.
 *
 * The oracle assumes no frame: the SOURCE page rendered by pdf.js with its annotations (what the editor canvas shows)
 * must equal the EXPORTED page rendered the same way. That comparison alone would pass if flatten did nothing, so each
 * case also renders the export with annotations DISABLED and requires the flattened colours to be there — they are
 * now page content. Every /Rotate and a CropBox origin run, and the page's own content ends with an unbalanced
 * `2 0 0 2 0 0 cm`: an appended appearance that inherited it would land at double coordinates.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const SIZE: [number, number] = [400, 360];
// Flattened: A (plain), B (/AS state + a rotating /Matrix), C (on an OFF layer), G (a sticky note with a popup).
const A = [40, 200, 100, 240];
const B = [150, 100, 190, 180];
const C = [240, 220, 300, 260];
const G = [260, 60, 290, 90];
// Kept: D hidden, E no appearance (pdf.js draws its own), F a link, H a pending redaction.
const D = [40, 60, 90, 100];
const E = [120, 250, 170, 300];
const F = [300, 150, 360, 170];
const H = [200, 280, 240, 310];

interface Built { bytes: Uint8Array; }

async function build(opts: { rotate?: number; crop?: boolean; noteContents?: string; reply?: boolean } = {}): Promise<Built> {
  const { PDFDocument, PDFName, PDFString, degrees } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage(SIZE);
  const ctx = doc.context;
  if (opts.rotate) page.setRotation(degrees(opts.rotate));
  if (opts.crop) page.setCropBox(30, 40, 340, 300);
  // A grey band, then a CTM change nobody restores.
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('0.8 g 0 0 400 20 re f 2 0 0 2 0 0 cm')));

  const form = (bbox: number[], content: string, matrix?: number[]) =>
    ctx.register(ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, ...(matrix ? { Matrix: matrix } : {}) } as never));
  const annot = (subtype: string, rect: number[], extra: Record<string, unknown> = {}) =>
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: subtype, Rect: rect, ...extra } as never));

  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') } as never));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocg], D: { OFF: [ocg], Order: [ocg] } } as never));

  const a = annot('Square', A, { AP: { N: form([0, 0, 60, 40], '1 0 0 rg 0 0 60 40 re f') } });
  // Two colour bands, so an orientation error shows: under this /Matrix the BBox turns 90 degrees.
  const bOn = form([0, 0, 40, 20], '0 0.6 0 rg 0 0 40 10 re f 0 0 1 rg 0 10 40 10 re f', [0, 1, -1, 0, 0, 0]);
  const bOff = form([0, 0, 40, 20], '1 0.5 0 rg 0 0 40 20 re f');
  // Off listed FIRST: taking the dictionary's first state instead of /AS would draw orange.
  const b = annot('Stamp', B, { AP: { N: { Off: bOff, On: bOn } }, AS: 'On' });
  const c = annot('Square', C, { AP: { N: form([0, 0, 60, 40], '1 0 1 rg 0 0 60 40 re f') }, OC: ocg });
  const g = annot('Text', G, {
    AP: { N: form([0, 0, 30, 30], '1 1 0 rg 0 0 30 30 re f') },
    ...(opts.noteContents ? { Contents: PDFString.of(opts.noteContents) } : {}),
  });
  const popup = annot('Popup', [300, 60, 380, 120], { Parent: g });
  (ctx.lookup(g) as import('@cantoo/pdf-lib').PDFDict).set(PDFName.of('Popup'), popup);
  const d = annot('Square', D, { F: 2, AP: { N: form([0, 0, 50, 40], '0 1 1 rg 0 0 50 40 re f') } });
  const e = annot('Circle', E, { C: [0, 0, 0.5], BS: { W: 3 } });
  const f = annot('Link', F, { Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.com') } });
  const h = annot('Redact', H, { AP: { N: form([0, 0, 40, 30], '0 0 0 rg 0 0 40 30 re f') } });
  const list = [a, b, c, g, popup, d, e, f, h];
  if (opts.reply) list.push(annot('Text', [10, 330, 30, 350], { IRT: g, Contents: PDFString.of('a reply') }));
  page.node.set(PDFName.of('Annots'), ctx.obj(list as never));
  return { bytes: await doc.save() };
}

async function flattened(bytes: Uint8Array, elements: PDFElement[] = [], userRot = 0) {
  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot } as DocumentPage;
  const warns: Array<[string, unknown]> = [];
  const reportError = {
    info() {}, silent() {},
    warn(k: string, p?: unknown) { warns.push([k, p]); },
    error(k: string, e?: unknown) { throw new Error(`errored: ${k} — ${String(e)}`); },
  } as unknown as IErrorReporter;
  const documentModel = {
    currentPage: docPage, currentPageIndex: 0, pageCount: 1, pages: [docPage],
    sourcePdfs: new Map([['s1', { doc: pdfjsDoc, bytes }]]),
    watermark: { enabled: false }, bates: { enabled: false },
  };
  const svc = new ExportService({
    documentModel, elements, formValues: {}, currentFilename: 'doc.pdf', exportPassword: null,
    inkLayer: new InkLayer(), reportError, progress: { begin: () => ({ done() {}, failed() {}, update() {}, setFraction() {} }) },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext) as unknown as {
    _assemblePdfDoc(a?: unknown, b?: unknown, o?: unknown): Promise<import('@cantoo/pdf-lib').PDFDocument>;
    _saveForExport(d: unknown): Promise<Uint8Array>;
  };
  const pdfDoc = await svc._assemblePdfDoc(undefined, undefined, { flattenAllForms: true, cleanMetadata: true });
  const out = await svc._saveForExport(pdfDoc);
  await pdfjsDoc.loadingTask.destroy();
  return { out, warns };
}

interface Rendered { data: Uint8ClampedArray; w: number; h: number; at(rect: number[]): [number, number, number]; }

async function render(bytes: Uint8Array, annotations: boolean, showAllLayers = false, extraRot = 0): Promise<Rendered> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + extraRot) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  let optionalContentConfigPromise;
  if (showAllLayers) {
    const cfg = await doc.getOptionalContentConfig();
    for (const [id] of cfg as unknown as Iterable<[string, unknown]>) cfg.setVisibility(id, true);
    optionalContentConfigPromise = Promise.resolve(cfg);
  }
  await page.render({
    canvasContext: c2d, viewport: vp, canvas,
    annotationMode: annotations ? pdfjsLib.AnnotationMode.ENABLE : pdfjsLib.AnnotationMode.DISABLE,
    optionalContentConfigPromise,
  }).promise;
  const data = c2d.getImageData(0, 0, canvas.width, canvas.height).data;
  const w = canvas.width, h = canvas.height;
  await doc.loadingTask.destroy();
  return {
    data, w, h,
    at(rect) {
      const [px, py] = vp.convertToViewportPoint((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
      const i = (Math.round(py) * w + Math.round(px)) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

function mismatch(a: Rendered, b: Rendered): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 40 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 40 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 40) n++;
  }
  return n;
}

const near = (px: [number, number, number], rgb: [number, number, number]) =>
  px.every((v, i) => Math.abs(v - rgb[i]) < 60);

async function annotSubtypes(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const annots = await (await doc.getPage(1)).getAnnotations();
  await doc.loadingTask.destroy();
  return annots.map((x: { subtype: string }) => x.subtype).sort();
}

describe('flatten draws source annotations into the page (limits row 23)', () => {
  const variants: Array<[string, { rotate?: number; crop?: boolean; userRot?: number }]> = [
    ['/Rotate 0', {}], ['/Rotate 90', { rotate: 90 }], ['/Rotate 180', { rotate: 180 }], ['/Rotate 270', { rotate: 270 }],
    ['a CropBox origin on /Rotate 90', { rotate: 90, crop: true }],
    // The user's rotate button: the export page turns, the source is drawn turned by the same amount.
    ['a user rotation of 90 on /Rotate 270 with a CropBox origin', { rotate: 270, crop: true, userRot: 90 }],
  ];
  for (const [label, v] of variants) {
    it(`${label}: the export shows what the editor showed, and the flattened ones are page content`, async () => {
      const { bytes } = await build(v);
      const { out, warns } = await flattened(bytes, [], v.userRot);
      const before = await render(bytes, true, false, v.userRot ?? 0);
      const after = await render(out, true);
      expect(mismatch(before, after), 'pixels differing from the source render').toBe(0);

      const content = await render(out, false);
      expect(near(content.at(A), [255, 0, 0]), `A ${content.at(A)}`).toBe(true);
      // Under B's /Matrix the form's upper (blue) band becomes the LEFT half of the rect, the green one the right.
      expect(near(content.at([B[0], B[1], B[0] + 20, B[3]]), [0, 0, 255]), 'B left half blue').toBe(true);
      expect(near(content.at([B[0] + 20, B[1], B[2], B[3]]), [0, 153, 0]), 'B right half green').toBe(true);
      expect(near(content.at(G), [255, 255, 0]), `G ${content.at(G)}`).toBe(true);
      // The OFF layer still hides C — and C IS in the content, inside that layer.
      expect(near(content.at(C), [255, 0, 255]), 'C hidden by its layer').toBe(false);
      expect(near((await render(out, false, true)).at(C), [255, 0, 255]), 'C once the layer is on').toBe(true);
      // Kept annotations are not in the content.
      expect(near(content.at(H), [0, 0, 0]), 'H (a pending redaction) not baked').toBe(false);

      expect(await annotSubtypes(out)).toEqual(['Circle', 'Link', 'Redact', 'Square']);
      expect(warns).toEqual([['toast.flattenAnnotationsSkipped', { count: 1 }]]);
    });
  }

  // Real files, not built here: pdf.js's own annotation tests (provenance in tests/fixtures/annotations/README.md).
  const real = import.meta.glob('../fixtures/annotations/*.pdf', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
  // One case per file: the four together sat at the 30 s budget under full-suite load (timed out twice, passed
  // alone), and a red then names the file.
  it('pdf.js\'s own annotation test files are all here', () => {
    expect(Object.keys(real)).toHaveLength(4);
  });
  for (const [name, url] of Object.entries(real)) {
    it(`${name.split('/').pop()} flattens pixel-identically and leaves no annotation`, async () => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      expect((await annotSubtypes(bytes)).length, `${name} has annotations to start with`).toBeGreaterThan(0);
      const { out, warns } = await flattened(bytes);
      expect(mismatch(await render(bytes, true), await render(out, true)), name).toBe(0);
      expect(await annotSubtypes(out), name).toEqual([]);
      expect(warns, name).toEqual([]);
    });
  }

  it('an annotation under a redaction is flattened into content and burned with it', async () => {
    const { bytes } = await build();
    // Display rect of A at /Rotate 0: y measured down from the page top.
    const red = new RedactionElement(A[0] - 2, SIZE[1] - A[3] - 2, A[2] - A[0] + 4, A[3] - A[1] + 4, 'p1');
    const { out } = await flattened(bytes, [red as unknown as PDFElement]);
    const r = await render(out, true);
    let redPixels = 0;
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i] > 200 && r.data[i + 1] < 60 && r.data[i + 2] < 60) redPixels++;
    expect(redPixels).toBe(0);
    expect(near(r.at(G), [255, 255, 0]), 'G, clear of the redaction, still shows').toBe(true);
  });

  it("a flattened note's /Contents leaves the file — unless a kept reply still points at the note", async () => {
    const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
    const alone = await flattened((await build({ noteContents: 'NOTE-SECRET-4711' })).bytes);
    expect(alone.out.byteLength).toBeGreaterThan(0);
    expect(text(alone.out)).not.toContain('NOTE-SECRET-4711');
    const withReply = await flattened((await build({ noteContents: 'NOTE-SECRET-4711', reply: true })).bytes);
    expect(text(withReply.out)).toContain('NOTE-SECRET-4711');
    expect(text(withReply.out)).toContain('a reply');
  });
});
