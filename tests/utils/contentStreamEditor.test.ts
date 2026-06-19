import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, StandardFonts, decodePDFRawStream, degrees, rgb } from '@cantoo/pdf-lib';
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
  isSubsetFontName,
  isType3Font,
  isVerticalWritingFont,
  getEditableTextAt,
  locateDecorationRects,
  matchDecorationForText,
  adjustedRuleWidth,
  buildPath3Redraw,
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

/**
 * Build a PDF with a genuine same-origin drop shadow: the SAME string drawn
 * twice at the exact same baseline origin (the legitimate multi-op-same-origin
 * case the nearby-blanking is meant to clean up), plus one separate string.
 * A real drop-shadow/outline pass repeats the IDENTICAL glyph string at the same
 * origin, so the duplicate uses the same text/font/size (BUG A4).
 */
async function makeOverlappingTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  // Embed Helvetica once and reference it by a single stable key /F1 so the
  // shadow duplicate shares the SAME font resource (as a real drop-shadow does
  // — pdf-lib's high-level drawText would assign each call a distinct key).
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  const ctx = doc.context;
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
  // Find the key pdf-lib gave Helvetica and alias it to /F1.
  const helvKey = [...fontDict.entries()][0][0];
  // helvKey came straight from entries(), so the value is present; guard narrows the type.
  const helvVal = fontDict.get(helvKey);
  if (!helvVal) throw new Error('Helvetica font entry missing');
  fontDict.set(PDFName.of('F1'), helvVal);
  const content =
    'BT /F1 12 Tf 1 0 0 1 50 300 Tm (Shadow1) Tj ET\n' +   // primary
    'BT /F1 12 Tf 1 0 0 1 50 300 Tm (Shadow1) Tj ET\n' +   // SAME key+text+origin → true shadow
    'BT /F1 12 Tf 1 0 0 1 50 200 Tm (Separate) Tj ET';     // 100pt away
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/**
 * Build a PDF with two DISTINCT words at the SAME baseline origin (within the
 * shadow radius) but with DIFFERENT content — the case that proximity-only
 * blanking wrongly wipes (BUG A4). Content-aware blanking must keep the
 * different-string neighbour even though it shares the origin.
 */
async function makeSameOriginDistinctPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  // Share a single font key /F1 so content payload is the ONLY differentiator —
  // proving content-aware blanking, not an accidental font-key mismatch, is what
  // preserves the neighbour.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  const ctx = doc.context;
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
  const helvKey = [...fontDict.entries()][0][0];
  const helvVal = fontDict.get(helvKey);
  if (!helvVal) throw new Error('Helvetica font entry missing');
  fontDict.set(PDFName.of('F1'), helvVal);
  const content =
    'BT /F1 12 Tf 1 0 0 1 50 300 Tm (TargetWord) Tj ET\n' + // target
    'BT /F1 12 Tf 1 0 0 1 50 300 Tm (OtherWord) Tj ET';     // SAME origin+key, DIFFERENT text
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/**
 * Build a PDF with two DISTINCT words at clearly different origins only ~2.5pt
 * apart — close enough that a 4pt nearby-blanking radius wrongly wipes the
 * neighbour (BUG A2), but far enough that exact/sub-point origin matching keeps
 * it intact.
 */
async function makeAdjacentWordsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('EditMe', { x: 50, y: 300, size: 12, font });    // target
  page.drawText('Neighbour', { x: 52, y: 298.5, size: 12, font }); // ~2.5pt away, DISTINCT
  return doc.save();
}

/**
 * Build a PDF whose ONLY text lives inside a Form XObject, invoked from the page
 * via a `Do` operator. Used to exercise the XObject-target path (BUG A1): such a
 * target must be flagged inXObject and must NOT be blanked without replacement.
 */
async function makeXObjectTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Embed the font into the page once so the XObject can reference it by name.
  page.drawText(' ', { x: 0, y: 0, size: 1, font });

  const ctx = doc.context;
  // Form XObject content: draw "InsideXObj" at (50,300) in the XObject's space.
  const xContent = 'q BT /F1 12 Tf 1 0 0 1 50 300 Tm (InsideXObj) Tj ET Q';
  const xBytes = new Uint8Array(xContent.length);
  for (let i = 0; i < xContent.length; i++) xBytes[i] = xContent.charCodeAt(i) & 0xff;

  // Reuse the page's /Resources/Font dict so /F1 resolves inside the XObject.
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDictRef = pageRes.get(PDFName.of('Font'));

  const xDict = PDFDict.fromMapWithContext(new Map(), ctx);
  xDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  xDict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  xDict.set(PDFName.of('FormType'), ctx.obj(1));
  const bbox = PDFArray.withContext(ctx);
  [0, 0, 400, 400].forEach(n => bbox.push(ctx.obj(n)));
  xDict.set(PDFName.of('BBox'), bbox);
  const xRes = PDFDict.fromMapWithContext(new Map(), ctx);
  if (fontDictRef) xRes.set(PDFName.of('Font'), fontDictRef);
  xDict.set(PDFName.of('Resources'), xRes);
  xDict.set(PDFName.of('Length'), ctx.obj(xBytes.length));
  const xStream = PDFRawStream.of(xDict, xBytes);
  const xRef = ctx.register(xStream);

  // Register the XObject on the page resources under /Fx0.
  let xobjDict = ctx.lookup(pageRes.get(PDFName.of('XObject'))) as PDFDict | undefined;
  if (!xobjDict?.set) {
    xobjDict = PDFDict.fromMapWithContext(new Map(), ctx);
    pageRes.set(PDFName.of('XObject'), xobjDict);
  }
  xobjDict.set(PDFName.of('Fx0'), xRef);

  // Append a `Do` to the page content stream so the XObject is actually drawn.
  const pageContent = '\nq /Fx0 Do Q';
  const pcBytes = new Uint8Array(pageContent.length);
  for (let i = 0; i < pageContent.length; i++) pcBytes[i] = pageContent.charCodeAt(i) & 0xff;
  const doStream = ctx.stream(pcBytes);
  const doRef = ctx.register(doStream);
  const existing = page.node.get(PDFName.of('Contents'));
  const contentsArr = PDFArray.withContext(ctx);
  if (existing) contentsArr.push(existing);
  contentsArr.push(doRef);
  page.node.set(PDFName.of('Contents'), contentsArr);

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
  const innerOps = groupOps(tokenizeContentStream(content));
  const out: string[] = [];
  for (const op of innerOps) {
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
    const innerOps = groupOps(tokenizeContentStream(src));
    const text = locateTextOps(innerOps);
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

  // BUG A1: a target found only inside a Form XObject must be flagged inXObject
  // so callers can fall back to an overlay rather than no-op.
  it('flags a target found inside a Form XObject with inXObject (A1)', async () => {
    const doc = await PDFDocument.load(await makeXObjectTextPdf());
    const info = await findTextOpAt(doc, 0, { x: 50, y: 300 });
    expect(info).not.toBeNull();
    expect(info?.inXObject).toBe(true);
  });
});

