/**
 * Shared fixture (limits row 38): an EMBEDDED SIMPLE TrueType font whose text is written as LITERAL strings and
 * which carries a /ToUnicode — the shape of the 171 corpus runs (pdfTeX Type1 there) that Path 2 used to skip
 * because it rewrote hex operands only.
 *
 * The font program is the vendored Noto Naskh Arabic TTF (OFL), which covers the ASCII digits. Codes are NOT the
 * digits' ASCII codes: /Differences maps 0x21..0x2A to /zero../nine, and the ToUnicode maps them back to U+0030..
 * U+0039. 0x28 and 0x29 ('(' and ')') are 7 and 8, so a literal carrying them needs `\(` `\)` escapes — which is
 * what makes a segment measured by its RAW length (escapes included) differ from one measured in codes.
 *
 * Runs (Td origins, 24 pt, page 400×400):
 *   (50, 300)  Tj            "12345"          ("#$%&)
 *   (50, 250)  TJ            "7890"           [(\(\)) -150 (*!)]
 *   (50, 200)  TJ mixed      "1234"           [("#) -100 <2425>]
 *   (50, 150)  "  (aw ac s)  "789"            0 0 (\(\)*) "
 *
 * `codespace` sets the ToUnicode codespacerange: 'byte' <00><FF> (default), 'wide' <0000><FFFF> (a simple font is
 * single-byte whatever the CMap declares — PDF 32000 §9.6.6), or 'none' (no codespacerange at all).
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface LiteralSubsetOptions { codespace?: 'byte' | 'wide' | 'none' }

export const LITERAL_RUNS = {
  tj: { x: 50, y: 300, text: '12345' },
  tjArray: { x: 50, y: 250, text: '7890' },
  mixed: { x: 50, y: 200, text: '1234' },
  quote: { x: 50, y: 150, text: '789' },
} as const;

function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export async function makeLiteralSubsetPdf(fontBytes: Uint8Array, opts: LiteralSubsetOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const font = fontkit.create(new Uint8Array(fontBytes) as never) as unknown as {
    unitsPerEm: number; ascent: number; descent: number; capHeight: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    glyphForCodePoint(cp: number): { advanceWidth: number };
  };
  const k = 1000 / font.unitsPerEm;

  const bytes = new Uint8Array(fontBytes);
  const file = ctx.flateStream(bytes, { Length1: bytes.length });
  const fileRef = ctx.register(file);

  const desc = ctx.obj({
    Type: 'FontDescriptor', FontName: 'ABCDEF+NotoNaskhDigits', Flags: 32,
    FontBBox: [font.bbox.minX * k, font.bbox.minY * k, font.bbox.maxX * k, font.bbox.maxY * k].map(Math.round),
    ItalicAngle: 0, Ascent: Math.round(font.ascent * k), Descent: Math.round(font.descent * k),
    CapHeight: Math.round((font.capHeight || font.ascent) * k), StemV: 80,
  }) as PDFDict;
  desc.set(PDFName.of('FontFile2'), fileRef);
  const descRef = ctx.register(desc);

  const digitNames = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const differences = PDFArray.withContext(ctx);
  differences.push(PDFNumber.of(0x21));
  for (const n of digitNames) differences.push(PDFName.of(n));
  const encoding = ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding' }) as PDFDict;
  encoding.set(PDFName.of('Differences'), differences);

  const cs = opts.codespace ?? 'byte';
  const cmap = [
    '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
    ...(cs === 'none' ? [] : ['1 begincodespacerange', cs === 'wide' ? '<0000> <FFFF>' : '<00> <FF>', 'endcodespacerange']),
    '1 beginbfrange', '<21> <2A> <0030>', 'endbfrange',
    'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
  ].join('\n');
  const toUnicodeRef = ctx.register(ctx.stream(latin1(cmap)));

  const widths = digitNames.map((_, i) => Math.round(font.glyphForCodePoint(0x30 + i).advanceWidth * k));
  const fontDict = ctx.obj({
    Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+NotoNaskhDigits', FirstChar: 0x21, LastChar: 0x2a, Widths: widths,
  }) as PDFDict;
  fontDict.set(PDFName.of('Encoding'), encoding);
  fontDict.set(PDFName.of('FontDescriptor'), descRef);
  fontDict.set(PDFName.of('ToUnicode'), toUnicodeRef);
  const fontRef = ctx.register(fontDict);

  const fonts = ctx.obj({}) as PDFDict;
  fonts.set(PDFName.of('F1'), fontRef);
  const res = ctx.obj({}) as PDFDict;
  res.set(PDFName.of('Font'), fonts);
  page.node.set(PDFName.of('Resources'), res);

  const content = [
    'BT /F1 24 Tf 50 300 Td ("#$%&) Tj ET',
    'BT /F1 24 Tf 50 250 Td [(\\(\\)) -150 (*!)] TJ ET',
    'BT /F1 24 Tf 50 200 Td [("#) -100 <2425>] TJ ET',
    'BT /F1 24 Tf 50 150 Td 0 0 (\\(\\)*) " ET',
  ].join('\n');
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(latin1(content))));
  return doc.save();
}
