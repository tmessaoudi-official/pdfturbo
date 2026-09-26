/**
 * A2 — the pure halves of the form-hidden-text filter: the footprint test, the per-item attribution with
 * its parity checks, and the walker's trigger and marker clips. The end-to-end half is
 * `tests/browser/form-hidden-text.browser.test.ts`.
 *
 * The parity checks are pinned HERE and only here: on 360 real corpus pages the marker-injected copy's
 * text matched the source item for item, so no real file drives a mismatch end-to-end.
 */
import { describe, it, expect } from 'vitest';
import {
  isItemOutsideClip, attributeHiddenItems, FORM_MARK_PREFIX, type FormTextItem, type FormTextMarker,
} from '../../src/export/formHiddenText';
import { walkPageOps } from '../../src/export/opStreamWalker';

const item = (str: string, x: number, y: number, width = 40, size = 10, rot = 0): FormTextItem => {
  const r = rot * Math.PI / 180;
  return { str, width, height: size, transform: [size * Math.cos(r), size * Math.sin(r), -size * Math.sin(r), size * Math.cos(r), x, y] };
};
const CLIP = { x0: 50, y0: 600, x1: 150, y1: 660 };
const begin = (tag: string): FormTextMarker => ({ type: 'beginMarkedContent', tag });
const end: FormTextMarker = { type: 'endMarkedContent' };
const T0 = `${FORM_MARK_PREFIX}0`, T1 = `${FORM_MARK_PREFIX}1`;

describe('isItemOutsideClip', () => {
  it('a run wholly past the box is outside; one inside is not', () => {
    expect(isItemOutsideClip(item('HIDDEN', 350, 620), CLIP)).toBe(true);
    expect(isItemOutsideClip(item('INSIDE', 55, 620), CLIP)).toBe(false);
  });

  it('a run crossing the edge is NOT outside — it is one item, and part of it shows', () => {
    expect(isItemOutsideClip(item('STRADDLE', 130, 640, 60), CLIP)).toBe(false);
  });

  it('touching the edge counts as inside', () => {
    expect(isItemOutsideClip(item('EDGE', 150, 620), CLIP)).toBe(false);
  });

  it('the quarter-em descender keeps a run whose baseline sits just above the box', () => {
    // Baseline 2pt above the top: the glyph box alone would miss the clip; the descender reaches it.
    expect(isItemOutsideClip(item('LOW', 60, 662), CLIP)).toBe(false);
    expect(isItemOutsideClip(item('LOW', 60, 662 + 3), CLIP)).toBe(true);
  });

  it('a rotated run is tested along its own direction', () => {
    // Pointing straight up from inside the box: stays. Pointing up from past its right edge: goes.
    expect(isItemOutsideClip(item('UP', 60, 610, 80, 10, 90), CLIP)).toBe(false);
    expect(isItemOutsideClip(item('UP', 170, 610, 80, 10, 90), CLIP)).toBe(true);
  });

  it('never drops: no clip, whitespace, vertical writing, a degenerate or non-finite transform', () => {
    const far = item('X', 400, 100);
    expect(isItemOutsideClip(far, null)).toBe(false);
    expect(isItemOutsideClip({ ...far, str: '  ' }, CLIP)).toBe(false);
    expect(isItemOutsideClip({ ...far, dir: 'ttb' }, CLIP)).toBe(false);
    expect(isItemOutsideClip({ ...far, transform: [0, 0, 0, 0, 400, 100] }, CLIP)).toBe(false);
    expect(isItemOutsideClip({ ...far, transform: [10, 0, 0, 10, NaN, 100] }, CLIP)).toBe(false);
  });

  it('an EMPTY clip (nested boxes that do not meet) draws nothing, so everything in it is outside', () => {
    expect(isItemOutsideClip(item('IN', 60, 620), { x0: 100, y0: 600, x1: 90, y1: 660 })).toBe(true);
  });
});

