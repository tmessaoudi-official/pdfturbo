// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/utils/qrCanvas', () => ({ drawQr: vi.fn(() => ({ modules: 33, modulePx: 4 })) }));

import { drawQr } from '../../src/utils/qrCanvas';
import { mountSignatureSources, padUrlFor } from '../../src/ui/signatureSources';
import { SignatureImageError } from '../../src/utils/signatureImage';
import type { ScanDeps, ScanEnd, ScanHandle } from '../../src/ui/qrScanner';
import { base45Encode, crc32, decodeSignatureFrames, encodeSignatureBody, encodeSignatureFrames, type DecodedSignature, type SignatureInput } from '../../src/utils/signatureStrokes';
import type { PadInk } from '../../src/utils/signatureInk';

/**
 * The two signature sources in the ✍ modal (phone-signature-pad plan step 5a; rulings 2026-11-10 23:46: two buttons,
 * the phone flow in one panel; the import removes the paper). Mounted on the REAL `#sigSources` markup of index.html,
 * so the module and the markup cannot drift apart. The image pixels are pinned in Chrome
 * (tests/browser/signature-import.browser.test.ts).
 */

const INDEX = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

function mount(over: Partial<Parameters<typeof mountSignatureSources>[0]> = {}) {
  const doc = new DOMParser().parseFromString(INDEX, 'text/html');
  const markup = doc.getElementById('sigSources');
  if (!markup) throw new Error('#sigSources missing from index.html');
  document.body.innerHTML = '';
  document.body.append(document.importNode(markup, true));
  const root = document.getElementById('sigSources') as HTMLElement;
  let closed: (() => void) | null = null;
  // A replay takes the decoded ink, as the real SignaturePad does since 7b (the box sync reads it back).
  const pad = {
    color: '#000000', lineWidth: 2, drawImage: vi.fn(),
    replay: vi.fn((sig: DecodedSignature) => { pad.color = sig.color; pad.lineWidth = sig.lineWidth * 1.25; }),
  };
  const loadImage = vi.fn(() => Promise.resolve(document.createElement('canvas')));
  const scans: FakeScan[] = [];
  const scan = vi.fn((d: ScanDeps): ScanHandle => {
    const s: FakeScan = {
      deps: d,
      ended: false,
      stop: vi.fn<() => void>(() => s.end({ reason: 'stopped' })),
      end: (e) => { if (!s.ended) { s.ended = true; d.onEnd(e); } },
    };
    scans.push(s);
    return { stop: s.stop, finished: Promise.resolve() };
  });
  const deps = {
    root,
    pad,
    onModalClosed: (fn: () => void) => { closed = fn; },
    padUrl: () => 'https://example.github.io/pdfturbo/pad.html#lang=fr',
    loadImage,
    scan,
    t: (k: string, p?: Record<string, string | number>) => (p ? `T(${k}|${JSON.stringify(p)})` : `T(${k})`),
    dpr: () => 2,
    ...over,
  };
  const handle = mountSignatureSources(deps);
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  return {
    handle, pad, loadImage, scan, scans, close: () => closed?.(),
    phoneBtn: $<HTMLButtonElement>('sigPhoneBtn'), panel: $('sigPhonePanel'), qr: $<HTMLCanvasElement>('sigPadQr'),
    url: $('sigPadUrl'), importBtn: $<HTMLButtonElement>('sigImportBtn'), input: $<HTMLInputElement>('sigImageInput'),
    msg: $('sigSourceMsg'), camBtn: $<HTMLButtonElement>('sigCamBtn'), video: $<HTMLVideoElement>('sigCamVideo'),
    status: $('sigScanStatus'),
  };
}

interface FakeScan { deps: ScanDeps; ended: boolean; stop: Mock<() => void>; end(e: ScanEnd): void }

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(drawQr).mockClear();
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled(); // an expected failure is shown, never logged (the QA sweep fails on it)
  consoleError.mockRestore();
});

