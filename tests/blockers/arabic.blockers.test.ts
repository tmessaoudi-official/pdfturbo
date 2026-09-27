/**
 * Arabic DOCX-reorder blocker AR-1 — confirming test. See ./README.md.
 * Source research: research-2026-06-15-blockers/raw/arabic.md (removed from the repo — see ./README.md)
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
  // RTL-base line (the Arabic words carry more letters) with an embedded two-word Latin run.
  // Page left→right: "PDF"(40) "report"(90) | "جميل"(150) "بيت"(200) "اليوم"(250).
  // (Single-letter Arabic words until limits row 19, when the base direction moved from an item count to a letter
  // count: three one-letter words against "PDF report" is now, correctly, an English line.)
  it('orders an RTL line with an embedded Latin run without reversing the run', () => {
    const r = orderLineWords([
      w('PDF', 40, false),
      w('report', 90, false),
      w('جميل', 150, true),
      w('بيت', 200, true),
      w('اليوم', 250, true),
    ]);
    expect(r.rtl).toBe(true);
    // RTL runs read right→left; the LTR run stays forward (PDF report).
    expect(r.words.map((x) => x.text)).toEqual(['اليوم', 'بيت', 'جميل', 'PDF', 'report']);
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
