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
  beginAnnotation: 26, endAnnotation: 27,
  paintFormXObjectBegin: 28, paintFormXObjectEnd: 29,
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

/**
 * C22 — the optional `origin` argument, i.e. "report positions in the CROP frame".
 *
 * These pin the property the flow export depends on: ONE argument moves `rules`, `vRules`, the
 * image CTMs and the `colorMap` keys together, because all four derive from the walker's ctm. The
 * caller's alternative — translating each channel after the fact — is what would let three of the
 * four move and the fourth stay put, silently unmatching colour, underline and hyperlink from the
 * words they belong to.
 */
describe('walkPageOps — CropBox origin (C22)', () => {
  const ORIGIN = { x: 50, y: 70 };

  it('translates a rule into the crop frame', () => {
    const ops = opList([OPS.constructPath], [[OPS.fill, null, { 0: 100, 1: 296, 2: 140, 3: 297 }]]);
    expect(walkPageOps(ops, OPS, ORIGIN).rules[0]).toMatchObject({ x: 50, y: 226 });
  });

  it('translates an image placement', () => {
    const ops = opList(
      [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      [[], [60, 0, 0, 40, 120, 200], ['img0'], []],
    );
    expect(walkPageOps(ops, OPS, ORIGIN).images[0].ctm).toEqual([60, 0, 0, 40, 70, 130]);
  });

  it('translates the colour key, so it still matches the translated text item', () => {
    const ops = opList(
      [OPS.beginText, OPS.setTextMatrix, OPS.setFillRGBColor, OPS.showText],
      [[], [[1, 0, 0, 1, 100, 300]], ['#FF0000'], [[]]],
    );
    const r = walkPageOps(ops, OPS, ORIGIN);
    expect(r.colorMap.get('50,230')).toBe('FF0000');
    // And NOT under the absolute key — a stale duplicate would match the wrong word.
    expect(r.colorMap.get('100,300')).toBeUndefined();
  });

  it('applies the origin INSIDE an annotation appearance stream too', () => {
    // `beginAnnotation` RESETS the ctm rather than composing onto it (pdf.js's canvas backend
    // sets the base transform there). It must reset to the BASE, not to identity: an annotation's
    // appearance stream is placed in the same page frame as everything else, so a literal identity
    // would leave stamped images and rules in ABSOLUTE space while the rest of the page had moved
    // — a mixed frame, and in the direction that makes `imagePlacementRedacted` test a stamped
    // image against redactions expressed in a different frame. This is the one case that goes red
    // for that mistake.
    const ops = opList(
      [OPS.beginAnnotation, OPS.transform, OPS.paintImageXObject, OPS.endAnnotation],
      [[null, null, [1, 0, 0, 1, 120, 200], [1, 0, 0, 1, 0, 0]], [40, 0, 0, 30, 0, 0], ['img0'], []],
    );
    expect(walkPageOps(ops, OPS, ORIGIN).images[0].ctm).toEqual([40, 0, 0, 30, 70, 130]);
  });

  it('is byte-identical to the absolute walk when the origin is omitted or zero', () => {
    const build = () => opList(
      [OPS.constructPath, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      [[OPS.fill, null, { 0: 10, 1: 50, 2: 110, 3: 52 }], [], [50, 0, 0, 60, 10, 20], ['img0'], []],
    );
    const absolute = walkPageOps(build(), OPS);
    expect(walkPageOps(build(), OPS, { x: 0, y: 0 })).toEqual(absolute);
    expect(absolute.images[0].ctm).toEqual([50, 0, 0, 60, 10, 20]);
  });
});

/**
 * WS4-F — the Form XObject `/BBox` clip.
 *
 * pdf.js clips a form to its `/BBox` (`pdf.mjs:12350-12362`: `save()` → `transform(...matrix)` →
 * `ctx.clip(rect(bbox))`), so a rule drawn past the boundary is invisible on screen and in every
 * rasterised export. The walker reported it at full length, and an over-long `vRule` is read by
 * `buildTableGrid` as a column boundary — after which `reconstructPage` REMOVES the in-region words
 * from the paragraph flow. Over-approximation here deletes prose, which is why the clip is modelled
 * for rules/vRules and deliberately NOT for images (a leak filter, where over-approximating is the
 * safe direction) and NOT for the colorMap (an attribute of a word `getTextContent` reports whether
 * or not the /BBox hides it — clipping it turned a coloured run black; WS7 round 7).
 */
describe('walkPageOps — Form XObject /BBox clip (WS4-F)', () => {
  const IDENT = [1, 0, 0, 1, 0, 0];
  /** A form Begin/End wrapped around `inner`. */
  const form = (
    matrix: unknown, bbox: unknown, innerFns: number[], innerArgs: unknown[],
  ): OpListLike => opList(
    [OPS.paintFormXObjectBegin, ...innerFns, OPS.paintFormXObjectEnd],
    [[matrix, bbox], ...innerArgs, []],
  );
  /** A thin horizontal rule spanning form-local x `x0..x1` at y `y..y+2`. */
  const ruleOps = (x0: number, x1: number, y: number): [number[], unknown[]] =>
    [[OPS.constructPath], [[OPS.fill, null, { 0: x0, 1: y, 2: x1, 3: y + 2 }]]];

  it('clips a rule that runs past the form boundary to the visible part', () => {
    const [f, a] = ruleOps(50, 400, 20);
    const r = walkPageOps(form(IDENT, [0, 0, 100, 100], f, a), OPS);
    expect(r.rules).toEqual([{ x: 50, y: 20, width: 50, height: 2 }]);
  });

  it('drops a rule drawn entirely outside the /BBox', () => {
    const [f, a] = ruleOps(200, 400, 20);
    expect(walkPageOps(form(IDENT, [0, 0, 100, 100], f, a), OPS).rules).toEqual([]);
  });

  it('classifies BEFORE clipping, so a clipped shading block never becomes a phantom rule', () => {
    // 40x40 is not line-like and yields nothing today. Its visible sliver under this /BBox is
    // 40x2, which IS line-like — so a walk that classified the CLIPPED rect would invent an
    // underline where the page has a filled block. This is the direction that eats prose.
    const r = walkPageOps(
      form(IDENT, [0, 0, 40, 2], [OPS.constructPath], [[OPS.fill, null, { 0: 0, 1: 0, 2: 40, 3: 40 }]]),
      OPS,
    );
    expect(r.rules).toEqual([]);
    expect(r.vRules).toEqual([]);
  });

  it('intersects nested form clips', () => {
    const r = walkPageOps(
      opList(
        [OPS.paintFormXObjectBegin, OPS.paintFormXObjectBegin, OPS.constructPath,
          OPS.paintFormXObjectEnd, OPS.paintFormXObjectEnd],
        [[IDENT, [0, 0, 100, 100]], [IDENT, [50, 0, 300, 100]],
          [OPS.fill, null, { 0: 0, 1: 20, 2: 400, 3: 22 }], [], []],
      ),
      OPS,
    );
    expect(r.rules).toEqual([{ x: 50, y: 20, width: 50, height: 2 }]);
  });

  it('applies the /BBox AFTER the form /Matrix — the box is in form space, not page space', () => {
    // Form placed at (150,500) with /BBox [0 0 100 100] ⇒ it covers page x 150..250. Computing the
    // clip from the PRE-matrix ctm would put it at x 0..100, which misses this rule entirely and
    // drops it — so this case goes red for exactly that mistake.
    const [f, a] = ruleOps(0, 400, 10);
    const r = walkPageOps(form([1, 0, 0, 1, 150, 500], [0, 0, 100, 100], f, a), OPS);
    expect(r.rules).toEqual([{ x: 150, y: 510, width: 100, height: 2 }]);
  });

  it('leaves the IMAGE channel unclipped — over-approximation is safe for a leak filter', () => {
    const r = walkPageOps(
      form(IDENT, [0, 0, 10, 10], [OPS.transform, OPS.paintImageXObject],
        [[60, 0, 0, 40, 120, 200], ['img0']]),
      OPS,
    );
    expect(r.images[0].ctm).toEqual([60, 0, 0, 40, 120, 200]);
  });

  it('pops the clip at the form End, so later page content is unclipped', () => {
    const r = walkPageOps(
      opList(
        [OPS.paintFormXObjectBegin, OPS.paintFormXObjectEnd, OPS.constructPath],
        [[IDENT, [0, 0, 100, 100]], [], [OPS.fill, null, { 0: 200, 1: 20, 2: 400, 3: 22 }]],
      ),
      OPS,
    );
    expect(r.rules).toEqual([{ x: 200, y: 20, width: 200, height: 2 }]);
  });

  it('does not clip when the form carries no /BBox, or a malformed one', () => {
    const [f, a] = ruleOps(200, 400, 20);
    const full = [{ x: 200, y: 20, width: 200, height: 2 }];
    expect(walkPageOps(form(IDENT, undefined, f, a), OPS).rules).toEqual(full);
    expect(walkPageOps(form(IDENT, [0, 0, 100], f, a), OPS).rules).toEqual(full);
    expect(walkPageOps(form(IDENT, [0, 0, NaN, 100], f, a), OPS).rules).toEqual(full);
    // …and a form that clips nothing is byte-identical to the same ops with no form at all.
    expect(walkPageOps(form(IDENT, undefined, f, a), OPS)).toEqual(walkPageOps(opList(f, a), OPS));
  });

  it('normalises a REVERSED /BBox, which the canvas backend accepts as a negative-extent rect', () => {
    const [f, a] = ruleOps(50, 400, 20);
    expect(walkPageOps(form(IDENT, [100, 100, 0, 0], f, a), OPS).rules)
      .toEqual([{ x: 50, y: 20, width: 50, height: 2 }]);
  });

  it('KEEPS a colour key outside the /BBox — the words are not clipped, so the colour must not be', () => {
    // This case asserted the OPPOSITE until WS7 round 7, and the inversion is the point.
    //
    // Colour is matched to a word BY POSITION, and the words come from `getTextContent`, which the
    // form's /BBox does not clip. So clipping the colour key alone is exactly the partial
    // normalisation this walker's own C22 comment says must be unexpressible: the run still
    // exports, it just silently loses its colour and comes out BLACK. Measured red -> none.
    //
    // The clip exists to stop INVENTED GEOMETRY — a phantom rule widens a table region and
    // `reconstructPage` then deletes the prose inside it. A colour key invents nothing; it
    // annotates a word that is exported either way. Geometry is clipped, attributes are not.
    const show = (x: number): [number[], unknown[]] => [
      [OPS.beginText, OPS.setTextMatrix, OPS.setFillRGBColor, OPS.showText],
      [[], [[1, 0, 0, 1, x, 50]], ['#FF0000'], [[]]],
    ];
    const [fIn, aIn] = show(50);
    const [fOut, aOut] = show(200);
    expect(walkPageOps(form(IDENT, [0, 0, 100, 100], fIn, aIn), OPS).colorMap.get('50,50'))
      .toBe('FF0000');
    expect(walkPageOps(form(IDENT, [0, 0, 100, 100], fOut, aOut), OPS).colorMap.get('200,50'))
      .toBe('FF0000');
  });

  it('expresses the clip in the CROP frame under an origin, in lockstep with the rules (C22)', () => {
    // Origin (50,70); form /BBox [0 0 100 100] at identity ⇒ absolute x 0..100 ⇒ crop x -50..50.
    // Rule absolute x 20..400 ⇒ crop -30..350, visible to crop x 50 ⇒ width 80. A clip built from
    // the raw args instead of from `ctm` would sit at crop x 0..100 and yield width 50 — the mixed
    // frame C22 exists to make unexpressible.
    const [f, a] = ruleOps(20, 400, 80);
    const r = walkPageOps(form(IDENT, [0, 0, 100, 100], f, a), OPS, { x: 50, y: 70 });
    expect(r.rules).toEqual([{ x: -30, y: 10, width: 80, height: 2 }]);
  });
});
