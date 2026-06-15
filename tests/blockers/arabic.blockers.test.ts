/**
 * Arabic DOCX-reorder blocker AR-1 — confirming test. See ./README.md.
 * Source research: docs/reviews/research-2026-06-15-blockers/raw/arabic.md
 *
 * FIXED: orderLineWords now applies the UAX#9 L2 run-reversal at word level, so an
 * embedded LTR run (Latin word / number) inside an RTL line keeps its forward
 * order instead of being reversed by the old blanket descending-x sort.
 */
import { describe, it, expect } from 'vitest';
import { orderLineWords } from '../../src/utils/flowDoc';

type W = { text: string; x: number; width: number; rtl: boolean };
const w = (text: string, x: number, rtl: boolean): W => ({ text, x, width: 40, rtl });

describe('Arabic AR-1 — mixed RTL line keeps embedded LTR run forward', () => {
  // RTL-base line (3 Arabic words dominate) with an embedded two-word Latin run.
  // Page left→right: "PDF"(40) "report"(90) | "ج"(150) "ب"(200) "ا"(250).
  it('orders an RTL line with an embedded Latin run without reversing the run', () => {
    const r = orderLineWords([
      w('PDF', 40, false),
      w('report', 90, false),
      w('ج', 150, true),
      w('ب', 200, true),
      w('ا', 250, true),
    ]);
    expect(r.rtl).toBe(true);
    // RTL runs read right→left (ا ب ج); the LTR run stays forward (PDF report).
    expect(r.words.map((x) => x.text)).toEqual(['ا', 'ب', 'ج', 'PDF', 'report']);
  });

  it('preserves embedded Latin run order (the old descending-x sort reversed it)', () => {
    const r = orderLineWords([
      w('PDF', 40, false),
      w('report', 90, false),
      w('عربي', 150, true),
      w('نص', 200, true),
    ].concat([w('خط', 250, true)]));
    const latin = r.words.filter((x) => !x.rtl).map((x) => x.text);
    expect(latin).toEqual(['PDF', 'report']); // NOT ['report', 'PDF']
  });
});
