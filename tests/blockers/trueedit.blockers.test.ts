/**
 * True-edit engine blockers — confirming tests. See ./README.md for the convention.
 * Source research: docs/reviews/research-2026-06-15-blockers/raw/trueedit.md
 */
import { describe, it, expect } from 'vitest';
import { tokenizeContentStream, serializeTokens } from '../../src/utils/contentStreamEditor';

describe('True-edit blocker B-1 — number tokenizer drops exponent notation', () => {
  // REACHABLE. The number continuation class is [0-9.] and excludes e/E, so a
  // scientific-notation operand like `1e-3` (legal but non-conformant-ish PDF)
  // splits into `1`, `e`, `-3`. serializeTokens then rejoins with spaces, changing
  // the content-stream meaning (a stray `e` operator + two numbers).
  it.fails('parses `1e-3` as the value 0.001, not `1` + a bogus operator', () => {
    const tokens = tokenizeContentStream('1e-3');
    const numbers = tokens.filter((t) => t.type === 'number');
    // DESIRED: one number token worth 0.001. TODAY: number `1` + an `e-3` OPERATOR
    // token (the continuation class [0-9.] stops at `e`), so the exponent is lost.
    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.value).toBeCloseTo(0.001);
  });

  it.fails('round-trips `1e-3 0 0 1 0 0 Tm` without inserting a stray operator', () => {
    const round = serializeTokens(tokenizeContentStream('1e-3 0 0 1 0 0 Tm'));
    // DESIRED: the exponent survives as one operand. TODAY: `1 e -3 0 0 1 0 0 Tm`.
    expect(round.replace(/\s+/g, ' ').trim()).toBe('1e-3 0 0 1 0 0 Tm');
  });
});
