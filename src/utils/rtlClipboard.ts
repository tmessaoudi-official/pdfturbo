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
 * cluster into rows, infer spaces from x-gaps, then per row emit logical order by
 * READING POSITION — RTL rows are read right-to-left (spans ordered by descending x),
 * each span NFKC-folded (presentation-form→base letter), LTR rows left-to-right. It
 * NEVER reverses a span's internal chars: pdf.js emits single glyphs in visual position
 * order but a MULTI-char span in native (logical) order, so a blanket codepoint-reverse
 * scrambled multi-char spans ("السلام"→"السمال"). Position-ordering + NFKC fixes that
 * (the same rule `TextSearchHandler.buildLogicalLines` uses for Arabic find).
 *
 * Ceiling (documented partial): an embedded LTR run inside an RTL line whose glyphs are
 * split into multiple spans/tokens still ends up token-order-reversed, and neutral
 * brackets mirror — full UAX#9 char-level bidi is out of scope, same as the DOCX export.
 * Special shaped ligatures (e.g. "الله") whose own item text is reordered also remain a
 * partial.
 */
import { isArabicText } from './flowDoc';
import { logicalItemOrder } from './bidi';

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
    const byX = [...row].sort((a, b) => a.left - b.left); // visual L→R
    const rtlVotes = byX.reduce((n, s) => n + (isArabicText(s.text) ? 1 : 0), 0);
    const rtl = rtlVotes * 2 > byX.length;
    // Reading order comes from span POSITION (RTL → right-to-left), NEVER from reversing a
    // span's internal chars: pdf.js emits single glyphs in visual position order but a
    // MULTI-char span keeps its native (logical) char order (the trailing "لام" of "السلام"
    // is one logical-order span). A blanket reverse scrambled those ("السلام"→"السمال"); we
    // order spans by reading position and fold each NFKC-only.
    // Logical reading order at SPAN granularity (UAX#9 L2): RTL-span runs reversed,
    // embedded LTR-span runs kept forward, multi-char tokens never internally reversed.
    const order = rtl ? logicalItemOrder(byX, (s) => isArabicText(s.text)) : byX;
    let out = '';
    for (let i = 0; i < order.length; i++) {
      if (i > 0) {
        const a = order[i - 1];
        const b = order[i];
        const leftCell = a.left <= b.left ? a : b;
        const rightCell = a.left <= b.left ? b : a;
        if (rightCell.left - leftCell.right > medianW * 0.4) out += ' ';
      }
      out += order[i].text.normalize('NFKC');
    }
    return out;
  });

  return lines.join('\n');
}
