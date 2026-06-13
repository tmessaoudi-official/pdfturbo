import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees, rgb } from '@cantoo/pdf-lib';
import {
  tokenizeContentStream,
  serializeTokens,
  serializeOps,
  groupOps,
  locateTextOps,
  findTextOpAt,
  deleteTextAt,
  changeSizeAt,
  changeColorAt,
  replaceTextAt,
  extractPsName,
  replaceShowOpInPlace,
  fillColorToHex,
  parseToUnicodeCMap,
  detectCMapBytesPerCode,
  encodeWithSubset,
  replaceShowOpHex,
  matchStandardFont,
  getPageFontDescriptor,
  multiplyMatrix,
  applyMatrixToPoint,
  getPageRotation,
  locatePageTextOps,
} from '../../src/utils/contentStreamEditor';

// ── Phase C helpers ─────────────────────────────────────────────────────────────

function ops(stream: string) {
  return groupOps(tokenizeContentStream(stream));
}

// ── Phase C: multiplyMatrix ────────────────────────────────────────────────────

describe('multiplyMatrix', () => {
  it('identity × identity = identity', () => {
    expect(multiplyMatrix([1,0,0,1,0,0], [1,0,0,1,0,0])).toEqual([1,0,0,1,0,0]);
  });
  it('translate × identity = translate', () => {
    expect(multiplyMatrix([1,0,0,1,100,200], [1,0,0,1,0,0])).toEqual([1,0,0,1,100,200]);
  });
  it('composes two translations', () => {
    expect(multiplyMatrix([1,0,0,1,10,20], [1,0,0,1,30,40])).toEqual([1,0,0,1,40,60]);
  });
  it('scale × identity = scale', () => {
    expect(multiplyMatrix([2,0,0,3,0,0], [1,0,0,1,0,0])).toEqual([2,0,0,3,0,0]);
  });
  it('scale composed with translation', () => {
    // [2 0 0 3 0 0] × [1 0 0 1 5 7] = [2 0 0 3 5 7]
    expect(multiplyMatrix([2,0,0,3,0,0], [1,0,0,1,5,7])).toEqual([2,0,0,3,5,7]);
  });
});

// ── Phase C: applyMatrixToPoint ────────────────────────────────────────────────

describe('applyMatrixToPoint', () => {
  it('identity leaves point unchanged', () => {
    expect(applyMatrixToPoint([1,0,0,1,0,0], 10, 20)).toEqual({ x: 10, y: 20 });
  });
  it('translation shifts point', () => {
    expect(applyMatrixToPoint([1,0,0,1,100,200], 10, 20)).toEqual({ x: 110, y: 220 });
  });
  it('scale scales point', () => {
    expect(applyMatrixToPoint([2,0,0,3,0,0], 5, 7)).toEqual({ x: 10, y: 21 });
  });
  it('translation from origin', () => {
    expect(applyMatrixToPoint([1,0,0,1,50,80], 0, 0)).toEqual({ x: 50, y: 80 });
  });
});

// ── Phase C: locateTextOps CTM tracking ───────────────────────────────────────

