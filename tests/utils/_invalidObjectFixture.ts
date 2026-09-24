import { zlibSync } from 'fflate';

/**
 * Hand-written PDF bytes carrying a MALFORMED indirect object. pdf-lib's dict parser throws on the
 * stray `}`, finds the following `endobj`, and keeps the object as an opaque `PDFInvalidObject` —
 * which no sanitizer walk can look inside. pdf.js's parser skips a non-Name dictionary key with an
 * `info()` and reads the rest, so the JavaScript action is LIVE for pdf.js.
 *
 * Built from a string on purpose: pdf-lib cannot write a malformed object, and a `ctx.obj` JS value
 * would be a Name, which pdf.js ignores (the round-9 probe trap). `/JS` is a literal string here.
 */
export function buildInvalidObjectPdf(opts: { reachable: boolean }): Uint8Array {
  // Reachable = listed in the page's /Annots AND in /AcroForm /Fields — the latter is what makes
  // pdf.js register the field's script (`hasJSActions()`); /Annots alone does not.
  const annots = opts.reachable ? ' /Annots [5 0 R]' : '';
  const acro = opts.reachable ? ' /AcroForm << /Fields [5 0 R] >>' : '';
  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${acro} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300]${annots} >>\nendobj\n`,
    '4 0 obj\n<< /Producer (fixture) >>\nendobj\n',
    '5 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Tx /T (f1) /Rect [10 10 110 40] } '
      + '/A << /S /JavaScript /JS (app.alert\\(1\\)) >> >>\nendobj\n',
  ];
  let body = '%PDF-1.7\n';
  const offs: number[] = [];
  for (const o of objs) { offs.push(body.length); body += o; }
  const xrefAt = body.length;
  body += `xref\n0 6\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`
    + `trailer\n<< /Size 6 /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1Bytes(body);
}

/** One byte per char. No `Buffer`, so the fixtures also run in the browser suite. */
export function latin1Bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
}

/**
 * Replaces exactly the first occurrence of `from`, and THROWS when it is absent: a mutation whose anchor
 * stopped matching would otherwise hand back the unmodified fixture and the case would test nothing.
 */
export function editPdfText(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.includes(from)) throw new Error(`fixture edit anchor not found: ${JSON.stringify(from)}`);
  return latin1Bytes(text.replace(from, to));
}

/**
 * A one-page PDF whose page annotation `8 0 R` lives inside an unfiltered object stream (object 10),
 * beside a harmless member 7 and a MALFORMED member 9. pdf-lib parses members in `order` and stops at
 * the first one that throws, so every member after 9 is never assigned. `noFirst` makes the stream's
 * constructor throw; `n` larger than the member count makes the member table itself fail to parse.
 */