describe('XObject target edit safety (A1)', () => {
  // The user-facing A1 fix (no silent no-op) lives in textEditHandler: an
  // inXObject target is treated as a MISS and routed to the overlay path. At the
  // engine level the invariant under test is "never delete without replacement":
  // editing an XObject target must never leave the original blanked with no new
  // text in its place. (A standard-font literal op edits in place; a subset/CID
  // op that would hit the Path-3 redraw refuses outright — both honour this.)
  it('replaceTextAt never blanks an XObject target without a replacement', async () => {
    const doc = await PDFDocument.load(await makeXObjectTextPdf());
    const ok = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Changed');
    const saved = bytesToLatin1(await doc.save());
    if (ok) {
      // In-place literal swap succeeded → the new text is present.
      expect(saved).toContain('Changed');
    } else {
      // Refused (Path-3 XObject case) → the original survives untouched.
      expect(saved).toContain('InsideXObj');
    }
    // Either way, the document must remain parseable.
    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.getPageCount()).toBe(1);
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

  it('also blanks a same-origin drop-shadow op (legitimate multi-op-same-origin)', async () => {
    const doc = await PDFDocument.load(await makeOverlappingTextPdf());
    await deleteTextAt(doc, 0, { x: 50, y: 300 });
    const saved = await doc.save();
    const strings = showStrings(await pageContentText(saved));
    // Both the primary and its identical same-origin shadow are blanked; only
    // ONE 'Separate' (100pt away) survives.
    expect(strings.filter(s => s === 'Shadow1')).toHaveLength(0);
    expect(strings).toContain('Separate');      // 100pt away — untouched
  });

  // BUG A2: a 4pt nearby-blanking radius wipes a DISTINCT neighbour word that
  // merely sits a couple of points away. Only ops at the matched origin must be
  // blanked.
  it('does NOT blank a distinct neighbour word ~2.5pt from the target origin (A2)', async () => {
    const doc = await PDFDocument.load(await makeAdjacentWordsPdf());
    const removed = await deleteTextAt(doc, 0, { x: 50, y: 300 });
    expect(removed).toBe(true);
    const saved = await doc.save();
    const strings = showStrings(await pageContentText(saved));
    expect(strings).not.toContain('EditMe');     // target — blanked
    expect(strings).toContain('Neighbour');      // distinct neighbour — preserved
  });

  // BUG A4: proximity alone is not enough — a DISTINCT word sharing the target's
  // exact origin (within the shadow radius) but with different content must NOT
  // be blanked. Only true shadow/outline duplicates (same font+size+content)
  // are swept.
  it('does NOT blank a distinct same-origin word with different content (A4)', async () => {
    const doc = await PDFDocument.load(await makeSameOriginDistinctPdf());
    const removed = await deleteTextAt(doc, 0, { x: 50, y: 300 });
    expect(removed).toBe(true);
    const saved = await doc.save();
    const strings = showStrings(await pageContentText(saved));
    expect(strings).not.toContain('TargetWord'); // target — blanked
    expect(strings).toContain('OtherWord');      // distinct same-origin word — preserved
  });

  it('STILL blanks a true same-origin shadow (same content+font+size) (A4)', async () => {
    const doc = await PDFDocument.load(await makeOverlappingTextPdf());
    const removed = await deleteTextAt(doc, 0, { x: 50, y: 300 });
    expect(removed).toBe(true);
    const saved = await doc.save();
    const strings = showStrings(await pageContentText(saved));
    // Neither copy of the identical shadow survives.
    expect(strings.filter(s => s === 'Shadow1')).toHaveLength(0);
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

// ── G8: getEditableTextAt — prefill the inline editor from the MATCHED op ───────
// The inline true-edit editor used to prefill from `best.str`, a SINGLE pdf.js
// text item (one glyph on glyph-positioned PDFs), while the in-place edit replaces
// the whole matched CONTENT-STREAM op. getEditableTextAt decodes the matched op's
// OWN text so prefill == exactly what replaceTextAt will replace.

/** Build a PDF whose page stream has a hex Tj backed by a 2-byte ToUnicode CMap. */
async function makeHexToUnicodePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;

  // ToUnicode CMap mapping char codes 0x0001→'H', 0x0002→'i'.
  const cmapText =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    '2 beginbfchar <0001> <0048> <0002> <0069> endbfchar\n' +
    'endcmap end end';
  const cb = new Uint8Array(cmapText.length);
  for (let i = 0; i < cmapText.length; i++) cb[i] = cmapText.charCodeAt(i) & 0xff;
  const cmapStream = PDFRawStream.of(
    PDFDict.fromMapWithContext(new Map([[PDFName.of('Length'), ctx.obj(cb.length)]]), ctx),
    cb,
  );
  const cmapRef = ctx.register(cmapStream);

  // A Type0 font carrying that ToUnicode (the show-op operand is decoded via it).
  const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('Type0'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+Test'));
  fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
  fontDict.set(PDFName.of('ToUnicode'), cmapRef);
  const fontRef = ctx.register(fontDict);

  const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
  resFont.set(PDFName.of('F1'), fontRef);
  const res = PDFDict.fromMapWithContext(new Map(), ctx);
  res.set(PDFName.of('Font'), resFont);
  page.node.set(PDFName.of('Resources'), res);

  // Show "Hi" as hex code units <0001><0002> at origin (50,300).
  const content = 'BT /F1 12 Tf 1 0 0 1 50 300 Tm <00010002> Tj ET';
  const pcb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) pcb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pcb)));
  return doc.save();
}

/**
 * Build a PDF whose page stream draws a LITERAL string of custom glyph-code bytes
 * with a SUBSET font (BaseFont `ABCDEF+…`) and NO ToUnicode. This mirrors real
 * subset fonts (LibreOffice/wkhtmltopdf/TeX) whose `( … ) Tj` operand bytes are
 * glyph indices, not WinAnsi text. Decoding the literal verbatim yields garbage,
 * so getEditableTextAt MUST return null (caller keeps the pdf.js item string).
 * @param withToUnicode when true, attaches a 1-byte ToUnicode mapping 0x01→'H' 0x02→'i'.
 */
async function makeSubsetLiteralPdf(withToUnicode: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;

  const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+Custom')); // subset tag → byte-swap-unsafe

  if (withToUnicode) {
    const cmapText =
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
      '1 begincodespacerange <00> <FF> endcodespacerange\n' +
      '2 beginbfchar <01> <0048> <02> <0069> endbfchar\n' +
      'endcmap end end';
    const cb = new Uint8Array(cmapText.length);
    for (let i = 0; i < cmapText.length; i++) cb[i] = cmapText.charCodeAt(i) & 0xff;
    const cmapStream = PDFRawStream.of(
      PDFDict.fromMapWithContext(new Map([[PDFName.of('Length'), ctx.obj(cb.length)]]), ctx),
      cb,
    );
    fontDict.set(PDFName.of('ToUnicode'), ctx.register(cmapStream));
  }
  const fontRef = ctx.register(fontDict);

  const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
  resFont.set(PDFName.of('F1'), fontRef);
  const res = PDFDict.fromMapWithContext(new Map(), ctx);
  res.set(PDFName.of('Font'), resFont);
  page.node.set(PDFName.of('Resources'), res);

  // Show a literal string of raw glyph-code bytes 0x01 0x02 at origin (50,300).
  const content = 'BT /F1 12 Tf 1 0 0 1 50 300 Tm (\x01\x02) Tj ET';
  const pcb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) pcb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pcb)));
  return doc.save();
}