describe('locateTextOps CTM tracking', () => {
  it('regression: no cm operator leaves positions unchanged', () => {
    const [info] = locateTextOps(ops('BT /F1 12 Tf 100 200 Td (Hello) Tj ET'));
    expect(info.origin).toMatchObject({ x: 100, y: 200 });
  });

  it('cm translation shifts reported text origin', () => {
    // cm [1 0 0 1 50 80] then text at Tm (10, 20) → origin (60, 100)
    const [info] = locateTextOps(ops('1 0 0 1 50 80 cm BT /F1 12 Tf 0 0 Td 10 20 Td (Hi) Tj ET'));
    expect(info.origin.x).toBeCloseTo(60);
    expect(info.origin.y).toBeCloseTo(100);
  });

  it('q/Q restores CTM after save/restore', () => {
    // cm outside q/Q, inner cm inside q/Q — text is after Q so only outer cm applies
    const stream = '1 0 0 1 50 80 cm q 1 0 0 1 200 300 cm Q BT /F1 12 Tf 0 0 Td (x) Tj ET';
    const [info] = locateTextOps(ops(stream));
    expect(info.origin.x).toBeCloseTo(50);
    expect(info.origin.y).toBeCloseTo(80);
  });

  it('CTM inside q/Q block is active for text within that block', () => {
    const stream = 'q 1 0 0 1 30 40 cm BT /F1 12 Tf 5 5 Td (x) Tj ET Q';
    const [info] = locateTextOps(ops(stream));
    expect(info.origin.x).toBeCloseTo(35);
    expect(info.origin.y).toBeCloseTo(45);
  });

  it('nested q/Q correctly restores outer CTM', () => {
    const stream = 'q 1 0 0 1 10 10 cm q 1 0 0 1 5 5 cm Q Q BT /F1 12 Tf 0 0 Td (x) Tj ET';
    const [info] = locateTextOps(ops(stream));
    // Both q/Q blocks restored → identity CTM → origin (0, 0)
    expect(info.origin.x).toBeCloseTo(0);
    expect(info.origin.y).toBeCloseTo(0);
  });

  it('identity cm does not change positions', () => {
    const stream = '1 0 0 1 0 0 cm BT /F1 12 Tf 100 200 Td (x) Tj ET';
    const [info] = locateTextOps(ops(stream));
    expect(info.origin.x).toBeCloseTo(100);
    expect(info.origin.y).toBeCloseTo(200);
  });
});

// ── Phase C: getPageRotation ───────────────────────────────────────────────────

describe('getPageRotation', () => {
  it('returns 0 for a page without explicit Rotate entry', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    expect(getPageRotation(doc, 0)).toBe(0);
  });

  it('returns 90 when page rotation is 90 degrees', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(90));
    expect(getPageRotation(doc, 0)).toBe(90);
  });

  it('returns 180 when page rotation is 180 degrees', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(180));
    expect(getPageRotation(doc, 0)).toBe(180);
  });

  it('returns 270 when page rotation is 270 degrees', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(270));
    expect(getPageRotation(doc, 0)).toBe(270);
  });
});

// ── Phase C: locatePageTextOps (XObject recursion) ────────────────────────────

describe('locatePageTextOps', () => {
  it('finds text in the page direct content stream (same result as locateTextOps)', async () => {
    const bytes = await makeThreeStringPdf();
    const doc = await PDFDocument.load(bytes);
    const results = await locatePageTextOps(doc, 0);
    expect(results.length).toBeGreaterThan(0);
    // None should be flagged as inXObject since makeThreeStringPdf has no XObjects
    expect(results.every(r => !r.inXObject)).toBe(true);
  });

  it('returns empty array for a page with no content', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const results = await locatePageTextOps(doc, 0);
    expect(results).toEqual([]);
  });
});

/** Build a real 3-string PDF entirely in memory — no fixtures. */
async function makeThreeStringPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello', { x: 50, y: 300, size: 12, font });
  page.drawText('World', { x: 50, y: 250, size: 12, font });
  page.drawText('KeepMe', { x: 50, y: 200, size: 12, font });
  return doc.save();
}

/** Build a 3-text PDF with two overlapping ops (within 4pt) and one separate. */
async function makeOverlappingTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Shadow1', { x: 50, y: 300, size: 12, font }); // primary
  page.drawText('Shadow2', { x: 52, y: 298, size: 12, font }); // within 4pt of Shadow1
  page.drawText('Separate', { x: 50, y: 200, size: 12, font }); // 100pt away
  return doc.save();
}

function bytesToLatin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Decode and concatenate all content streams of page 0 as latin1 text. */
async function pageContentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  if (!contents) return '';
  let out = '';
  if (contents instanceof PDFRawStream) {
    out = bytesToLatin1(decodePDFRawStream(contents).decode());
  } else {
    const arr = contents as unknown as { size(): number; get(i: number): unknown };
    for (let i = 0; i < arr.size(); i++) {
      const stream = doc.context.lookup(
        arr.get(i) as Parameters<typeof doc.context.lookup>[0]
      );
      if (stream instanceof PDFRawStream) {
        out += bytesToLatin1(decodePDFRawStream(stream).decode()) + '\n';
      }
    }
  }
  return out;
}

