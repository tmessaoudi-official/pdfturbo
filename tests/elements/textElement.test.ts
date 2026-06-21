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