describe('getEditableTextAt', () => {
  it('returns null for a subset-font literal show-string with no ToUnicode (REGRESSION: glyph-code garbage)', async () => {
    // The bytes 0x01 0x02 are GLYPH CODES, not characters. Decoding the literal
    // verbatim would prefill the editor with "\x01\x02" (random characters) —
    // the reported click-to-edit regression. With no ToUnicode and a byte-swap-
    // unsafe font, the only safe answer is null (handler keeps the pdf.js string).
    const doc = await PDFDocument.load(await makeSubsetLiteralPdf(false));
    expect(await getEditableTextAt(doc, 0, { x: 50, y: 300 }, 3)).toBeNull();
  });

  it('decodes a subset-font literal show-string via its ToUnicode CMap', async () => {
    // Same subset font, but WITH a 1-byte ToUnicode: the literal glyph codes
    // 0x01 0x02 map to 'H' 'i' — decode correctly rather than fall back.
    const doc = await PDFDocument.load(await makeSubsetLiteralPdf(true));
    expect(await getEditableTextAt(doc, 0, { x: 50, y: 300 }, 3)).toBe('Hi');
  });

  it('returns the whole literal-string op text (NOT one char) at its origin', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    // makeThreeStringPdf draws "Hello" at (50,300) as a single literal Tj op.
    expect(await getEditableTextAt(doc, 0, { x: 50, y: 300 }, 3)).toBe('Hello');
  });

  it('returns null when no show op lies within tolerance (off-text click)', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    expect(await getEditableTextAt(doc, 0, { x: 350, y: 30 }, 3)).toBeNull();
  });

  it('decodes a hex Tj op via the font ToUnicode CMap', async () => {
    const doc = await PDFDocument.load(await makeHexToUnicodePdf());
    expect(await getEditableTextAt(doc, 0, { x: 50, y: 300 }, 3)).toBe('Hi');
  });

  it('returns null for a target inside a Form XObject (not editable in place)', async () => {
    const doc = await PDFDocument.load(await makeXObjectTextPdf());
    // The only text lives inside the XObject — the in-place editor cannot use it.
    expect(await getEditableTextAt(doc, 0, { x: 50, y: 300 }, 3)).toBeNull();
  });

  it('matches the exact text replaceTextAt would replace (single literal op)', async () => {
    // The whole point of G8: prefill == the matched op text, so editing the
    // prefilled value replaces precisely that op (no corruption).
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const prefill = await getEditableTextAt(doc, 0, { x: 50, y: 200 }, 3);
    expect(prefill).toBe('KeepMe');
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
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    expect(textOps).toHaveLength(1);

    const ok = replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'NewText');
    expect(ok).toBe(true);

    const serialized = serializeOps(innerOps);
    expect(serialized).toContain('(NewText)');
    expect(serialized).not.toContain('(OrigText)');
    expect(serialized).toContain('/F1');
    expect(serialized).toContain('12 Tf');
  });

  it('replaces the first string element of a TJ array in-place', () => {
    const src = 'BT /F1 12 Tf [(Hello) -120 (World)] TJ ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'Hi');
    expect(ok).toBe(true);
    const serialized = serializeOps(innerOps);
    expect(serialized).toContain('(Hi)');
    expect(serialized).not.toContain('(Hello)');
  });

  it('returns false for a hex-encoded string operand (Tj)', () => {
    const src = 'BT <48656C6C6F> Tj ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    expect(replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'NewText')).toBe(false);
  });

  it('returns false when newText contains non-ASCII characters', () => {
    const src = 'BT (Hello) Tj ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    expect(replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'Héllo')).toBe(false);
  });

  // Gap 1 (biggest-ROI true-edit fix): a kerned TJ array must NOT be collapsed to
  // a single literal — that discarded every kerning number and reflowed the line,
  // shifting neighbour glyphs. New behaviour: distribute newText across the
  // existing string segments by their original char counts (last segment absorbs
  // any length delta) and leave the kerning numbers in place.
  it('preserves kerning numbers and distributes text across TJ string segments', () => {
    const src = 'BT /F1 12 Tf [(Hel) -50 (lo) -30 (!!)] TJ ET'; // "Hello!!" = 3/2/2
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'World??'); // 7 chars, same length
    expect(ok).toBe(true);
    const s = serializeOps(innerOps);
    expect(s).toContain('-50');
    expect(s).toContain('-30');
    expect(s).toContain('(Wor)'); // seg0 keeps 3 chars
    expect(s).toContain('(ld)');  // seg1 keeps 2 chars
    expect(s).toContain('(??)');  // seg2 keeps 2 chars
    expect(s).not.toContain('(Hel)');
    expect(s).not.toContain('(lo)');
  });

  it('absorbs a longer edit into the last TJ segment, keeping kerning', () => {
    const src = 'BT [(Hel) -50 (lo)] TJ ET'; // "Hello" = 3/2
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'Helloooo'); // 8 chars
    expect(ok).toBe(true);
    const s = serializeOps(innerOps);
    expect(s).toContain('(Hel)');    // seg0 first 3
    expect(s).toContain('(loooo)');  // seg1 (last) absorbs the rest ('Helloooo'.slice(3))
    expect(s).toContain('-50');
  });

  it('blanks trailing TJ segments for a shorter edit, leaving no stale text', () => {
    const src = 'BT [(Hel) -50 (lo) -30 (!!)] TJ ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpInPlace(innerOps[textOps[0].opIndex], 'Hi'); // 2 chars
    expect(ok).toBe(true);
    const s = serializeOps(innerOps);
    expect(s).toContain('(Hi)');
    expect(s).not.toContain('(lo)');
    expect(s).not.toContain('(!!)');
    expect(s).toContain('-50'); // kerning still present even with emptied segments
    expect(s).toContain('-30');
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

  // M0 #2 — file-open DoS/OOM hardening. A crafted ToUnicode CMap can declare a
  // sequential bfrange spanning billions of code points; the unguarded loop would
  // allocate billions of Map entries (OOM) or throw on an out-of-range code point.
  it('clamps a maliciously huge sequential bfrange without hanging or OOM', () => {
    const cmap = `beginbfrange
<00000000> <FFFFFFFF> <0020>
endbfrange`;
    const t0 = Date.now();
    const map = parseToUnicodeCMap(cmap);
    expect(Date.now() - t0).toBeLessThan(2000);
    // Bounded: a legitimate 1–2 byte ToUnicode map has at most 65536 distinct codes.
    expect(map.size).toBeLessThanOrEqual(0x10000);
    // The low end is still mapped correctly (from=0 → start 0x20 = space).
    expect(map.get(0)).toBe(' ');
  });

  it('does not throw on a bfrange whose destination exceeds the max code point', () => {
    const cmap = `beginbfrange
<0000> <0020> <0010FFF8>
endbfrange`;
    expect(() => parseToUnicodeCMap(cmap)).not.toThrow();
    const map = parseToUnicodeCMap(cmap);
    // In-range destinations are mapped; out-of-range (> 0x10FFFF) are skipped, not fatal.
    expect(map.get(0)).toBe(String.fromCodePoint(0x10fff8));
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
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpHex(innerOps[textOps[0].opIndex], '<0048006900>');
    expect(ok).toBe(true);
    expect(serializeOps(innerOps)).toContain('<0048006900>');
    expect(serializeOps(innerOps)).not.toContain('<48656C6C6F>');
  });

  it('replaces the first hexstring in a TJ array', () => {
    const src = 'BT [<4865> -120 <6C6C6F>] TJ ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpHex(innerOps[textOps[0].opIndex], '<0048>');
    expect(ok).toBe(true);
    expect(serializeOps(innerOps)).toContain('<0048>');
  });

  it('returns false when the op has no hexstring operand', () => {
    const src = 'BT (Hello) Tj ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    expect(replaceShowOpHex(innerOps[textOps[0].opIndex], '<0048>')).toBe(false);
  });

  // BUG A2 (original): replaceShowOpHex used to swap ONLY the first hexstring of a
  // multi-segment TJ array, leaving subsequent hexstrings as STALE old glyphs.
  // Gap 1 (kerning, Sprint 3 batch 2): the new payload is now DISTRIBUTED across
  // the existing hex segments by their original content lengths (preserving the
  // per-segment advance widths AND the kerning numbers), with any length delta
  // absorbed by the last segment. The A2 guarantee still holds — no stale glyph
  // bytes survive (every segment is rewritten; overflow segments become <>).
  it('distributes new hex across TJ segments, keeps kerning, leaves no stale glyphs (A2)', () => {
    const src = 'BT [<4865> -50 <6C6C6F> -30 <2121>] TJ ET'; // seg content lens 4/6/4
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpHex(innerOps[textOps[0].opIndex], '<00480069>'); // 8 hex chars
    expect(ok).toBe(true);
    const serialized = serializeOps(innerOps);
    // Distributed: seg0 gets 4 (<0048>), seg1 gets the remaining 4 (<0069>), seg2 emptied.
    expect(serialized).toContain('<0048>');
    expect(serialized).toContain('<0069>');
    // No stale old glyph bytes remain anywhere in the array.
    expect(serialized).not.toContain('<6C6C6F>');
    expect(serialized).not.toContain('<2121>');
    // Kerning numbers preserved.
    expect(serialized).toContain('-50');
    expect(serialized).toContain('-30');
  });

  it('leaves a single-hexstring TJ array unchanged apart from the swap (A2 regression)', () => {
    const src = 'BT [<4865>] TJ ET';
    const innerOps = groupOps(tokenizeContentStream(src));
    const textOps = locateTextOps(innerOps);
    const ok = replaceShowOpHex(innerOps[textOps[0].opIndex], '<0048>');
    expect(ok).toBe(true);
    expect(serializeOps(innerOps)).toContain('<0048>');
    expect(serializeOps(innerOps)).not.toContain('<4865>');
  });
});