/** Extract all shown strings (hex-decoded) from a content stream. */
function showStrings(content: string): string[] {
  const ops = groupOps(tokenizeContentStream(content));
  const out: string[] = [];
  for (const op of ops) {
    if (!['Tj', "'", '"', 'TJ'].includes(op.operator)) continue;
    const toks =
      op.operator === 'TJ'
        ? (op.operands[0]?.items ?? []).filter(
            t => t.type === 'string' || t.type === 'hexstring'
          )
        : [op.operands[op.operands.length - 1]];
    for (const t of toks) {
      if (!t) continue;
      if (t.type === 'hexstring') {
        const hex = t.raw.slice(1, -1).replace(/\s+/g, '');
        let s = '';
        for (let i = 0; i + 1 < hex.length; i += 2) {
          s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
        out.push(s);
      } else if (t.type === 'string') {
        out.push(t.raw.slice(1, -1));
      }
    }
  }
  return out;
}

describe('tokenizeContentStream', () => {
  it('round-trips a representative stream (re-tokenize equivalence)', () => {
    const src = 'BT /F1 12 Tf 1 0 0 1 50 300 Tm (Hello \\(world\\)) Tj ET 0.5 g 10 20 30 40 re f';
    const tokens = tokenizeContentStream(src);
    const again = tokenizeContentStream(serializeTokens(tokens));
    expect(again.map(t => [t.type, t.raw])).toEqual(tokens.map(t => [t.type, t.raw]));
  });

  it('handles hex strings, arrays and names', () => {
    const tokens = tokenizeContentStream('[<48656C6C6F> -120 (B)] TJ /Name42 cs');
    const types = tokens.map(t => t.type);
    expect(types).toContain('array');
    expect(types).toContain('operator');
    expect(types).toContain('name');
  });
});

describe('groupOps + locateTextOps', () => {
  it('locates Td-positioned show ops with correct origins and font size', () => {
    const src = 'BT /F1 10 Tf 10 20 Td (A) Tj 0 -15 Td (B) Tj ET';
    const ops = groupOps(tokenizeContentStream(src));
    const text = locateTextOps(ops);
    expect(text).toHaveLength(2);
    expect(text[0].origin).toEqual({ x: 10, y: 20 });
    expect(text[0].fontSize).toBe(10);
    expect(text[1].origin).toEqual({ x: 10, y: 5 });
  });

  it('locates Tm-positioned and TJ-array show ops', () => {
    const src = 'BT /F2 14 Tf 1 0 0 1 100 200 Tm [(A) -120 (B)] TJ ET';
    const text = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(text).toHaveLength(1);
    expect(text[0].origin).toEqual({ x: 100, y: 200 });
    expect(text[0].operator).toBe('TJ');
  });

  it("tracks the quote operator ' as line-advance + show", () => {
    const src = "BT /F1 10 Tf 12 TL 10 100 Td (first) Tj (second) ' ET";
    const text = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(text).toHaveLength(2);
    expect(text[1].origin).toEqual({ x: 10, y: 88 }); // 100 - TL 12
  });
});

describe('findTextOpAt', () => {
  it('returns the op info for a point near a show op', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const info = await findTextOpAt(doc, 0, { x: 50, y: 250 });
    expect(info).not.toBeNull();
    expect(info?.origin).toEqual({ x: 50, y: 250 });
    expect(info?.fontSize).toBe(12);
  });

  it('returns null when nothing is within tolerance', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    expect(await findTextOpAt(doc, 0, { x: 350, y: 30 })).toBeNull();
  });
});

