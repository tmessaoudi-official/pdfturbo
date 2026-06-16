/**
 * M2 #22 — the pdf.js operator-list walk extracted out of the ~260-line
 * _extractFlowDoc into a pure walkPageOps(). These tests pin the deterministic
 * matrix/color/rule/image-placement tracking directly (no canvas, no page.objs);
 * image bitmap rasterization stays in exportService and is covered by the browser
 * DOCX-image tests.
 */
import { describe, it, expect } from 'vitest';
import { walkPageOps, type OpListLike } from '../../src/export/opStreamWalker';

// Synthetic OPS table — only the codes walkPageOps reads. Values are arbitrary
// but distinct (real pdf.js OPS are passed in at runtime).
const OPS: Record<string, number> = {
  save: 1, restore: 2, transform: 3, paintImageXObject: 4, constructPath: 5,
  setFillRGBColor: 6, setFillGray: 7, setFillCMYKColor: 8, beginText: 9,
  setTextMatrix: 10, setLeading: 11, moveText: 12, setLeadingMoveText: 13,
  nextLine: 14, showText: 15, showSpacedText: 16, nextLineShowText: 17,
  nextLineSetSpacingShowText: 18, fill: 20, eoFill: 21, fillStroke: 22,
  eoFillStroke: 23, stroke: 24, closeStroke: 25,
};

const opList = (fnArray: number[], argsArray: unknown[]): OpListLike => ({ fnArray, argsArray });

describe('walkPageOps', () => {
  it('records a non-black text fill color at the show-op page position', () => {
    const r = walkPageOps(
      opList(
        [OPS.beginText, OPS.setTextMatrix, OPS.setFillRGBColor, OPS.showText],
        [[], [[1, 0, 0, 1, 100, 200]], ['#FF0000'], [[]]],
      ),
      OPS,
    );
    expect(r.colorMap.get('100,200')).toBe('FF0000');
  });

  it('omits black text from the color map (reconstructPage defaults to black)', () => {
    const r = walkPageOps(
      opList([OPS.beginText, OPS.setTextMatrix, OPS.showText], [[], [[1, 0, 0, 1, 10, 20]], [[]]]),
      OPS,
    );
    expect(r.colorMap.size).toBe(0);
  });

  it('tracks the CTM across save/transform and records an image placement', () => {
    const r = walkPageOps(
      opList(
        [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
        [[], [50, 0, 0, 60, 10, 20], ['img0'], []],
      ),
      OPS,
    );
    expect(r.images).toEqual([{ name: 'img0', ctm: [50, 0, 0, 60, 10, 20] }]);
  });

  it('emits a thin horizontal rule transformed into page space (underline candidate)', () => {
    const r = walkPageOps(
      opList([OPS.constructPath], [[OPS.fill, null, { 0: 10, 1: 50, 2: 110, 3: 52 }]]),
      OPS,
    );
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0]).toMatchObject({ x: 10, y: 50, width: 100, height: 2 });
  });

  it('emits a thin vertical rule transformed into page space (table-grid candidate, #56)', () => {
    const r = walkPageOps(
      opList([OPS.constructPath], [[OPS.fill, null, { 0: 30, 1: 10, 2: 32, 3: 210 }]]),
      OPS,
    );
    expect(r.vRules).toHaveLength(1);
    expect(r.vRules[0]).toMatchObject({ x: 30, y: 10, width: 2, height: 200 });
    expect(r.rules).toHaveLength(0); // not a horizontal rule
  });

  it('rejects a shading block from both rule sets but keeps a vertical bar as a grid rule', () => {
    const r = walkPageOps(
      opList(
        [OPS.constructPath, OPS.constructPath],
        [
          [OPS.fill, null, { 0: 0, 1: 0, 2: 100, 3: 100 }], // square block → neither
          [OPS.fill, null, { 0: 0, 1: 0, 2: 1, 3: 40 }],     // vertical bar → vRules
        ],
      ),
      OPS,
    );
    expect(r.rules).toHaveLength(0);
    expect(r.vRules).toHaveLength(1);
    expect(r.vRules[0]).toMatchObject({ x: 0, y: 0, width: 1, height: 40 });
  });
});