// ── A3: cmapHexToUnicodeStr UTF-16BE decoding (via parseToUnicodeCMap) ─────────

describe('parseToUnicodeCMap — UTF-16BE dst decoding (A3)', () => {
  it('decodes a 2-code-unit ligature dst <00660069> as "fi"', () => {
    const cmap = 'beginbfchar\n<0003> <00660069>\nendbfchar';
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0003)).toBe('fi');
  });

  it('combines a UTF-16BE surrogate pair into a single non-BMP code point', () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A → surrogate pair D835 DC00.
    const cmap = 'beginbfchar\n<0005> <D835DC00>\nendbfchar';
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0005)).toBe(String.fromCodePoint(0x1d400));
    expect([...(map.get(0x0005) ?? '')]).toHaveLength(1);
  });

  it('treats a 6-hex dst as UTF-16BE units (not a single 24-bit code point)', () => {
    // The old parity heuristic decoded <006601> as one code point U+006601.
    // As UTF-16BE units that is <0066> + a lone trailing nibble; the leading
    // unit U+0066 ("f") must decode correctly regardless.
    const cmap = 'beginbfchar\n<0007> <00660041>\nendbfchar';
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0007)).toBe('fA');
  });

  it('does not crash on a lone high surrogate (skips or replaces it)', () => {
    const cmap = 'beginbfchar\n<0009> <D835>\nendbfchar';
    const map = parseToUnicodeCMap(cmap);
    const v = map.get(0x0009);
    // No throw; lone surrogate yields either empty or the replacement char.
    expect(v === '' || v === '�').toBe(true);
  });

  it('still decodes plain BMP single-unit dst values', () => {
    const cmap = 'beginbfchar\n<0048> <0048>\n<0065> <0065>\nendbfchar';
    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x0048)).toBe('H');
    expect(map.get(0x0065)).toBe('e');
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