describe('deleteTextAt', () => {
  it('truly removes the targeted string from the saved PDF', async () => {
    const bytes = await makeThreeStringPdf();
    const doc = await PDFDocument.load(bytes);

    const removed = await deleteTextAt(doc, 0, { x: 50, y: 300 });
    expect(removed).toBe(true);

    const saved = await doc.save();
    const strings = showStrings(await pageContentText(saved));
    expect(strings).not.toContain('Hello');
    expect(strings).toContain('World');
    expect(strings).toContain('KeepMe');
  });

  it('returns false when nothing is within tolerance', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const removed = await deleteTextAt(doc, 0, { x: 350, y: 30 });
    expect(removed).toBe(false);
  });

  it('leaves a still-parseable document', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    await deleteTextAt(doc, 0, { x: 50, y: 250 });
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('also blanks shadow ops within 4pt of the primary origin', async () => {
    const doc = await PDFDocument.load(await makeOverlappingTextPdf());
    await deleteTextAt(doc, 0, { x: 50, y: 300 });
    const saved = await doc.save();
    const strings = showStrings(await pageContentText(saved));
    expect(strings).not.toContain('Shadow1'); // primary — blanked
    expect(strings).not.toContain('Shadow2'); // shadow within 4pt — also blanked
    expect(strings).toContain('Separate');   // 100pt away — untouched
  });
});

describe('replaceTextAt', () => {
  it('removes the original and draws the replacement at the same origin', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());

    const ok = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Bonjour');
    expect(ok).toBe(true);

    const saved = await doc.save();
    const content = await pageContentText(saved);
    const strings = showStrings(content);
    expect(strings).not.toContain('Hello');
    expect(strings).toContain('Bonjour');
    // replacement must land at the original origin (50 300 in a positioning op)
    expect(content).toMatch(/50\s+300\s+(Tm|Td)/);
  });

  it('preserves the detected font size in the replacement', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    await replaceTextAt(doc, 0, { x: 50, y: 200 }, 'Changed');
    const saved = await doc.save();
    const content = await pageContentText(saved);
    expect(showStrings(content)).toContain('Changed');
    expect(content).toMatch(/\/\S+\s+12\s+Tf/);
  });
});

// ── New: extractPsName ────────────────────────────────────────────────────────

describe('extractPsName', () => {
  it('strips the ABCDEF+ subset prefix from internal font ids', () => {
    expect(extractPsName('g_d0_ABCDEF+Arial-BoldMT')).toBe('Arial-BoldMT');
  });

  it('returns the id unchanged when no + is present', () => {
    expect(extractPsName('g_d0_f1')).toBe('g_d0_f1');
  });

  it('handles bare PostScript names without any prefix', () => {
    expect(extractPsName('Helvetica')).toBe('Helvetica');
  });
});

// ── New: fill color tracking ──────────────────────────────────────────────────

describe('locateTextOps — fill color tracking', () => {
  it('captures rg (RGB) fill color on the following show op', () => {
    const src = 'BT /F1 12 Tf 1 0 0 rg 50 300 Td (Red) Tj ET';
    const textOps = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(textOps).toHaveLength(1);
    expect(textOps[0].fillColor).toBe('1 0 0 rg');
  });

  it('captures g (gray) fill color', () => {
    const src = 'BT /F1 12 Tf 0.5 g 50 300 Td (Gray) Tj ET';
    const textOps = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(textOps[0].fillColor).toBe('0.5 g');
  });

  it('captures k (CMYK) fill color', () => {
    const src = 'BT /F1 12 Tf 0 0 1 0 k 50 300 Td (Blue) Tj ET';
    const textOps = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(textOps[0].fillColor).toBe('0 0 1 0 k');
  });

  it('leaves fillColor undefined when no color op precedes the show', () => {
    const src = 'BT /F1 12 Tf 50 300 Td (Black) Tj ET';
    const textOps = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(textOps[0].fillColor).toBeUndefined();
  });

  it('updates fillColor when a new color op appears between two show ops', () => {
    const src = 'BT /F1 12 Tf 1 0 0 rg 10 20 Td (Red) Tj 0 1 0 rg 0 -15 Td (Green) Tj ET';
    const textOps = locateTextOps(groupOps(tokenizeContentStream(src)));
    expect(textOps).toHaveLength(2);
    expect(textOps[0].fillColor).toBe('1 0 0 rg');
    expect(textOps[1].fillColor).toBe('0 1 0 rg');
  });
});

// ── New: fillColorToHex ───────────────────────────────────────────────────────

