// @vitest-environment jsdom
// zxing-wasm's reader fetches its wasm from fastly.jsdelivr.net unless `locateFile` says otherwise; the CSP has
// `connect-src 'self' blob:`, so the CDN default would fail the scan in production and, were the CSP ever widened,
// make the scanner the one feature that talks to a third party (milestone panel round 1, 2026-11-11: nothing pinned
// the override). A fresh module per test, because `loadZxingDecoder` memoises the prepared module.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Prepare = (opts: { overrides: { locateFile(p: string, prefix: string): string }; fireImmediately?: boolean }) => Promise<unknown>;

beforeEach(() => {
  vi.resetModules();
});

async function load(prepare: Prepare, read = vi.fn(() => Promise.resolve([] as Array<{ isValid: boolean; text: string }>))) {
  vi.doMock('zxing-wasm/reader', () => ({ prepareZXingModule: prepare, readBarcodes: read }));
  const mod = await import('../../src/ui/qrScanner');
  const { default: wasmUrl } = await import('zxing-wasm/reader/zxing_reader.wasm?url');
  return { mod, wasmUrl: wasmUrl as string, read };
}

const CDN_PREFIX = 'https://fastly.jsdelivr.net/npm/zxing-wasm@3/dist/reader/';

describe('loadZxingDecoder — the wasm comes from this origin', () => {
  it('locateFile maps the .wasm to the bundled URL, not the CDN prefix it is handed', async () => {
    const prepare = vi.fn<Prepare>(() => Promise.resolve({}));
    const { mod, wasmUrl } = await load(prepare);
    await mod.loadZxingDecoder();
    expect(prepare).toHaveBeenCalledTimes(1);
    const opts = prepare.mock.calls[0][0];
    const located = opts.overrides.locateFile('zxing_reader.wasm', CDN_PREFIX);
    expect(located).toBe(wasmUrl);
    expect(located).not.toMatch(/jsdelivr|^https?:\/\//);
    expect(wasmUrl).toMatch(/zxing_reader.*\.wasm/);
    expect(opts.fireImmediately).toBe(true);
  });

  it('a non-wasm file keeps the prefix zxing gives it (only the wasm is redirected)', async () => {
    const prepare = vi.fn<Prepare>(() => Promise.resolve({}));
    const { mod } = await load(prepare);
    await mod.loadZxingDecoder();
    expect(prepare.mock.calls[0][0].overrides.locateFile('x.data', '/p/')).toBe('/p/x.data');
  });

  it('a failed load is retried by the next call (the memo is cleared)', async () => {
    let n = 0;
    const prepare = vi.fn<Prepare>(() => {
      n += 1;
      return n === 1 ? Promise.reject(new Error('wasm fetch failed')) : Promise.resolve({});
    });
    const { mod } = await load(prepare);
    await expect(mod.loadZxingDecoder()).rejects.toThrow('wasm fetch failed');
    await mod.loadZxingDecoder();
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('the decode keeps only valid reads, verbatim', async () => {
    const read = vi.fn(() => Promise.resolve([{ isValid: true, text: 'PTSIG1:A' }, { isValid: false, text: 'junk' }]));
    const { mod } = await load(vi.fn<Prepare>(() => Promise.resolve({})), read);
    const decode = await mod.loadZxingDecoder();
    expect(await decode({} as ImageData)).toEqual(['PTSIG1:A']);
  });
});
