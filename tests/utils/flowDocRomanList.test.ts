/**
 * Batch-3 (e) — roman-numeral ordered-list markers.
 *
 * Roman is ambiguous with single letters: `(i)` could be letter-i or roman-1,
 * and bare-dot `i.` collides with author initials. We therefore only treat a
 * MULTI-character parenthesized roman numeral (`(ii)`, `(iv)`, `(III)`) as a
 * roman list — those are unambiguous. Single `(i)`/`(I)` stays a letter list
 * (the prior, honest behavior). docx gets lowerRoman / upperRoman LevelFormat.
 */
import { describe, it, expect } from 'vitest';
import { detectListPrefix } from '../../src/utils/flowDoc';

describe('detectListPrefix — roman numerals', () => {
  it('detects multi-char lower roman in (ii) form', () => {
    expect(detectListPrefix('(ii) second')).toEqual({
      type: 'ordered', stripped: 'second', format: 'lowerRoman', ordinalText: '(%1)',
    });
  });

  it('detects multi-char lower roman in ii) form', () => {
    expect(detectListPrefix('iv) fourth')).toEqual({
      type: 'ordered', stripped: 'fourth', format: 'lowerRoman', ordinalText: '%1)',
    });
  });

  it('detects multi-char UPPER roman in (III) form', () => {
    expect(detectListPrefix('(III) third')).toEqual({
      type: 'ordered', stripped: 'third', format: 'upperRoman', ordinalText: '(%1)',
    });
  });

  it('detects (xi) as roman', () => {
    expect(detectListPrefix('(xi) eleventh')?.format).toBe('lowerRoman');
  });

  it('leaves single-letter (i) as a LETTER list (ambiguous → not roman)', () => {
    expect(detectListPrefix('(i) item')?.format).toBe('lowerLetter');
  });

  it('leaves (a) as lowerLetter and (1) as decimal (unchanged)', () => {
    expect(detectListPrefix('(a) alpha')?.format).toBe('lowerLetter');
    expect(detectListPrefix('(1) one')?.format).toBe('decimal');
  });

  it('does not treat a non-roman paren letter pair like (ll) as roman', () => {
    // "ll" is not a valid roman numeral → falls through (no single-letter match
    // either, since it is 2 chars) → not a list.
    expect(detectListPrefix('(ll) nope')).toBeNull();
  });
});