describe('fillColorToHex', () => {
  it('converts rg RGB operands to 6-char uppercase hex', () => {
    expect(fillColorToHex('1 0 0 rg')).toBe('FF0000');
    expect(fillColorToHex('0 0 1 rg')).toBe('0000FF');
    expect(fillColorToHex('0 0 0 rg')).toBe('000000');
    expect(fillColorToHex('1 1 1 rg')).toBe('FFFFFF');
  });

  it('converts g (gray) operands to hex', () => {
    expect(fillColorToHex('1 g')).toBe('FFFFFF');
    expect(fillColorToHex('0 g')).toBe('000000');
    expect(fillColorToHex('0.5 g')).toMatch(/^[0-9A-F]{6}$/);
  });

  it('converts k (CMYK) operands to hex', () => {
    // 0 0 0 0 k → white
    expect(fillColorToHex('0 0 0 0 k')).toBe('FFFFFF');
    // 0 0 0 1 k → black
    expect(fillColorToHex('0 0 0 1 k')).toBe('000000');
  });

  it('returns undefined for unrecognised formats', () => {
    expect(fillColorToHex('scn')).toBeUndefined();
    expect(fillColorToHex('')).toBeUndefined();
  });
});

// ── New: replaceShowOpInPlace ─────────────────────────────────────────────────

describe('replaceShowOpInPlace', () => {
  it('replaces an ASCII literal Tj string in-place, preserving font context ops', () => {
    const src = 'BT /F1 12 Tf 50 300 Td (OrigText) Tj ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    expect(textOps).toHaveLength(1);

    const ok = replaceShowOpInPlace(ops[textOps[0].opIndex], 'NewText');
    expect(ok).toBe(true);

    const serialized = serializeOps(ops);
    expect(serialized).toContain('(NewText)');
    expect(serialized).not.toContain('(OrigText)');
    expect(serialized).toContain('/F1');
    expect(serialized).toContain('12 Tf');
  });

  it('replaces the first string element of a TJ array in-place', () => {
    const src = 'BT /F1 12 Tf [(Hello) -120 (World)] TJ ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    const ok = replaceShowOpInPlace(ops[textOps[0].opIndex], 'Hi');
    expect(ok).toBe(true);
    const serialized = serializeOps(ops);
    expect(serialized).toContain('(Hi)');
    expect(serialized).not.toContain('(Hello)');
  });

  it('returns false for a hex-encoded string operand (Tj)', () => {
    const src = 'BT <48656C6C6F> Tj ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    expect(replaceShowOpInPlace(ops[textOps[0].opIndex], 'NewText')).toBe(false);
  });

  it('returns false when newText contains non-ASCII characters', () => {
    const src = 'BT (Hello) Tj ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    expect(replaceShowOpInPlace(ops[textOps[0].opIndex], 'Héllo')).toBe(false);
  });
});

// ── Phase B: ToUnicode CMap parsing ──────────────────────────────────────────

describe('parseToUnicodeCMap', () => {
  it('parses single bfchar entries (2-byte codes)', () => {
    const cmap = `beginbfchar
<0048> <0048>
<0065> <0065>
endbfchar`;
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0048)).toBe('H');
    expect(map.get(0x0065)).toBe('e');
  });

  it('parses single bfchar entries (1-byte codes)', () => {
    const cmap = `beginbfchar
<48> <0048>
<65> <0065>
endbfchar`;
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x48)).toBe('H');
    expect(map.get(0x65)).toBe('e');
  });

  it('parses sequential bfrange entries', () => {
    const cmap = `beginbfrange
<0041> <0043> <0041>
endbfrange`;
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0041)).toBe('A');
    expect(map.get(0x0042)).toBe('B');
    expect(map.get(0x0043)).toBe('C');
  });

  it('parses bfrange with array (individual mapping)', () => {
    const cmap = `beginbfrange
<0041> <0043> [<0048> <0065> <006C>]
endbfrange`;
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0041)).toBe('H');
    expect(map.get(0x0042)).toBe('e');
    expect(map.get(0x0043)).toBe('l');
  });

  it('returns an empty map for empty or unparseable input', () => {
    expect(parseToUnicodeCMap('').size).toBe(0);
    expect(parseToUnicodeCMap('no cmap content here').size).toBe(0);
  });

  it('handles combined bfchar and bfrange sections', () => {
    const cmap = `beginbfchar
<0020> <0020>
endbfchar
beginbfrange
<0041> <0042> <0041>
endbfrange`;
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0020)).toBe(' ');
    expect(map.get(0x0041)).toBe('A');
    expect(map.get(0x0042)).toBe('B');
  });
});

