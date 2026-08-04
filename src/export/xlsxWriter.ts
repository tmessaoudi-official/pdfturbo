/**
 * Minimal XLSX writer for extracted tables (#56b). Pure → jsdom-testable.
 *
 * NO NEW *LIBRARY*: XLSX is OPC — the same ZIP-of-XML-parts container as DOCX — so this is a few
 * hundred bytes of XML templating over the `zipSync` already used by `src/docx/opcEdit.ts`, rather than
 * a multi-hundred-KB spreadsheet library. Note the wording: `fflate` itself became a DECLARED
 * production dependency in the same change, because it never was one. Its only provider was
 * `@vitest/ui` (a devDependency no npm script even references) while shipping in the production
 * bundle — so an fflate advisory would have been triaged as "devDependency-only" and dismissed, and
 * removing that unused devDep would have broken DOCX save at runtime.
 *
 * TWO DECISIONS WORTH KNOWING, both differences from the CSV writer:
 *
 * 1. **The CSV formula-injection guard must NOT be reused here.** `tableExtract.csvField` prefixes a
 *    value starting with `= + - @` with an apostrophe, because a CSV cell is parsed by the spreadsheet
 *    and could become a formula. In XLSX a formula is a distinct `<f>` element; a cell written as
 *    `t="inlineStr"` is text by construction and can never be evaluated. Copying the guard across
 *    would corrupt real data — the text-branch casualties are names and numbers like "-Dupont",
 *    "+33 1 23" and "@handle" — while protecting against nothing. (NOT "-5", which takes the numeric
 *    branch and never reaches the guard; that example was wrong in the first version of this comment.)
 * 2. **Numeric cells are written as real numbers**, which is the entire point of XLSX over CSV: a text
 *    "9.99" cannot be summed. The rule is NOT a plain exact round-trip — see `isNumericCell` below for
 *    what it actually is and for the two ways a naive version corrupts data. Do not restate the rule
 *    here; one specification per predicate, at the predicate.
 */
import type { TableGrid } from '../utils/tableExtract';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/**
 * Characters XML 1.0 forbids OUTRIGHT — they are illegal even when escaped as a numeric reference, so
 * a single one in a cell makes the sheet part not well-formed and the workbook is REFUSED rather than
 * degraded. Also strips lone surrogates, which cannot be encoded as valid UTF-8.
 *
 * This is reachable, not theoretical. pdf.js falls back to `IdentityToUnicodeMap` for a subset
 * CID/Identity-H font with no usable `/ToUnicode`, and that map is `String.fromCharCode(i)` — so text
 * items come back as literal U+0001, U+0002, … CLAUDE.md records both the artifact ("broken ToUnicode
 * (U+0002)") and a real-world file in exactly that configuration (a Word/LibreOffice invoice whose
 * every font is a CID subset without ToUnicode). Nothing upstream filters them either: the extractor's
 * `it.str.trim().length > 0` and the cell join's `.trim()` remove U+000B/U+000C but not U+0000–0008 or
 * U+000E–001F. And because the file is written BEFORE the success toast, the user would get a broken
 * workbook and be told it worked.
 */
// Built via RegExp from escape TEXT rather than a literal, so the source file itself contains no
// control characters (which is also what keeps oxlint's no-control-regex quiet without a suppression).
const XML_ILLEGAL = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]'
  + '|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]', 'g');

/** Escape the five XML predefined entities. Cell text comes from an arbitrary opened PDF. */
export function xmlEscape(s: string): string {
  return s
    .replace(XML_ILLEGAL, '')
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
 * TWO naive versions of this were shipped and both corrupted data, so the shape below is load-bearing:
 *
 *   a) A strict `String(Number(v)) === v` accepts "9.99" but rejects "24.50" and "5.00", so a currency
 *      column comes out part numeric and part text and cannot be summed. Every unit test passed it,
 *      because the fixture happened to use "9.99".
 *   b) Tolerating trailing zeros WITHOUT bounding the fraction then accepted "1.200" — twelve hundred
 *      in FR/DE/ES/IT — and emitted <v>1.200</v>, which readers parse as 1.2. That silently divides a
 *      French invoice's amounts by 1000, with a success toast, in an app that ships an `fr` locale.
 *      Strictly worse than the CSV path it was meant to improve on.
 *
 * What holds: exact numerals are numeric; trailing-zero tolerance applies ONLY to a 1–2 digit fraction
 * (the currency shape, never the thousands-group shape); everything ambiguous stays text with its exact
 * glyphs. Three protections fall out of that rather than needing special cases:
 *   "007"                  → TEXT (leading zero is significant in an account/invoice number)
 *   "12345678901234567890" → TEXT (would silently lose precision as an IEEE double)
 *   "1,200" / "1.200"      → TEXT (thousands separators, either convention)
 * and exponent notation is refused explicitly, because "1e+21" round-trips exactly while "1e5" does not
 * — an invariant that is only true because the code enforces it.
 */
export function isNumericCell(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const n = Number(v);
  if (!Number.isFinite(n)) return false;
  // A trailing decimal point is a numeral to JS ("1." === 1) but in a TABLE it is far more likely an
  // ordinal list marker, and converting it would silently drop the period from the cell's text.
  if (v.endsWith('.')) return false;
  // Exponent notation is refused outright, so the invariant documented above actually holds: without
  // this, "1e+21" round-trips exactly and would be emitted as a number while "1e5" would not.
  if (/[eE]/.test(v)) return false;
  // An exact numeral has nothing to interpret.
  if (String(n) === v) return true;
  // THE THOUSANDS-SEPARATOR TRAP. Tolerating insignificant trailing zeros is what makes a currency
  // column numeric throughout, but it must be limited to a 1- OR 2-DIGIT fraction. In FR/DE/ES/IT
  // notation "1.200" means twelve hundred, and it canonicalises to "1.2" — so a blanket tolerance
  // emitted <v>1.200</v>, which every reader parses as 1.2, silently dividing a French invoice's
  // amounts by 1000 with a success toast. A bare string cannot disambiguate a 3-digit group, so this
  // refuses and keeps the exact glyphs as text rather than guessing.
  if (!/^-?\d+\.\d{1,2}$/.test(v)) return false;
  return String(n) === v.replace(/0+$/, '').replace(/\.$/, '');
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
  const safeName = xmlEscape(sheetName.replace(XML_ILLEGAL, '').replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Table');

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
