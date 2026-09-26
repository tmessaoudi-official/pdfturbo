/**
 * Row 32 (2026-09-26) — every pdf.js document is opened WITH pdf.js's CMap files.
 *
 * A CID font encoded with a predefined Adobe CMap (common in CJK PDFs) decodes only when `getDocument`
 * is given `cMapUrl`; without it the page's text is not selectable, searchable or exported. One helper,
 * `withCMaps`, adds the parameters, and this file bans a `getDocument` call that bypasses it, so a new
 * open site cannot silently lose CJK text. `tests/browser/cjk-cmaps.browser.test.ts` pins the behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withCMaps, cMapBaseUrl } from '../../src/utils/pdfjsParams';

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

describe('withCMaps — the helper', () => {
  it('adds an absolute cMapUrl ending in pdfjs/cmaps/ and cMapPacked, keeping every other key', () => {
    const p = withCMaps({ data: new Uint8Array([1]), verbosity: 0 });
    expect(p.data).toEqual(new Uint8Array([1]));
    expect(p.verbosity).toBe(0);
    expect(p.cMapPacked).toBe(true);
    expect(p.cMapUrl).toBe(cMapBaseUrl());
    expect(new URL(p.cMapUrl).pathname.endsWith('/pdfjs/cmaps/')).toBe(true);
  });

  it('does not mutate the caller\'s object (the password retry loop reuses it)', () => {
    const src = { data: new Uint8Array(), password: 'x' };
    withCMaps(src);
    expect(Object.keys(src).sort()).toEqual(['data', 'password']);
  });
});

describe('withCMaps — no getDocument call in src/ bypasses it', () => {
  const files = tsFiles(join(ROOT, 'src'));
  const calls = files.flatMap(f =>
    (code(f).match(/\.getDocument\([^\n]*/g) ?? []).map(c => ({ file: relative(ROOT, f), call: c })));

  it('every getDocument call is getDocument(withCMaps(…))', () => {
    expect(calls.filter(c => !c.call.startsWith('.getDocument(withCMaps(')).map(c => `${c.file}: ${c.call}`))
      .toEqual([]);
  });

  it('non-vacuity: the scan finds the known open sites', () => {
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });
});
