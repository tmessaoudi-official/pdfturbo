/**
 * Architecture step 3: the coordinate frames are SOFT brands (Decisions Log 2026-10-17) — an optional phantom
 * `__frame`, so a plain `{ x, y, width, height }` literal still fits every frame while a converter's output handed to
 * a parameter of another frame does not compile. This file is type-checked by tsc (tsconfig includes `tests/`), so
 * the type-level lines below are the guard: a converter whose return or parameter loses its brand, or brands collapsed
 * into one, leave a `@ts-expect-error` unused (tsc fails); a required `__frame` stops the plain literal compiling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DisplayRect } from '../../../src/shared-kernel/geometry/frames';
import { contentRectToDisplay, redactionRectToContent, rotatedElementFootprint } from '../../../src/utils/geometry';

const takesDisplay = (r: DisplayRect): number => r.width;

describe('coordinate-frame brands (step 3)', () => {
  // The directives sit on the converter CALLS, with no annotated variable between: a converter whose signature went
  // back to a plain `Rect` would then compile here, and the unused directive is what reds (TS2578).
  it('rejects a converter output in the wrong frame, accepts a plain literal', () => {
    // @ts-expect-error -- redactionRectToContent returns a ContentRect, which is not a DisplayRect
    takesDisplay(redactionRectToContent({ x: 10, y: 20, width: 30, height: 40 }, 200, 100, 90));
    // @ts-expect-error -- rotatedElementFootprint returns a DisplayRect; contentRectToDisplay takes a ContentRect
    contentRectToDisplay(rotatedElementFootprint({ x: 1, y: 2, width: 3, height: 4, rotation: 30 }), 200, 100, 0);
    expect(takesDisplay({ x: 0, y: 0, width: 5, height: 5 })).toBe(5);
    const content = redactionRectToContent({ x: 10, y: 20, width: 30, height: 40 }, 200, 100, 90);
    expect(takesDisplay(contentRectToDisplay(content, 200, 100, 90))).toBeGreaterThan(0);
  });

  it('is types only: a converter output carries no __frame key at run time', () => {
    const r = redactionRectToContent({ x: 1, y: 2, width: 3, height: 4 }, 100, 100, 0);
    expect(Object.keys(r).sort()).toEqual(['height', 'width', 'x', 'y']);
  });

  // Any spelling: fields in any order, `;` or `,` between them, optional or not — and no unbranded `Rect`, which would
  // compile against every frame. Comments are stripped first, so a doc comment naming a PDF `/Rect` is not a hit.
  it('src/utils/geometry.ts declares no anonymous or unbranded rect type (the plan step-3 fitness rule)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'utils', 'geometry.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const field = (name: string): RegExp => new RegExp(`\\b${name}\\??\\s*:\\s*number\\b`);
    const anonymous = (src.match(/\{[^{}]*\}/g) ?? []).filter((body) => ['x', 'y', 'width', 'height'].every((f) => field(f).test(body)));
    expect(anonymous).toEqual([]);
    expect(src.match(/\bRect\b/g) ?? []).toEqual([]);
  });
});
