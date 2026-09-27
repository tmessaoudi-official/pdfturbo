/**
 * Limits row 39 — the glyph-name table that reads an embedded simple font with no /ToUnicode.
 *
 * The table is GENERATED from @cantoo/pdf-lib's standard-fonts encodings; the first case re-derives it from the
 * package so a hand edit or a package change cannot drift it silently. WIN_ANSI_NAMES is PDF 32000 Annex D's
 * WinAnsiEncoding, which is not cp1252 — the deltas are pinned one by one.
 */
import { describe, it, expect } from 'vitest';
import { Encodings } from '@cantoo/pdf-lib/standard-fonts';
import { glyphNameToUnicode, GLYPH_NAME_TABLE, WIN_ANSI_NAMES } from '../../src/utils/glyphNames';

describe('glyph names (limits row 39)', () => {
  it('matches every name the WinAnsi and Symbol encodings of the package use', () => {
    const fromPackage: Record<string, number> = {};
    for (const enc of [Encodings.WinAnsi, Encodings.Symbol]) {
      for (const cp of enc.supportedCodePoints) {
        const { name } = enc.encodeUnicodeCodePoint(cp);
        if (!(name in fromPackage)) fromPackage[name] = cp;
      }
    }
    expect(GLYPH_NAME_TABLE).toEqual(fromPackage);
  });

  it.each([
    ['A', 'A'], ['zero', '0'], ['quoteright', '’'], ['alpha', 'α'], ['minus', '−'],
    ['one.tab', '1'], ['period.tab', '.'], ['f_f_i', 'ffi'], ['f_i', 'fi'], ['fi', 'fi'], ['ffl', 'ffl'],
    ['dotlessi', 'ı'], ['Lslash', 'Ł'], ['caron', 'ˇ'], ['Ydieresis', 'Ÿ'],
    ['uni0041', 'A'], ['uni00410042', 'AB'], ['u1F600', '\u{1f600}'],
  ])('%s reads as %j', (name, text) => {
    expect(glyphNameToUnicode(name)).toBe(text);
  });

  it.each(['.notdef', '', 'a39', 'uniD800', 'u110000', 'f_a39', 'bogus', 'uni004'])('%j is unknown', (name) => {
    expect(glyphNameToUnicode(name)).toBeNull();
  });

  it('is WinAnsiEncoding by code, not cp1252', () => {
    expect(WIN_ANSI_NAMES).toHaveLength(256);
    expect(WIN_ANSI_NAMES[0x41]).toBe('A');
    expect(WIN_ANSI_NAMES[0x80]).toBe('Euro');
    expect(WIN_ANSI_NAMES[0x95]).toBe('bullet');
    expect(WIN_ANSI_NAMES[0xa0]).toBe('space');
    expect(WIN_ANSI_NAMES[0xad]).toBe('hyphen');
    for (const undefinedCode of [0x7f, 0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(WIN_ANSI_NAMES[undefinedCode]).toBe('');
    for (let c = 0; c < 0x20; c++) expect(WIN_ANSI_NAMES[c]).toBe('');
  });
});
