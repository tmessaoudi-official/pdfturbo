/**
 * PERSISTENCE / SERIALIZATION ROUND-TRIP COMPLETENESS — every element, every field.
 *
 * Written 2026-08-28 as a standing guard for a defect class this repo keeps courting rather than
 * for a defect it had: the § Gotchas entries repeatedly add an OPTIONAL field to an element "with
 * no SCHEMA_VERSION bump", and each one silently depends on three separate places staying in step.
 * The audit that produced this file found the inventories already balanced — 108 toJSON slots
 * against 108 read by the factory, delta 0 — so this pins that state instead of fixing a break.
 *
 * It is not a vacuous pass: the probe was sabotaged six ways (deleting charSpacing, baselineShift,
 * list, linkUrl, backgroundColor and lineHeight from the payload — exactly what a fromJSON that
 * forgot to read one produces) and detected all six.
 *
 * Thesis under test: fields added to element classes "with no SCHEMA_VERSION bump"
 * must be (a) written by toJSON(), (b) read back by ElementFactory.fromJSON(), and
 * (c) survive an IndexedDB save/restore cycle. A field written but never read back
 * is silent data loss ("my formatting disappeared after reload").
 *
 * Method: construct each element type with EVERY field set to a distinctive
 * non-default value, then compare fromJSON(toJSON(el)).toJSON() to el.toJSON().
 * JSON-to-JSON (not instance-to-instance) so methods / _nextId don't pollute it.
 *
 * The same toJSON -> fromJSON chain is used by THREE consumers:
 *   - sessionManager._flush -> saveState (IndexedDB autosave)
 *   - SnapshotCmd (undo/redo of text-edit checkpoints)
 *   - annotationService copy/paste (clipboard)
 * so one chain test covers all three.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';

import { TextElement } from '../../src/elements/textElement';
import { SignatureElement } from '../../src/elements/signatureElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import { ImageElement } from '../../src/elements/imageElement';
import { HighlightElement } from '../../src/elements/highlightElement';
import { CommentElement } from '../../src/elements/commentElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import { CodeElement } from '../../src/elements/codeElement';
import { ElementFactory } from '../../src/utils/elementFactory';
import type { PDFElement } from '../../src/elements/annotationElement';

import { saveState, loadState, clearState, type SavedState } from '../../src/infra/storage';
import { InkLayer } from '../../src/infra/inkLayer';

/** fromJSON(toJSON(el)) and hand back BOTH JSON payloads for comparison. */
function roundTrip(el: PDFElement): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before = el.toJSON() as unknown as Record<string, unknown>;
  const revived = ElementFactory.fromJSON({ ...before });
  expect(revived, 'fromJSON returned null — type not handled').not.toBeNull();
  const after = (revived as PDFElement).toJSON() as unknown as Record<string, unknown>;
  return { before, after };
}

/** Enumerate own+inherited data keys actually present on the instance. */
function instanceFields(el: object): string[] {
  return Object.keys(el).sort();
}

