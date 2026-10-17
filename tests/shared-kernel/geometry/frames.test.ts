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
import { lex } from '../../tools/architectureGraph';

/**
 * Every anonymous rect type in `code` — a brace body holding `x`, `y`, `width` and `height` typed `number` at its own
 * depth, in any order, with `;` or `,`, optional or `readonly` — and every unbranded `Rect`. Comments are blanked by
 * the architecture lexer, which reads strings as strings, so a `//` inside one is not a comment. Not caught (bounds):
 * the four fields split across an intersection, or written as a `Record<…>`.
 */
function rectTypeViolations(code: string): string[] {
  const src = lex(code).code;
  const field = (name: string): RegExp => new RegExp(`\\b${name}\\??\\s*:\\s*number\\b`);
  const found: string[] = [];
  for (let i = src.indexOf('{'); i >= 0; i = src.indexOf('{', i + 1)) {
    let depth = 0;
    let own = '';
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
      else if (depth === 1) own += src[j];
    }
    if (['x', 'y', 'width', 'height'].every((f) => field(f).test(own))) found.push(src.slice(i, j + 1));
  }
  for (const m of src.match(/\bRect\b/g) ?? []) found.push(m);
  return found;
}

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

  it('the fitness scan catches every spelling it claims, and reads strings as strings', () => {
    const hits = (code: string): number => rectTypeViolations(code).length;
    expect(hits('const f = (r: { y: number, x: number, height?: number, width: number }): number => r.x;')).toBe(1);
    expect(hits('interface R { readonly x: number; readonly y: number; readonly width: number; readonly height: number }')).toBe(1);
    expect(hits('const f = (r: { x: number; y: number; width: number; height: number; meta: { id: string } }) => r;')).toBe(1);
    expect(hits("const u = 'http://x'; const f = (r: { x: number; y: number; width: number; height: number }) => r;")).toBe(1);
    expect(hits("import type { Rect } from './frames';")).toBe(1);
    expect(hits('// a PDF /Rect, and { x: number; y: number; width: number; height: number } in a comment')).toBe(0);
    expect(hits('const f = (p: { x: number; y: number }) => p.x;')).toBe(0);
    // A point and a size are not a rect: only the fields at a brace body's OWN depth count.
    expect(hits('const f = (r: { pos: { x: number; y: number }; size: { width: number; height: number } }) => r;')).toBe(0);
  });

  it('src/utils/geometry.ts declares no anonymous or unbranded rect type (the plan step-3 fitness rule)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'utils', 'geometry.ts'), 'utf8');
    expect(rectTypeViolations(src)).toEqual([]);
  });
});
