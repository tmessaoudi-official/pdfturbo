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
  return new Uint8Array(Buffer.from(body, 'latin1'));
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
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