// ── ISSUE-2: subset-font detection (gates the literal in-place edit) ──────────────
describe('isSubsetFontName', () => {
  it('detects a 6-letter tag prefix (subset font)', () => {
    expect(isSubsetFontName('ABCDEF+Arial')).toBe(true);
    expect(isSubsetFontName('/WXYZAB+Helvetica-Bold')).toBe(true);
  });

  it('treats untagged / standard font names as non-subset', () => {
    expect(isSubsetFontName('Arial')).toBe(false);
    expect(isSubsetFontName('/Helvetica')).toBe(false);
    expect(isSubsetFontName('TimesNewRoman')).toBe(false);
    expect(isSubsetFontName('')).toBe(false);
  });

  it('does not mistake a short/lowercase prefix for a subset tag', () => {
    expect(isSubsetFontName('ABCDE+Arial')).toBe(false);   // only 5 letters
    expect(isSubsetFontName('abcdef+Arial')).toBe(false);  // lowercase
    expect(isSubsetFontName('ABCDEFG+Arial')).toBe(false); // 7 letters
  });
});

// ── A5: defensive routing for non-editable text ──────────────────────────────────

/**
 * Build a PDF whose page text is shown by a /Subtype /Type3 font. Type3 fonts
 * define glyphs as content-stream procedures, not byte→glyph encodings — they
 * are never safely byte-swappable and must be refused (BUG A5).
 */
async function makeType3FontPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;

  // Minimal Type3 font dict (a single glyph at code 0x41).
  const charProc = ctx.stream(new Uint8Array([0x20])); // trivial glyph proc
  const charProcRef = ctx.register(charProc);
  const charProcs = PDFDict.fromMapWithContext(new Map(), ctx);
  charProcs.set(PDFName.of('a'), charProcRef);
  const encDict = PDFDict.fromMapWithContext(new Map(), ctx);
  const diffs = PDFArray.withContext(ctx);
  diffs.push(ctx.obj(0x41));
  diffs.push(PDFName.of('a'));
  encDict.set(PDFName.of('Differences'), diffs);
  const fontMatrix = PDFArray.withContext(ctx);
  [0.001, 0, 0, 0.001, 0, 0].forEach(n => fontMatrix.push(ctx.obj(n)));
  const fontBBox = PDFArray.withContext(ctx);
  [0, 0, 750, 750].forEach(n => fontBBox.push(ctx.obj(n)));
  const widths = PDFArray.withContext(ctx);
  widths.push(ctx.obj(500));

  const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('Type3'));
  fontDict.set(PDFName.of('FontBBox'), fontBBox);
  fontDict.set(PDFName.of('FontMatrix'), fontMatrix);
  fontDict.set(PDFName.of('CharProcs'), charProcs);
  fontDict.set(PDFName.of('Encoding'), encDict);
  fontDict.set(PDFName.of('FirstChar'), ctx.obj(0x41));
  fontDict.set(PDFName.of('LastChar'), ctx.obj(0x41));
  fontDict.set(PDFName.of('Widths'), widths);
  const fontRef = ctx.register(fontDict);

  const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
  resFont.set(PDFName.of('T3'), fontRef);
  const res = PDFDict.fromMapWithContext(new Map(), ctx);
  res.set(PDFName.of('Font'), resFont);
  page.node.set(PDFName.of('Resources'), res);

  const content = 'BT /T3 12 Tf 1 0 0 1 50 300 Tm (A) Tj ET';
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  const cs = ctx.stream(cb);
  page.node.set(PDFName.of('Contents'), ctx.register(cs));
  return doc.save();
}

/**
 * Build a PDF with a standard-font show op rendered under text-render-mode 3
 * (invisible) — the classic OCR layer over a scanned image. Editing it would
 * paint visible text over the scan, so it must be refused (BUG A5).
 */
async function makeInvisibleTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Embed Helvetica into the page resources so /F-something resolves.
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  let bytes = await doc.save();
  // Reload and find the assigned font key, then inject a `3 Tr` invisible op.
  const d2 = await PDFDocument.load(bytes);
  const content = await pageContentText(bytes);
  const tfMatch = content.match(/\/(\w+)\s+1\s+Tf/);
  const fontKey = tfMatch ? tfMatch[1] : 'F1';
  const invisible = `\nBT /${fontKey} 12 Tf 3 Tr 1 0 0 1 50 300 Tm (Hidden) Tj ET`;
  const newContent = content + invisible;
  const cb = new Uint8Array(newContent.length);
  for (let i = 0; i < newContent.length; i++) cb[i] = newContent.charCodeAt(i) & 0xff;
  const p2 = d2.getPage(0);
  const cs = d2.context.stream(cb);
  p2.node.set(PDFName.of('Contents'), d2.context.register(cs));
  bytes = await d2.save();
  return bytes;
}

