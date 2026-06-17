/**
 * #6 (2026-06-17) — correct Arabic text-layer COPY.
 *
 * pdf.js v6 builds the selection text layer as ONE span per glyph, positioned in
 * VISUAL (left-to-right) order, carrying Unicode PRESENTATION FORMS (pre-shaped
 * isolated/initial/medial/final glyphs), with NO space characters — word breaks
 * are x-gaps. So `getSelection().toString()` of an Arabic page yields pre-shaped
 * glyphs, visually ordered, unspaced: unsearchable, un-pasteable garbage.
 *
 * `reconstructLogicalText` rebuilds proper text from the selected spans' geometry:
 * cluster into rows, infer spaces from x-gaps, then per row emit logical order —
 * RTL rows are `reverseRtlText`'d (codepoint-reverse + NFKC: visual→logical and
 * presentation-form→base letter), LTR rows are NFKC-normalized as-is. This mirrors
 * the export's reconstruction (orderLineWords / reverseRtlText) at glyph-span level.
 *
 * Ceiling (documented partial): a single line mixing LTR+RTL is reversed as one RTL
 * run (the embedded Latin/number run ends up order-reversed) — full UAX#9 bidi at
 * char level is out of scope, same as the DOCX export.
 */
import { isArabicText, reverseRtlText } from './flowDoc';

export interface SpanGeom {
  text: string;
  left: number;
  right: number;
  top: number;
  height: number;
}

function _median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Reconstruct logical, spaced, base-letter text from glyph-span geometry (one
 * entry per selected text-layer span). Pure → jsdom-testable.
 */
export function reconstructLogicalText(spans: ReadonlyArray<SpanGeom>): string {
  const cells = spans.filter((s) => s.text.length > 0);
  if (!cells.length) return '';

  const medianH = _median(cells.map((s) => s.height).filter((h) => h > 0)) || 10;
  const medianW = _median(cells.map((s) => s.right - s.left).filter((w) => w > 0)) || medianH * 0.5;
  const rowTol = Math.max(3, medianH * 0.6);

  // Cluster into rows by vertical position (top), then read each row left→right.
  const byTop = [...cells].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: SpanGeom[][] = [];
  for (const cell of byTop) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].top - cell.top) <= rowTol) row.push(cell);
    else rows.push([cell]);
  }

  const lines = rows.map((row) => {
    const byX = [...row].sort((a, b) => a.left - b.left);
    const rtlVotes = byX.reduce((n, s) => n + (isArabicText(s.text) ? 1 : 0), 0);
    const rtl = rtlVotes * 2 > byX.length;
    let visual = '';
    for (let i = 0; i < byX.length; i++) {
      if (i > 0) {
        const gap = byX[i].left - byX[i - 1].right;
        if (gap > medianW * 0.4) visual += ' ';
      }
      visual += byX[i].text;
    }
    // RTL: visual order is the codepoint-reverse of logical → reverseRtlText restores
    // logical order AND folds presentation forms to base letters (NFKC). LTR: just NFKC.
    return rtl ? reverseRtlText(visual) : visual.normalize('NFKC');
  });

  return lines.join('\n');
}
