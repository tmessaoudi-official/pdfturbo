/**
 * DocModel → PDF renderer (#1d, Track B). The flow→PDF sibling of `flowDocWriters.ts`.
 *
 * Renders the DOCX editor's editable model (paragraphs + per-run bold/italic) to a
 * selectable-text PDF using @cantoo/pdf-lib Helvetica StandardFonts: run-level word-wrap,
 * pagination, per-run font selection. Zero new dependencies.
 *
 * Ceiling (matches the editor's own model limits): tables / images / styles / colors /
 * font faces / headers-footers / lists / alignment / doc page-size are NOT rendered.
 * Non-WinAnsi scripts (CJK / Arabic / emoji) are sanitized to '?' — StandardFonts encode
 * CP1252 only; font-embedding is the future path. High-fidelity raster export (docx-preview)
 * is the documented future Approach B.
 */

/** CP1252 high chars (the 0x80–0x9F slots) mapped to their Unicode codepoints. */
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True when pdf-lib's WinAnsi StandardFonts can encode this codepoint. */
function _isWinAnsi(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp);
}

/**
 * Replace every non-WinAnsi codepoint with '?'. Tab/newline/CR are preserved (the caller
 * tokenizes on whitespace). `replaced` is true iff any character was substituted.
 */
export function sanitizeWinAnsi(s: string): { text: string; replaced: boolean } {
  let out = '';
  let replaced = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || _isWinAnsi(cp)) {
      out += ch;
    } else {
      out += '?';
      replaced = true;
    }
  }
  return { text: out, replaced };
}
