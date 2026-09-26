/**
 * Oriented overlays export the way the editor shows them, on rotated pages too (A3-pre, 2026-09-26).
 *
 * The editor draws every element upright on screen, turned by its own rotation about the BOX CENTRE
 * (`elementLayerRenderer`: CSS `rotate(deg)`, `transform-origin: center center`). The export used to
 * hand pdf-lib `rotate: degrees(-elemRot)` alone, which is right only when the page itself is not
 * rotated: on a /Rotate 90 scan, or after the user turned the page, text, images, codes, signatures
 * and comments came out turned by the page rotation (and images squashed into swapped dimensions).
 * Rotated TEXT additionally turned about its line start rather than the box centre, landing up to
 * ~120pt away from where the editor shows it.
 *
 * Two oracles, both independent of the renderer's own arithmetic:
 *  - IMAGES (image, code, signature): a four-colour quadrant picture. A 4×4 grid of points on it is
 *    rotated about the ELEMENT centre in display space, exactly as CSS turns it, and the exported page
 *    must show each point's quadrant colour there. Position, orientation and aspect in one check.
 *  - TEXT (plain, advanced, Arabic, mixed, comment, signature caption): pdf.js's own text transforms,
 *    mapped to display space. The reference is the same element exported on an UNROTATED page with
 *    no element rotation — a path this change leaves byte-identical — and the expected origin is that
 *    reference turned about the box centre, reading along (cos θ, sin θ).
 */
import { describe, it, expect } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { buildPageOverlays } from '../../src/export/exportPipeline';
import { TextElement } from '../../src/elements/textElement';
import { ImageElement } from '../../src/elements/imageElement';
import { CodeElement } from '../../src/elements/codeElement';
import { SignatureElement } from '../../src/elements/signatureElement';
import { CommentElement } from '../../src/elements/commentElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;
// Non-square content box so a swapped dimension or a wrong pivot cannot cancel out.
const W = 300, H = 400, SCALE = 2;
const noWM: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000', fontSize: 10 };
const rep = { info() {}, warn() {}, error() {}, silent() {} } as unknown as IErrorReporter;

type Box = { x: number; y: number; w: number; h: number };
const COLOURS = { red: [230, 20, 20], green: [20, 170, 20], blue: [20, 20, 230], yellow: [240, 210, 0] } as const;
type Colour = keyof typeof COLOURS;

/** A picture whose four quadrants are four colours: TL red, TR green, BL blue, BR yellow. */
function quadrantPng(w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  const fill = (k: Colour, x: number, y: number) => { cx.fillStyle = `rgb(${COLOURS[k].join(',')})`; cx.fillRect(x, y, w, h); };
  fill('red', 0, 0); fill('green', w, 0); fill('blue', 0, h); fill('yellow', w, h);
  return c.toDataURL('image/png');
}

/** CSS `rotate(θ)` about the box centre, in display (y-down) coordinates. */
function turn(px: number, py: number, b: Box, deg: number): { x: number; y: number } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, t = deg * Math.PI / 180;
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * Math.cos(t) - dy * Math.sin(t), y: cy + dx * Math.sin(t) + dy * Math.cos(t) };
}

describe('the oracle', () => {
  it('turn() is what CSS rotate() about the centre does', () => {
    const b: Box = { x: 50, y: 40, w: 120, h: 60 };
    const host = document.createElement('div');
    host.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;transform:rotate(30deg);transform-origin:center center`;
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;left:${b.w / 4 - 1}px;top:${b.h / 4 - 1}px;width:2px;height:2px`;
    host.appendChild(dot);
    const frame = document.createElement('div');
    frame.style.cssText = 'position:absolute;left:0;top:0';
    frame.appendChild(host);
    document.body.appendChild(frame);
    const f = frame.getBoundingClientRect(), d = dot.getBoundingClientRect();
    const want = turn(b.x + b.w / 4, b.y + b.h / 4, b, 30);
    expect(Math.abs(d.x + d.width / 2 - f.x - want.x)).toBeLessThan(0.5);
    expect(Math.abs(d.y + d.height / 2 - f.y - want.y)).toBeLessThan(0.5);
    frame.remove();
  });
});