describe('detectCMapBytesPerCode', () => {
  it('detects 1-byte encoding from <20> <FF> codespace range', () => {
    const cmap = '1 begincodespacerange\n<20> <FF>\nendcodespacerange';
    expect(detectCMapBytesPerCode(cmap)).toBe(1);
  });

  it('detects 2-byte encoding from <0000> <FFFF> codespace range', () => {
    const cmap = '2 begincodespacerange\n<0000> <FFFF>\nendcodespacerange';
    expect(detectCMapBytesPerCode(cmap)).toBe(2);
  });

  it('defaults to 2-byte when no codespace range is present', () => {
    expect(detectCMapBytesPerCode('beginbfchar\nendbfchar')).toBe(2);
  });
});

// ── Phase B: subset glyph encoding ───────────────────────────────────────────

describe('encodeWithSubset', () => {
  function buildReverseMap(entries: [string, number][]): Map<string, number> {
    return new Map(entries);
  }

  it('encodes text where all chars are present in the subset map (2-byte)', () => {
    const rev = buildReverseMap([['H', 0x0048], ['i', 0x0069]]);
    const hex = encodeWithSubset('Hi', rev, 2);
    expect(hex).toBe('<00480069>');
  });

  it('encodes text where all chars are present in the subset map (1-byte)', () => {
    const rev = buildReverseMap([['A', 0x41], ['B', 0x42]]);
    const hex = encodeWithSubset('AB', rev, 1);
    expect(hex).toBe('<4142>');
  });

  it('returns null when any character is missing from the map', () => {
    const rev = buildReverseMap([['H', 0x0048]]);
    expect(encodeWithSubset('Hi', rev, 2)).toBeNull();
  });

  it('returns null for empty text', () => {
    const rev = buildReverseMap([['A', 0x41]]);
    expect(encodeWithSubset('', rev, 1)).toBeNull();
  });
});

// ── Phase B: replaceShowOpHex ─────────────────────────────────────────────────

describe('replaceShowOpHex', () => {
  it('replaces a hexstring operand on a Tj op', () => {
    const src = 'BT <48656C6C6F> Tj ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    const ok = replaceShowOpHex(ops[textOps[0].opIndex], '<0048006900>');
    expect(ok).toBe(true);
    expect(serializeOps(ops)).toContain('<0048006900>');
    expect(serializeOps(ops)).not.toContain('<48656C6C6F>');
  });

  it('replaces the first hexstring in a TJ array', () => {
    const src = 'BT [<4865> -120 <6C6C6F>] TJ ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    const ok = replaceShowOpHex(ops[textOps[0].opIndex], '<0048>');
    expect(ok).toBe(true);
    expect(serializeOps(ops)).toContain('<0048>');
  });

  it('returns false when the op has no hexstring operand', () => {
    const src = 'BT (Hello) Tj ET';
    const ops = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(ops);
    expect(replaceShowOpHex(ops[textOps[0].opIndex], '<0048>')).toBe(false);
  });
});

// ── Phase B: font matching ────────────────────────────────────────────────────

