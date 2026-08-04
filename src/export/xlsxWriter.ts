/**
 * Minimal XLSX writer for extracted tables (#56b). Pure → jsdom-testable.
 *
 * NO NEW DEPENDENCY: XLSX is OPC — the same ZIP-of-XML-parts container as DOCX — and this repo already
 * writes OPC zips with fflate's `zipSync` in `src/docx/opcEdit.ts`. So a spreadsheet writer is a few
 * hundred bytes of XML templating rather than a multi-hundred-KB library.
 *
 * TWO DECISIONS WORTH KNOWING, both differences from the CSV writer:
 *
 * 1. **The CSV formula-injection guard must NOT be reused here.** `tableExtract.csvField` prefixes a
 *    value starting with `= + - @` with an apostrophe, because a CSV cell is parsed by the spreadsheet
 *    and could become a formula. In XLSX a formula is a distinct `<f>` element; a cell written as
 *    `t="inlineStr"` is text by construction and can never be evaluated. Copying the guard across
 *    would corrupt data — a cell legitimately reading "-5" would gain a visible apostrophe — while
 *    protecting against nothing.
 * 2. **Numeric cells are written as real numbers**, which is the entire point of XLSX over CSV: a text
 *    "9.99" cannot be summed. The test is EXACT ROUND-TRIP (`String(Number(v)) === v`), so "9.99" and
 *    "-5" become numbers while "007", "1,200", "+33 1 23" and "1e5" stay text. That deliberately
 *    preserves a leading zero, which a naive `parseFloat` would silently destroy in an account or
 *    invoice number.
 */
import type { TableGrid } from '../utils/tableExtract';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Escape the five XML predefined entities. Cell text comes from an arbitrary opened PDF. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 0-based column index → spreadsheet column letters (0→A, 25→Z, 26→AA). */
export function colLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Whether a cell should be written as a NUMBER rather than text.
 *
 * The comparison ignores INSIGNIFICANT trailing zeros in the fraction, and that detail is the whole
 * point. A strict `String(Number(v)) === v` looks right and is wrong on real data: it accepts "9.99"
 * but rejects "24.50" and "5.00", so a currency column comes out with some cells numeric and some
 * textual and the column cannot be summed. Found by exporting an actual invoice-shaped table and
 * reading the sheet XML — every unit test passed, because the fixture happened to use "9.99".
 *
 * Canonicalising instead of loosening keeps three protections that matter, all as a side effect of one
 * comparison rather than a list of special cases:
 *   "007"                  → stays TEXT (leading zero is significant in an account/invoice number)
 *   "12345678901234567890" → stays TEXT (would silently lose precision as an IEEE double)
 *   "1,200" / "1e5"        → stay TEXT (thousands separator / exponent notation are not plain numerals)
 */
export function isNumericCell(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const n = Number(v);
  if (!Number.isFinite(n)) return false;
  // A trailing decimal point is a numeral to JS ("1." === 1) but in a TABLE it is far more likely an
  // ordinal list marker, and converting it would silently drop the period from the cell's text.
  if (v.endsWith('.')) return false;
  const canonical = v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
  return String(n) === canonical;
}

function cellXml(value: string, ref: string): string {
  if (!value) return '';
  if (isNumericCell(value)) return `<c r="${ref}"><v>${value.trim()}</v></c>`;
  // xml:space="preserve" so a cell of "  " or one with meaningful edge spacing is not silently
  // collapsed by a conforming reader.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function sheetXml(grid: TableGrid): string {
  const rows = grid.cells.map((row, r) => {
    const cells = row.map((v, c) => cellXml(v, `${colLetter(c)}${r + 1}`)).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${MAIN_NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * Build the bytes of a single-sheet .xlsx workbook from an extracted table grid.
 * `zipSync` is dynamically imported by the caller's chunk, so fflate stays out of the initial bundle.
 */
export async function buildXlsxBytes(grid: TableGrid, sheetName = 'Table'): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  // Excel rejects a sheet name containing : \ / ? * [ ] or longer than 31 chars.
  const safeName = xmlEscape(sheetName.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Table');

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="${CT_NS}">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet"/>`
      + `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="${PKG_REL_NS}">`
      + `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`
      + `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets>`
      + `</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="${PKG_REL_NS}">`
      + `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>`
      + `</Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(grid)),
  };

  return zipSync(files);
}