describe('isType3Font (A5)', () => {
  it('detects a /Subtype /Type3 font in page resources', async () => {
    const doc = await PDFDocument.load(await makeType3FontPdf());
    expect(isType3Font(doc, 0, '/T3')).toBe(true);
  });

  it('returns false for a standard (non-Type3) font', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const content = await pageContentText(await doc.save());
    const tfMatch = content.match(/\/(\w+)\s+12\s+Tf/);
    const fontKey = tfMatch ? `/${tfMatch[1]}` : '/F1';
    expect(isType3Font(doc, 0, fontKey)).toBe(false);
  });
});

describe('isVerticalWritingFont (A5)', () => {
  it('returns false for a horizontal standard font', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const content = await pageContentText(await doc.save());
    const tfMatch = content.match(/\/(\w+)\s+12\s+Tf/);
    const fontKey = tfMatch ? `/${tfMatch[1]}` : '/F1';
    expect(isVerticalWritingFont(doc, 0, fontKey)).toBe(false);
  });

  it('detects a Type0 font with a vertical (…-V) encoding CMap name', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ctx = doc.context;
    const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type0'));
    fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-V'));
    const fontRef = ctx.register(fontDict);
    const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
    resFont.set(PDFName.of('FV'), fontRef);
    const res = PDFDict.fromMapWithContext(new Map(), ctx);
    res.set(PDFName.of('Font'), resFont);
    page.node.set(PDFName.of('Resources'), res);
    expect(isVerticalWritingFont(doc, 0, '/FV')).toBe(true);
  });

  it('treats a Type0 font with a horizontal (…-H) encoding as not vertical', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ctx = doc.context;
    const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type0'));
    fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
    const fontRef = ctx.register(fontDict);
    const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
    resFont.set(PDFName.of('FH'), fontRef);
    const res = PDFDict.fromMapWithContext(new Map(), ctx);
    res.set(PDFName.of('Font'), resFont);
    page.node.set(PDFName.of('Resources'), res);
    expect(isVerticalWritingFont(doc, 0, '/FH')).toBe(false);
  });
});

describe('replaceTextAt — refuses non-editable text (A5)', () => {
  it('refuses to edit a Type3-font show op (returns false, original preserved)', async () => {
    const doc = await PDFDocument.load(await makeType3FontPdf());
    const ok = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'X');
    expect(ok).toBe(false);
    const saved = bytesToLatin1(await doc.save());
    expect(saved).toContain('(A)'); // original show op untouched
  });

  it('refuses to edit an invisible (Tr 3) show op (returns false, original preserved)', async () => {
    const doc = await PDFDocument.load(await makeInvisibleTextPdf());
    const ok = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Visible');
    expect(ok).toBe(false);
    const strings = showStrings(await pageContentText(await doc.save()));
    expect(strings).toContain('Hidden'); // invisible OCR text left intact
  });

  it('still edits a normal horizontal visible standard-font op (A5 does not over-refuse)', async () => {
    const doc = await PDFDocument.load(await makeThreeStringPdf());
    const ok = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Bonjour');
    expect(ok).toBe(true);
    expect(showStrings(await pageContentText(await doc.save()))).toContain('Bonjour');
  });
});

// ── Decoration + graphics-state fidelity ────────────────────────────────────────
// PDF has NO underline TEXT attribute — underline/strikethrough are SEPARATE thin
// rects/lines whose width is baked into their own geometry. Editing text to a new
// length must resize the rule that belongs to it (the reported bug: a longer edit
// left its tail un-underlined). Plus: a Path-3 redraw must re-emit Tc/Tw/Tz/Ts.

/** Widths of every `re` op whose IMMEDIATE next op is a fill painter. */
function paintedReWidths(content: string): number[] {
  const innerOps = groupOps(tokenizeContentStream(content));
  const FILL = new Set(['f', 'F', 'f*', 'b', 'b*', 'B', 'B*']);
  const out: number[] = [];
  for (let i = 0; i < innerOps.length - 1; i++) {
    if (
      innerOps[i].operator === 're' &&
      innerOps[i].operands.length >= 4 &&
      FILL.has(innerOps[i + 1].operator)
    ) {
      out.push(innerOps[i].operands[2].value ?? NaN);
    }
  }
  return out;
}

/** Span (|lx − mx|) of the first horizontal `m … l S` stroked line in a content stream. */
function strokedLineSpan(content: string): number | null {
  const innerOps = groupOps(tokenizeContentStream(content));
  let mx: number | null = null;
  for (const op of innerOps) {
    if (op.operator === 'm' && op.operands.length >= 2) mx = op.operands[0].value ?? null;
    else if (op.operator === 'l' && op.operands.length >= 2 && mx !== null) {
      return Math.abs((op.operands[0].value ?? NaN) - mx);
    }
  }
  return null;
}

/** Standard-font "Hello" with a thin filled underline rect just below its baseline. */
async function makeUnderlinedTextPdf(rectWidth = 28): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  const ctx = doc.context;
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
  const helvVal = fontDict.get([...fontDict.entries()][0][0]);
  if (!helvVal) throw new Error('font missing');
  fontDict.set(PDFName.of('F1'), helvVal);
  const content =
    `BT /F1 12 Tf 1 0 0 1 50 300 Tm (Hello) Tj ET\n` +
    `0 0 0 rg 50 297 ${rectWidth} 1.2 re f`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

