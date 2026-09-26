/**
 * Rows 32, 36 and 37 (2026-09-26) — every pdf.js document is opened WITH pdf.js's data files.
 *
 * A CID font encoded with a predefined Adobe CMap (common in CJK PDFs) decodes only when `getDocument`
 * is given `cMapUrl` (row 32), a JBIG2 or JPEG 2000 image only when it is given `wasmUrl` (row 36), and
 * CMYK / ICC colour is colour-managed only with `iccUrl` and worker fetch (row 37). One helper,
 * `withPdfjsAssets`, adds the parameters, and this file bans a `getDocument` call that bypasses it, so a
 * new open site cannot silently lose any of them. `tests/browser/cjk-cmaps.browser.test.ts`,
 * `scan-codecs.browser.test.ts` and `icc-colour.browser.test.ts` pin the behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withPdfjsAssets, cMapBaseUrl, wasmBaseUrl, iccBaseUrl } from '../../src/utils/pdfjsParams';

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

  it('turns on colour management: an absolute iccUrl ending in pdfjs/iccs/, and useWorkerFetch true (row 37)', () => {
    const p = withPdfjsAssets({ data: new Uint8Array() });
    expect(p.iccUrl).toBe(iccBaseUrl());
    expect(new URL(p.iccUrl).pathname.endsWith('/pdfjs/iccs/')).toBe(true);
    // pdf.js enables its ICC module only when the worker fetches its own data (IccColorSpace.setOptions).
    expect(p.useWorkerFetch).toBe(true);
  });

  it('gives NO standardFontDataUrl: that would change how non-embedded fonts are drawn, a separate change', () => {
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
