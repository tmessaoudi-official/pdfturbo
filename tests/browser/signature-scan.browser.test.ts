import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { mountSignatureSources } from '../../src/ui/signatureSources';
import { startScan, type ScanDeps } from '../../src/ui/qrScanner';
import { drawQr } from '../../src/utils/qrCanvas';
import { SignaturePad } from '../../src/utils/signaturePad';
import { base45Encode, crc32, encodeSignatureBody, encodeSignatureFrames, type SignatureInput } from '../../src/utils/signatureStrokes';

/**
 * Phone-signature-pad step 5b, in real Chrome: Start camera → a FAKE camera (a canvas showing the phone's QR codes,
 * repainted every frame — a static canvas may emit no frames — through `canvas.captureStream`) → the REAL scanner loop
 * (video element, frame grab, zxing-wasm with its self-hosted wasm) → the real collector → `SignaturePad.replay` on a
 * real pad. Only `getUserMedia` is replaced. Every way out must leave every camera track `ended`.
 */

const SIG: SignatureInput = {
  width: 500, height: 200, color: '#000080', lineWidth: 3,
  strokes: [[{ x: 30, y: 150 }, { x: 120, y: 40 }, { x: 220, y: 160 }, { x: 330, y: 50 }, { x: 460, y: 140 }]],
};
const ONE = encodeSignatureFrames(SIG).frames;
const body = encodeSignatureBody(SIG, 1);
const TWO = [0, 1].map((i) => {
  const per = Math.ceil(body.length / 2);
  const slice = body.subarray(i * per, (i + 1) * per);
  const crc = crc32(body);
  const bytes = new Uint8Array(8 + slice.length);
  bytes.set([0x50, 0x54, 1, (i << 4) | 2, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
  bytes.set(slice, 8);
  return base45Encode(bytes);
});

/** A camera filming a phone screen that shows `codes`, switching code every `cycleMs` (the pad's multi-QR cycle). */
function fakeCamera(codes: string[], cycleMs = 400) {
  const cam = document.createElement('canvas');
  cam.width = 640;
  cam.height = 480;
  const ctx = cam.getContext('2d') as CanvasRenderingContext2D;
  const qrs = codes.map((c) => {
    const q = document.createElement('canvas');
    drawQr(q, c, 360, 1);
    return q;
  });
  let raf = 0;
  const t0 = performance.now();
  const paint = () => {
    const q = qrs[Math.floor((performance.now() - t0) / cycleMs) % qrs.length];
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cam.width, cam.height);
    ctx.drawImage(q, (cam.width - q.width) / 2, (cam.height - q.height) / 2);
    raf = requestAnimationFrame(paint);
  };
  paint();
  const stream = cam.captureStream(30);
  return { stream, tracks: stream.getTracks(), dispose: () => cancelAnimationFrame(raf) };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  document.body.replaceChildren();
});

function mount(camera: ReturnType<typeof fakeCamera>) {
  cleanups.push(camera.dispose);
  const markup = new DOMParser().parseFromString(indexHtml, 'text/html').getElementById('sigSources');
  if (!markup) throw new Error('#sigSources missing from index.html');
  document.body.replaceChildren(document.importNode(markup, true));
  const padCanvas = document.createElement('canvas');
  padCanvas.width = 500;
  padCanvas.height = 200;
  document.body.append(padCanvas);
  const pad = new SignaturePad(padCanvas);
  let closeModal: () => void = () => {};
  const finished: Array<Promise<void>> = [];
  const loadImage = vi.fn(() => new Promise<HTMLCanvasElement>(() => {})); // never lands: only its START matters
  mountSignatureSources({
    root: document.getElementById('sigSources') as HTMLElement,
    pad,
    onModalClosed: (fn) => { closeModal = fn; },
    padUrl: () => 'https://example.org/pdfturbo/pad.html#lang=en',
    loadImage,
    t: (k) => k,
    dpr: () => 1,
    scan: (d: ScanDeps) => {
      const h = startScan({ ...d, getUserMedia: () => Promise.resolve(camera.stream) });
      finished.push(h.finished);
      return h;
    },
  });
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  return {
    pad, padCanvas, finished, close: () => closeModal(),
    phoneBtn: $<HTMLButtonElement>('sigPhoneBtn'), camBtn: $<HTMLButtonElement>('sigCamBtn'),
    video: $<HTMLVideoElement>('sigCamVideo'), status: $('sigScanStatus'), input: $<HTMLInputElement>('sigImageInput'),
  };
}