describe('HUNT persist-1 — element toJSON -> fromJSON round trip (maximal field set)', () => {
  it('TextElement: every field set to a non-default value survives', () => {
    const el = new TextElement(11, 22, 'p1', {
      width: 333, height: 44,
      fontSize: 27, color: '#123456', fontFamily: 'Courier New',
      bold: true, italic: true, underline: true, strikethrough: true,
      align: 'justify', multiline: false,
      backgroundColor: '#abcdef', lineHeight: 2.5, opacity: 0.42,
      strokeWidth: 1.5, charSpacing: 3.25, horizontalScale: 175,
      baselineShift: 'sub', direction: 'rtl', list: 'ordered',
      linkUrl: 'https://example.com/x',
    });
    el.text = 'hello\nworld';
    el.rotation = 37;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
    // and the fields are actually present (not all-undefined on both sides)
    expect(Object.keys(before).sort()).toEqual([
      'align', 'backgroundColor', 'baselineShift', 'bold', 'charSpacing', 'color',
      'direction', 'fontFamily', 'fontSize', 'height', 'horizontalScale', 'id',
      'italic', 'lineHeight', 'linkUrl', 'list', 'multiline', 'opacity', 'pageId',
      'rotation', 'strikethrough', 'strokeWidth', 'text', 'type', 'underline',
      'width', 'x', 'y',
    ]);
  });

  it('TextElement: FALSY / zero values survive (the coercion trap)', () => {
    const el = new TextElement(0, 0, 'p1', {
      width: 1, height: 1,
      fontSize: 1, color: '#000000', fontFamily: 'Arial',
      bold: false, italic: false, underline: false, strikethrough: false,
      align: 'left', multiline: false,
      backgroundColor: '#000000', lineHeight: 1, opacity: 0,
      strokeWidth: 0, charSpacing: 0, horizontalScale: 50,
      baselineShift: 'super', direction: 'ltr', list: 'bullet', linkUrl: 'mailto:a@b.c',
    });
    el.text = '';
    el.rotation = 0;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
    expect(after['opacity']).toBe(0);
    expect(after['strokeWidth']).toBe(0);
    expect(after['charSpacing']).toBe(0);
    expect(after['multiline']).toBe(false);
  });

  it('TextElement: negative rotation survives', () => {
    const el = new TextElement(5, 5, 'p1');
    el.rotation = -90;
    const { after } = roundTrip(el);
    expect(after['rotation']).toBe(-90);
  });

  it('SignatureElement: data + full caption survives', () => {
    const el = new SignatureElement(3, 4, 'p2', 'data:image/png;base64,AAAA', {
      width: 210, height: 90, signer: 'Alice Martin',
      mention: 'Lu et approuve', signedDate: '2026-08-28',
    });
    el.rotation = 15;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
  });

  it('ShapeElement: every field, incl. freehand points and zero coords', () => {
    const el = new ShapeElement('freehand', 0, 0, 120, 80, 'p3', {
      strokeColor: '#00ff00', fillColor: '#ff00ff', strokeWidth: 0,
      x1: 0, y1: 0, x2: 120, y2: 80,
      points: [{ x: 0, y: 0 }, { x: 5.5, y: 9.25 }],
    });
    el.rotation = 180;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
    expect(after['strokeWidth']).toBe(0);
    expect(after['points']).toEqual([{ x: 0, y: 0 }, { x: 5.5, y: 9.25 }]);
  });

  it('ShapeElement: fillColor left undefined stays undefined', () => {
    const el = new ShapeElement('rect', 1, 2, 3, 4, 'p3', { strokeColor: '#111111' });
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
    expect(after['fillColor']).toBeUndefined();
  });

  it('ImageElement: src survives', () => {
    const el = new ImageElement(7, 8, 100, 50, 'p4', 'data:image/png;base64,BBBB');
    el.rotation = 270;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
  });

  it('HighlightElement: color + opacity survive, incl. opacity 0', () => {
    const el = new HighlightElement(1, 2, 30, 12, 'p5', '#ff8800', 0);
    el.rotation = 90;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
    expect(after['opacity']).toBe(0);
  });

  it('CommentElement: color + text + explicit size survive', () => {
    const el = new CommentElement(2, 3, 'p6', { color: '#FFEE00', text: 'note text', width: 321, height: 123 });
    el.rotation = 45;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
  });

  it('RedactionElement: non-default colour survives', () => {
    const el = new RedactionElement(4, 5, 60, 20, 'p7', 'rgb(0,0,0)');
    el.rotation = 12;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
  });

  it('CodeElement: codeType/data/qrStyle/bwipOpts/cachedDataUrl + dims survive', () => {
    const el = new CodeElement(9, 10, 'p8',
      {
        codeType: 'qrcode',
        data: 'https://example.com',
        qrStyle: { dotsOptions: { color: '#101010', type: 'dots' } } as never,
        bwipOpts: { bcid: 'code128', scale: 3 } as never,
      },
      'data:image/png;base64,CCCC',
      { w: 256, h: 257 },
    );
    el.rotation = 5;
    const { before, after } = roundTrip(el);
    expect(after).toEqual(before);
  });

  it('INVENTORY: every instance data field of every element type appears in toJSON', () => {
    const specimens: Array<[string, PDFElement]> = [
      ['text', new TextElement(1, 1, 'p', { backgroundColor: '#fff', lineHeight: 1, opacity: 1, strokeWidth: 1, charSpacing: 1, horizontalScale: 100, baselineShift: 'sub', list: 'bullet', linkUrl: 'https://a.b' })],
      ['signature', new SignatureElement(1, 1, 'p', 'd', { signer: 's', mention: 'm', signedDate: '2026-01-01' })],
      ['shape', new ShapeElement('rect', 1, 1, 2, 2, 'p', { fillColor: '#000' })],
      ['image', new ImageElement(1, 1, 2, 2, 'p', 'src')],
      ['highlight', new HighlightElement(1, 1, 2, 2, 'p')],
      ['comment', new CommentElement(1, 1, 'p')],
      ['redaction', new RedactionElement(1, 1, 2, 2, 'p')],
      ['code', new CodeElement(1, 1, 'p', { codeType: 'qrcode', data: 'd' }, 'u')],
    ];
    // Documented-intentional omissions (CLAUDE.md: "toJSON omits when unset/default",
    // and fromJSON re-supplies the identical default) — NOT data loss.
    const INTENTIONAL_OMISSIONS = new Set([
      'text.direction', // omitted when === 'auto'; fromJSON defaults to 'auto'
    ]);
    const missing: string[] = [];
    for (const [name, el] of specimens) {
      const jsonKeys = new Set(Object.keys(el.toJSON()));
      for (const f of instanceFields(el)) {
        const key = `${name}.${f}`;
        if (!jsonKeys.has(f) && !INTENTIONAL_OMISSIONS.has(key)) missing.push(key);
      }
    }
    // eslint-disable-next-line no-console
    console.log('FIELDS PRESENT ON INSTANCE BUT ABSENT FROM toJSON (excl. intentional):', JSON.stringify(missing));
    expect(missing).toEqual([]);
  });

  it('the omitted text.direction still round-trips to the same value', () => {
    const el = new TextElement(1, 1, 'p');
    expect(el.direction).toBe('auto');
    expect(Object.keys(el.toJSON())).not.toContain('direction');
    const revived = ElementFactory.fromJSON({ ...el.toJSON() }) as TextElement;
    expect(revived.direction).toBe('auto'); // default re-supplied → no loss
  });
});

