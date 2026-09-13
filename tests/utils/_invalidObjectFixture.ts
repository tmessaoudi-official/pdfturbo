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

export type XrefShape =
  | 'clean' | 'dupFirst' | 'dupFirstLoose' | 'dupLast' | 'dupBadXref' | 'incremental' | 'incrementalStale' | 'dualTrailer'
  | 'junkRelative' | 'junkAbsolute' | 'xrefStreamDupFirst' | 'unreachableDupFirst' | 'identicalDupFirst';

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
 *  - `unreachableDupFirst` / `identicalDupFirst`: the first-copy table on an unused object / on two nulls.
 */
export function buildXrefShapePdf(shape: XrefShape): Uint8Array {
  const content = (t: string): string => {
    const s = `BT /F1 24 Tf 20 200 Td (${t}) Tj ET`;
    return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  };
  const dup = ['dupFirst', 'dupFirstLoose', 'dupLast', 'dupBadXref', 'junkRelative', 'junkAbsolute', 'xrefStreamDupFirst'].includes(shape);
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

  if (shape === 'xrefStreamDupFirst') {
    const be = (v: number, w: number): string =>
      Array.from({ length: w }, (_, i) => String.fromCharCode((v >>> (8 * (w - 1 - i))) & 0xff)).join('');
    const xrefAt = body.length;
    let data = '';
    for (let i = 0; i <= size; i++) {
      const o = i === size ? xrefAt : offsetOf(i);
      data += o === undefined ? ` ${be(0, 4)}${be(i === 0 ? 0xffff : 0, 2)}` : `${be(o, 4)}${be(0, 2)}`;
    }
    body += `${size} 0 obj\n<< /Type /XRef /Size ${size + 1} /W [1 4 2] /Root 1 0 R /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`
      + `startxref\n${xrefAt}\n%%EOF\n`;
    return latin1Bytes(body);
  }

  const xrefAt = body.length;
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
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
  // The xref is decorative here — pdf-lib scans objects sequentially — so extra objects only widen /Size.
  const size = offs.length + 1;
  body += `xref\n0 ${size}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`
    + `trailer\n<< /Size ${size} /Root 1 0 R${info} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1Bytes(body);
}
