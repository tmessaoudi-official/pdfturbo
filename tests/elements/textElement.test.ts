import { describe, it, expect, beforeEach } from 'vitest';
import { TextElement } from '../../src/elements/textElement';
import { ElementFactory } from '../../src/utils/elementFactory';

describe('TextElement', () => {
  beforeEach(() => {
    // Reset DOM for each test
    document.body.innerHTML = '';
  });

  it('round-trips backgroundColor, lineHeight, opacity through toJSON/fromJSON', () => {
    const te = new TextElement(10, 20, 'page-1', {
      backgroundColor: '#ffff00', lineHeight: 1.8, opacity: 0.5,
    });
    te.text = 'hi';
    const json = te.toJSON();
    expect(json['backgroundColor']).toBe('#ffff00');
    expect(json['lineHeight']).toBe(1.8);
    expect(json['opacity']).toBe(0.5);

    const back = ElementFactory.fromJSON(json) as TextElement;
    expect(back.backgroundColor).toBe('#ffff00');
    expect(back.lineHeight).toBe(1.8);
    expect(back.opacity).toBe(0.5);
  });

  it('defaults the three new fields to undefined when unset (legacy blob)', () => {
    const te = new TextElement(0, 0, 'p');
    expect(te.backgroundColor).toBeUndefined();
    expect(te.lineHeight).toBeUndefined();
    expect(te.opacity).toBeUndefined();
  });

  it('applies backgroundColor and opacity to the rendered element div', () => {
    const te = new TextElement(0, 0, 'p', { backgroundColor: '#ff0000', opacity: 0.4 });
    const div = te.render(document.createElement('div'), { left: 0, top: 0 }, 1);
    expect(div.style.background).toContain('255'); // rgba(255,0,0,...)
    expect(div.style.opacity).toBe('0.4');
  });
});

describe('TextElement Slice-2 DOM preview', () => {
  it('applies stroke, char-spacing, horizontal-scale, justify, baseline shift to the input', () => {
    const el = new TextElement(0, 0, 'p1', {
      strokeColor: '#ff0000', strokeWidth: 1, charSpacing: 2,
      horizontalScale: 80, align: 'justify', baselineShift: 'super', fontSize: 20,
    });
    const input = document.createElement('textarea');
    el._applyInputFormatting(input, 1);
    expect(input.style.getPropertyValue('-webkit-text-stroke')).toContain('1px');
    expect(input.style.letterSpacing).toBe('2px');
    expect(input.style.transform).toContain('scaleX(0.8)');
    expect(input.style.textAlign).toBe('justify');
    // super → smaller font + raised
    expect(parseFloat(input.style.fontSize)).toBeCloseTo(20 * 0.65, 1);
  });
});

describe('TextElement Slice-2 fields', () => {
  it('omits new fields from toJSON when unset (no schema churn)', () => {
    const el = new TextElement(0, 0, 'p1', { });
    const json = el.toJSON();
    expect('strokeWidth' in json).toBe(false);
    expect('charSpacing' in json).toBe(false);
    expect('horizontalScale' in json).toBe(false);
    expect('baselineShift' in json).toBe(false);
  });

  it('round-trips set fields through toJSON + factory', () => {
    const el = new TextElement(0, 0, 'p1', {
      strokeColor: '#ff0000', strokeWidth: 1.5, charSpacing: 2,
      horizontalScale: 80, baselineShift: 'super', align: 'justify',
    });
    const round = ElementFactory.fromJSON(el.toJSON()) as TextElement;
    expect(round.strokeColor).toBe('#ff0000');
    expect(round.strokeWidth).toBe(1.5);
    expect(round.charSpacing).toBe(2);
    expect(round.horizontalScale).toBe(80);
    expect(round.baselineShift).toBe('super');
    expect(round.align).toBe('justify');
  });

  it('legacy blob (no new fields) restores with defaults', () => {
    const legacy = new TextElement(0, 0, 'p1').toJSON();
    const round = ElementFactory.fromJSON(legacy) as TextElement;
    expect(round.strokeWidth).toBeUndefined();
    expect(round.horizontalScale).toBeUndefined();
    expect(round.align).toBe('left');
  });
});