/**
 * CONTROL — proves the probe above is NOT vacuous.
 *
 * A "no findings" result is only meaningful if the method can detect a break at
 * all. Here the chain is deliberately sabotaged (a field is dropped from the JSON
 * payload between toJSON and fromJSON, exactly as a fromJSON that forgot to read
 * it would behave) and the same comparison MUST go red.
 */
describe('HUNT persist-1 — CONTROL: the round-trip probe detects a simulated break', () => {
  const SABOTAGE = ['charSpacing', 'baselineShift', 'list', 'linkUrl', 'backgroundColor', 'lineHeight'] as const;

  for (const field of SABOTAGE) {
    it(`detects a dropped "${field}"`, () => {
      const el = new TextElement(1, 1, 'p', {
        backgroundColor: '#abcdef', lineHeight: 2.5, charSpacing: 3.25,
        baselineShift: 'sub', list: 'ordered', linkUrl: 'https://example.com/x',
      });
      const before = el.toJSON() as unknown as Record<string, unknown>;
      const damaged = { ...before };
      delete damaged[field];                       // simulate "fromJSON never reads it"
      const revived = ElementFactory.fromJSON(damaged) as PDFElement;
      const after = revived.toJSON() as unknown as Record<string, unknown>;
      expect(after).not.toEqual(before);           // the probe WOULD have caught it
      expect(after[field]).toBeUndefined();
    });
  }
});

