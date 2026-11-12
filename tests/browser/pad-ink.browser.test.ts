/**
 * The phone pad's ink, end to end in REAL Chrome (phone-signature-pad 7b commit B — the oracle of 3C round 1 #1).
 * The PC's ✍ modal (index.html's markup, a real SignaturePad on a 640 px canvas, the real ink boxes) shows its link; the
 * phone pad (a real `mountPadPage`, 320 px wide — so pad ≠ cw ≠ 500) opens on that link's ink; the PHONE changes the ink;
 * its PTSIG frames go through the real collector into the PC's replay; then the PC changes the ink. Each time the
 * stroke's thickness is MEASURED in pixels (the sum of alpha across a straight segment) and its colour read.
 * What jsdom cannot show: the widths are pixels here, not numbers handed to a mock context.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { mountPadPage, type PadPageHandle } from '../../src/pad/padPage';
import { mountSignatureSources, padUrlFor } from '../../src/ui/signatureSources';
import { bindSignatureInkBoxes, inkBoxes } from '../../src/ui/signatureInkBoxes';
import { SignaturePad } from '../../src/utils/signaturePad';
import { encodeSignatureFrames } from '../../src/utils/signatureStrokes';
import type { ScanDeps, ScanHandle } from '../../src/ui/qrScanner';

const pages: PadPageHandle[] = [];
afterEach(() => {
  pages.splice(0).forEach((p) => p.destroy());
  document.body.replaceChildren();
  localStorage.clear();
});

function pc() {
  const modal = new DOMParser().parseFromString(indexHtml, 'text/html').getElementById('signatureModal');
  if (!modal) throw new Error('#signatureModal missing from index.html');
  const host = document.createElement('div');
  host.append(document.importNode(modal, true));
  document.body.append(host);
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  const canvas = $<HTMLCanvasElement>('signatureCanvas');
  canvas.width = 640; // the ✍ modal pad never calls setSize: its logical size is its buffer
  canvas.height = 256;
  canvas.setPointerCapture = () => {}; // synthetic pointers have no active id; the capture is not what is tested here
  const pad = new SignaturePad(canvas);
  const width = $<HTMLInputElement>('sigLineWidth');
  const color = $<HTMLInputElement>('sigColor');
  bindSignatureInkBoxes(pad, width, color);
  let scan: ScanDeps | null = null;
  mountSignatureSources({
    root: $('sigSources'), pad, onModalClosed: () => {}, t: (k) => k, dpr: () => 1,
    padUrl: (ink) => padUrlFor(location.origin, '/pdfturbo/', 'en', ink),
    ink: inkBoxes(width, color, canvas),
    scan: (d): ScanHandle => { scan = d; return { stop: vi.fn(), finished: Promise.resolve() }; },
  });
  const type = (el: HTMLInputElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return {
    pad, canvas, width, color, type,
    url: () => $('sigPadUrl').textContent ?? '',
    openPhonePanel: () => $<HTMLButtonElement>('sigPhoneBtn').click(),
    feed: (frames: string[]) => {
      $<HTMLButtonElement>('sigCamBtn').click();
      if (!scan) throw new Error('the camera did not start');
      for (const f of frames) if (scan.onText(f)) return;
      throw new Error('the frames did not complete a signature');
    },
  };
}

function phone(hash: string) {
  const root = document.createElement('main');
  root.style.cssText = 'width:320px;padding:0';
  document.body.append(root);
  const page = mountPadPage(root, { hash: () => hash, dpr: () => 1, t: (k) => k, setLanguage: () => {} });
  pages.push(page);
  const canvas = root.querySelector('[data-pad="canvas"]') as HTMLCanvasElement;
  canvas.setPointerCapture = () => {}; // synthetic pointers (see pc())
  const r = canvas.getBoundingClientRect();
  const fire = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', buttons: 1, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
  return {
    page, root,
    /** A straight horizontal stroke across the pad's middle. */
    line: () => {
      fire('pointerdown', 30, 64);
      for (let x = 40; x <= 290; x += 10) fire('pointermove', x, 64);
      fire('pointerup', 290, 64);
    },
    swatch: (hex: string) => (root.querySelector(`[data-pad="swatches"] button[title="${hex}"]`) as HTMLButtonElement).click(),
    up: () => (root.querySelector('[data-pad="widthUp"]') as HTMLButtonElement).click(),
  };
}

