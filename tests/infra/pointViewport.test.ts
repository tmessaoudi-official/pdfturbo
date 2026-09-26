/**
 * /UserUnit (2026-09-26) — the editor measures in POINTS.
 *
 * pdf.js multiplies every viewport by the page's /UserUnit (`pdf.mjs:826`), while pdf-lib — the export —
 * works in plain points. So on a /UserUnit page the editor's coordinates and the export's differed by that
 * factor wherever the two met, and a redaction drawn over a secret was burned at 1/u of its position.
 * The fix is structural: one helper divides the requested scale by the page's UserUnit, and every viewport
 * in `src/` comes from it. This file pins the helper and bans the direct call, so a new site cannot
 * reopen the gap; `tests/browser/userunit-frame.browser.test.ts` pins the behaviour end to end.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pointViewport } from '../../src/utils/pointViewport';

const ROOT = join(__dirname, '..', '..');
const HELPER = 'src/utils/pointViewport.ts';

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

describe('pointViewport — the helper', () => {
  const page = (userUnit?: number) => ({
    userUnit,
    getViewport: (o: { scale: number; rotation?: number }) => o,
  });

  it('divides the scale by the UserUnit, so the viewport is in points', () => {
    expect(pointViewport(page(2), { scale: 1.5, rotation: 90 })).toEqual({ scale: 0.75, rotation: 90 });
  });

  it('changes nothing on an ordinary page, or when the page reports no UserUnit', () => {
    expect(pointViewport(page(1), { scale: 1.5 })).toEqual({ scale: 1.5 });
    expect(pointViewport(page(), { scale: 1.5, rotation: 0 })).toEqual({ scale: 1.5, rotation: 0 });
  });

  // pdf.js already turns a non-positive /UserUnit into 1 in the worker; the helper also refuses a
  // non-finite one rather than produce a zero or NaN scale.
  it('ignores a UserUnit that is not a positive finite number', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pointViewport(page(bad), { scale: 2 })).toEqual({ scale: 2 });
    }
  });
});

describe('pointViewport — no direct getViewport call in src/', () => {
  const files = tsFiles(join(ROOT, 'src'));

  it('every viewport comes from the helper', () => {
    const offenders = files
      .filter(f => relative(ROOT, f) !== HELPER)
      .filter(f => /\.getViewport\(/.test(code(f)))
      .map(f => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('non-vacuity: the helper itself calls getViewport exactly once, and is used at 20+ sites', () => {
    expect(code(join(ROOT, HELPER)).match(/\.getViewport\(/g)?.length).toBe(1);
    const uses = files.filter(f => relative(ROOT, f) !== HELPER)
      .reduce((n, f) => n + (code(f).match(/\bpointViewport\(/g)?.length ?? 0), 0);
    expect(uses).toBeGreaterThanOrEqual(20);
  });
});