describe('HUNT persist-1 — full SavedState through a real IndexedDB cycle', () => {
  it('elements, page rotation/crop/blank dims, watermark.density, bates, ink, formValues all survive', async () => {
    await clearState();

    const text = new TextElement(11, 22, 'pg1', {
      width: 333, height: 44, fontSize: 27, color: '#123456', fontFamily: 'Courier New',
      bold: true, italic: true, underline: true, strikethrough: true, align: 'justify',
      multiline: false, backgroundColor: '#abcdef', lineHeight: 2.5, opacity: 0.42,
      strokeWidth: 1.5, charSpacing: 3.25, horizontalScale: 175, baselineShift: 'sub',
      direction: 'rtl', list: 'ordered', linkUrl: 'https://example.com/x',
    });
    text.text = 'persisted';
    text.rotation = 37;

    const shape = new ShapeElement('freehand', 0, 0, 10, 10, 'pg1', {
      strokeColor: '#00ff00', fillColor: '#ff00ff', strokeWidth: 0,
      points: [{ x: 1, y: 2 }],
    });

    const ink = new InkLayer();
    ink.addStroke('pg1', { type: 'ink', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], width: 2, color: '#f00', fillColor: '#0f0' });
    ink.addStroke('pg1', { type: 'erase', points: [{ x: 0, y: 0 }], width: 9, color: '#000' });

    const state: SavedState = {
      elements: [text.toJSON(), shape.toJSON()],
      pages: [
        { id: 'pg1', sourcePdfId: 'src1', sourcePageNum: 1, rotation: 270, crop: { x: 5, y: 6, width: 100, height: 200 } },
        { id: 'pg2', sourcePdfId: 'blank', sourcePageNum: 0, blankWidth: 595, blankHeight: 842 },
      ],
      watermark: { enabled: true, text: 'WM', opacity: 0.25, angle: -45, color: '#888888', fontSize: 60, density: 4.5 },
      bates: { enabled: true, mode: 'bates', prefix: 'ACME-', startNumber: 0, digits: 6, position: 'tl', fontSize: 11, color: '#555555' },
      currentPageIndex: 1,
      sourcePdfs: [{ id: 'src1', name: 'a.pdf', bytes: new Uint8Array([1, 2, 3, 4]) }],
      formValues: { pg1: { f1: 'v1', f2: '' } },
      inkData: ink.toJSON(),
    };

    await saveState(state);
    const back = await loadState();
    expect(back).not.toBeNull();
    const got = back as SavedState;

    // page-level fields
    expect(got.pages).toEqual(state.pages);
    expect(got.pages[0].rotation).toBe(270);
    expect(got.pages[0].crop).toEqual({ x: 5, y: 6, width: 100, height: 200 });
    expect(got.pages[1].blankWidth).toBe(595);
    // document-level settings
    expect(got.watermark).toEqual(state.watermark);
    expect(got.watermark.density).toBe(4.5);
    expect(got.bates).toEqual(state.bates);
    expect(got.bates?.startNumber).toBe(0);
    expect(got.currentPageIndex).toBe(1);
    // ink + form values
    expect(got.inkData).toEqual(state.inkData);
    expect(got.formValues).toEqual(state.formValues);
    // source bytes
    expect(Array.from(got.sourcePdfs[0].bytes)).toEqual([1, 2, 3, 4]);

    // elements: revive exactly the way restoreSession does
    const revived = (got.elements ?? [])
      .map(d => ElementFactory.fromJSON(d as Record<string, unknown>))
      .filter(Boolean) as PDFElement[];
    expect(revived.length).toBe(2);
    expect(revived[0].toJSON()).toEqual(text.toJSON());
    expect(revived[1].toJSON()).toEqual(shape.toJSON());
  });
});