function withRotation<T extends PDFElement>(el: T, deg: number): T {
  (el as { rotation?: number }).rotation = deg;
  return el;
}

async function exportPage(sourceRot: number, userRot: number, elements: PDFElement[]) {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await PDFDocument.create();
  const sp = src.addPage([W, H]);
  sp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  if (sourceRot) sp.setRotation(degrees(sourceRot));
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [0]);
  out.addPage(page);
  await buildPageOverlays({
    pdfDoc: out, page, docPage: { id: 'p1', sourcePdfId: 's', sourcePageNum: 1, rotation: userRot },
    elements, pdfLib: { rgb, StandardFonts, degrees },
    userRot, sourceRot: page.getRotation().angle, watermark: noWM, inkLayer: new InkLayer(), reportError: rep,
  });
  const bytes = await out.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  return pdf.getPage(1);
}

// Every page orientation the editor can present: a source /Rotate, a user rotation, and both.
const PAGES = [
  { sourceRot: 0, userRot: 0 }, { sourceRot: 90, userRot: 0 }, { sourceRot: 180, userRot: 0 },
  { sourceRot: 270, userRot: 0 }, { sourceRot: 0, userRot: 90 }, { sourceRot: 90, userRot: 180 },
];
const ELEMENT_ROTATIONS = [0, 90, 30];
const CASES = PAGES.flatMap(p => ELEMENT_ROTATIONS.map(r => ({ ...p, r })));

// ─── pictures ──────────────────────────────────────────────────────────────────
const IMG: Box = { x: 30, y: 30, w: 120, h: 60 };
const CODE: Box = { x: 190, y: 30, w: 80, h: 80 };
const SIG: Box = { x: 40, y: 170, w: 140, h: 70 };
// With a caption the picture fills only the top band (renderSignature: min(h·0.34, 22) is reserved
// below it), and the WHOLE element turns about its own centre — so the band's centre moves.
const SIG_BAND: Box = { x: SIG.x, y: SIG.y, w: SIG.w, h: SIG.h - Math.min(SIG.h * 0.34, 22) };

function pictureElements(deg: number): PDFElement[] {
  return [
    withRotation(new ImageElement(IMG.x, IMG.y, IMG.w, IMG.h, 'p1', quadrantPng(IMG.w, IMG.h)) as unknown as PDFElement, deg),
    withRotation(new CodeElement(CODE.x, CODE.y, 'p1', { codeType: 'qr', data: 'x' }, quadrantPng(CODE.w, CODE.h), { w: CODE.w, h: CODE.h }) as unknown as PDFElement, deg),
    withRotation(new SignatureElement(SIG.x, SIG.y, 'p1', quadrantPng(SIG_BAND.w, SIG_BAND.h), { width: SIG.w, height: SIG.h, signer: 'Ann' }) as unknown as PDFElement, deg),
  ];
}

function classify(d: Uint8ClampedArray, width: number, px: number, py: number): Colour | 'none' {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = ((Math.round(py) + dy) * width + Math.round(px) + dx) * 4;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  r /= n; g /= n; b /= n;
  let best: Colour | 'none' = 'none', bestD = 60 * 60 * 3;
  for (const k of Object.keys(COLOURS) as Colour[]) {
    const [cr, cg, cb] = COLOURS[k];
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestD) { bestD = dist; best = k; }
  }
  return best;
}

