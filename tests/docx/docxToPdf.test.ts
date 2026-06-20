import { describe, it, expect } from 'vitest';
import { sanitizeWinAnsi } from '../../src/docx/docxToPdf';

describe('sanitizeWinAnsi', () => {
  it('passes ASCII and Latin-1/CP1252 through unchanged', () => {
    expect(sanitizeWinAnsi('Hello, café — €5 “quote”')).toEqual({
      text: 'Hello, café — €5 “quote”',
      replaced: false,
    });
  });

  it('replaces non-WinAnsi (CJK / emoji) with ? and flags it', () => {
    // for…of iterates by code point: 2 CJK → "??", emoji (surrogate pair) → one "?".
    const r = sanitizeWinAnsi('hi 世界 🚀');
    expect(r.text).toBe('hi ?? ?');
    expect(r.replaced).toBe(true);
  });

  it('keeps whitespace (tab/newline) intact and reports no replacement', () => {
    expect(sanitizeWinAnsi('a\tb\nc')).toEqual({ text: 'a\tb\nc', replaced: false });
  });
});
