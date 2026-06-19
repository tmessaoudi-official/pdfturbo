import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import {
  replaceTextAt,
  groupOps,
  tokenizeContentStream,
} from '../../src/utils/contentStreamEditor';

// ── Repro/guard: sequential true-edits at the SAME origin ────────────────────
//
// Reported bug: "first edit mostly works, but from the second it resets / texts
// sit on top of each other". Root cause: Path 3 (standard-font redraw) BLANKS the
// original show op in place and APPENDS a redraw at the end of the stream. On the
// next edit, `findTarget` sees two ops at the same origin — the blanked ghost
// (lower opIndex) and the live redraw — and the ghost wins the distance tie. The
// second edit then mutates the ghost while the first redraw lingers ⇒ two visible
// strings overlap (or, if the ghost stays empty, the edit appears to "reset").
//
// Guard = count the VISIBLE (non-empty) shown strings after save+reload. Correct
// behaviour is exactly ONE, carrying the latest text.

function bytesToLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

async function pageContentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  if (!contents) return '';
  if (contents instanceof PDFRawStream) return bytesToLatin1(decodePDFRawStream(contents).decode());
  const arr = contents as unknown as { size(): number; get(i: number): unknown };
  let out = '';
  for (let i = 0; i < arr.size(); i++) {
    const stream = doc.context.lookup(arr.get(i) as Parameters<typeof doc.context.lookup>[0]);
    if (stream instanceof PDFRawStream) out += bytesToLatin1(decodePDFRawStream(stream).decode()) + '\n';
  }
  return out;
}

/** All non-empty shown strings (hex-decoded) from a content stream. */
function visibleStrings(content: string): string[] {
  const ops = groupOps(tokenizeContentStream(content));
  const out: string[] = [];
  for (const op of ops) {
    if (!['Tj', "'", '"', 'TJ'].includes(op.operator)) continue;
    const toks =
      op.operator === 'TJ'
        ? (op.operands[0]?.items ?? []).filter(t => t.type === 'string' || t.type === 'hexstring')
        : [op.operands[op.operands.length - 1]];
    for (const t of toks) {
      if (!t) continue;
      let s = '';
      if (t.type === 'hexstring') {
        const hex = t.raw.slice(1, -1).replace(/\s+/g, '');
        for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      } else if (t.type === 'string') {
        s = t.raw.slice(1, -1);
      }
      if (s.trim().length > 0) out.push(s);
    }
  }
  return out;
}

async function makeHelloPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 800]).drawText('HELLO', { x: 100, y: 700, size: 20, font });
  return doc.save();
}

const ORIGIN = { x: 100, y: 700 };

describe('sequential true-edits at the same origin (overlap / reset bug)', () => {
  it('second edit replaces — first Path-3 redraw must not linger', async () => {
    const bytes = await makeHelloPdf();

    // Edit 1: restyle (bold) forces Path 3 → blanks original + appends redraw.
    const doc1 = await PDFDocument.load(bytes.slice(0));
    expect(await replaceTextAt(doc1, 0, ORIGIN, 'HELLO', 3, { bold: true })).toBe(true);
    const bytes1 = await doc1.save();
    const after1 = visibleStrings(await pageContentText(bytes1));
    expect(after1.filter(s => s.includes('HELLO')).length).toBe(1);

    // Edit 2 at the SAME origin: HELLO → WORLD.
    const doc2 = await PDFDocument.load(bytes1.slice(0));
    expect(await replaceTextAt(doc2, 0, ORIGIN, 'WORLD', 3)).toBe(true);
    const after2 = visibleStrings(await pageContentText(await doc2.save()));

    expect(after2.some(s => s.includes('WORLD'))).toBe(true);
    expect(after2.some(s => s.includes('HELLO'))).toBe(false); // stale redraw must be gone
    expect(after2.length).toBe(1); // exactly one visible string, no overlap
  });

  it('three sequential Path-3 edits never accumulate redraws', async () => {
    let bytes = await makeHelloPdf();
    const texts = ['AAAA', 'BBBB', 'CCCC'];
    for (const txt of texts) {
      const doc = await PDFDocument.load(bytes.slice(0));
      expect(await replaceTextAt(doc, 0, ORIGIN, txt, 3, { bold: true })).toBe(true);
      bytes = await doc.save();
    }
    const visible = visibleStrings(await pageContentText(bytes));
    expect(visible.some(s => s.includes('CCCC'))).toBe(true);
    expect(visible.some(s => s.includes('AAAA') || s.includes('BBBB'))).toBe(false);
    expect(visible.length).toBe(1);
  });
});
