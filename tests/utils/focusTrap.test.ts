// @vitest-environment jsdom
// trapFocus wraps Tab inside a dialog. Row 11 PC half (2026-11-16, 3C advisor): it filtered each control on its OWN
// computed display, so a control hidden through an ancestor still counted — in the ✍ dialog's full screen the first
// "focusable" became the hidden #sigLineWidth, so Tab from the last control went nowhere and Shift+Tab from the first
// left the dialog. Controls inside an `inert` or `hidden` ancestor are now skipped.
import { describe, it, expect, afterEach } from 'vitest';
import { trapFocus } from '../../src/utils/focusTrap';

afterEach(() => { document.body.replaceChildren(); });

function setup() {
  document.body.innerHTML =
    '<div id="c"><div id="blk" inert><button id="hiddenA">a</button></div><button id="b1">b1</button>' +
    '<div hidden><button id="hiddenP">p</button></div><button id="b2">b2</button>' +
    '<div id="blk2" inert><button id="hiddenZ">z</button></div></div>';
  const c = document.getElementById('c') as HTMLElement;
  const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const tab = (shift = false) => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    (document.activeElement as HTMLElement).dispatchEvent(e);
    return e.defaultPrevented;
  };
  return { c, $, tab };
}

describe('trapFocus — controls inside an inert or hidden ancestor (row 11 PC half)', () => {
  it('focuses the first control that is NOT inside an inert block', () => {
    const { c, $ } = setup();
    const release = trapFocus(c);
    expect(document.activeElement).toBe($('b1'));
    release();
  });

  it('Tab from the last real control wraps to the first real one; Shift+Tab from the first wraps to the last', () => {
    const { c, $, tab } = setup();
    const release = trapFocus(c, undefined, false);
    $('b2').focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe($('b1'));
    expect(tab(true)).toBe(true);
    expect(document.activeElement).toBe($('b2'));
    release();
  });

  it('the control: a Tab between two real controls is left to the browser', () => {
    const { c, $, tab } = setup();
    const release = trapFocus(c, undefined, false);
    $('b1').focus();
    expect(tab()).toBe(false);
    release();
  });
});