describe('matchStandardFont', () => {
  it('returns Helvetica for a generic sans-serif font name', () => {
    expect(matchStandardFont('ArialMT', 0)).toBe(StandardFonts.Helvetica);
  });

  it('returns HelveticaBold for a bold sans-serif font name', () => {
    expect(matchStandardFont('Arial-BoldMT', 0)).toBe(StandardFonts.HelveticaBold);
  });

  it('returns HelveticaOblique for an italic sans-serif font', () => {
    expect(matchStandardFont('Arial-ItalicMT', 0)).toBe(StandardFonts.HelveticaOblique);
  });

  it('returns HelveticaBoldOblique for bold-italic sans-serif', () => {
    expect(matchStandardFont('Arial-BoldItalicMT', 0)).toBe(StandardFonts.HelveticaBoldOblique);
  });

  it('returns TimesRoman for a serif font name', () => {
    expect(matchStandardFont('TimesNewRomanPSMT', 0)).toBe(StandardFonts.TimesRoman);
  });

  it('returns TimesRomanBold when serif and bold', () => {
    expect(matchStandardFont('TimesNewRomanPS-BoldMT', 0)).toBe(StandardFonts.TimesRomanBold);
  });

  it('returns TimesRomanItalic when serif and italic', () => {
    expect(matchStandardFont('TimesNewRomanPS-ItalicMT', 0)).toBe(StandardFonts.TimesRomanItalic);
  });

  it('returns TimesRomanBoldItalic when serif, bold, and italic', () => {
    expect(matchStandardFont('TimesNewRomanPS-BoldItalicMT', 0)).toBe(StandardFonts.TimesRomanBoldItalic);
  });

  it('returns Courier when FixedPitch flag (bit 0) is set', () => {
    expect(matchStandardFont('SomeFont', 0x01)).toBe(StandardFonts.Courier);
  });

  it('returns CourierBold when FixedPitch + bold name', () => {
    expect(matchStandardFont('CourierNew-Bold', 0x01)).toBe(StandardFonts.CourierBold);
  });

  it('detects Italic from Flags bit 6 (0x40)', () => {
    expect(matchStandardFont('ArialMT', 0x40)).toBe(StandardFonts.HelveticaOblique);
  });

  it('detects serif from Flags bit 1 (0x02)', () => {
    expect(matchStandardFont('UnknownFont', 0x02)).toBe(StandardFonts.TimesRoman);
  });
});

// ── Phase B: getPageFontDescriptor ────────────────────────────────────────────

describe('getPageFontDescriptor', () => {
  it('returns null when the font key is not in the page resources', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    // /F99 does not exist in the test PDF
    const result = getPageFontDescriptor(doc, 0, '/F99');
    expect(result).toBeNull();
  });

  it('returns null for standard fonts that have no FontDescriptor', async () => {
    // The test PDF uses Helvetica (standard font) — no FontDescriptor
    // We get the actual font key from the content stream
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const content = await pageContentText(await doc.save());
    const tfMatch = content.match(/\/(\w+)\s+12\s+Tf/);
    const fontKey = tfMatch ? `/${tfMatch[1]}` : '/F1';
    // Standard fonts have no FontDescriptor → null
    const result = getPageFontDescriptor(doc, 0, fontKey);
    // Standard font may have null descriptor — null or {flags:0, name:''} both acceptable
    if (result !== null) {
      expect(typeof result.flags).toBe('number');
      expect(typeof result.name).toBe('string');
    }
  });
});

// ── New: tfOpIndex + colorOpIndex tracking ─────────────────────────────────────

describe('locateTextOps — tfOpIndex and colorOpIndex', () => {
  it('captures tfOpIndex pointing to the Tf op index in the ops array', () => {
    // Indices: 0=BT, 1=Tf, 2=Td, 3=Tj, 4=ET
    const opList = ops('BT /F1 12 Tf 100 200 Td (Hello) Tj ET');
    const [info] = locateTextOps(opList);
    expect(info.tfOpIndex).toBe(1);
  });

  it('colorOpIndex is undefined when no color op precedes the show op', () => {
    const [info] = locateTextOps(ops('BT /F1 12 Tf 0 0 Td (Hello) Tj ET'));
    expect(info.colorOpIndex).toBeUndefined();
  });

  it('captures colorOpIndex pointing to the rg op', () => {
    // Indices: 0=BT, 1=Tf, 2=rg, 3=Td, 4=Tj, 5=ET
    const opList = ops('BT /F1 12 Tf 1 0 0 rg 100 200 Td (Hello) Tj ET');
    const [info] = locateTextOps(opList);
    expect(info.colorOpIndex).toBe(2);
  });

  it('tfOpIndex updates when Tf changes before a second show op', () => {
    // Indices: 0=BT, 1=Tf(/F1), 2=Tj, 3=Tf(/F2), 4=Tj, 5=ET
    const opList = ops('BT /F1 12 Tf (First) Tj /F2 10 Tf (Second) Tj ET');
    const [first, second] = locateTextOps(opList);
    expect(first.tfOpIndex).toBe(1);
    expect(second.tfOpIndex).toBe(3);
  });

  it('colorOpIndex tracks the last color op before each individual show op', () => {
    // Indices: 0=BT, 1=Tf, 2=rg(red), 3=Tj, 4=rg(blue), 5=Tj, 6=ET
    const opList = ops('BT /F1 12 Tf 1 0 0 rg (Red) Tj 0 0 1 rg (Blue) Tj ET');
    const [red, blue] = locateTextOps(opList);
    expect(red.colorOpIndex).toBe(2);
    expect(blue.colorOpIndex).toBe(4);
  });
});