describe('the markup in index.html', () => {
  it('has the two buttons, the closed phone panel and a hidden message, all named', () => {
    const { phoneBtn, panel, importBtn, input, msg, qr } = mount();
    expect(phoneBtn.getAttribute('aria-expanded')).toBe('false');
    expect(phoneBtn.getAttribute('aria-controls')).toBe('sigPhonePanel');
    expect(panel.hidden).toBe(true);
    expect(msg.hidden).toBe(true);
    expect(msg.getAttribute('role')).toBe('alert');
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/png,image/jpeg,image/webp');
    expect(qr.getAttribute('role')).toBe('img');
    expect(qr.dataset.i18nAria).toBe('modal.signature.padQrLabel');
    expect(phoneBtn.querySelector('[data-i18n="modal.signature.phone"]')).not.toBeNull();
    expect(importBtn.querySelector('[data-i18n="modal.signature.importImage"]')).not.toBeNull();
  });
});

describe('Sign on phone', () => {
  it('opens the panel with the pad-URL QR (byte mode) and the URL as text, and closes it on a second press', () => {
    const { phoneBtn, panel, qr, url } = mount();
    phoneBtn.click();
    expect(panel.hidden).toBe(false);
    expect(phoneBtn.getAttribute('aria-expanded')).toBe('true');
    expect(drawQr).toHaveBeenCalledWith(qr, 'https://example.github.io/pdfturbo/pad.html#lang=fr', expect.any(Number), 2, 'Byte');
    expect(url.textContent).toBe('https://example.github.io/pdfturbo/pad.html#lang=fr');
    phoneBtn.click();
    expect(panel.hidden).toBe(true);
    expect(phoneBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('reads the URL at each open (the language may have changed)', () => {
    let lang = 'en';
    const { phoneBtn } = mount({ padUrl: () => `https://h/pdfturbo/pad.html#lang=${lang}` });
    phoneBtn.click();
    phoneBtn.click();
    lang = 'ar';
    phoneBtn.click();
    expect(vi.mocked(drawQr).mock.calls.map((c) => c[1])).toEqual(['https://h/pdfturbo/pad.html#lang=en', 'https://h/pdfturbo/pad.html#lang=ar']);
  });

  it('a modal close shuts the panel', () => {
    const { phoneBtn, panel, close } = mount();
    phoneBtn.click();
    close();
    expect(panel.hidden).toBe(true);
    expect(phoneBtn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Import image', () => {
  it('the button opens the file chooser', () => {
    const { importBtn, input } = mount();
    const click = vi.spyOn(input, 'click');
    importBtn.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  // The input holding NO file afterwards (so the same file can be picked again) is pinned in Chrome, with a real
  // FileList: tests/browser/signature-sources.browser.test.ts. Here `input.value` reads '' whatever the code does.
  it('a chosen file is loaded and drawn on the pad', async () => {
    const { input, pad, loadImage, msg } = mount();
    const file = new File([new Uint8Array([1])], 's.png', { type: 'image/png' });
    pick(input, file);
    await flush();
    expect(loadImage).toHaveBeenCalledWith(file);
    expect(pad.drawImage).toHaveBeenCalledWith(await loadImage.mock.results[0].value);
    expect(msg.hidden).toBe(true);
  });

  it.each(['en', 'fr', 'ar'])('every refusal code has its message in %s (a missing one would show the raw key)', (lang) => {
    const loc = JSON.parse(readFileSync(resolve(__dirname, `../../locales/${lang}.json`), 'utf8'));
    const keys = Object.keys(loc.modal.signature.importError).sort();
    expect(keys).toEqual(['bytes', 'decode', 'empty', 'flattened', 'pixels', 'type']);
  });

  it.each(['type', 'bytes', 'pixels', 'decode', 'empty', 'flattened'] as const)('a refused image (%s) is SHOWN, the pad untouched, nothing logged', async (code) => {
    const { input, pad, msg } = mount({ loadImage: vi.fn(() => Promise.reject(new SignatureImageError(code, 'x'))) });
    pick(input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    await flush();
    expect(pad.drawImage).not.toHaveBeenCalled();
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toBe(`T(modal.signature.importError.${code})`);
  });

  it('the next successful import hides the message; a modal close hides it too', async () => {
    let fail = true;
    const { input, msg, close } = mount({
      loadImage: vi.fn(() => (fail ? Promise.reject(new SignatureImageError('decode', 'x')) : Promise.resolve(document.createElement('canvas')))),
    });
    const f = new File([new Uint8Array([1])], 's.png', { type: 'image/png' });
    pick(input, f);
    await flush();
    expect(msg.hidden).toBe(false);
    fail = false;
    pick(input, f);
    await flush();
    expect(msg.hidden).toBe(true);
    fail = true;
    pick(input, f);
    await flush();
    close();
    expect(msg.hidden).toBe(true);
  });

  it('a second import supersedes the first one still loading: only the latest is drawn', async () => {
    const finishers: Array<(c: HTMLCanvasElement) => void> = [];
    const { input, pad } = mount({ loadImage: vi.fn(() => new Promise<HTMLCanvasElement>((r) => { finishers.push(r); })) });
    pick(input, new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    pick(input, new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }));
    const second = document.createElement('canvas');
    finishers[1](second);
    await flush();
    finishers[0](document.createElement('canvas'));
    await flush();
    expect(pad.drawImage).toHaveBeenCalledTimes(1);
    expect(pad.drawImage).toHaveBeenCalledWith(second);
  });

  it('an import that lands after the modal closed is not drawn', async () => {
    let finish: (c: HTMLCanvasElement) => void = () => {};
    const { input, pad, close } = mount({ loadImage: vi.fn(() => new Promise<HTMLCanvasElement>((r) => { finish = r; })) });
    pick(input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    close();
    finish(document.createElement('canvas'));
    await flush();
    expect(pad.drawImage).not.toHaveBeenCalled();
  });

  it('a bug in the loader (not a refused image) is NOT swallowed: the import rejects with it, nothing is shown', async () => {
    const boom = new TypeError('bug');
    const { handle, input, msg, pad } = mount({ loadImage: vi.fn(() => Promise.reject(boom)) });
    pick(input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    await expect(handle.whenIdle()).rejects.toBe(boom); // in the app nobody catches it: the global error boundary does
    expect(msg.hidden).toBe(true);
    expect(pad.drawImage).not.toHaveBeenCalled();
  });
});

// ---- step 5b: Start camera (rulings 2026-11-11: the preview takes the QR's box; no auto-save) ----------------------

const SIG: SignatureInput = { width: 500, height: 200, color: '#000080', lineWidth: 2, strokes: [[{ x: 20, y: 30 }, { x: 300, y: 150 }]] };
const ONE = encodeSignatureFrames(SIG).frames;
const body = encodeSignatureBody(SIG, 1);
/** The same signature split into two frames (the encoder would use one: the collector must not care). */
const TWO = [0, 1].map((i) => {
  const per = Math.ceil(body.length / 2);
  const slice = body.subarray(i * per, (i + 1) * per);
  const crc = crc32(body);
  const bytes = new Uint8Array(8 + slice.length);
  bytes.set([0x50, 0x54, 1, (i << 4) | 2, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
  bytes.set(slice, 8);
  return base45Encode(bytes);
});

function started(over: Partial<Parameters<typeof mountSignatureSources>[0]> = {}) {
  const m = mount(over);
  m.phoneBtn.click();
  m.camBtn.click();
  return { ...m, s: m.scans[m.scans.length - 1] };
}

describe('Start camera — the markup', () => {
  it('a toggle button, a muted inline video with a name, and a POLITE status line apart from the alert', () => {
    const { camBtn, video, status, msg, panel } = mount();
    expect(panel.contains(camBtn)).toBe(true);
    expect(camBtn.querySelector('[data-i18n="modal.signature.startCamera"]')).not.toBeNull();
    expect(camBtn.hasAttribute('aria-pressed')).toBe(false); // the label changes, so no pressed state on top
    expect(video.hidden).toBe(true);
    expect(video.muted || video.hasAttribute('muted')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.dataset.i18nAria).toBe('modal.signature.cameraPreview');
    expect(status.getAttribute('role')).toBe('status');
    expect(status).not.toBe(msg);
  });
});

describe('Start camera — scanning', () => {
  it('starts the scanner on the video; the preview takes the QR box; the button becomes Stop', () => {
    const { scan, video, qr, camBtn, status } = started();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0][0].video).toBe(video);
    expect(video.hidden).toBe(false);
    expect(qr.hidden).toBe(true);
    expect(camBtn.textContent).toContain('T(modal.signature.stopCamera)');
    expect(status.textContent).toBe('T(modal.signature.scanLooking)');
  });

  it('a one-frame signature is replayed on the pad and the scan ends; no auto-save', () => {
    const { s, pad, status } = started();
    expect(s.deps.onText(ONE[0])).toBe(true);
    expect(pad.replay).toHaveBeenCalledWith(decodeSignatureFrames(ONE));
    expect(status.textContent).toBe('T(modal.signature.scanDone)');
  });

  it('after the end: the QR is back, the video hidden, the button Start again; the done status stays', () => {
    const { s, qr, video, camBtn, status } = started();
    s.deps.onText(ONE[0]);
    s.end({ reason: 'done' });
    expect(qr.hidden).toBe(false);
    expect(video.hidden).toBe(true);
    expect(camBtn.textContent).toContain('T(modal.signature.startCamera)');
    expect(status.textContent).toBe('T(modal.signature.scanDone)');
  });

  it('a multi-frame signature shows "part 1 of 2", then decodes', () => {
    const { s, pad, status } = started();
    expect(s.deps.onText(TWO[1])).toBe(false);
    expect(status.textContent).toBe('T(modal.signature.scanPart|{"have":1,"total":2})');
    expect(s.deps.onText(TWO[0])).toBe(true);
    expect(pad.replay).toHaveBeenCalledWith(decodeSignatureFrames(TWO));
  });

  it.each([
    ['https://example.org/', 'scanForeign'],
    [base45Encode(new Uint8Array([0x50, 0x54, 2, 1, 0, 0, 0, 0, 9])), 'scanRefresh'],
  ])('a code that is not a usable signature (%s) is shown in the status, and scanning goes on', (text, key) => {
    const { s, pad, status } = started();
    expect(s.deps.onText(text)).toBe(false);
    expect(status.textContent).toBe(`T(modal.signature.${key})`);
    expect(pad.replay).not.toHaveBeenCalled();
  });

  it.each(['denied', 'noCamera', 'failed'] as const)('a failure (%s) is shown in the alert; the UI goes back to Start camera', (error) => {
    const { s, msg, status, camBtn, qr } = started();
    s.end({ reason: 'error', error });
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toBe(`T(modal.signature.scanError.${error})`);
    expect(status.textContent).toBe('');
    expect(camBtn.textContent).toContain('T(modal.signature.startCamera)');
    expect(qr.hidden).toBe(false);
  });

  it('Start again after a stop forgets the frames read before', () => {
    const m = started();
    m.s.deps.onText(TWO[0]);
    m.camBtn.click(); // Stop
    m.camBtn.click(); // Start
    const again = m.scans[1];
    expect(again.deps.onText(TWO[1])).toBe(false);
    expect(m.pad.replay).not.toHaveBeenCalled();
  });

  it('a scan that ends INSIDE startScan (no camera API: http on the LAN) leaves Start camera working', () => {
    const scan = vi.fn((d: ScanDeps): ScanHandle => {
      d.onEnd({ reason: 'error', error: 'noCamera' }); // synchronously, before the handle is returned
      return { stop: vi.fn(), finished: Promise.resolve() };
    });
    const m = mount({ scan });
    m.phoneBtn.click();
    m.camBtn.click();
    expect(m.msg.textContent).toBe('T(modal.signature.scanError.noCamera)');
    expect(m.camBtn.textContent).toContain('T(modal.signature.startCamera)');
    m.camBtn.click();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('reading the same code again does not rewrite the status line (a live region re-announces a rewrite)', async () => {
    const { s, status } = started();
    s.deps.onText(TWO[0]);
    const writes: MutationRecord[] = [];
    const mo = new MutationObserver((r) => writes.push(...r));
    mo.observe(status, { childList: true, characterData: true, subtree: true });
    s.deps.onText(TWO[0]);
    s.deps.onText(TWO[0]);
    await flush();
    mo.disconnect();
    expect(writes).toHaveLength(0);
    expect(status.textContent).toBe('T(modal.signature.scanPart|{"have":1,"total":2})');
  });

  it('Start clears a previous failure message', () => {
    const m = started();
    m.s.end({ reason: 'error', error: 'denied' });
    m.camBtn.click();
    expect(m.msg.hidden).toBe(true);
  });
});

describe('Start camera — every way out stops the camera', () => {
  it('the Stop button', () => {
    const { s, camBtn, status } = started();
    camBtn.click();
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('');
    expect(camBtn.textContent).toContain('T(modal.signature.startCamera)');
  });

  it('a modal close (Cancel, Escape, Save)', () => {
    const { s, close, status } = started();
    close();
    expect(s.stop).toHaveBeenCalled();
    expect(status.textContent).toBe('');
  });

  it('the panel collapsed by Sign on phone', () => {
    const { s, phoneBtn } = started();
    phoneBtn.click();
    expect(s.stop).toHaveBeenCalled();
  });

  it('an import starting', () => {
    const { s, input } = started();
    pick(input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    expect(s.stop).toHaveBeenCalled();
  });

  it('an import still loading when a scan lands is NOT drawn over the scan', async () => {
    let finish: (c: HTMLCanvasElement) => void = () => {};
    const m = mount({ loadImage: vi.fn(() => new Promise<HTMLCanvasElement>((r) => { finish = r; })) });
    pick(m.input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    m.phoneBtn.click();
    m.camBtn.click();
    m.scans[0].deps.onText(ONE[0]);
    finish(document.createElement('canvas'));
    await flush();
    expect(m.pad.replay).toHaveBeenCalledTimes(1);
    expect(m.pad.drawImage).not.toHaveBeenCalled();
  });
});

// Step-7 walkthrough W13 (2026-11-11, F1): after a completed scan, an import left "Signature scanned. Check it, then
// press Save." on screen over the imported image; the Clear button left it over an EMPTY pad (found while planning 7b).
// The status line describes the pad, so anything that replaces or empties the pad clears it — and only that: a REFUSED
// import leaves the scan on the pad, so it leaves its status too (panel round 4 C4, ruling 2026-11-12 19:57, which
// REVERSES the 10:33 plan's "a refused import after a scan also clears it").
describe('after a scan, the status does not outlive the pad it describes (F1)', () => {
  function scanned(over: Partial<Parameters<typeof mountSignatureSources>[0]> = {}) {
    let cleared: (() => void) | null = null;
    const m = started({ onPadCleared: (fn: () => void) => { cleared = fn; }, ...over });
    expect(m.s.deps.onText(ONE[0])).toBe(true);
    m.s.end({ reason: 'done' });
    expect(m.status.textContent).toBe('T(modal.signature.scanDone)'); // precondition: the stale text is on screen
    return { ...m, clearPad: () => cleared?.() };
  }

  it('a successful import clears it once the image is drawn — not while it is still loading', async () => {
    const m = scanned();
    pick(m.input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    expect(m.status.textContent).toBe('T(modal.signature.scanDone)'); // the pad still holds the scan
    await m.handle.whenIdle();
    expect(m.pad.drawImage).toHaveBeenCalledTimes(1);
    expect(m.status.textContent).toBe('');
  });

  it('a REFUSED import leaves it — the pad still holds the scan — and shows the refusal', async () => {
    const m = scanned({ loadImage: vi.fn(() => Promise.reject(new SignatureImageError('flattened', 'flattened'))) });
    pick(m.input, new File([new Uint8Array([1])], 's.jpg', { type: 'image/jpeg' }));
    await m.handle.whenIdle();
    expect(m.pad.drawImage).not.toHaveBeenCalled();
    expect(m.status.textContent).toBe('T(modal.signature.scanDone)');
    expect(m.msg.hidden).toBe(false);
  });

  it('an import that loads after a NEWER scan landed is dropped, and the newer scan keeps its status (control)', async () => {
    let finish: (c: HTMLCanvasElement) => void = () => {};
    const m = scanned({ loadImage: vi.fn(() => new Promise<HTMLCanvasElement>((r) => { finish = r; })) });
    pick(m.input, new File([new Uint8Array([1])], 's.png', { type: 'image/png' }));
    m.camBtn.click();
    m.scans[1].deps.onText(ONE[0]);
    finish(document.createElement('canvas'));
    await m.handle.whenIdle();
    expect(m.pad.drawImage).not.toHaveBeenCalled();
    expect(m.status.textContent).toBe('T(modal.signature.scanDone)');
  });

  it('the modal Clear button clears it', () => {
    const m = scanned();
    m.clearPad();
    expect(m.status.textContent).toBe('');
  });

  it('Clear with nothing scanned leaves a running scan\'s progress alone (control: only a pad change clears)', () => {
    let cleared: (() => void) | null = null;
    const m = started({ onPadCleared: (fn: () => void) => { cleared = fn; } });
    m.s.deps.onText(TWO[0]);
    (cleared as (() => void) | null)?.();
    expect(m.status.textContent).toBe('T(modal.signature.scanPart|{"have":1,"total":2})');
  });
});

describe('padUrlFor', () => {
  it('builds the pad URL under the base path, the language in the FRAGMENT (a precached or cached pad still matches)', () => {
    expect(padUrlFor('https://example.github.io', '/pdfturbo/', 'fr')).toBe('https://example.github.io/pdfturbo/pad.html#lang=fr');
    expect(padUrlFor('http://localhost:5173', '/pdfturbo/', 'ar')).toBe('http://localhost:5173/pdfturbo/pad.html#lang=ar');
  });
  it('with an ink, the ink follows the language in the fragment (7b)', () => {
    expect(padUrlFor('https://example.github.io', '/pdfturbo/', 'en', { color: '#1d4ed8', width: 2, cw: 500 }))
      .toBe('https://example.github.io/pdfturbo/pad.html#lang=en&c=1d4ed8&w=2&cw=500');
  });
});

// 7b commit B (F2, rulings 2026-11-12 09:56): the phone pad opens on the PC's ink, and after a scan the PC's boxes follow
// the scanned ink. The boxes are injected (`ink`), so this module still queries nothing outside #sigSources.
describe('the ink — the link carries the boxes, a scan writes them back', () => {
  function inked(start: PadInk = { color: '#ff0000', width: 4, cw: 640 }) {
    let box = { ...start };
    let changed: (() => void) | null = null;
    const ink = {
      get: vi.fn(() => ({ ...box })),
      set: vi.fn((v: { color: string; width: number }) => { box = { ...box, color: v.color, width: Math.round(v.width) }; }),
      onChange: (fn: () => void) => { changed = fn; },
    };
    const m = mount({ ink, padUrl: (i?: PadInk) => padUrlFor('https://h', '/p/', 'en', i) });
    return { ...m, ink, change: (v: Partial<PadInk>) => { box = { ...box, ...v }; changed?.(); } };
  }
  const lastUrl = () => vi.mocked(drawQr).mock.calls.at(-1)?.[1];

  it('the QR and the URL text carry the boxes\' ink, read at each open', () => {
    const m = inked();
    m.phoneBtn.click();
    expect(lastUrl()).toBe('https://h/p/pad.html#lang=en&c=ff0000&w=4&cw=640');
    expect(m.url.textContent).toBe('https://h/p/pad.html#lang=en&c=ff0000&w=4&cw=640');
  });

  it('a box change re-draws the QR and the URL while the panel is open; closed, it draws nothing', () => {
    const m = inked();
    m.change({ color: '#0000ff' });
    expect(drawQr).not.toHaveBeenCalled();
    m.phoneBtn.click();
    m.change({ width: 7 });
    expect(lastUrl()).toBe('https://h/p/pad.html#lang=en&c=0000ff&w=7&cw=640');
    expect(m.url.textContent).toBe(lastUrl());
  });

  it('a scan accepted: the boxes take the REPLAYED ink (after the replay), and the QR is re-drawn from them', () => {
    const m = inked();
    m.phoneBtn.click();
    m.camBtn.click();
    const s = m.scans[0];
    expect(s.deps.onText(ONE[0])).toBe(true);
    expect(m.pad.replay).toHaveBeenCalledTimes(1);
    expect(m.ink.set).toHaveBeenCalledTimes(1);
    expect(m.pad.lineWidth).not.toBe(2); // precondition: the replay changed the pad's ink
    expect(m.ink.set.mock.calls[0][0]).toEqual({ color: '#000080', width: m.pad.lineWidth }); // the pad's ink after the replay
    expect(m.ink.set.mock.invocationCallOrder[0]).toBeGreaterThan(m.pad.replay.mock.invocationCallOrder[0]);
    s.end({ reason: 'done' });
    expect(lastUrl()).toBe(`https://h/p/pad.html#lang=en&c=000080&w=${Math.round(m.pad.lineWidth)}&cw=640`); // a programmatic .value fires no event: drawn explicitly
  });

  it('no ink injected (an old caller): the link is padUrl() with no ink, nothing breaks', () => {
    const m = mount({ padUrl: (i?: PadInk) => padUrlFor('https://h', '/p/', 'en', i) });
    m.phoneBtn.click();
    expect(lastUrl()).toBe('https://h/p/pad.html#lang=en');
    m.camBtn.click();
    expect(m.scans[0].deps.onText(ONE[0])).toBe(true);
  });
});