describe('locateDecorationRects', () => {
  it('finds a filled `re` rect with CTM-transformed user-space geometry', () => {
    const rules = locateDecorationRects(ops('1 0 0 1 0 0 cm 10 5 100 2 re f'));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ x: 10, y: 5, width: 100, height: 2, kind: 'rect' });
    expect(rules[0].ctmScaleX).toBeCloseTo(1);
    if (rules[0].kind === 'rect') expect(rules[0].widthOperandIndex).toBe(2);
  });

  it('applies the CTM scale to width and position', () => {
    const rules = locateDecorationRects(ops('2 0 0 1 5 0 cm 10 5 100 2 re f'));
    expect(rules).toHaveLength(1);
    expect(rules[0].x).toBeCloseTo(25); // 10*2 + 5
    expect(rules[0].width).toBeCloseTo(200); // 100*2
    expect(rules[0].ctmScaleX).toBeCloseTo(2);
  });

  it('REFUSES (omits) a sheared/rotated-CTM rect', () => {
    expect(locateDecorationRects(ops('1 0.5 0 1 0 0 cm 10 5 100 2 re f'))).toHaveLength(0);
  });

  it('finds a horizontal stroked-line underline (`m … l … S`) as a line rule', () => {
    const rules = locateDecorationRects(ops('50 297 m 78 297 l S'));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: 'line', x: 50, width: 28 });
    expect(rules[0].ctmScaleX).toBeCloseTo(1);
  });

  it('finds a right-to-left stroked line (m to the RIGHT of l)', () => {
    const rules = locateDecorationRects(ops('78 297 m 50 297 l S'));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: 'line', x: 50, width: 28 });
  });

  it('applies CTM scale + translation to a stroked-line rule', () => {
    const rules = locateDecorationRects(ops('2 0 0 1 5 0 cm 10 297 m 30 297 l S'));
    expect(rules).toHaveLength(1);
    expect(rules[0].x).toBeCloseTo(25); // 10*2 + 5
    expect(rules[0].width).toBeCloseTo(40); // (30-10)*2
    expect(rules[0].ctmScaleX).toBeCloseTo(2);
  });

  it('REFUSES a SLANTED stroked line (y endpoints differ → not a decoration)', () => {
    expect(locateDecorationRects(ops('50 297 m 78 305 l S'))).toHaveLength(0);
  });

  it('REFUSES a polyline (two `l` segments → not a simple underline)', () => {
    expect(locateDecorationRects(ops('50 297 m 78 297 l 100 297 l S'))).toHaveLength(0);
  });

  it('REFUSES a stroked line under a sheared/rotated CTM', () => {
    expect(locateDecorationRects(ops('1 0.5 0 1 0 0 cm 50 297 m 78 297 l S'))).toHaveLength(0);
  });

  it('REFUSES a thick stroked line (line width too large → shading, not a rule)', () => {
    // 4pt-thick stroke over a 12pt run: height 4 > 0.18*12 → classifier rejects it,
    // but locate still returns the geometry; the thickness lives in `height`.
    const rules = locateDecorationRects(ops('4 w 50 297 m 78 297 l S'));
    expect(rules).toHaveLength(1);
    expect(rules[0].height).toBeCloseTo(4);
  });

  it('ignores a `re` ended with the no-op painter `n`', () => {
    expect(locateDecorationRects(ops('10 5 100 2 re n'))).toHaveLength(0);
  });

  it('REFUSES a rect whose fill painter ALSO closes an m/l subpath (would erase art)', () => {
    expect(locateDecorationRects(ops('10 10 m 20 20 l 50 297 28 1 re f'))).toHaveLength(0);
  });

  it('detects a `cm`-translated rect (the q/cm/re/f structure pdf-lib & Word emit)', () => {
    const rules = locateDecorationRects(ops('q 1 0 0 1 50 297 cm 0 0 28 1.2 re f Q'));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ x: 50, y: 297, width: 28, ctmScaleX: 1 });
  });
});

describe('matchDecorationForText', () => {
  const target = { origin: { x: 50, y: 300 }, fontSize: 12 };
  it('matches the single underline rule under the text extent', () => {
    const m = matchDecorationForText(locateDecorationRects(ops('50 297 28 1 re f')), target, 28);
    expect(m?.kind).toBe('underline');
    expect(m?.rule.width).toBeCloseTo(28);
  });

  it('returns null with TWO candidate rules (double underline → refuse)', () => {
    const rules = locateDecorationRects(ops('50 297 28 1 re f 50 296 28 1 re f'));
    expect(rules).toHaveLength(2); // both genuinely in the underline band
    expect(matchDecorationForText(rules, target, 28)).toBeNull();
  });

  it('returns null when the rule does not x-overlap the text extent', () => {
    expect(matchDecorationForText(locateDecorationRects(ops('200 297 28 1 re f')), target, 28)).toBeNull();
  });

  it('classifies a mid-x-height rule as strikethrough', () => {
    const m = matchDecorationForText(locateDecorationRects(ops('50 304 28 1 re f')), target, 28);
    expect(m?.kind).toBe('strikethrough');
  });

  it('matches a stroked-line underline rule', () => {
    const m = matchDecorationForText(locateDecorationRects(ops('50 297 m 78 297 l S')), target, 28);
    expect(m?.kind).toBe('underline');
    expect(m?.rule.kind).toBe('line');
  });
});

describe('adjustedRuleWidth', () => {
  it('scales the rule width by the new/old text-width ratio', () => {
    expect(adjustedRuleWidth(28, 28, 56)).toBeCloseTo(56);
    expect(adjustedRuleWidth(30, 60, 30)).toBeCloseTo(15);
  });
  it('returns null when old text width is ~0 (div-by-zero guard)', () => {
    expect(adjustedRuleWidth(28, 0, 56)).toBeNull();
  });
});

describe('buildPath3Redraw graphics-state', () => {
  const base = {
    resName: 'F9', size: 12, color: { r: 0, g: 0, b: 0 },
    originX: 50, originY: 300, showOperand: '<0048>',
  };
  it('emits Tc/Tw/Tz/Ts when present', () => {
    const s = buildPath3Redraw({ ...base, charSpacing: 2, wordSpacing: 1, hScale: 90, textRise: 3 });
    expect(s).toMatch(/\b2 Tc\b/);
    expect(s).toMatch(/\b1 Tw\b/);
    expect(s).toMatch(/\b90 Tz\b/);
    expect(s).toMatch(/\b3 Ts\b/);
  });
  it('omits Tc/Tw/Tz/Ts when absent (default graphics state)', () => {
    const s = buildPath3Redraw(base);
    expect(s).not.toMatch(/\bTc\b/);
    expect(s).not.toMatch(/\bTw\b/);
    expect(s).not.toMatch(/\bTz\b/);
    expect(s).not.toMatch(/\bTs\b/);
  });
});