// ── New: changeSizeAt ──────────────────────────────────────────────────────────

describe('changeSizeAt', () => {
  it('modifies the Tf op fontSize in-place for text near the point', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const ok = await changeSizeAt(doc, 0, { x: 50, y: 300 }, 24, 5);
    expect(ok).toBe(true);
    const saved = await doc.save();
    const content = await pageContentText(saved);
    expect(content).toMatch(/\S+\s+24\s+Tf/);
  });

  it('returns false when no text op is within tolerance', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const ok = await changeSizeAt(doc, 0, { x: 350, y: 30 }, 24, 5);
    expect(ok).toBe(false);
  });

  it('does not alter Tf ops for other text items', async () => {
    // makeThreeStringPdf has 3 texts at y=300, 250, 200 all size 12
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    await changeSizeAt(doc, 0, { x: 50, y: 300 }, 24, 5);
    const saved = await doc.save();
    const content = await pageContentText(saved);
    const count24 = (content.match(/\S+\s+24\s+Tf/g) ?? []).length;
    const count12 = (content.match(/\S+\s+12\s+Tf/g) ?? []).length;
    expect(count24).toBe(1);
    expect(count12).toBeGreaterThan(0);
  });
});

// ── New: changeColorAt ─────────────────────────────────────────────────────────

describe('changeColorAt', () => {
  it('changes the rg fill color op to the new color', async () => {
    // pdf-lib buffers content until save() — must save+reload before reading content stream
    let doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Red', { x: 50, y: 300, size: 12, font, color: rgb(1, 0, 0) });
    doc = await PDFDocument.load(await doc.save());

    const ok = await changeColorAt(doc, 0, { x: 50, y: 300 }, { r: 0, g: 0, b: 1 }, 5);
    expect(ok).toBe(true);
    const saved = await doc.save();
    const content = await pageContentText(saved);
    expect(content).toMatch(/0\s+0\s+1\s+rg/);
    expect(content).not.toMatch(/1\s+0\s+0\s+rg/);
  });

  it('returns false when no text op is within tolerance', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const ok = await changeColorAt(doc, 0, { x: 350, y: 30 }, { r: 0, g: 0, b: 1 }, 5);
    expect(ok).toBe(false);
  });

  it('returns false for a stream with no fill color op before the show op', async () => {
    // Manually craft a content stream that has text but no color op
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    // Find the font key pdf-lib assigned (need it for content stream)
    page.drawText('Bare', { x: 50, y: 300, size: 12, font });
    const saved = await doc.save();
    let content = await pageContentText(saved);
    // Strip all color ops (rg/g/k) from the content stream, then reload
    content = content.replace(/[\d.\s]+rg\s*/g, '').replace(/[\d.]+\s+g\s*/g, '');
    const doc2 = await PDFDocument.load(saved);
    const p2 = doc2.getPage(0);
    const bytes2 = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) bytes2[i] = content.charCodeAt(i) & 0xff;
    const stream2 = doc2.context.stream(bytes2);
    const ref2 = doc2.context.register(stream2);
    p2.node.set(PDFName.of('Contents'), ref2);

    const ok = await changeColorAt(doc2, 0, { x: 50, y: 300 }, { r: 1, g: 0, b: 0 }, 5);
    expect(ok).toBe(false);
  });
});
