// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/utils/qrCanvas', () => ({ drawQr: vi.fn(() => ({ modules: 33, modulePx: 4 })) }));

import { drawQr } from '../../src/utils/qrCanvas';
import { mountSignatureSources, padUrlFor } from '../../src/ui/signatureSources';
import { SignatureImageError } from '../../src/utils/signatureImage';

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
  const pad = { drawImage: vi.fn() };
  const loadImage = vi.fn(() => Promise.resolve(document.createElement('canvas')));
  const deps = {
    root,
    pad,
    onModalClosed: (fn: () => void) => { closed = fn; },
    padUrl: () => 'https://example.github.io/pdfturbo/pad.html#lang=fr',
    loadImage,
    t: (k: string) => `T(${k})`,
    dpr: () => 2,
    ...over,
  };
  const handle = mountSignatureSources(deps);
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  return {
    handle, pad, loadImage, close: () => closed?.(),
    phoneBtn: $<HTMLButtonElement>('sigPhoneBtn'), panel: $('sigPhonePanel'), qr: $<HTMLCanvasElement>('sigPadQr'),
    url: $('sigPadUrl'), importBtn: $<HTMLButtonElement>('sigImportBtn'), input: $<HTMLInputElement>('sigImageInput'),
    msg: $('sigSourceMsg'),
  };
}

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

  it.each(['type', 'bytes', 'pixels', 'decode', 'empty'] as const)('a refused image (%s) is SHOWN, the pad untouched, nothing logged', async (code) => {
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

describe('padUrlFor', () => {
  it('builds the pad URL under the base path, the language in the FRAGMENT (a precached or cached pad still matches)', () => {
    expect(padUrlFor('https://example.github.io', '/pdfturbo/', 'fr')).toBe('https://example.github.io/pdfturbo/pad.html#lang=fr');
    expect(padUrlFor('http://localhost:5173', '/pdfturbo/', 'ar')).toBe('http://localhost:5173/pdfturbo/pad.html#lang=ar');
  });
});
