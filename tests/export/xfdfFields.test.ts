/**
 * Limits row 26 (D21) — form field values ↔ XFDF `<fields>`.
 *
 * The load-bearing case is the redaction one: an XFDF carries TEXT, so a field whose widget sits under a
 * redaction must not be exported — neither the value the user typed nor the value the PDF was filled with.
 * Each leak case has a CONTROL with the redaction moved off the widget, so a filter that dropped every field
 * could not pass.
 */
import { describe, it, expect } from 'vitest';
import { collectFormWidgets, fieldsForExport, fillsFromXfdf, widgetKind, type FormWidget } from '../../src/export/xfdfFields';
import type { DocumentPage } from '../../src/core/documentModel';
import type { PDFElement } from '../../src/elements/annotationElement';

const NAME = { subtype: 'Widget', fieldType: 'Tx', fieldName: 'name', fieldValue: 'Filled by PDF', rect: [100, 700, 300, 720] };
const AGREE = { subtype: 'Widget', fieldType: 'Btn', checkBox: true, fieldName: 'agree', fieldValue: 'Off', rect: [100, 600, 115, 615] };
const OPTS = { subtype: 'Widget', fieldType: 'Ch', multiSelect: true, fieldName: 'opts', fieldValue: ['a', 'c'], rect: [100, 500, 200, 560] };
const PUSH = { subtype: 'Widget', fieldType: 'Btn', pushButton: true, fieldName: 'go', rect: [0, 0, 10, 10] };
const LINK = { subtype: 'Link', rect: [0, 0, 10, 10] };

function sources(annots: unknown[], rotate = 0) {
  const page = {
    rotate,
    getAnnotations: () => Promise.resolve(annots),
    getViewport: () => ({ viewBox: [0, 0, 600, 800] }),
  };
  return new Map([['s1', { doc: { getPage: () => Promise.resolve(page) } }]]);
}
const PAGE = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as unknown as DocumentPage;
/** A redaction in DISPLAY space (top-left, y-down) over the `name` widget: user y 700..720 is display y 80..100. */
const OVER_NAME = { pageId: 'p1', type: 'redaction', x: 90, y: 70, width: 220, height: 40 } as unknown as PDFElement;
const ELSEWHERE = { pageId: 'p1', type: 'redaction', x: 400, y: 700, width: 50, height: 20 } as unknown as PDFElement;

const collect = (annots: unknown[], els: PDFElement[] = [], rotate = 0) =>
  collectFormWidgets([PAGE], sources(annots, rotate) as never, els);

describe('XFDF fields — which widgets are fields (row 26)', () => {
  it('keeps text, checkbox, radio, choice and list widgets; skips push buttons and non-widgets', () => {
    expect(widgetKind(NAME)).toBe('text');
    expect(widgetKind(AGREE)).toBe('checkbox');
    expect(widgetKind({ ...AGREE, checkBox: false, radioButton: true })).toBe('radio');
    expect(widgetKind(OPTS)).toBe('list');
    expect(widgetKind({ ...OPTS, multiSelect: false, combo: true })).toBe('choice');
    expect(widgetKind(PUSH)).toBeNull();
    expect(widgetKind(LINK)).toBeNull();
  });

  it('reads the PDF own values in the store string form (a checkbox Off is empty, a list is newline-joined)', async () => {
    const w = await collect([NAME, AGREE, OPTS, PUSH, LINK]);
    expect(w.map(x => [x.name, x.kind, x.sourceValue])).toEqual([
      ['name', 'text', 'Filled by PDF'], ['agree', 'checkbox', 'Off'], ['opts', 'list', 'a\nc'],
    ]);
  });
});

describe('XFDF fields — a field under a redaction is never exported (row 26)', () => {
  it('LEAK: a SOURCE-only value under a redaction is left out', async () => {
    const f = fieldsForExport(await collect([NAME], [OVER_NAME]), {});
    expect(JSON.stringify(f)).not.toContain('Filled by PDF');
    expect(f).toEqual([]);
  });

  it('LEAK: a value the USER typed under a redaction is left out too', async () => {
    const f = fieldsForExport(await collect([NAME], [OVER_NAME]), { s1: { name: 'Typed secret' } });
    expect(JSON.stringify(f)).not.toContain('Typed secret');
  });

  it('CONTROL: with the redaction elsewhere on the page both values export', async () => {
    const w = await collect([NAME], [ELSEWHERE]);
    expect(fieldsForExport(w, {})).toEqual([{ name: 'name', values: ['Filled by PDF'] }]);
    expect(fieldsForExport(w, { s1: { name: 'Typed secret' } })).toEqual([{ name: 'name', values: ['Typed secret'] }]);
  });

  it('LEAK: a field with ONE of its widgets redacted is dropped whole, even through a second, clear widget', async () => {
    const second = { ...NAME, rect: [100, 100, 300, 120] };
    expect(fieldsForExport(await collect([second, NAME], [OVER_NAME]), { s1: { name: 'Typed secret' } })).toEqual([]);
  });

  it('LEAK on a /Rotate 90 page: the redaction is tested in the rotated display frame', async () => {
    // At 90° display x = user y and display y = user x, so the `name` widget is displayed at x 700..720, y 100..300.
    const turned = { pageId: 'p1', type: 'redaction', x: 690, y: 90, width: 40, height: 220 } as unknown as PDFElement;
    expect(fieldsForExport(await collect([NAME], [turned], 90), {})).toEqual([]);
    // CONTROL: the same display rect on an UNROTATED page covers nothing of the widget.
    expect(fieldsForExport(await collect([NAME], [turned], 0), {})).toHaveLength(1);
  });
});

describe('XFDF fields — values out and in (row 26)', () => {
  const W = (name: string, kind: FormWidget['kind'], sourceValue = '', srcId = 's1'): FormWidget =>
    ({ srcId, name, kind, sourceValue, redacted: false });

  it('exports the user value over the source value, an unticked box as Off, and each selected option', () => {
    const f = fieldsForExport([W('name', 'text', 'src'), W('agree', 'checkbox', 'Yes'), W('opts', 'list', 'a')],
      { s1: { name: 'user', agree: '', opts: 'b\nc' } });
    expect(f).toEqual([{ name: 'name', values: ['user'] }, { name: 'agree', values: ['Off'] }, { name: 'opts', values: ['b', 'c'] }]);
  });

  it('leaves out a field neither side gave a value, and exports a name shared by two sources once (first wins)', () => {
    expect(fieldsForExport([W('blank', 'text')], {})).toEqual([]);
    expect(fieldsForExport([W('n', 'text', 'first'), W('n', 'text', 'second', 's2')], {})).toEqual([{ name: 'n', values: ['first'] }]);
  });

  it('imports into every source that has the field; Off unticks (stored empty); a list joins; unknown names are skipped', () => {
    const widgets = [W('agree', 'checkbox', '', 's1'), W('agree', 'checkbox', '', 's2'), W('opts', 'list'), W('name', 'text')];
    const { fills, skipped } = fillsFromXfdf([
      { name: 'agree', values: ['Off'] }, { name: 'opts', values: ['x', 'z'] }, { name: 'name', values: ['Ada'] },
      { name: 'nowhere', values: ['?'] },
    ], widgets);
    expect(fills).toEqual([
      { srcId: 's1', name: 'agree', value: '' }, { srcId: 's2', name: 'agree', value: '' },
      { srcId: 's1', name: 'opts', value: 'x\nz' }, { srcId: 's1', name: 'name', value: 'Ada' },
    ]);
    expect(skipped).toBe(1);
  });
});
