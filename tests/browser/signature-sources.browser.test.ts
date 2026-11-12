/**
 * The ✍ modal's signature sources in REAL Chrome (phone-signature-pad plan step 5a): what jsdom cannot show.
 *  - the pad-URL QR read back: the code the PC shows is BYTE mode (lowercase, `#`, `=`, a case-sensitive path) and
 *    until this test nothing read one back. Drawn through the real `#sigSources` markup and `mountSignatureSources`,
 *    then decoded by zxing-wasm — a phone's camera app stands in the same place;
 *  - the file input after an import: it must hold NO file, or picking the SAME file again fires no `change` and the
 *    button looks dead. jsdom cannot hold a file in an input (its `value` reads '' whatever the code does — the
 *    assertion that used to live in tests/ui/signatureSources.test.ts could not fail), so a real FileList is used.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import indexHtml from '../../index.html?raw';
import { mountSignatureSources, padUrlFor } from '../../src/ui/signatureSources';

const READ: ReaderOptions = { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 };

beforeAll(() => {
  prepareZXingModule({ overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } });
});
afterEach(() => { document.body.replaceChildren(); });

function mount(over: Partial<Parameters<typeof mountSignatureSources>[0]> = {}) {
  const markup = new DOMParser().parseFromString(indexHtml, 'text/html').getElementById('sigSources');
  if (!markup) throw new Error('#sigSources missing from index.html');
  document.body.replaceChildren(document.importNode(markup, true));
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  const pad = { drawImage: vi.fn(), replay: vi.fn(), color: '#000000', lineWidth: 2 };
  const loadImage = vi.fn((_f: File) => Promise.resolve(document.createElement('canvas')));
  const handle = mountSignatureSources({
    root: $('sigSources'), pad, onModalClosed: () => {}, padUrl: () => '', loadImage, t: (k) => k, dpr: () => 1, ...over,
  });
  return { handle, pad, loadImage, phoneBtn: $<HTMLButtonElement>('sigPhoneBtn'), qr: $<HTMLCanvasElement>('sigPadQr'), input: $<HTMLInputElement>('sigImageInput') };
}

async function readQr(canvas: HTMLCanvasElement): Promise<string[]> {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const r = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), READ);
  return r.filter((b) => b.isValid).map((b) => b.text);
}

describe('Sign on phone — the pad-URL QR, read back', () => {
  // A GitHub Pages-shaped origin; the path is case-sensitive there, so an upper-cased URL would be a 404.
  for (const lang of ['en', 'fr', 'ar']) {
    for (const dpr of [1, 2]) {
      it(`${lang}, dpr ${dpr}: the code on screen decodes to the exact pad URL`, async () => {
        const url = padUrlFor('https://example.github.io', '/pdfturbo/', lang);
        expect(url).toBe(`https://example.github.io/pdfturbo/pad.html#lang=${lang}`);
        const { phoneBtn, qr } = mount({ padUrl: () => url, dpr: () => dpr });
        phoneBtn.click();
        expect(qr.checkVisibility()).toBe(true);
        expect(qr.width).toBeGreaterThan(100); // drawn, not the 300x150 default left blank
        expect(await readQr(qr)).toEqual([url]);
      });
    }
  }
});

describe('Import image — the file input after an import', () => {
  it('holds no file once the import ran, so the same file can be picked again', async () => {
    const { handle, input, loadImage, pad } = mount();
    const file = new File([new Uint8Array([1, 2, 3])], 's.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    // The precondition: the input really holds the file. Without it the assertions below could not fail.
    expect(input.files).toHaveLength(1);
    expect(input.value).toMatch(/s\.png$/);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.whenIdle();
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage.mock.calls[0][0].name).toBe('s.png'); // read BEFORE the reset
    expect(pad.drawImage).toHaveBeenCalledTimes(1);
    expect(input.files).toHaveLength(0);
    expect(input.value).toBe('');
  });
});