const inkPixels = (c: HTMLCanvasElement) => {
  const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
};
const allEnded = (tracks: MediaStreamTrack[]) => tracks.every((t) => t.readyState === 'ended');
const playing = (v: HTMLVideoElement) => vi.waitFor(() => { expect(v.readyState).toBeGreaterThanOrEqual(2); }, { timeout: 5000 });

describe('Start camera → scan → the pad (real zxing, fake camera)', () => {
  it('a one-QR signature is replayed on the pad; the camera is released', async () => {
    const cam = fakeCamera(ONE);
    const m = mount(cam);
    m.phoneBtn.click();
    m.camBtn.click();
    await vi.waitFor(() => { expect(m.status.textContent).toBe('modal.signature.scanDone'); }, { timeout: 15000 });
    await Promise.all(m.finished);
    expect(inkPixels(m.padCanvas)).toBeGreaterThan(500);
    expect(allEnded(cam.tracks)).toBe(true);
    expect(m.video.srcObject).toBeNull();
    expect(m.video.hidden).toBe(true);
  });

  it('a two-QR signature cycling on the phone is collected and replayed', async () => {
    const cam = fakeCamera(TWO);
    const m = mount(cam);
    m.phoneBtn.click();
    m.camBtn.click();
    await vi.waitFor(() => { expect(m.status.textContent).toBe('modal.signature.scanDone'); }, { timeout: 20000 });
    await Promise.all(m.finished);
    expect(inkPixels(m.padCanvas)).toBeGreaterThan(500);
    expect(allEnded(cam.tracks)).toBe(true);
  });

  // 7b (ruling 2026-11-12 09:56, REVERSING the step-5b pin "the inputs change nothing on a replayed pad"): PTSIG
  // carries one ink, so while the pad shows a scan an ink change repaints the scan — the pixels turn red, and widen.
  it('an ink change repaints a replayed pad: the scan turns red and wider (one ink per signature, 7b)', async () => {
    const cam = fakeCamera(ONE);
    const m = mount(cam);
    m.phoneBtn.click();
    m.camBtn.click();
    await vi.waitFor(() => { expect(m.status.textContent).toBe('modal.signature.scanDone'); }, { timeout: 15000 });
    const ctx = m.padCanvas.getContext('2d') as CanvasRenderingContext2D;
    const inked = (d: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; };
    const before = ctx.getImageData(0, 0, 500, 200).data.slice();
    m.pad.setLineWidth(9);
    m.pad.setColor('#ff0000');
    const after = ctx.getImageData(0, 0, 500, 200).data;
    expect(inked(after)).toBeGreaterThan(inked(before) * 1.5);
    let red = false;
    for (let i = 0; i < after.length && !red; i += 4) red = after[i + 3] === 255 && after[i] === 255 && after[i + 1] === 0 && after[i + 2] === 0;
    expect(red).toBe(true);
  });
});

describe('every way out releases the camera (real tracks)', () => {
  // A camera that shows NO code, so the scan runs until something stops it.
  const blank = () => fakeCamera(['NOT A PTSIG FRAME']);

  async function runningThen(stop: (m: ReturnType<typeof mount>) => void) {
    const cam = blank();
    const m = mount(cam);
    m.phoneBtn.click();
    m.camBtn.click();
    await playing(m.video);
    expect(cam.tracks.every((t) => t.readyState === 'live')).toBe(true);
    stop(m);
    await Promise.all(m.finished);
    expect(allEnded(cam.tracks)).toBe(true);
    expect(m.video.srcObject).toBeNull();
    expect(m.video.hidden).toBe(true);
  }

  it('Stop', () => runningThen((m) => m.camBtn.click()));
  it('a modal close (Cancel, Escape, Save)', () => runningThen((m) => m.close()));
  it('the panel collapsed', () => runningThen((m) => m.phoneBtn.click()));
  it('an import starting', () => runningThen((m) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    m.input.files = dt.files;
    m.input.dispatchEvent(new Event('change'));
  }));
  it('the tab hidden', () => runningThen(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    cleanups.push(() => { delete (document as unknown as { hidden?: boolean }).hidden; });
    document.dispatchEvent(new Event('visibilitychange'));
  }));
  it('a foreign code is shown and scanning goes on', async () => {
    const cam = fakeCamera(['HELLO WORLD']);
    const m = mount(cam);
    m.phoneBtn.click();
    m.camBtn.click();
    await vi.waitFor(() => { expect(m.status.textContent).toBe('modal.signature.scanForeign'); }, { timeout: 15000 });
    expect(cam.tracks.every((t) => t.readyState === 'live')).toBe(true);
    m.camBtn.click();
    await Promise.all(m.finished);
    expect(allEnded(cam.tracks)).toBe(true);
  });
});