/** Thickness (the sum of alpha / 255 down the column) and the RGB of the most opaque pixel, at x = width / 2. */
function measure(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const x = Math.floor(canvas.width / 2);
  const col = ctx.getImageData(x, 0, 1, canvas.height).data;
  let sum = 0;
  let best = -1;
  for (let y = 0; y < canvas.height; y++) {
    sum += col[y * 4 + 3] / 255;
    if (best < 0 || col[y * 4 + 3] > col[best * 4 + 3]) best = y;
  }
  return { thickness: sum, rgb: [col[best * 4], col[best * 4 + 1], col[best * 4 + 2]] };
}

describe('the ink from PC to phone and back (7b oracle)', () => {
  it('PC red/4 → the pad opens on red/4 → the phone picks green/6 → the scan replays at 6 px green, boxes green/6 → the PC picks blue/2', () => {
    const p = pc();
    p.type(p.color, '#ff0000');
    p.type(p.width, '4');
    p.openPhonePanel();
    const link = p.url();
    expect(link).toBe(`${location.origin}/pdfturbo/pad.html#lang=en&c=ff0000&w=4&cw=640`);

    const f = phone(new URL(link).hash);
    expect(f.page.pad.canvas.clientWidth).toBe(320); // precondition: pad ≠ cw ≠ 500
    expect([f.page.pad.color, f.page.pad.lineWidth]).toEqual(['#ff0000', 2]); // 4 PC px = 2 px on a pad half as wide
    f.line();
    f.swatch('#00cc00');
    f.up();
    f.up();
    expect([f.page.pad.color, f.page.pad.lineWidth]).toEqual(['#00cc00', 3]);
    const onPhone = measure(f.page.pad.canvas); // the phone repainted its stroke in the new ink
    expect(onPhone.thickness).toBeCloseTo(3, 0);
    expect(onPhone.rgb).toEqual([0, 204, 0]);

    p.feed(encodeSignatureFrames(f.page.pad.toSignatureInput()).frames); // what Done shows, read by the PC camera
    const replayed = measure(p.canvas);
    expect(Math.abs(replayed.thickness - 6)).toBeLessThan(0.5);
    expect(replayed.rgb).toEqual([0, 204, 0]);
    expect([p.color.value, p.width.value]).toEqual(['#00cc00', '6']);

    p.type(p.color, '#0000ff');
    p.type(p.width, '2');
    const repainted = measure(p.canvas);
    expect(Math.abs(repainted.thickness - 2)).toBeLessThan(0.5);
    expect(repainted.rgb).toEqual([0, 0, 255]);
  });

  it('a replayed width the box cannot show (3.4 PC px): the box reads 3, the stroke stays 3.4 until the user changes it', () => {
    const p = pc();
    p.openPhonePanel();
    const f = phone('#lang=en&c=000000&w=2&cw=640');
    f.page.pad.setLineWidth(1.7); // an old or foreign pad: 1.7 px on a 320 px pad = 3.4 PC px
    f.line();
    p.feed(encodeSignatureFrames(f.page.pad.toSignatureInput()).frames);
    expect(p.width.value).toBe('3');
    expect(Math.abs(measure(p.canvas).thickness - 3.4)).toBeLessThan(0.3);
    expect(p.pad.lineWidth).not.toBe(3);
  });

  it('after a scan, Clear → draw: the new stroke is in the BOXES\' ink, not the scan\'s (a wide QR width does not outlive it)', () => {
    const p = pc();
    p.openPhonePanel();
    const f = phone('#lang=en&c=000000&w=10&cw=200'); // 10 px on a 200 px PC canvas: 32 px on this 640 px one
    f.line();
    p.feed(encodeSignatureFrames(f.page.pad.toSignatureInput()).frames);
    expect(measure(p.canvas).thickness).toBeGreaterThan(25);
    expect(p.width.value).toBe('10'); // the most the box can show
    p.pad.clear(); // the modal's Clear: following ends, the pad takes the boxes' ink
    const r = p.canvas.getBoundingClientRect();
    const fire = (type: string, x: number) =>
      p.canvas.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'mouse', buttons: 1, clientX: r.left + x, clientY: r.top + 128, bubbles: true }));
    fire('pointerdown', 100);
    for (let x = 110; x <= 540; x += 10) fire('pointermove', x);
    fire('pointerup', 540);
    expect(Math.abs(measure(p.canvas).thickness - 10)).toBeLessThan(0.5);
  });
});
