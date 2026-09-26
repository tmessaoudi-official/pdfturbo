/**
 * Rows 32 and 36 (2026-09-26) — every pdf.js document is opened WITH pdf.js's data files.
 *
 * A CID font encoded with a predefined Adobe CMap (common in CJK PDFs) decodes only when `getDocument`
 * is given `cMapUrl` (row 32), and a JBIG2 or JPEG 2000 image only when it is given `wasmUrl` (row 36);
 * without them the text, or the scan, is lost. One helper, `withPdfjsAssets`, adds the parameters, and
 * this file bans a `getDocument` call that bypasses it, so a new open site cannot silently lose either.
 * `tests/browser/cjk-cmaps.browser.test.ts` and `scan-codecs.browser.test.ts` pin the behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withPdfjsAssets, cMapBaseUrl, wasmBaseUrl } from '../../src/utils/pdfjsParams';

const ROOT = join(__dirname, '..', '..');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Source with comment lines and trailing `//` comments removed — prose may mention the call freely. */
function code(file: string): string {
  return readFileSync(file, 'utf8').split('\n')
    .filter(l => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');
}

describe('withPdfjsAssets — the helper', () => {
  it('adds an absolute cMapUrl ending in pdfjs/cmaps/ and cMapPacked, keeping every other key', () => {
    const p = withPdfjsAssets({ data: new Uint8Array([1]), verbosity: 0 });
    expect(p.data).toEqual(new Uint8Array([1]));
    expect(p.verbosity).toBe(0);
    expect(p.cMapPacked).toBe(true);
    expect(p.cMapUrl).toBe(cMapBaseUrl());
    expect(new URL(p.cMapUrl).pathname.endsWith('/pdfjs/cmaps/')).toBe(true);
  });

  it('adds an absolute wasmUrl ending in pdfjs/wasm/ (row 36: JBIG2 / JPEG 2000 decoders)', () => {
    const p = withPdfjsAssets({ data: new Uint8Array() });
    expect(p.wasmUrl).toBe(wasmBaseUrl());
    expect(new URL(p.wasmUrl).pathname.endsWith('/pdfjs/wasm/')).toBe(true);
  });

  it('pins useWorkerFetch false, so pdf.js does not switch on ICC colour management (row 37, unruled)', () => {
    expect(withPdfjsAssets({ data: new Uint8Array() }).useWorkerFetch).toBe(false);
    expect('standardFontDataUrl' in withPdfjsAssets({ data: new Uint8Array() })).toBe(false);
  });

  it('does not mutate the caller\'s object (the password retry loop reuses it)', () => {
    const src = { data: new Uint8Array(), password: 'x' };
    withPdfjsAssets(src);
    expect(Object.keys(src).sort()).toEqual(['data', 'password']);
  });
});

describe('withPdfjsAssets — no getDocument call in src/ bypasses it', () => {
  const files = tsFiles(join(ROOT, 'src'));
  const calls = files.flatMap(f =>
    (code(f).match(/\.getDocument\([^\n]*/g) ?? []).map(c => ({ file: relative(ROOT, f), call: c })));

  it('every getDocument call is getDocument(withPdfjsAssets(…))', () => {
    expect(calls.filter(c => !c.call.startsWith('.getDocument(withPdfjsAssets(')).map(c => `${c.file}: ${c.call}`))
      .toEqual([]);
  });

  it('non-vacuity: the scan finds the known open sites', () => {
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });
});