describe('pictures keep their orientation and aspect on a rotated page', () => {
  it.each(CASES)('source /Rotate $sourceRot, user $userRot, element $r°', async ({ sourceRot, userRot, r }) => {
    const pg = await exportPage(sourceRot, userRot, pictureElements(r));
    const vp = pg.getViewport({ scale: SCALE });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    await pg.render({ canvas: c, viewport: vp }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const wrong: string[] = [];
    for (const [name, b, pivot] of [['image', IMG, IMG], ['code', CODE, CODE], ['signature', SIG_BAND, SIG]] as const) {
      // A 4×4 grid reaching 10% from each edge: a shift of a few points (the captioned signature's
      // band sits 11pt off the element centre) crosses a quadrant or leaves the picture.
      const quads: Array<[Colour, number, number]> = [];
      for (const fx of [0.1, 0.4, 0.6, 0.9]) for (const fy of [0.1, 0.4, 0.6, 0.9]) {
        const want: Colour = fy < 0.5 ? (fx < 0.5 ? 'red' : 'green') : (fx < 0.5 ? 'blue' : 'yellow');
        quads.push([want, b.x + b.w * fx, b.y + b.h * fy]);
      }
      for (const [want, qx, qy] of quads) {
        const p = turn(qx, qy, pivot, r);
        const got = classify(d, c.width, p.x * SCALE, p.y * SCALE);
        if (got !== want) wrong.push(`${name} ${want} quadrant at (${p.x.toFixed(0)},${p.y.toFixed(0)}) shows ${got}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ─── text ──────────────────────────────────────────────────────────────────────
// Centres sit at least half a diagonal from every edge of the 300×300 region every orientation
// shares, so a turned box stays on the page: pdf.js TRUNCATES a text item at the page edge, which
// would read as a wrong string rather than as the placement error it is.
const LATIN: Box = { x: 40, y: 70, w: 100, h: 20 };
const ADV: Box = { x: 160, y: 70, w: 100, h: 20 };
const AR: Box = { x: 30, y: 140, w: 120, h: 20 };
const MIX: Box = { x: 145, y: 140, w: 130, h: 20 };
const NOTE: Box = { x: 40, y: 195, w: 100, h: 60 };
const CAP: Box = { x: 160, y: 190, w: 110, h: 70 };
// ~63pt at 10pt Helvetica: fits the display width (100 − 8) on one line, but would wrap at the
// swapped width (60 − 8) — so a maxWidth taken from the wrong axis changes the item list.
const NOTE_TEXT = 'NOTE ALPHA';

function textElements(deg: number): PDFElement[] {
  const text = (b: Box, t: string, extra: object = {}) =>
    withRotation(Object.assign(new TextElement(b.x, b.y, 'p1', { width: b.w, height: b.h, fontSize: 14 }), { text: t }, extra) as unknown as PDFElement, deg);
  return [
    text(LATIN, 'HELLO'),
    text(ADV, 'SPACED', { charSpacing: 2 }),
    text(AR, 'مرحبا بكم'),
    text(MIX, 'مرحبا PDF'),
    withRotation(new CommentElement(NOTE.x, NOTE.y, 'p1', { width: NOTE.w, height: NOTE.h, text: NOTE_TEXT }) as unknown as PDFElement, deg),
    withRotation(new SignatureElement(CAP.x, CAP.y, 'p1', quadrantPng(10, 5), { width: CAP.w, height: CAP.h, signer: 'Ann' }) as unknown as PDFElement, deg),
  ];
}
// Which box each reference item belongs to, found by where its UNROTATED origin falls.
const TEXT_BOXES = [LATIN, ADV, AR, MIX, NOTE, CAP];

type Item = { str: string; x: number; y: number; dx: number; dy: number };
async function textItems(sourceRot: number, userRot: number, deg: number): Promise<Item[]> {
  const pg = await exportPage(sourceRot, userRot, textElements(deg));
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  const items: Item[] = [];
  for (const ti of tc.items) {
    if (!('str' in ti) || !ti.str.trim()) continue;
    const m = pdfjsLib.Util.transform(vp.transform, ti.transform) as number[];
    const len = Math.hypot(m[0], m[1]);
    items.push({ str: ti.str, x: m[4], y: m[5], dx: m[0] / len, dy: m[1] / len });
  }
  return items;
}

let reference: Item[] | null = null;
async function referenceItems(): Promise<Item[]> {
  reference ??= await textItems(0, 0, 0);
  return reference;
}

describe('text reads along the element\'s own rotation, pivoted about the box centre', () => {
  it('the reference page carries every kind of text line (non-vacuity)', async () => {
    const ref = await referenceItems();
    const joined = ref.map(i => i.str.replace(/ /g, '')).join('|');
    for (const want of ['HELLO', 'SPACED', 'NOTEALPHA', 'Ann', 'PDF']) expect(joined).toContain(want);
    // Both Arabic lines contribute at least one item of their own.
    expect(ref.filter(i => /[؀-ۿ]/.test(i.str)).length).toBeGreaterThanOrEqual(2);
    for (const i of ref) expect(Math.abs(i.dx - 1) + Math.abs(i.dy)).toBeLessThan(1e-3);
  });

  it.each(CASES)('source /Rotate $sourceRot, user $userRot, element $r°', async ({ sourceRot, userRot, r }) => {
    const ref = await referenceItems();
    const got = await textItems(sourceRot, userRot, r);
    expect(got.map(i => i.str)).toEqual(ref.map(i => i.str));
    const t = r * Math.PI / 180;
    const wrong: string[] = [];
    ref.forEach((a, k) => {
      const box = TEXT_BOXES.find(b => a.x >= b.x - 1 && a.x <= b.x + b.w + 1 && a.y >= b.y - 1 && a.y <= b.y + b.h + 1);
      if (!box) { wrong.push(`reference item "${a.str}" is outside every box`); return; }
      const want = turn(a.x, a.y, box, r);
      const g = got[k];
      if (Math.hypot(g.x - want.x, g.y - want.y) > 1) wrong.push(`"${a.str}" origin (${g.x.toFixed(1)},${g.y.toFixed(1)}) want (${want.x.toFixed(1)},${want.y.toFixed(1)})`);
      if (g.dx * Math.cos(t) + g.dy * Math.sin(t) < 0.999) wrong.push(`"${a.str}" reads along (${g.dx.toFixed(2)},${g.dy.toFixed(2)}) want (${Math.cos(t).toFixed(2)},${Math.sin(t).toFixed(2)})`);
    });
    expect(wrong).toEqual([]);
  });
});

// ─── visual record ─────────────────────────────────────────────────────────────
// Not an assertion: the exported page with the editor's (turned) boxes outlined in blue, for the
// before/after record under var/claude/qa-shots/a3pre/. The picture and text cases above are the proof.
describe('visual record', () => {
  it.each([
    { sourceRot: 0, userRot: 0, r: 0 }, { sourceRot: 90, userRot: 0, r: 0 },
    { sourceRot: 90, userRot: 0, r: 30 }, { sourceRot: 0, userRot: 90, r: 90 },
  ])('source $sourceRot, user $userRot, element $r°', async ({ sourceRot, userRot, r }) => {
    const sets = [
      { name: 'pictures', els: pictureElements(r), boxes: [IMG, CODE, SIG] },
      { name: 'text', els: textElements(r), boxes: [LATIN, ADV, AR, MIX, NOTE, CAP] },
    ];
    for (const { name, els, boxes } of sets) {
      const pg = await exportPage(sourceRot, userRot, els);
      const vp = pg.getViewport({ scale: SCALE });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      // Shown at scale 1: the test iframe is only 414px wide, and a screenshot clips at its edge.
      c.style.width = `${c.width / SCALE}px`;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      await pg.render({ canvas: c, viewport: vp }).promise;
      ctx.strokeStyle = '#2255ff'; ctx.lineWidth = 2;
      for (const b of boxes) {
        const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => turn(x, y, b, r));
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x * SCALE, p.y * SCALE) : ctx.moveTo(p.x * SCALE, p.y * SCALE)));
        ctx.closePath(); ctx.stroke();
      }
      document.body.appendChild(c);
      await browserPage.screenshot({ path: `../../var/claude/qa-shots/a3pre/after-${name}-s${sourceRot}-u${userRot}-e${r}.png`, element: c });
      c.remove();
    }
  });
});