describe('attributeHiddenItems', () => {
  const source = [item('PAGE', 60, 700), item('INSIDE', 55, 620), item('HIDDEN', 350, 620), item('PAIR', 210, 605), item('PAIR', 400, 405)];
  const marked = [
    source[0],
    begin(T0), source[1], source[2],
    begin(T1), source[3], end,
    end,
    begin(T1), source[4], end,
  ];
  const T1_CLIPS = [{ x0: 60, y0: 600, x1: 150, y1: 620 }, { x0: 300, y0: 400, x1: 500, y1: 420 }];
  const clips = new Map([[T0, [CLIP]], [T1, T1_CLIPS]]);

  it('drops exactly the items outside THEIR placement\'s clip, pairing each occurrence in order', () => {
    expect([...(attributeHiddenItems(source, marked, clips) ?? [])]).toEqual([2, 3]);
  });

  it('the document\'s own markers pass through without claiming a clip', () => {
    const withOwn = [begin('Span'), ...marked, end];
    expect([...(attributeHiddenItems(source, withOwn, clips) ?? [])]).toEqual([2, 3]);
  });

  it('text inside the document\'s own marker, inside one of ours, still takes our clip', () => {
    const m = [source[0], begin(T0), source[1], begin('Span'), source[2], end, begin(T1), source[3], end, end, begin(T1), source[4], end];
    expect([...(attributeHiddenItems(source, m, clips) ?? [])]).toEqual([2, 3]);
  });

  it('null (filter nothing) when the copy has a different number of text items', () => {
    expect(attributeHiddenItems(source.slice(0, 4), marked, clips)).toBeNull();
    expect(attributeHiddenItems([...source, item('EXTRA', 1, 1)], marked, clips)).toBeNull();
  });

  it('null when a string or an origin differs at any position', () => {
    expect(attributeHiddenItems([source[0], source[1], item('OTHER', 350, 620), source[3], source[4]], marked, clips)).toBeNull();
    expect(attributeHiddenItems([source[0], source[1], item('HIDDEN', 350.5, 620), source[3], source[4]], marked, clips)).toBeNull();
  });

  it('null when a tag occurs a different number of times in the text than in the operator list', () => {
    expect(attributeHiddenItems(source, marked, new Map([[T0, [CLIP]], [T1, [T1_CLIPS[0]]]]))).toBeNull();
    expect(attributeHiddenItems(source, marked, new Map([[T0, [CLIP]], [T1, [...T1_CLIPS, null]]]))).toBeNull();
    expect(attributeHiddenItems(source, marked, new Map([[T1, T1_CLIPS]]))).toBeNull();
  });

  it('an unclipped placement (null) drops nothing', () => {
    expect([...(attributeHiddenItems(source, marked, new Map([[T0, [null]], [T1, [null, null]]])) ?? [])]).toEqual([]);
  });
});

describe('walkPageOps — the A2 trigger and marker clips', () => {
  const OPS = {
    save: 10, restore: 11, transform: 12, beginText: 31, endText: 32, setTextMatrix: 42, showText: 44,
    paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, beginMarkedContent: 69, endMarkedContent: 71,
    beginAnnotation: 80, endAnnotation: 81,
  };
  const ops = (list: Array<[number, unknown[]]>) => ({ fnArray: list.map(o => o[0]), argsArray: list.map(o => o[1]) });
  const form = (x: number, y: number): Array<[number, unknown[]]> => [[OPS.paintFormXObjectBegin, [[1, 0, 0, 1, x, y], [0, 0, 100, 60]]]];
  const show = (x: number, y: number): Array<[number, unknown[]]> => [
    [OPS.beginText, []], [OPS.setTextMatrix, [[1, 0, 0, 1, x, y]]], [OPS.showText, [[]]], [OPS.endText, []],
  ];

  it('fires only for form text whose origin is outside the clip', () => {
    expect(walkPageOps(ops([...form(50, 600), ...show(5, 20), [OPS.paintFormXObjectEnd, []]]), OPS).formTextOutsideClip).toBe(false);
    expect(walkPageOps(ops([...form(50, 600), ...show(300, 20), [OPS.paintFormXObjectEnd, []]]), OPS).formTextOutsideClip).toBe(true);
    // Page text is never "outside" — there is no form clip.
    expect(walkPageOps(ops(show(900, 900)), OPS).formTextOutsideClip).toBe(false);
  });

  it('ignores text inside an annotation appearance', () => {
    expect(walkPageOps(ops([
      [OPS.beginAnnotation, ['a', [0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0]]],
      ...form(50, 600), ...show(300, 20), [OPS.paintFormXObjectEnd, []], [OPS.endAnnotation, []],
    ]), OPS).formTextOutsideClip).toBe(false);
  });

  it('records the clip at each of OUR tags, per occurrence, and nothing without the option', () => {
    const list = ops([
      ...form(50, 600), [OPS.beginMarkedContent, [{ name: T0 }]], [OPS.endMarkedContent, []], [OPS.paintFormXObjectEnd, []],
      [OPS.beginMarkedContent, [{ name: 'Span' }]], [OPS.endMarkedContent, []],
      ...form(200, 100), [OPS.beginMarkedContent, [{ name: T0 }]], [OPS.endMarkedContent, []], [OPS.paintFormXObjectEnd, []],
    ]);
    expect(walkPageOps(list, OPS).markedClips).toBeUndefined();
    const m = walkPageOps(list, OPS, undefined, { markPrefix: FORM_MARK_PREFIX }).markedClips;
    expect([...(m?.keys() ?? [])]).toEqual([T0]);
    expect(m?.get(T0)).toEqual([{ x0: 50, y0: 600, x1: 150, y1: 660 }, { x0: 200, y0: 100, x1: 300, y1: 160 }]);
  });

  it('skips our tags inside an annotation — getTextContent never reads those, so counting them would break the pairing', () => {
    const m = walkPageOps(ops([
      [OPS.beginAnnotation, ['a', [0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0]]],
      ...form(50, 600), [OPS.beginMarkedContent, [{ name: T0 }]], [OPS.endMarkedContent, []], [OPS.paintFormXObjectEnd, []],
      [OPS.endAnnotation, []],
    ]), OPS, undefined, { markPrefix: FORM_MARK_PREFIX }).markedClips;
    expect(m?.size).toBe(0);
  });
});
