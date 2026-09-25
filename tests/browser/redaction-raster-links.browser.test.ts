/**
 * A4 (real Chrome) — a page exported through the redaction rasterizer keeps its SAFE links.
 *
 * `rasterizePageWithRedactions` turns the page into one image, which used to drop every `/Link`:
 * the source's own and the ones an overlay text box adds. Ruling (limits-walkthrough A4): re-add
 * every link that does not meet a redaction, in the clipped output frame; a covered link must
 * never come back.
 *
 * The positional pin is a pixel, not arithmetic of the test's own: each link sits over a filled
 * rectangle of its own colour, and the test samples the rendered output at the CENTRE of every
 * re-added `/Rect`. A frame error at 90/180/270, under a crop, or under a source CropBox origin
 * moves the rect off its colour. The fixture is NON-SQUARE and the links sit far from both centre
 * lines, so a 180° flip and a 90° swap each land on a different colour or on white.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { TextElement } from '../../src/elements/textElement';
import { InkLayer } from '../../src/infra/inkLayer';
import { contentRectToDisplay } from '../../src/utils/geometry';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 300, H = 600;
/** Rects in page content space: x from the left, y DOWN from the MediaBox top. */
type Box = { x: number; y: number; w: number; h: number };
const SRC_SAFE: Box = { x: 20, y: 40, w: 60, h: 40 };      // green, https://safe.example/src
const SRC_COVERED: Box = { x: 200, y: 450, w: 80, h: 50 }; // blue, under the redaction
const SRC_JS: Box = { x: 200, y: 40, w: 80, h: 40 };        // white, javascript: — never returns
const SRC_GOTO: Box = { x: 20, y: 450, w: 60, h: 50 };      // white, GoTo — never returns
const OV_SAFE: Box = { x: 20, y: 250, w: 100, h: 40 };      // magenta overlay, https://safe.example/overlay
const OV_COVERED: Box = { x: 210, y: 460, w: 60, h: 30 };   // overlay link stacked UNDER the redaction
const REDACT: Box = { x: 190, y: 440, w: 100, h: 70 };

const URL_SRC = 'https://safe.example/src';
const URL_OV = 'https://safe.example/overlay';

const noopReporter = { info() {}, warn() {}, error() {}, silent() {} } as unknown as IErrorReporter;
const noWatermark: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };

interface Fixture {
  /** Source `/Rotate`. */
  srcRotate?: number;
  /** Source `/CropBox` as [x0, y0, x1, y1]; its top stays at H so content y-down is unchanged. */
  srcCropBox?: [number, number, number, number];
}

async function buildSource(f: Fixture): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, PDFName, PDFArray, PDFString, rgb, degrees } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  const fill = (b: Box, c: [number, number, number]) =>
    page.drawRectangle({ x: b.x, y: H - b.y - b.h, width: b.w, height: b.h, color: rgb(...c) });
  fill(SRC_SAFE, [0, 1, 0]);
  fill(SRC_COVERED, [0, 0, 1]);
  const ctx = doc.context;
  const rectOf = (b: Box) => ctx.obj([b.x, H - b.y - b.h, b.x + b.w, H - b.y]);
  const link = (b: Box, action: import('@cantoo/pdf-lib').PDFDict) => ctx.register(ctx.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: rectOf(b), A: action,
  }));
  const annots = PDFArray.withContext(ctx);
  annots.push(link(SRC_SAFE, ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of(URL_SRC) })));
  annots.push(link(SRC_COVERED, ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of('https://covered.example/src') })));
  annots.push(link(SRC_JS, ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of('javascript:alert(1)') })));
  annots.push(link(SRC_GOTO, ctx.obj({ S: PDFName.of('GoTo'), D: ctx.obj([page.ref, PDFName.of('Fit')]) })));
  page.node.set(PDFName.of('Annots'), annots);
  if (f.srcRotate) page.setRotation(degrees(f.srcRotate));
  if (f.srcCropBox) {
    const [x0, y0, x1, y1] = f.srcCropBox;
    page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  }
  return doc;
}

interface Run extends Fixture {
  userRot?: number;
  /** User crop in unrotated content space relative to the source CropBox (y down). */
  crop?: { x: number; y: number; width: number; height: number };
}

