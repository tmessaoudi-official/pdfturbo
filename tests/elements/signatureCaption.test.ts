/**
 * F-D D1 — SignatureElement approval caption (signer / mention / date): gating,
 * caption lines, JSON round-trip, and the no-caption regression (plain signatures
 * serialize exactly as before).
 */
import { describe, it, expect } from 'vitest';
import { SignatureElement } from '../../src/elements/signatureElement';
import { ElementFactory } from '../../src/utils/elementFactory';

const DATA = 'data:image/png;base64,abc123';

describe('SignatureElement caption (F-D D1)', () => {
  it('hasCaption is false for a plain signature', () => {
    const el = new SignatureElement(0, 0, 'p1', DATA);
    expect(el.hasCaption()).toBe(false);
    expect(el.captionLines()).toEqual([]);
  });

  it('hasCaption true when any field is set; captionLines composes mention + who/date', () => {
    const el = new SignatureElement(0, 0, 'p1', DATA, {
      signer: 'Alice Martin', mention: 'Lu et approuvé', signedDate: '2026-06-18',
    });
    expect(el.hasCaption()).toBe(true);
    expect(el.captionLines()).toEqual(['Lu et approuvé', 'Alice Martin — 2026-06-18']);
  });

  it('captionLines drops empty parts (mention only)', () => {
    const el = new SignatureElement(0, 0, 'p1', DATA, { mention: 'Lu et approuvé' });
    expect(el.captionLines()).toEqual(['Lu et approuvé']);
  });

  it('captionLines joins signer + date with an em-dash when both present, signer-only otherwise', () => {
    expect(new SignatureElement(0, 0, 'p1', DATA, { signer: 'Bob' }).captionLines()).toEqual(['Bob']);
    expect(new SignatureElement(0, 0, 'p1', DATA, { signedDate: '2026-06-18' }).captionLines())
      .toEqual(['2026-06-18']);
  });

  it('toJSON omits caption keys when unset (no regression for plain signatures)', () => {
    const json = new SignatureElement(0, 0, 'p1', DATA).toJSON();
    expect(json['signer']).toBeUndefined();
    expect(json['mention']).toBeUndefined();
    expect(json['signedDate']).toBeUndefined();
    expect(json['data']).toBe(DATA);
  });

  it('toJSON includes caption keys when set', () => {
    const json = new SignatureElement(0, 0, 'p1', DATA, {
      signer: 'Alice', mention: 'Lu et approuvé', signedDate: '2026-06-18',
    }).toJSON();
    expect(json['signer']).toBe('Alice');
    expect(json['mention']).toBe('Lu et approuvé');
    expect(json['signedDate']).toBe('2026-06-18');
  });
});

describe('ElementFactory.fromJSON — signature caption round-trip (F-D D1)', () => {
  it('restores signer / mention / signedDate', () => {
    const el = ElementFactory.fromJSON({
      id: 9, type: 'signature', x: 50, y: 100, width: 200, height: 80, pageId: 'p2',
      data: DATA, signer: 'Alice Martin', mention: 'Lu et approuvé', signedDate: '2026-06-18',
    }) as SignatureElement;
    expect(el.hasCaption()).toBe(true);
    expect(el.captionLines()).toEqual(['Lu et approuvé', 'Alice Martin — 2026-06-18']);
  });

  it('a legacy blob without caption keys restores as a plain signature', () => {
    const el = ElementFactory.fromJSON({
      id: 9, type: 'signature', x: 0, y: 0, width: 200, height: 80, pageId: 'p2', data: DATA,
    }) as SignatureElement;
    expect(el.hasCaption()).toBe(false);
  });
});
