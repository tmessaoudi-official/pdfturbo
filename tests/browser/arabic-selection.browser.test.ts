/**
 * #6c (2026-06-17) — Arabic visual-selection HIGHLIGHT. pdf.js v6 emits Arabic
 * source as per-glyph spans whose DOM order is NOT monotonic in x, so a
 * drag-selection (rendered as the rects of the DOM range between two carets) shows
 * HOLES — selected glyphs interleaved with unselected ones. Measured live on a real
 * Arabic PDF: a 73-span line had 17/72 backward x-transitions, and a 15-glyph
 * contiguous DOM range left ~45% of its band as gaps.
 *
 * alignSpanOrderToVisual re-appends spans in visual (top, then left) order so a
 * DOM-contiguous range is visually contiguous. Live re-measure after the fix: line
 * became 72/0 monotonic and the 15-glyph range's gaps dropped 114px → 21px (natural
 * word spaces only). Real-browser only: the reorder reads getBoundingClientRect,
 * which jsdom does not lay out.
 */
import { describe, it, expect } from 'vitest';
import { alignSpanOrderToVisual } from '../../src/utils/textLayer';

function mkSpan(text: string, left: number, top: number): HTMLElement {
  const s = document.createElement('span');
  s.textContent = text;
  s.setAttribute('data-x', String(left));
  Object.assign(s.style, { position: 'absolute', left: `${left}px`, top: `${top}px` });
  return s;
}
function domXs(container: HTMLElement): number[] {
  return [...container.querySelectorAll('span')].map((s) => Number(s.getAttribute('data-x')));
}

describe('#6c — alignSpanOrderToVisual', () => {
  it('reorders an Arabic-dominant line into ascending visual-x DOM order', () => {
    const c = document.createElement('div');
    c.style.position = 'absolute';
    document.body.appendChild(c);
    // Arabic glyphs appended in scrambled DOM order on one line (top 50).
    const glyphs = ['م', 'ر', 'ح', 'ب', 'ا'];
    [40, 10, 30, 0, 20].forEach((x, i) => c.appendChild(mkSpan(glyphs[i], x, 50)));

    const changed = alignSpanOrderToVisual(c);

    expect(changed).toBe(true);
    expect(domXs(c)).toEqual([0, 10, 20, 30, 40]); // now visually contiguous → hole-free highlight
    document.body.removeChild(c);
  });

  it('groups by line (top) then orders by x within each line', () => {
    const c = document.createElement('div');
    c.style.position = 'absolute';
    document.body.appendChild(c);
    // Two lines (top 10 / top 60), scrambled & interleaved in DOM.
    c.appendChild(mkSpan('ا', 30, 10));
    c.appendChild(mkSpan('ب', 5, 60));
    c.appendChild(mkSpan('ت', 10, 10));
    c.appendChild(mkSpan('ث', 20, 60));

    alignSpanOrderToVisual(c);

    expect(domXs(c)).toEqual([10, 30, 5, 20]); // line top=10 (10,30) then line top=60 (5,20)
    document.body.removeChild(c);
  });

  it('leaves an LTR-dominant page untouched (no-op, preserves pdf.js column order)', () => {
    const c = document.createElement('div');
    c.style.position = 'absolute';
    document.body.appendChild(c);
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].forEach((t, i) =>
      c.appendChild(mkSpan(t, [40, 10, 30, 0, 20][i], 50)),
    );

    const changed = alignSpanOrderToVisual(c);

    expect(changed).toBe(false);
    expect(domXs(c)).toEqual([40, 10, 30, 0, 20]); // unchanged
    document.body.removeChild(c);
  });

  it('does nothing for a trivial (single-span) layer', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    c.appendChild(mkSpan('مرحبا', 10, 10));
    expect(alignSpanOrderToVisual(c)).toBe(false);
    document.body.removeChild(c);
  });
});