/** Rasterize and return the produced page's links plus a colour sampler over its rendering. */
async function run(opts: Run) {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await buildSource(opts);
  const [cx0, , cx1, cy1] = opts.srcCropBox ?? [0, 0, W, H];
  const cw = cx1 - cx0, ch = cy1 - (opts.srcCropBox?.[1] ?? 0);
  const totalRot = (((opts.srcRotate ?? 0) + (opts.userRot ?? 0)) % 360 + 360) % 360;
  // Content box (MediaBox frame) → the editor's DISPLAY frame, which is where elements live.
  const disp = (b: Box) => contentRectToDisplay(
    { x: b.x - cx0, y: b.y - (H - cy1), width: b.w, height: b.h }, cw, ch, totalRot,
  );
  const text = (b: Box, url: string, colour: string) => {
    const d = disp(b);
    const te = new TextElement(d.x, d.y, 'p1', {
      width: d.width, height: d.height, fontSize: 8, color: colour, backgroundColor: colour, linkUrl: url,
    });
    te.text = 'LINK';
    return te as unknown as PDFElement;
  };
  const r = disp(REDACT);
  const elements: PDFElement[] = [
    text(OV_COVERED, 'https://covered.example/overlay', '#0000ff'),   // stacked UNDER the redaction
    new RedactionElement(r.x, r.y, r.width, r.height, 'p1', '#000000') as unknown as PDFElement,
    text(OV_SAFE, URL_OV, '#ff00ff'),
  ];
  const docPage: DocumentPage = {
    id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: opts.userRot ?? 0,
    ...(opts.crop ? { crop: opts.crop } : {}),
  } as DocumentPage;
  const target = await PDFDocument.create();
  await rasterizePageWithRedactions(src, docPage, elements, target, { rgb, StandardFonts, degrees },
    noWatermark, new InkLayer(), noopReporter);
  const bytes = await target.save({ useObjectStreams: false });

  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const p = await pdf.getPage(1);
  const annots = (await p.getAnnotations()) as Array<{ subtype: string; url?: string; rect: number[]; unsafeUrl?: string }>;
  const links = annots.filter(a => a.subtype === 'Link');
  const vp = p.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const cctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await p.render({ canvas, viewport: vp }).promise;
  /** Average colour of a 5×5 patch at the centre of a user-space rect in the OUTPUT page. */
  const colourAt = (rect: number[]) => {
    const [px, py] = vp.convertToViewportPoint((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
    const d = cctx.getImageData(Math.round(px) - 2, Math.round(py) - 2, 5, 5).data;
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
    const n = d.length / 4;
    return { r: rr / n, g: gg / n, b: bb / n };
  };
  const [, , ow, oh] = p.view;
  return { links, colourAt, outW: ow, outH: oh };
}

const isGreen = (c: { r: number; g: number; b: number }) => c.g > 180 && c.r < 80 && c.b < 80;
const isMagenta = (c: { r: number; g: number; b: number }) => c.r > 180 && c.b > 180 && c.g < 80;

async function expectBothSafeLinksInPlace(opts: Run) {
  const { links, colourAt, outW, outH } = await run(opts);
  const urls = links.map(l => l.url ?? l.unsafeUrl).sort();
  expect(urls).toEqual([URL_OV, URL_SRC].sort());
  for (const l of links) {
    const [x1, y1, x2, y2] = l.rect;
    expect(Math.min(x1, x2)).toBeGreaterThanOrEqual(0);
    expect(Math.min(y1, y2)).toBeGreaterThanOrEqual(0);
    expect(Math.max(x1, x2)).toBeLessThanOrEqual(outW + 1e-6);
    expect(Math.max(y1, y2)).toBeLessThanOrEqual(outH + 1e-6);
    const c = colourAt(l.rect);
    if ((l.url ?? l.unsafeUrl) === URL_SRC) expect(isGreen(c), `src link at ${l.rect} sampled ${JSON.stringify(c)}`).toBe(true);
    else expect(isMagenta(c), `overlay link at ${l.rect} sampled ${JSON.stringify(c)}`).toBe(true);
  }
}

describe('A4 — safe links survive the redaction rasterizer, covered ones never return', () => {
  for (const userRot of [0, 90, 180, 270]) {
    it(`user rotation ${userRot}: both safe links re-added over their own colour; covered/js/GoTo absent`, async () => {
      await expectBothSafeLinksInPlace({ userRot });
    });
  }

  it('source /Rotate 90', async () => {
    await expectBothSafeLinksInPlace({ srcRotate: 90 });
  });

  it('source /CropBox with a non-zero origin', async () => {
    await expectBothSafeLinksInPlace({ srcCropBox: [10, 30, 300, 600] });
  });

  it('user crop that keeps everything, at rotation 90', async () => {
    await expectBothSafeLinksInPlace({ userRot: 90, crop: { x: 10, y: 20, width: 280, height: 520 } });
  });

  it('user crop that cuts through both safe links: rects are clipped to the page, not negative', async () => {
    // Crop starts at content x=50: the source link (x 20..80) and the overlay (x 20..120) both cross it.
    await expectBothSafeLinksInPlace({ crop: { x: 50, y: 0, width: 250, height: 600 } });
  });

  it('a link wholly outside the crop window is not re-added', async () => {
    // Crop keeps content y 200..600 — the source link (y 40..80) is cut away entirely.
    const { links, colourAt } = await run({ crop: { x: 0, y: 200, width: 300, height: 400 } });
    expect(links.map(l => l.url ?? l.unsafeUrl)).toEqual([URL_OV]);
    expect(isMagenta(colourAt(links[0].rect))).toBe(true);
  });

  it('non-vacuity: the fixture really carries the covered, javascript: and GoTo links', async () => {
    const src = await buildSource({});
    const bytes = await src.save({ useObjectStreams: false });
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const annots = (await (await pdf.getPage(1)).getAnnotations()) as Array<{ subtype: string }>;
    expect(annots.filter(a => a.subtype === 'Link')).toHaveLength(4);
  });
});
