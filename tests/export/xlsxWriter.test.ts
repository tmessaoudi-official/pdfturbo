/**
 * XLSX table export (#56b) — the pure writer.
 *
 * Unzips the produced workbook with fflate and asserts on the real sheet XML, rather than trusting
 * that a blob was produced. The two cases that matter most are the ones where XLSX must differ from
 * the CSV writer: numeric cells become real numbers, and the CSV formula-injection apostrophe must NOT
 * appear (an inline string is text by construction in XLSX, so the guard would only corrupt data).
 */
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildXlsxBytes, colLetter, isNumericCell, xmlEscape } from '../../src/export/xlsxWriter';
import type { TableGrid } from '../../src/utils/tableExtract';

const grid = (cells: string[][]): TableGrid => ({ rows: cells.length, cols: cells[0].length, cells });

async function sheetOf(g: TableGrid): Promise<string> {
  const files = unzipSync(await buildXlsxBytes(g));
  return strFromU8(files['xl/worksheets/sheet1.xml']);
}

describe('buildXlsxBytes — container', () => {
  it('produces every part a reader needs to open the workbook', async () => {
    const files = unzipSync(await buildXlsxBytes(grid([['a']])));
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('is a real ZIP (PK signature)', async () => {
    const bytes = await buildXlsxBytes(grid([['a']]));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('declares the worksheet content type and relationship', async () => {
    const files = unzipSync(await buildXlsxBytes(grid([['a']])));
    expect(strFromU8(files['[Content_Types].xml'])).toContain('spreadsheetml.worksheet');
    expect(strFromU8(files['xl/_rels/workbook.xml.rels'])).toContain('worksheets/sheet1.xml');
  });

  it('sanitises a sheet name Excel would reject', async () => {
    const files = unzipSync(await buildXlsxBytes(grid([['a']]), 'a/b:c*d[e]'));
    const wb = strFromU8(files['xl/workbook.xml']);
    expect(wb).toContain('name="a_b_c_d_e_"');
  });
});

describe('buildXlsxBytes — cells', () => {
  it('writes text cells as inline strings at the right references', async () => {
    const xml = await sheetOf(grid([['Item', 'Qty'], ['Widget', 'two']]));
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('r="A1" t="inlineStr"');
    expect(xml).toContain('<t xml:space="preserve">Item</t>');
    expect(xml).toContain('r="B2" t="inlineStr"');
    expect(xml).toContain('<t xml:space="preserve">two</t>');
  });

  it('writes NUMERIC cells as numbers, not text — the point of xlsx over csv', async () => {
    const xml = await sheetOf(grid([['9.99', '-5', '0']]));
    expect(xml).toContain('<c r="A1"><v>9.99</v></c>');
    expect(xml).toContain('<c r="B1"><v>-5</v></c>');
    expect(xml).toContain('<c r="C1"><v>0</v></c>');
    expect(xml).not.toContain('inlineStr');
  });

  it('keeps a leading-zero code as TEXT (a naive parseFloat would destroy it)', async () => {
    const xml = await sheetOf(grid([['007', '1,200', '1e5']]));
    expect(xml).not.toContain('<v>');
    expect(xml).toContain('<t xml:space="preserve">007</t>');
    expect(xml).toContain('<t xml:space="preserve">1,200</t>');
  });

  it('a CURRENCY column is numeric THROUGHOUT, trailing zeros included', async () => {
    // The case a live export caught and every earlier unit test missed: a strict
    // String(Number(v)) === v accepts "9.99" but rejects "24.50" and "5.00", so the column comes out
    // half numeric and half text and cannot be summed.
    const xml = await sheetOf(grid([['9.99'], ['24.50'], ['5.00'], ['0.50'], ['10.00']]));
    expect(xml).not.toContain('inlineStr');
    expect(xml).toContain('<c r="A2"><v>24.50</v></c>');
    expect(xml).toContain('<c r="A3"><v>5.00</v></c>');
  });

  it('a long digit string that would LOSE PRECISION stays text', async () => {
    const xml = await sheetOf(grid([['12345678901234567890']]));
    expect(xml).toContain('inlineStr');
    expect(xml).not.toContain('<v>');
  });

  it('does NOT apply the CSV apostrophe guard — inline strings cannot be formulas', async () => {
    const xml = await sheetOf(grid([['=1+1', '-Dupont', '@handle']]));
    // Text, escaped, and byte-for-byte what the PDF said — no injected apostrophe. (The real
    // text-branch casualties of porting the guard are names like "-Dupont" and "@handle"; "-5" would
    // never reach it, since it takes the numeric branch.)
    expect(xml).toContain('<t xml:space="preserve">=1+1</t>');
    expect(xml).toContain('<t xml:space="preserve">-Dupont</t>');
    expect(xml).toContain('<t xml:space="preserve">@handle</t>');
    expect(xml).not.toContain("'=1+1");
  });

  // ── the two data-corruption regressions the certification panel caught ─────────────────────────
  it('a EUROPEAN thousands value stays TEXT — it must not be silently divided by 1000', async () => {
    // "1.200" is twelve hundred in FR/DE/ES/IT. It canonicalises to "1.2", so tolerating trailing
    // zeros without bounding the fraction emitted <v>1.200</v>, which every reader parses as 1.2.
    // A bare string cannot disambiguate a 3-digit group, so the only safe answer is text.
    const xml = await sheetOf(grid([['1.200'], ['24.500'], ['1.000.000'], ['12.300']]));
    expect(xml).not.toContain('<v>');
    expect(xml).toContain('<t xml:space="preserve">1.200</t>');
    expect(xml).toContain('<t xml:space="preserve">24.500</t>');
  });

  it('an XML-ILLEGAL control character cannot make the workbook unopenable', async () => {
    // Reachable, not theoretical: pdf.js falls back to IdentityToUnicodeMap for a subset CID font with
    // no usable /ToUnicode, yielding literal U+0001/U+0002 text items that survive every upstream
    // trim() filter. One of them in a cell used to make sheet1.xml not well-formed — and the file is
    // written BEFORE the success toast, so the user got a broken workbook and was told it worked.
    const xml = await sheetOf(grid([['ACME\u0001 Ltd', 'a\u0000b', 'v\u000bt', 'x\u001fy']]));
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml).toContain('<t xml:space="preserve">ACME Ltd</t>');
    expect(xml).toContain('<t xml:space="preserve">ab</t>');
    // A legal control character (TAB) is NOT stripped — only the illegal ones.
    const tabbed = await sheetOf(grid([['a\tb']]));
    expect(tabbed).toContain('a\tb');
  });

  it('a hostile SHEET NAME cannot break workbook.xml either (same root cause)', async () => {
    const files = unzipSync(await buildXlsxBytes(grid([['a']]), 'bad\u0001name'));
    const wb = strFromU8(files['xl/workbook.xml']);
    const parsed = new DOMParser().parseFromString(wb, 'application/xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(wb).toContain('name="badname"');
  });

  it('escapes XML metacharacters in cell text', async () => {
    const xml = await sheetOf(grid([['a & b <c> "d"']]));
    expect(xml).toContain('a &amp; b &lt;c&gt; &quot;d&quot;');
  });

  it('omits empty cells rather than emitting hollow ones', async () => {
    const xml = await sheetOf(grid([['a', ''], ['', 'd']]));
    expect(xml).toContain('r="A1"');
    expect(xml).toContain('r="B2"');
    expect(xml).not.toContain('r="B1"');
    expect(xml).not.toContain('r="A2"');
  });
});

describe('helpers', () => {
  it('colLetter spans past Z', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
    expect(colLetter(51)).toBe('AZ');
    expect(colLetter(52)).toBe('BA');
  });

  it('isNumericCell: plain numerals only, insignificant trailing zeros allowed', () => {
    // Numeric: plain numerals, trailing fraction zeros included (currency).
    for (const v of ['0', '9.99', '-5', '1000', '24.50', '5.00', '0.50', '10.00', '1.50']) {
      expect(isNumericCell(v), v).toBe(true);
    }
    // Text: leading zeros, separators, exponents, precision loss, non-numbers.
    for (const v of ['', ' ', '007', '00.5', '1,200', '1e5', '=1+1', 'abc', 'NaN', 'Infinity',
      '12345678901234567890', '1.', '+5',
      // European thousands separators — a 3-digit group after the dot is ambiguous, so never numeric.
      '1.200', '24.500', '12.300', '1.000', '1.000.000',
      // Exponent notation is refused outright so the documented invariant actually holds.
      '1e+21', '1e-7', '1E5']) {
      expect(isNumericCell(v), v).toBe(false);
    }
  });

  it('xmlEscape covers all five predefined entities', () => {
    expect(xmlEscape(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});