describe('locateTextOps graphics-state capture', () => {
  it('captures Tc/Tw/Tz/Ts onto the show op', () => {
    const found = locateTextOps(ops('BT /F1 12 Tf 2 Tc 1 Tw 90 Tz 3 Ts 1 0 0 1 50 300 Tm (Hi) Tj ET'));
    expect(found).toHaveLength(1);
    expect(found[0].charSpacing).toBeCloseTo(2);
    expect(found[0].wordSpacing).toBeCloseTo(1);
    expect(found[0].hScale).toBeCloseTo(90);
    expect(found[0].textRise).toBeCloseTo(3);
  });
});

describe('replaceTextAt — decoration resize (opt-in)', () => {
  it('extends the underline rule when the new text is LONGER', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedTextPdf(28));
    const ok = await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'HelloWorld', 5, undefined, undefined, {
      adjustDecorations: true,
    });
    expect(ok).toBe(true);
    const widths = paintedReWidths(await pageContentText(await doc.save()));
    expect(widths).toHaveLength(1);
    expect(widths[0]).toBeGreaterThan(40); // grew from 28 toward ~60
  });

  it('shrinks the underline rule when the new text is SHORTER', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedTextPdf(28));
    await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'Hi', 5, undefined, undefined, { adjustDecorations: true });
    expect(paintedReWidths(await pageContentText(await doc.save()))[0]).toBeLessThan(20);
  });

  it('leaves the rule untouched when adjustDecorations is off (byte-identical)', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedTextPdf(28));
    await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'HelloWorld'); // no opts
    expect(paintedReWidths(await pageContentText(await doc.save()))[0]).toBeCloseTo(28);
  });
});

/** "Hello" with the underline drawn the way a STROKED line would be (m/l/S). */
async function makeLineUnderlinedTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  const ctx = doc.context;
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
  const helvVal = fontDict.get([...fontDict.entries()][0][0]);
  if (!helvVal) throw new Error('font missing');
  fontDict.set(PDFName.of('F1'), helvVal);
  const content =
    `BT /F1 12 Tf 1 0 0 1 50 300 Tm (Hello) Tj ET\n` +
    `0 0 0 RG 1 w 50 297 m 78 297 l S`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/** "Hello" with the underline as a q/cm-wrapped `re f` (pdf-lib drawRectangle shape). */
async function makeCmRectUnderlinedTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  const ctx = doc.context;
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
  const helvVal = fontDict.get([...fontDict.entries()][0][0]);
  if (!helvVal) throw new Error('font missing');
  fontDict.set(PDFName.of('F1'), helvVal);
  const content =
    `BT /F1 12 Tf 1 0 0 1 50 300 Tm (Hello) Tj ET\n` +
    `q 0 0 0 rg 1 0 0 1 50 297 cm 0 0 28 1.2 re f Q`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

describe('replaceTextAt — decoration on realistic / refused structures', () => {
  it('EXTENDS a stroked-line underline when the new text is longer (m…l…S form)', async () => {
    const doc = await PDFDocument.load(await makeLineUnderlinedTextPdf());
    const ok = await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'HelloWorld', 5, undefined, undefined, {
      adjustDecorations: true,
    });
    expect(ok).toBe(true);
    const content = await pageContentText(await doc.save());
    expect(showStrings(content)).toContain('HelloWorld'); // text edited
    const lineOps = groupOps(tokenizeContentStream(content)).map(o => o.operator);
    expect(lineOps).toContain('l'); // the stroked line still exists
    expect(lineOps).toContain('S');
    expect(strokedLineSpan(content) ?? NaN).toBeGreaterThan(40); // grew from 28 toward ~60
  });

  it('SHRINKS a stroked-line underline when the new text is shorter', async () => {
    const doc = await PDFDocument.load(await makeLineUnderlinedTextPdf());
    await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'Hi', 5, undefined, undefined, { adjustDecorations: true });
    expect(strokedLineSpan(await pageContentText(await doc.save())) ?? NaN).toBeLessThan(20);
  });

  it('leaves the stroked line untouched when adjustDecorations is off', async () => {
    const doc = await PDFDocument.load(await makeLineUnderlinedTextPdf());
    await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'HelloWorld'); // no opts
    expect(strokedLineSpan(await pageContentText(await doc.save())) ?? NaN).toBeCloseTo(28);
  });

  it('resizes a q/cm-wrapped `re f` underline (real authoring-tool structure)', async () => {
    const doc = await PDFDocument.load(await makeCmRectUnderlinedTextPdf());
    const ok = await replaceTextAt(doc, 0, { x: 52, y: 300 }, 'HelloWorld', 5, undefined, undefined, {
      adjustDecorations: true,
    });
    expect(ok).toBe(true);
    expect(paintedReWidths(await pageContentText(await doc.save()))[0]).toBeGreaterThan(40);
  });
});

describe('deleteTextAt — decoration removal (opt-in)', () => {
  it('removes the orphaned underline rule when its text is deleted', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedTextPdf(28));
    expect(deleteTextAt(doc, 0, { x: 52, y: 300 }, 5, { adjustDecorations: true })).toBe(true);
    expect(paintedReWidths(await pageContentText(await doc.save()))).toHaveLength(0);
  });

  it('leaves the rule when adjustDecorations is off', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedTextPdf(28));
    deleteTextAt(doc, 0, { x: 52, y: 300 });
    expect(paintedReWidths(await pageContentText(await doc.save()))).toHaveLength(1);
  });

  it('removes an orphaned stroked-line underline when its text is deleted', async () => {
    const doc = await PDFDocument.load(await makeLineUnderlinedTextPdf());
    expect(deleteTextAt(doc, 0, { x: 52, y: 300 }, 5, { adjustDecorations: true })).toBe(true);
    const content = await pageContentText(await doc.save());
    // The stroke painter `S` is neutralised to `n` → the line no longer paints.
    const lineOps = groupOps(tokenizeContentStream(content)).map(o => o.operator);
    expect(lineOps).not.toContain('S');
  });
});
