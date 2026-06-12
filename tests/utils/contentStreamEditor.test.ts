import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import {
  tokenizeContentStream,
  serializeTokens,
  serializeOps,
  groupOps,
  locateTextOps,
  findTextOpAt,
  deleteTextAt,
  replaceTextAt,
  extractPsName,
  replaceShowOpInPlace,
  fillColorToHex,
} from '../../src/utils/contentStreamEditor';

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