export function buildObjStmPdf(
  order: number[],
  opts: { noFirst?: boolean; n?: number; members?: Record<number, string> } = {},
): Uint8Array {
  const members: Record<number, string> = {
    7: '<< /X 1 >>',
    8: '<< /Type /Annot /Subtype /Text /Rect [10 10 40 40] /Contents (KEEPNOTE) >>',
    9: '<< /Y } >>',
    ...opts.members,
  };
  let data = '';
  const pairs: string[] = [];
  for (const n of order) { pairs.push(`${n} ${data.length}`); data += `${members[n]}\n`; }
  const head = `${pairs.join(' ')}\n`;
  const stream = head + data;
  const first = opts.noFirst ? '' : ` /First ${head.length}`;
  const body = '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Annots [8 0 R] >>\nendobj\n'
    + `10 0 obj\n<< /Type /ObjStm /N ${opts.n ?? order.length}${first} /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    // Decorative, like the other builders: pdf-lib scans objects sequentially.
    + 'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 11 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
  return latin1Bytes(body);
}

/** PNG predictor rows (pdf.js `readBlockPng`, one byte per pixel), cycling the five row filters None/Sub/Up/Average/Paeth. */
function pngPredict(rows: number[][]): number[] {
  const paeth = (left: number, up: number, upLeft: number): number => {
    const p = left + up - upLeft;
    const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
    if (pa <= pb && pa <= pc) return left;
    return pb <= pc ? up : upLeft;
  };
  const out: number[] = [];
  rows.forEach((row, r) => {
    const prev = r > 0 ? rows[r - 1] : row.map(() => 0);
    const filter = r % 5;
    out.push(filter);
    row.forEach((raw, k) => {
      const left = k > 0 ? row[k - 1] : 0;
      const upLeft = k > 0 ? prev[k - 1] : 0;
      const guess = [0, left, prev[k], (left + prev[k]) >> 1, paeth(left, prev[k], upLeft)][filter];
      out.push((raw - guess) & 0xff);
    });
  });
  return out;
}

/** TIFF predictor 2 rows, 8 bits per component, one colour: each byte minus the one before it in the row. */
function tiffPredict(rows: number[][]): number[] {
  return rows.flatMap(row => row.map((raw, k) => (k > 0 ? (raw - row[k - 1]) & 0xff : raw)));
}

export type XrefShape =
  | 'clean' | 'dupFirst' | 'dupFirstLoose' | 'dupLast' | 'dupBadXref' | 'incremental' | 'incrementalStale' | 'dualTrailer'
  | 'junkRelative' | 'junkAbsolute' | 'xrefStreamDupFirst' | 'unreachableDupFirst' | 'identicalDupFirst'
  | 'identicalStreamDupFirst' | 'identicalFontDupFirst' | 'identicalPagesDupFirst' | 'dupFirstShifted' | 'cleanShifted'
  | 'xrefStreamPngDupFirst' | 'xrefStreamTiffDupFirst' | 'xrefStreamPngClean' | 'xrefStreamBadPredictorDupFirst'
  | 'xrefStreamBadTypeDupFirst';

/**
 * pdf.js reads a PDF through `startxref` and its cross-reference chain; pdf-lib scans objects in file
 * order and keeps the LAST definition of each object and the LAST trailer. These shapes make the two
 * agree or disagree about page 1 on purpose — the text pdf.js reaches first says VIEWED, a later copy
 * says SIGNED. Unlike the builders above, the xref here is REAL: every offset is measured, because the
 * cross-reference data is the subject.
 *  - `dupFirst` / `dupLast`: object 5 twice, the table naming the first / the last copy.
 *  - `dupFirstLoose`: `dupFirst` with the offset one byte early, on whitespace pdf.js reads past.
 *  - `dupBadXref`: the same duplicate with every offset wrong, so pdf.js rebuilds its table by scanning.
 *  - `incremental` / `incrementalStale`: a real appended update whose table names the new / the OLD copy.
 *  - `dualTrailer`: a second trailer whose /Root is a second page tree.
 *  - `junkRelative` / `junkAbsolute`: bytes before `%PDF-`, offsets counted from the header / from byte 0.
 *  - `xrefStreamDupFirst`: `dupFirst` with a cross-reference STREAM.
 *  - `xrefStreamPngDupFirst` / `xrefStreamTiffDupFirst` / `xrefStreamPngClean`: that stream Flate-compressed with a
 *    PNG (`/Predictor 12`, every row filter used) or TIFF (`/Predictor 2`) predictor — how Acrobat and most producers
 *    write one. pdf-lib inflates the stream and never applies the predictor.
 *  - `xrefStreamBadPredictorDupFirst`: unpredicted rows declaring `/Predictor 3`, which pdf.js cannot decode. The rows
 *    are valid as they stand, so a decoder that passed an unsupported predictor through would build the chain pdf.js
 *    never reads, and refuse.
 *  - `xrefStreamBadTypeDupFirst`: the plain stream with entry type 3 for object 5, which pdf.js rejects.
 *  - `unreachableDupFirst` / `identicalDupFirst`: the first-copy table on an unused object / on two nulls.
 *  - `identicalStreamDupFirst` / `identicalFontDupFirst` / `identicalPagesDupFirst`: the first-copy table on two
 *    BYTE-IDENTICAL copies of the content stream / the font / the page tree — two distinct pdf-lib objects, which
 *    two interned nulls are not.
 *  - `dupFirstShifted` / `cleanShifted`: `dupFirst` / `clean` with a table subsection numbered from 1 whose first
 *    row is the free object-0 row; pdf.js renumbers such a subsection from 0.
 */
export function buildXrefShapePdf(shape: XrefShape): Uint8Array {
  const content = (t: string): string => {
    const s = `BT /F1 24 Tf 20 200 Td (${t}) Tj ET`;
    return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  };
  const dup = ['dupFirst', 'dupFirstLoose', 'dupLast', 'dupBadXref', 'junkRelative', 'junkAbsolute', 'xrefStreamDupFirst', 'dupFirstShifted',
    'xrefStreamPngDupFirst', 'xrefStreamTiffDupFirst', 'xrefStreamBadPredictorDupFirst', 'xrefStreamBadTypeDupFirst'].includes(shape);
  const objs: Array<[number, string]> = [
    [1, `<< /Type /Catalog /Pages 2 0 R${shape === 'identicalDupFirst' ? ' /Extra 9 0 R' : ''} >>`],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, content('VIEWED')],
  ];
  if (dup) objs.push([5, content('SIGNED')]);
  if (shape === 'unreachableDupFirst') objs.push([9, '<< /A 1 >>'], [9, '<< /A 2 >>']);
  if (shape === 'identicalDupFirst') objs.push([9, 'null'], [9, 'null']);
  if (shape === 'identicalStreamDupFirst') objs.push([5, content('VIEWED')]);
  if (shape === 'identicalFontDupFirst') objs.push([4, objs[3][1]]);
  if (shape === 'identicalPagesDupFirst') objs.push([2, objs[1][1]]);
  if (shape === 'dualTrailer') {
    objs.push(
      [11, '<< /Type /Catalog /Pages 12 0 R >>'],
      [12, '<< /Type /Pages /Kids [13 0 R] /Count 1 >>'],
      [13, '<< /Type /Page /Parent 12 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 15 0 R >>'],
      [15, content('SIGNED')],
    );
  }
  const junk = shape.startsWith('junk') ? 'JUNK BEFORE THE HEADER\n' : '';
  // pdf.js counts offsets from `%PDF-`, not from byte 0; `junkAbsolute` deliberately counts from byte 0.
  const rel = shape === 'junkRelative' ? junk.length : 0;
  let body = `${junk}%PDF-1.7\n`;
  const at = new Map<number, number[]>();
  for (const [n, b] of objs) {
    at.set(n, [...(at.get(n) ?? []), body.length]);
    body += `${n} 0 obj\n${b}\nendobj\n`;
  }
  const size = Math.max(...objs.map(([n]) => n)) + 1;
  const offsetOf = (n: number): number | undefined => {
    const list = at.get(n);
    if (!list) return undefined;
    if (shape === 'dupBadXref') return 7;
    if (shape === 'dupFirstLoose' && n === 5) return list[0] - rel - 1; // on the newline pdf.js's lexer skips
    return (shape === 'dupLast' ? list[list.length - 1] : list[0]) - rel;
  };
  const pad = (v: number, w: number): string => String(v).padStart(w, '0');

  if (shape.startsWith('xrefStream')) {
    const xrefAt = body.length;
    // One row per object, laid out as /W [1 4 2] declares: type, offset, generation, big-endian.
    const rows: number[][] = [];
    for (let i = 0; i <= size; i++) {
      const o = i === size ? xrefAt : offsetOf(i);
      const gen = o === undefined && i === 0 ? 0xffff : 0;
      const v = o ?? 0;
      rows.push([o === undefined ? 0 : 1, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff, gen >>> 8, gen & 0xff]);
    }
    if (shape === 'xrefStreamBadTypeDupFirst') rows[5][0] = 3;
    const tiff = shape === 'xrefStreamTiffDupFirst';
    const badPredictor = shape === 'xrefStreamBadPredictorDupFirst';
    let data = String.fromCharCode(...rows.flat());
    let params = '';
    if (shape !== 'xrefStreamDupFirst' && shape !== 'xrefStreamBadTypeDupFirst') {
      data = String.fromCharCode(...zlibSync(Uint8Array.from(tiff ? tiffPredict(rows) : badPredictor ? rows.flat() : pngPredict(rows))));
      const predictor = tiff ? 2 : badPredictor ? 3 : 12;
      params = ` /Filter /FlateDecode /DecodeParms << /Predictor ${predictor} /Columns 7 >>`;
    }
    body += `${size} 0 obj\n<< /Type /XRef /Size ${size + 1} /W [1 4 2] /Root 1 0 R${params} /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`
      + `startxref\n${xrefAt}\n%%EOF\n`;
    return latin1Bytes(body);
  }

  const xrefAt = body.length;
  body += `xref\n${shape.endsWith('Shifted') ? 1 : 0} ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) {
    const o = offsetOf(i);
    body += o === undefined ? '0000000000 65535 f \n' : `${pad(o, 10)} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt - rel}\n%%EOF\n`;
  if (shape === 'incremental' || shape === 'incrementalStale') {
    const appended = body.length;
    body += `5 0 obj\n${content('SIGNED')}\nendobj\n`;
    const section = body.length;
    const five = shape === 'incremental' ? appended : (at.get(5) ?? [0])[0];
    body += `xref\n5 1\n${pad(five, 10)} 00000 n \ntrailer\n<< /Size ${size} /Root 1 0 R /Prev ${xrefAt} >>\n`
      + `startxref\n${section}\n%%EOF\n`;
  }
  if (shape === 'dualTrailer') body += `trailer\n<< /Size ${size} /Root 11 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1Bytes(body);
}

export type ViewerNullShape =
  | 'freeContents' | 'zeroContents' | 'absentContents' | 'freeContentsUpdate' | 'zeroContentsUpdate'
  | 'freeCatalog' | 'freePages' | 'freeNull' | 'infoDeletedUpdate' | 'rootRecovered' | 'rootRecoveredNoXref';

/**
 * Shapes where pdf.js resolves an object to NOTHING, or reads a different document root, while pdf-lib holds
 * content (WS7 round 14). pdf.js's `XRef.getEntry` returns null for an entry that is absent, free or at offset
 * 0 (pdfjs-dist 6.3.289), and pdf-lib ignores the table and keeps what it parsed. The table is REAL here too.
 *  - `freeContents` / `zeroContents` / `absentContents`: one revision, the page content marked free / placed at
 *    offset 0 / not listed at all. pdf.js draws a blank page; pdf-lib holds HIDDEN.
 *  - `freeContentsUpdate` / `zeroContentsUpdate`: an appended SIGNED copy whose update section marks the
 *    object free / places it at offset 0.
 *  - `freeCatalog` / `freePages`: the same for the catalog / the page tree. `XRef.parse` needs both to be
 *    dictionaries, so pdf.js rebuilds its table by scanning and both parsers read HIDDEN.
 *  - `freeNull`: the catalog reaches an object written as `null` that the table marks free. pdf.js finds nothing,
 *    pdf-lib holds `null`: the same value, so nothing differs.
 *  - `infoDeletedUpdate`: a legal update that deletes /Info; pdf-lib merges trailers field by field and keeps
 *    the older trailer's /Info.
 *  - `rootRecovered` / `rootRecoveredNoXref`: the trailer's /Root lacks /Type /Catalog, so pdf-lib's
 *    `maybeRecoverRoot` replaces it with another catalog in the file, while pdf.js uses the trailer's — with a
 *    real table / with `startxref 0`, which puts pdf.js in recovery mode.
 */
export function buildViewerNullPdf(shape: ViewerNullShape): Uint8Array {
  const content = (t: string): string => {
    const s = `BT /F1 24 Tf 20 200 Td (${t}) Tj ET`;
    return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  };
  const recovered = shape.startsWith('rootRecovered');
  const page = (parent: number, contents: number): string =>
    `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contents} 0 R >>`;
  const objs: Array<[number, string]> = [
    [1, recovered ? '<< /Pages 2 0 R >>' : `<< /Type /Catalog /Pages 2 0 R${shape === 'freeNull' ? ' /Extra 6 0 R' : ''} >>`],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, page(2, 5)],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, content(recovered ? 'VIEWED' : 'HIDDEN')],
  ];
  if (shape === 'infoDeletedUpdate') objs.push([6, '<< /Producer (older revision) >>']);
  if (shape === 'freeNull') objs.push([6, 'null']);
  if (recovered) {
    objs.push(
      [11, '<< /Type /Catalog /Pages 12 0 R >>'],
      [12, '<< /Type /Pages /Kids [13 0 R] /Count 1 >>'],
      [13, page(12, 15)],
      [15, content('SIGNED')],
    );
  }
  let body = '%PDF-1.7\n';
  const at = new Map<number, number>();
  for (const [n, b] of objs) {
    at.set(n, body.length);
    body += `${n} 0 obj\n${b}\nendobj\n`;
  }
  const pad = (v: number): string => String(v).padStart(10, '0');
  const size = Math.max(...objs.map(([n]) => n)) + 1;
  const freed = ({ freeContents: 5, freeCatalog: 1, freePages: 2, freeNull: 6 } as Partial<Record<ViewerNullShape, number>>)[shape];
  const row = (n: number): string => {
    const o = at.get(n);
    if (o === undefined) return '0000000000 65535 f \n';
    if (n === freed) return `${pad(o)} 00000 f \n`;
    if (shape === 'zeroContents' && n === 5) return '0000000000 00000 n \n';
    return `${pad(o)} 00000 n \n`;
  };
  const listed = shape === 'absentContents' ? 5 : size;
  const xrefAt = body.length;
  body += `xref\n0 ${listed}\n0000000000 65535 f \n`;
  for (let n = 1; n < listed; n++) body += row(n);
  const info = shape === 'infoDeletedUpdate' ? ' /Info 6 0 R' : '';
  body += `trailer\n<< /Size ${size} /Root 1 0 R${info} >>\nstartxref\n${shape === 'rootRecoveredNoXref' ? 0 : xrefAt}\n%%EOF\n`;
  if (shape === 'freeContentsUpdate' || shape === 'zeroContentsUpdate') {
    const appended = body.length;
    body += `5 0 obj\n${content('SIGNED')}\nendobj\n`;
    const section = body.length;
    const five = shape === 'freeContentsUpdate' ? `${pad(appended)} 00001 f \n` : '0000000000 00000 n \n';
    body += `xref\n5 1\n${five}trailer\n<< /Size ${size} /Root 1 0 R /Prev ${xrefAt} >>\nstartxref\n${section}\n%%EOF\n`;
  }
  if (shape === 'infoDeletedUpdate') {
    const section = body.length;
    body += `xref\n6 1\n0000000000 00001 f \ntrailer\n<< /Size ${size} /Root 1 0 R /Prev ${xrefAt} >>\nstartxref\n${section}\n%%EOF\n`;
  }
  return latin1Bytes(body);
}

const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const contentStream = (text: string): string => {
  const s = `BT /F1 24 Tf 20 200 Td (${text}) Tj ET`;
  return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
};
const pageDict = (parent: number, contents: number): string =>
  `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contents} 0 R >>`;
/** One cross-reference stream row as `/W [1 4 2]` lays it out: type, offset, generation, big-endian. */
const xrefRow = (type: number, offset: number): number[] =>
  [type, (offset >>> 24) & 0xff, (offset >>> 16) & 0xff, (offset >>> 8) & 0xff, offset & 0xff, 0, 0];

/** Writes objects in order and REAL cross-reference tables over the offsets it measured. */
class ObjectWriter {
  body = '%PDF-1.7\n';
  private readonly at = new Map<number, number[]>();
  add(num: number, value: string): void {
    this.at.set(num, [...(this.at.get(num) ?? []), this.body.length]);
    this.body += `${num} 0 obj\n${value}\nendobj\n`;
  }
  has(num: number): boolean { return this.at.has(num); }
  first(num: number): number { return (this.at.get(num) as number[])[0]; }
  last(num: number): number { return (this.at.get(num) as number[]).at(-1) as number; }
  /** Appends `xref` with one row per object in each [first, count] subsection; `offset` undefined writes a free row. */
  table(size: number, offset: (num: number) => number | undefined, subsections: Array<[number, number]> = [[0, size]]): number {
    const start = this.body.length;
    this.body += 'xref\n';
    for (const [from, count] of subsections) {
      this.body += `${from} ${count}\n`;
      for (let n = from; n < from + count; n++) {
        const o = n === 0 ? undefined : offset(n);
        this.body += o === undefined ? '0000000000 65535 f \n' : `${String(o).padStart(10, '0')} 00000 n \n`;
      }
    }
    return start;
  }
}

export type XrefPointerShape =
  | 'prevMid' | 'prevBeyondEof' | 'prevToContentStream' | 'prevToBadPredictorStream' | 'prevToBadTypeStream'
  | 'prevToTableNoTrailer' | 'prevValid' | 'prevMidPartial' | 'prevAsRefPartial' | 'hybridBadXRefStm' | 'hybridAbbreviatedStream'
  | 'prevToBadTypeStreamKeepsRow' | 'streamXRefStmIgnored';

/**
 * Cross-reference chains with a pointer pdf.js cannot follow (WS7 round 16). `XRef.readXRef` reads each queued section
 * inside a try/catch: a section it cannot read is skipped, keeping the rows it read before failing, and the queue goes
 * on — so the startxref table goes on naming the page pdf.js shows. After a TABLE it cannot finish no later table is
 * read at all (WS7 round 17, `buildXrefQueuePdf`); none of these shapes queues one. Measured in pdfjs-dist 6.3.289.
 *  - `prevMid` / `prevBeyondEof` / `prevToContentStream`: an appended update whose table names the EARLIER copy of the page
 *    content, with /Prev pointing into the middle of an object / past the end of the file / at a content stream. pdf.js
 *    shows VIEWED; pdf-lib keeps the later SIGNED copy.
 *  - `prevToBadPredictorStream` / `prevToBadTypeStream`: /Prev at a cross-reference stream pdf.js rejects — an unsupported
 *    /Predictor 3, or a row of type 3 after a valid one.
 *  - `prevToTableNoTrailer`: /Prev at a table with no trailer, which pdf-lib accepts.
 *  - `prevValid`: the same update with a correct /Prev, refused with no bad pointer at all (non-vacuity of the shape).
 *  - `prevMidPartial` / `prevAsRefPartial`: the update lists only object 5 and its /Prev is bad / a reference to an
 *    object that does not exist (one to an integer IS followed: `buildXrefQueuePdf('prevIndirect')`), so the section
 *    pdf.js can read has no usable root: it rebuilds by scanning and reads SIGNED, like pdf-lib.
 *  - `hybridBadXRefStm`: one revision holding both copies, the table naming VIEWED and its /XRefStm pointing mid-object.
 *  - `hybridAbbreviatedStream`: the table omits object 5 and its /XRefStm stream names the SIGNED copy, written with the
 *    abbreviated /F and /DP keys pdf.js reads and the recorder does not model. Both parsers read SIGNED.
 *  - `prevToBadTypeStreamKeepsRow`: the update's table omits object 5 and its /Prev stream names the SIGNED copy in row 1
 *    before a type-3 row: pdf.js keeps the row it read before rejecting the stream and shows SIGNED, like pdf-lib.
 *  - `streamXRefStmIgnored`: the newest section is a cross-reference STREAM carrying /XRefStm (at a stream naming VIEWED)
 *    and /Prev (at a table naming SIGNED). pdf.js reads /XRefStm only from a table, so it shows SIGNED, like pdf-lib.
 */
export function buildXrefPointerPdf(shape: XrefPointerShape): Uint8Array {
  const w = new ObjectWriter();
  w.add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  w.add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  w.add(3, pageDict(2, 5));
  w.add(4, HELVETICA);
  w.add(5, contentStream('VIEWED'));
  const latin1 = (data: Uint8Array): string => String.fromCharCode(...data);

  if (shape === 'hybridBadXRefStm' || shape === 'hybridAbbreviatedStream') {
    w.add(5, contentStream('SIGNED'));
    if (shape === 'hybridBadXRefStm') {
      const x = w.table(6, n => w.first(n));
      w.body += `trailer\n<< /Size 6 /Root 1 0 R /XRefStm ${w.first(3) + 9} >>\nstartxref\n${x}\n%%EOF\n`;
    } else {
      const data = zlibSync(Uint8Array.from([0, ...xrefRow(1, w.last(5))])); // one PNG row, filter None
      w.add(6, `<< /Type /XRef /Size 7 /W [1 4 2] /Index [5 1] /F /FlateDecode /DP << /Predictor 12 /Columns 7 >> /Length ${data.length} >>`
        + `\nstream\n${latin1(data)}\nendstream`);
      const x = w.table(7, n => (n === 5 ? undefined : w.first(n)), [[0, 5], [6, 1]]);
      w.body += `trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${w.first(6)} >>\nstartxref\n${x}\n%%EOF\n`;
    }
    return latin1Bytes(w.body);
  }

  if (shape === 'streamXRefStmIgnored') {
    w.add(5, contentStream('SIGNED'));
    const skipped = Uint8Array.from(xrefRow(1, w.first(5)));
    w.add(7, `<< /Type /XRef /Size 8 /W [1 4 2] /Index [5 1] /Length ${skipped.length} >>\nstream\n${latin1(skipped)}\nendstream`);
    const table = w.table(6, n => w.last(n));
    w.body += `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
    const rows = Uint8Array.from([0, 0, 0, 0, 0, 0xff, 0xff, ...[1, 2, 3, 4].flatMap(n => xrefRow(1, w.first(n)))]);
    w.add(8, `<< /Type /XRef /Size 9 /W [1 4 2] /Index [0 5] /Root 1 0 R /XRefStm ${w.first(7)} /Prev ${table} /Length ${rows.length} >>`
      + `\nstream\n${latin1(rows)}\nendstream`);
    w.body += `startxref\n${w.first(8)}\n%%EOF\n`;
    return latin1Bytes(w.body);
  }

  const x1 = w.table(6, n => w.first(n));
  w.body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x1}\n%%EOF\n`;
  w.add(5, contentStream('SIGNED'));
  let prev = String(w.first(3) + 9);
  if (shape === 'prevBeyondEof') prev = '99999999';
  if (shape === 'prevValid') prev = String(x1);
  if (shape === 'prevAsRefPartial') prev = `${x1} 0 R`;
  if (shape === 'prevToContentStream') prev = String(w.first(5));
  if (shape === 'prevToBadPredictorStream') {
    const data = zlibSync(Uint8Array.from(xrefRow(1, w.first(1))));
    w.add(8, `<< /Type /XRef /Size 9 /W [1 4 2] /Index [1 1] /Filter /FlateDecode /DecodeParms << /Predictor 3 >> /Length ${data.length} >>`
      + `\nstream\n${latin1(data)}\nendstream`);
    prev = String(w.first(8));
  }
  if (shape === 'prevToBadTypeStream' || shape === 'prevToBadTypeStreamKeepsRow') {
    const keepsRow = shape === 'prevToBadTypeStreamKeepsRow';
    const data = Uint8Array.from([...xrefRow(1, keepsRow ? w.last(5) : w.first(1)), ...xrefRow(3, 0)]);
    w.add(8, `<< /Type /XRef /Size 9 /W [1 4 2] /Index [${keepsRow ? 5 : 1} 2] /Length ${data.length} >>\nstream\n${latin1(data)}\nendstream`);
    prev = String(w.first(8));
  }
  if (shape === 'prevToTableNoTrailer') prev = String(w.table(2, n => w.first(n), [[1, 1]]));
  const subsections: Array<[number, number]> | undefined = shape === 'prevMidPartial' || shape === 'prevAsRefPartial'
    ? [[5, 1]]
    : shape === 'prevToBadTypeStreamKeepsRow' ? [[0, 5]] : undefined;
  const x2 = w.table(6, n => w.first(n), subsections);
  w.body += `trailer\n<< /Size 9 /Root 1 0 R /Prev ${prev} >>\nstartxref\n${x2}\n%%EOF\n`;
  return latin1Bytes(w.body);
}

export type PageTreeShape =
  | 'onlyPageContentMid' | 'firstPageContentMid' | 'middlePageContentMid' | 'lastPageContentMid' | 'middlePageContentOtherHeader'
  | 'nestedMiddlePageDictMid' | 'middlePageDictMid' | 'lastPageDictMid' | 'nestedFirstPageDictMid'
  | 'nestedMiddlePageDictMidCountOverstated';

/**
 * A page tree with ONE cross-reference entry that does not land on its object (WS7 round 16). pdf.js throws where it reads
 * such an entry (`XRef.fetchUncompressed`), and what follows depends on when. Met while `checkFirstPage` / `checkLastPage`
 * walk to the first or last page (`Catalog.getPageDict`), it makes pdf.js rebuild its table by scanning, which agrees with
 * pdf-lib; met later, nothing recovers it. Measured in pdfjs-dist 6.3.289, pages reading PAGE1, PAGE2, PAGE3:
 *  - `*ContentMid` / `middlePageContentOtherHeader`: a page's content entry lands inside another object / on another
 *    object's header. That page draws blank and `getTextContent` fails, while pdf-lib exports its text.
 *  - `nestedMiddlePageDictMid`: page 2's dictionary sits under an intermediate node whose /Count lets the last-page walk
 *    skip it, so no rebuild: page 2 fails on screen and pdf-lib exports it.
 *  - `middlePageDictMid` / `lastPageDictMid`: a page DICTIONARY in a flat tree — the last-page walk reads every kid, so pdf.js
 *    rebuilds and shows all three pages.
 *  - `nestedFirstPageDictMid`: the first page's dictionary under the intermediate node, met by the first-page walk: rebuilt.
 *  - `nestedMiddlePageDictMidCountOverstated`: `nestedMiddlePageDictMid` with the root /Count saying 4. The last-page walk
 *    finds no fourth page, `checkLastPage` falls back to walking the whole tree (`getAllPageDicts`), meets page 2: rebuilt.
 */
export function buildPageTreePdf(shape: PageTreeShape): Uint8Array {
  const count = shape.startsWith('only') ? 1 : 3;
  const nested = shape.startsWith('nested');
  const w = new ObjectWriter();
  w.add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: count }, (_, i) => `${20 + i} 0 R`).join(' ');
  const declared = shape === 'nestedMiddlePageDictMidCountOverstated' ? count + 1 : count;
  w.add(2, `<< /Type /Pages /Kids [${nested ? '30 0 R 22 0 R' : kids}] /Count ${declared} >>`);
  if (nested) w.add(30, '<< /Type /Pages /Parent 2 0 R /Kids [20 0 R 21 0 R] /Count 2 >>');
  w.add(4, HELVETICA);
  for (let i = 0; i < count; i++) {
    w.add(20 + i, pageDict(nested && i < 2 ? 30 : 2, 10 + i));
    w.add(10 + i, contentStream(`PAGE${i + 1}`));
  }
  const bad = ({
    onlyPageContentMid: 10, firstPageContentMid: 10, middlePageContentMid: 11, lastPageContentMid: 12,
    middlePageContentOtherHeader: 11, nestedMiddlePageDictMid: 21, middlePageDictMid: 21, lastPageDictMid: 22,
    nestedFirstPageDictMid: 20, nestedMiddlePageDictMidCountOverstated: 21,
  } as Record<PageTreeShape, number>)[shape];
  const wrong = shape === 'middlePageContentOtherHeader' ? w.first(4) : w.first(4) + 9;
  const size = nested ? 31 : 23;
  const x = w.table(size, n => (!w.has(n) ? undefined : n === bad ? wrong : w.first(n)));
  w.body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return latin1Bytes(w.body);
}

export type XrefQueueShape =
  | 'staleTableBeforePrev' | 'objectZeroInUseBeforeTable' | 'staleStreamBeforeStream' | 'prevIndirectUnreadable'
  | 'staleTableWithTrailer' | 'staleTableAfterPrev' | 'staleTableBeforeStream' | 'prevIndirect' | 'xrefStmIndirect';

/**
 * The cross-reference QUEUE as pdf.js reads it (WS7 round 17). Every shape holds object 5, the page content, twice:
 * VIEWED first, SIGNED last, which pdf-lib keeps. Measured in pdfjs-dist 6.3.289:
 *  - `staleTableBeforePrev`: the newest table omits object 5; its /XRefStm is a table with no trailer and its /Prev a
 *    table naming SIGNED. pdf.js keeps the failed table's `_tableState`, so the /Prev table re-reads the failed bytes and
 *    fails too: object 5 is never read and the page draws blank.
 *  - `objectZeroInUseBeforeTable`: the newest section is a stream marking object 0 in use; its /Prev table omits object 5
 *    and names, through its own /Prev, a table with SIGNED. pdf.js throws "unexpected first object" at that table, so its
 *    /Prev is never queued: blank.
 *  - `staleStreamBeforeStream`: /XRefStm is a stream pdf.js rejects at its second row, /Prev a stream naming SIGNED. pdf.js
 *    keeps the rejected stream's `streamState` and reads the second stream at the first one's position: blank.
 *  - `prevIndirectUnreadable`: /Prev is a reference whose entry lands inside another object; the fetch throws, so the
 *    table naming SIGNED is never queued: blank.
 *  - `staleTableWithTrailer`, `staleTableAfterPrev`, `staleTableBeforeStream` (controls): the failed table has a trailer,
 *    is queued after the table naming SIGNED, or is followed by a STREAM, which `_tableState` does not touch: SIGNED.
 *  - `prevIndirect` / `xrefStmIndirect` (controls): /Prev or /XRefStm written as a reference to an integer object, which
 *    pdf.js resolves and follows: SIGNED.
 */
export function buildXrefQueuePdf(shape: XrefQueueShape): Uint8Array {
  const w = new ObjectWriter();
  w.add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  w.add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  w.add(3, pageDict(2, 5));
  w.add(4, HELVETICA);
  w.add(5, contentStream('VIEWED'));
  w.add(5, contentStream('SIGNED'));
  const latin1 = (data: Uint8Array): string => String.fromCharCode(...data);
  const stream = (num: number, index: [number, number], rows: number[][], extra = ''): void => {
    const data = Uint8Array.from(rows.flat());
    w.add(num, `<< /Type /XRef /Size ${num + 1} /W [1 4 2] /Index [${index[0]} ${index[1]}]${extra} /Length ${data.length} >>`
      + `\nstream\n${latin1(data)}\nendstream`);
  };
  const end = (at: number, trailer: string): Uint8Array => {
    w.body += `trailer\n<< ${trailer} >>\nstartxref\n${at}\n%%EOF\n`;
    return latin1Bytes(w.body);
  };

  if (shape === 'staleStreamBeforeStream') {
    stream(7, [1, 2], [xrefRow(1, w.first(1)), xrefRow(3, 0)]);
    stream(8, [5, 1], [xrefRow(1, w.last(5))]);
    const top = w.table(6, n => w.first(n), [[0, 5]]);
    return end(top, `/Size 9 /Root 1 0 R /XRefStm ${w.first(7)} /Prev ${w.first(8)}`);
  }
  if (shape === 'staleTableBeforeStream') {
    stream(7, [5, 1], [xrefRow(1, w.last(5))]);
    const bad = w.table(2, n => w.first(n), [[1, 1]]);
    const top = w.table(6, n => w.first(n), [[0, 5]]);
    return end(top, `/Size 8 /Root 1 0 R /XRefStm ${bad} /Prev ${w.first(7)}`);
  }
  const older = w.table(6, n => w.last(n));
  w.body += 'trailer\n<< /Size 6 /Root 1 0 R >>\n';
  if (shape === 'objectZeroInUseBeforeTable') {
    const mid = w.table(6, n => w.first(n), [[0, 5]]);
    w.body += `trailer\n<< /Size 6 /Root 1 0 R /Prev ${older} >>\n`;
    stream(7, [0, 5], [0, 1, 2, 3, 4].map(n => xrefRow(1, w.first(n === 0 ? 1 : n))), ` /Root 1 0 R /Prev ${mid}`);
    w.body += `startxref\n${w.first(7)}\n%%EOF\n`;
    return latin1Bytes(w.body);
  }
  if (shape === 'prevIndirect' || shape === 'xrefStmIndirect' || shape === 'prevIndirectUnreadable') {
    w.add(9, String(older));
    const lands = (n: number): number => (n === 9 && shape === 'prevIndirectUnreadable' ? w.first(4) + 9 : w.first(n));
    const top = w.table(10, lands, [[0, 5], [9, 1]]);
    return end(top, `/Size 10 /Root 1 0 R /${shape === 'xrefStmIndirect' ? 'XRefStm' : 'Prev'} 9 0 R`);
  }
  const bad = w.table(2, n => w.first(n), [[1, 1]]);
  if (shape === 'staleTableWithTrailer') w.body += 'trailer\n<< /Size 6 >>\n';
  const top = w.table(6, n => w.first(n), [[0, 5]]);
  const [xrefStm, prev] = shape === 'staleTableAfterPrev' ? [older, bad] : [bad, older];
  return end(top, `/Size 6 /Root 1 0 R /XRefStm ${xrefStm} /Prev ${prev}`);
}

export type XrefCountShape = 'countHonest' | 'countShort' | 'countLong';

/**
 * One cross-reference table naming the EARLIER of two copies of the content stream (VIEWED first, SIGNED last),
 * whose subsection header declares the true row count, one row more, or one row fewer (closing audit, 2026-09-24,
 * P3a). pdf-lib ignores the declared count; pdf.js's `readXRefTable` reads exactly that many rows and throws when
 * the rows and the count disagree — so it finds no trailer, rebuilds by scanning, keeps the last copy like pdf-lib,
 * and shows SIGNED. Only `countHonest` is read as written: pdf.js shows VIEWED while pdf-lib holds SIGNED.
 */
export function buildXrefCountPdf(shape: XrefCountShape): Uint8Array {
  const w = new ObjectWriter();
  w.add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  w.add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  w.add(3, pageDict(2, 5));
  w.add(4, HELVETICA);
  w.add(5, contentStream('VIEWED'));
  w.add(5, contentStream('SIGNED'));
  const at = w.table(6, n => w.first(n));
  const declared = { countHonest: 6, countShort: 7, countLong: 5 }[shape];
  w.body = w.body.slice(0, at) + w.body.slice(at).replace('xref\n0 6\n', `xref\n0 ${declared}\n`);
  w.body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return latin1Bytes(w.body);
}

export type PageOrderShape =
  | 'countHidesFirst' | 'countShiftsPages' | 'countHidesSecond' | 'pageWithoutType'
  | 'countHonest' | 'countRootOverstated' | 'countRootUnderstated' | 'countIntermediateOverstated' | 'duplicateKid';

/**
 * A well-formed page tree whose /Count values or page dictionaries the two readers take differently (WS7 round 17, safety
 * P1). pdf.js's `Catalog.getPageDict` skips a subtree by its /Count and counts any dictionary without /Kids as a page;
 * pdf-lib's `PDFPageTree.traverse` ignores /Count and keeps only `/Type /Page` leaves. Pages read PAGE1..PAGE3:
 *  - `countHidesFirst`: root /Count 1, Kids [an intermediate /Count 0 holding PAGE1, PAGE2]. pdf.js shows PAGE2 alone;
 *    pdf-lib's first page is PAGE1.
 *  - `countShiftsPages`: the same with PAGE3 after PAGE2 and root /Count 2: pdf.js shows PAGE2, PAGE3.
 *  - `countHidesSecond`: root /Count 2, Kids [PAGE1, an intermediate /Count 0 holding PAGE2, PAGE3]. pdf.js shows
 *    PAGE1, PAGE3 — the lie acts only past the first page, where the guard's one-walk shortcut must not be taken.
 *  - `pageWithoutType`: PAGE1's dictionary has no /Type. pdf.js shows it; pdf-lib skips it.
 *  - `countHonest`, `countRootOverstated` (pdf.js walks the whole tree), `countRootUnderstated` (pdf.js shows fewer
 *    pages, every one the page pdf-lib holds there), `countIntermediateOverstated` (a lie no page lookup can act on) and
 *    `duplicateKid` (controls).
 * `rebuild` points `startxref` at object 1, which is no cross-reference section, so pdf.js rebuilds its table by scanning.
 */
export function buildPageOrderPdf(shape: PageOrderShape, opts: { rebuild?: boolean } = {}): Uint8Array {
  const trees: Record<PageOrderShape, [string, number, string?]> = {
    countHidesFirst: ['30 0 R 21 0 R', 1, '[20 0 R] /Count 0'],
    countShiftsPages: ['30 0 R 21 0 R 22 0 R', 2, '[20 0 R] /Count 0'],
    countHidesSecond: ['20 0 R 30 0 R 22 0 R', 2, '[21 0 R] /Count 0'],
    pageWithoutType: ['20 0 R 21 0 R', 2],
    countHonest: ['30 0 R 21 0 R', 2, '[20 0 R] /Count 1'],
    countRootOverstated: ['20 0 R 21 0 R 22 0 R', 5],
    countRootUnderstated: ['20 0 R 21 0 R 22 0 R', 2],
    countIntermediateOverstated: ['20 0 R 30 0 R', 3, '[21 0 R 22 0 R] /Count 7'],
    duplicateKid: ['20 0 R 20 0 R 21 0 R', 3],
  };
  const [kids, count, intermediate] = trees[shape];
  const w = new ObjectWriter();
  w.add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  w.add(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  if (intermediate) w.add(30, `<< /Type /Pages /Parent 2 0 R /Kids ${intermediate} >>`);
  w.add(4, HELVETICA);
  for (let i = 0; i < 3; i++) {
    const page = pageDict(2, 10 + i);
    w.add(20 + i, shape === 'pageWithoutType' && i === 0 ? page.replace('/Type /Page ', '') : page);
    w.add(10 + i, contentStream(`PAGE${i + 1}`));
  }
  const x = w.table(31, n => (w.has(n) ? w.first(n) : undefined));
  w.body += `trailer\n<< /Size 31 /Root 1 0 R >>\nstartxref\n${opts.rebuild ? w.first(1) : x}\n%%EOF\n`;
  return latin1Bytes(w.body);
}

export type LinearizedShape =
  | 'linearizedFirstPageElsewhere' | 'linearizedEntryTable' | 'linearizedClean' | 'linearizedLengthWrong' | 'linearizedCountFromN';

/**
 * A linearized file: a first object with /Linearized whose /L is the file length, then the first-page cross-reference
 * table (WS7 round 17). pdf.js enters such a file at the section after that first object (`PDFDocument.startXRef`), takes
 * its page count from /N and its first page from /O. Measured in pdfjs-dist 6.3.289:
 *  - `linearizedFirstPageElsewhere`: /O names the second page. pdf.js shows PAGE2 twice; pdf-lib holds PAGE1, PAGE2.
 *  - `linearizedEntryTable`: the first-page table names the EARLIER copy of page 1's content (VIEWED) and `startxref` a
 *    later table naming the copy pdf-lib keeps (SIGNED). pdf.js shows VIEWED.
 *  - `linearizedClean`, and `linearizedLengthWrong` — the entry-table file with /L one byte off, which pdf.js does not
 *    treat as linearized and reads through `startxref`: SIGNED (controls).
 *  - `linearizedCountFromN`: /N 1 over the `countHidesSecond` tree. pdf.js counts one page, PAGE1, so the /Count lie
 *    past it is never shown (control; counted by the catalog's /Count it would show PAGE1, PAGE3).
 */
export function buildLinearizedPdf(shape: LinearizedShape): Uint8Array {
  const countFromN = shape === 'linearizedCountFromN';
  const size = countFromN ? 31 : 22;
  const dup = shape === 'linearizedEntryTable' || shape === 'linearizedLengthWrong';
  const linearization = (length: number): string =>
    `1 0 obj\n<< /Linearized 1 /L ${String(length).padStart(10, '0')} /H [1 1] `
    + `/O ${shape === 'linearizedFirstPageElsewhere' ? 21 : 20} /E 1 /N ${countFromN ? 1 : 2} /T 1 >>\nendobj\n`;
  const w = new ObjectWriter();
  const linAt = w.body.length;
  const firstTable = (offset: (num: number) => number | undefined): string => {
    let s = `xref\n0 ${size}\n`;
    for (let n = 0; n < size; n++) {
      const o = n === 0 ? undefined : offset(n);
      s += o === undefined ? '0000000000 65535 f \n' : `${String(o).padStart(10, '0')} 00000 n \n`;
    }
    return `${s}trailer\n<< /Size ${size} /Root 2 0 R >>\n`;
  };
  w.body += linearization(0);
  const tableAt = w.body.length;
  const placeholder = firstTable(() => 0);
  w.body += placeholder;
  w.add(2, '<< /Type /Catalog /Pages 3 0 R >>');
  w.add(3, `<< /Type /Pages /Kids [${countFromN ? '20 0 R 30 0 R 22 0 R' : '20 0 R 21 0 R'}] /Count 2 >>`);
  if (countFromN) {
    w.add(30, '<< /Type /Pages /Parent 3 0 R /Kids [21 0 R] /Count 0 >>');
    w.add(22, pageDict(3, 12));
    w.add(12, contentStream('PAGE3'));
  }
  w.add(4, HELVETICA);
  w.add(20, pageDict(3, 10));
  w.add(21, pageDict(3, 11));
  w.add(10, contentStream(dup ? 'VIEWED' : 'PAGE1'));
  if (dup) w.add(10, contentStream('SIGNED'));
  w.add(11, contentStream('PAGE2'));
  const at = (pick: 'first' | 'last') => (n: number): number | undefined =>
    (n === 1 ? linAt : w.has(n) ? w[pick](n) : undefined);
  let startxref = tableAt;
  if (dup) {
    startxref = w.table(size, at('last'));
    w.body += `trailer\n<< /Size ${size} /Root 2 0 R >>\n`;
  }
  w.body += `startxref\n${startxref}\n%%EOF\n`;
  const table = firstTable(at('first'));
  const length = w.body.length + (shape === 'linearizedLengthWrong' ? 1 : 0);
  const body = w.body.slice(0, linAt) + linearization(length) + table + w.body.slice(tableAt + placeholder.length);
  return latin1Bytes(body);
}

/** Appends an incremental-update section — the given objects, then a decorative xref and trailer. */
export function appendRevision(bytes: Uint8Array, objects: string): Uint8Array {
  return latin1Bytes(new TextDecoder('latin1').decode(bytes) + objects
    + 'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n');
}

const CONTENT = 'BT /F1 24 Tf 20 200 Td (KEEPME) Tj ET';

/**
 * A one-page PDF whose content stream is the LAST object. `brokenLast` damages it and leaves off its
 * `endobj`, which pdf-lib 2.11.0 silently drops; `brokenTerminated` is the same damage with `endobj`,
 * which pdf-lib keeps as a PDFInvalidObject; `danglingInfo` adds a reference to an object that exists
 * nowhere. A byte builder is the only way to control what follows the last object.
 */
export function buildContentStreamPdf(opts: {
  brokenLast?: boolean; brokenTerminated?: boolean; danglingInfo?: boolean;
  /** Replaces the page's content-stream text. */
  content?: string;
  /** Adds `/Extra [1000 0 R …]` to the catalog: that many REACHABLE references with no header anywhere. */
  danglingRefs?: number;
  /** Adds `/Lang (<text>)` to the catalog — a string OUTSIDE every stream body. */
  catalogString?: string;
  /** Adds an unreferenced stream object 6 of this many filler bytes before the content stream. */
  padStreamBytes?: number;
  /** After the intact content stream, appends an UNTERMINATED broken object 6 the catalog references. */
  brokenAfterStream?: boolean;
} = {}): Uint8Array {
  const content = opts.content ?? CONTENT;
  const extraRefs = opts.danglingRefs
    ? ` /Extra [${Array.from({ length: opts.danglingRefs }, (_, i) => `${1000 + i} 0 R`).join(' ')}]`
    : '';
  const brokenRef = opts.brokenAfterStream ? ' /Broken 6 0 R' : '';
  const lang = opts.catalogString !== undefined ? ` /Lang (${opts.catalogString})` : '';
  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${extraRefs}${brokenRef}${lang} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  if (opts.brokenLast) {
    // A stray `}` makes pdf-lib's dict parser throw; with no `endobj` before EOF, 2.11.0 drops it.
    objs.push(`5 0 obj\n<< /Length ${content.length} } >>\nstream\n${content}\nendstream\n`);
  } else if (opts.brokenTerminated) {
    // Same damage, but TERMINATED: pdf-lib keeps it as a PDFInvalidObject — not a drop.
    objs.push(`5 0 obj\n<< /Length ${content.length} } >>\nstream\n${content}\nendstream\nendobj\n`);
  } else {
    if (opts.padStreamBytes) {
      objs.push(`6 0 obj\n<< /Length ${opts.padStreamBytes} >>\nstream\n${'x'.repeat(opts.padStreamBytes)}\nendstream\nendobj\n`);
    }
    objs.push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    if (opts.brokenAfterStream) objs.push('6 0 obj\n<< /Type /Foo } >>\n');
  }
  let body = '%PDF-1.7\n';
  const offs: number[] = [];
  for (const o of objs) { offs.push(body.length); body += o; }
  const xrefAt = body.length;
  // /Info 9 0 R names an object that exists nowhere — a harmless legacy null, not a drop.
  const info = opts.danglingInfo ? ' /Info 9 0 R' : '';
  // Rows are keyed by object NUMBER, not file order: `padStreamBytes` writes object 6 before object 5, and a
  // row-per-position table then points 5 0 R at object 6 — the bad-pointer shape the guard refuses since
  // WS7 round 16, where pdf.js draws the page blank.
  const byNum = new Map(objs.map((o, i) => [Number(/^(\d+) 0 obj/.exec(o)?.[1]), offs[i]]));
  const size = Math.max(...byNum.keys()) + 1;
  const rows = Array.from({ length: size - 1 }, (_, i) => byNum.get(i + 1));
  body += `xref\n0 ${size}\n0000000000 65535 f \n${rows.map(o => (o === undefined ? '0000000000 65535 f \n' : String(o).padStart(10, '0') + ' 00000 n \n')).join('')}`
    + `trailer\n<< /Size ${size} /Root 1 0 R${info} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1Bytes(body);
}
