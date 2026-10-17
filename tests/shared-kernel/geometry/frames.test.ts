/**
 * Architecture step 3: the coordinate frames are SOFT brands (Decisions Log 2026-10-17) — an optional phantom
 * `__frame`, so a plain `{ x, y, width, height }` literal still fits every frame while a converter's output handed to
 * a parameter of another frame does not compile. This file is type-checked by tsc (tsconfig includes `tests/`), so
 * the two type-level lines below are the guard: collapse the brands into one and the `@ts-expect-error` goes unused
 * (tsc fails); make `__frame` required and the plain literal stops compiling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentRect, DisplayRect } from '../../../src/shared-kernel/geometry/frames';
import { contentRectToDisplay, redactionRectToContent } from '../../../src/utils/geometry';

const takesDisplay = (r: DisplayRect): number => r.width;

describe('coordinate-frame brands (step 3)', () => {
  it('rejects a converter output in the wrong frame, accepts a plain literal', () => {
    const content: ContentRect = redactionRectToContent({ x: 10, y: 20, width: 30, height: 40 }, 200, 100, 90);
    // @ts-expect-error -- a ContentRect is not a DisplayRect: the brand is what makes this a compile error
    takesDisplay(content);
    expect(takesDisplay({ x: 0, y: 0, width: 5, height: 5 })).toBe(5);
    expect(takesDisplay(contentRectToDisplay(content, 200, 100, 90))).toBeGreaterThan(0);
  });

  it('is types only: a converter output carries no __frame key at run time', () => {
    const r = redactionRectToContent({ x: 1, y: 2, width: 3, height: 4 }, 100, 100, 0);
    expect(Object.keys(r).sort()).toEqual(['height', 'width', 'x', 'y']);
  });

  it('src/utils/geometry.ts declares no anonymous rect type (the plan step-3 fitness rule)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'utils', 'geometry.ts'), 'utf8');
    expect(src.match(/\{\s*x:\s*number;\s*y:\s*number;\s*width:\s*number;\s*height:\s*number/g) ?? []).toEqual([]);
  });
});
