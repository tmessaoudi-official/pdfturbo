/**
 * Fixtures for the WS8 viewer check (`src/utils/viewerCheck.ts`). Hand-written PDFs with a REAL cross-reference
 * table (every offset measured), because what the table names is the subject.
 */

const enc = (s: string): Uint8Array => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
const stream = (body: string): string => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;

/**
 * Objects written in order; the table names the FIRST definition of each number (pdf.js reads it) while pdf-lib keeps
 * the LAST — so a number defined twice shows one copy on screen and exports the other.
 */
function assemble(objs: Array<[number, string]>): Uint8Array {
  let body = '%PDF-1.7\n';
  const first = new Map<number, number>();
  for (const [n, b] of objs) {
    if (!first.has(n)) first.set(n, body.length);
    body += `${n} 0 obj\n${b}\nendobj\n`;
  }
  const size = Math.max(...objs.map(([n]) => n)) + 1;
  const xref = body.length;
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const o = first.get(n);
    body += o === undefined ? '0000000000 65535 f \n' : `${String(o).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(body);
}

const CAPTION = 'BT /F1 12 Tf 20 250 Td (CAPTION) Tj ET';

/**
 * One page whose content stream (object 5) is defined twice. `graphicsOnly`: both copies carry the same caption and
 * differ only in what they paint below it — the "scan with a caption" shape a text fingerprint cannot see. `same`:
 * two identical copies (the control). `text`: the copies differ in their text.
 */
export function buildDupContentPdf(shape: 'graphicsOnly' | 'same' | 'text' | 'colourOnly' | 'moved'): Uint8Array {
  if (shape === 'colourOnly' || shape === 'moved') {
    // Same operators in the same order; only an operand differs — a colour, or where the square is drawn.
    const kept = shape === 'colourOnly' ? `${CAPTION} 1 0 0 rg 20 20 100 100 re f` : `${CAPTION} 0 0 1 rg 150 20 100 100 re f`;
    return assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
      [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
      [5, stream(`${CAPTION} 0 0 1 rg 20 20 100 100 re f`)],
      [5, stream(kept)],
    ]);
  }
  const shown = shape === 'text' ? 'BT /F1 12 Tf 20 250 Td (VIEWED) Tj ET' : `${CAPTION} 0 0 1 rg 20 20 100 100 re f`;
  const kept = shape === 'text' ? 'BT /F1 12 Tf 20 250 Td (SIGNED) Tj ET'
    : shape === 'same' ? shown
      : `${CAPTION} 1 0 0 rg 20 20 100 100 re f 1 0 0 rg 150 20 100 100 re f`;
  return assemble([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, stream(shown)],
    [5, stream(kept)],
  ]);
}

/** One page with an optional-content layer the catalog switches OFF or ON. */
export function buildLayerPdf(state: 'OFF' | 'ON'): Uint8Array {
  return assemble([
    [1, `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /${state} [6 0 R] >> >> >>`],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R '
      + '/Resources << /Font << /F1 5 0 R >> /Properties << /L1 6 0 R >> >> >>'],
    [4, stream('BT /F1 12 Tf 20 150 Td (ALWAYS VISIBLE) Tj ET /OC /L1 BDC BT /F1 12 Tf 20 100 Td (LAYER TEXT) Tj ET EMC')],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [6, '<< /Type /OCG /Name (Layer) >>'],
  ]);
}

/**
 * One page, 300×300: a GREEN square always drawn, and a RED square inside an optional-content layer the catalog
 * switches OFF or ON. The red square is the only red thing on the page, so a rendered export can be checked for the
 * hidden layer without any coordinate arithmetic.
 */
export function buildColourLayerPdf(state: 'OFF' | 'ON'): Uint8Array {
  return assemble([
    [1, `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /${state} [5 0 R] >> >> >>`],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Properties << /L1 5 0 R >> >> >>'],
    [4, stream('0 1 0 rg 20 20 100 100 re f /OC /L1 BDC 1 0 0 rg 160 160 100 100 re f EMC')],
    [5, '<< /Type /OCG /Name (Layer) >>'],
  ]);
}

/**
 * Limits row 13 (C3): one page drawing one 32×32 image XObject (object 6) that is defined TWICE with the same size and
 * different pixels — pdf.js reads the first definition, pdf-lib keeps the last. The page's text, operators and every
 * numeric operand (the image's id, width and height, its placement) are identical on both sides, so only a hash of
 * the DECODED PIXELS can tell the page on screen from the page exported. `same`: two identical definitions (control).
 */
export function buildDupImagePdf(shape: 'swapped' | 'same'): Uint8Array {
  const px = (r: number, g: number, b: number): string => String.fromCharCode(r, g, b).repeat(32 * 32);
  const image = (pixels: string): string =>
    `<< /Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`;
  const shown = px(220, 30, 30);
  return assemble([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, stream(`${CAPTION} q 100 0 0 100 20 20 cm /Im1 Do Q`)],
    [6, image(shown)],
    [6, image(shape === 'same' ? shown : px(30, 30, 220))],
  ]);
}
