/**
 * Limits row 47 — true-edit composed a nested `cm` as CTM × M instead of M × CTM (PDF: a later `cm` applies to
 * the point first). For a translation followed by a scale, every run's origin landed somewhere pdf.js does not
 * draw it: measured on the corpus, all 50,243 runs of Publication 17 moved, and the correct order met a pdf.js
 * item origin 47,174 times against 482 for the old one.
 *
 * Two failure shapes, both pinned here against REAL pdf.js origins (never the editor's own arithmetic):
 *   - a click on a run drawn under translate-then-scale found nothing (the edit fell back to an overlay);
 *   - worse, a click on a DIFFERENT run B found A, because A's wrongly placed origin sat exactly on B —
 *     the edit changed text the user did not click. The fixture is built so the old order puts A on B.
 *
 * A = "AAAA" under `1 0 0 1 40 40 cm 2 0 0 2 0 0 cm` at Td (10, 20): drawn at (60, 80); the old order put it at
 * (100, 120). B = "BBBB" at identity CTM, drawn at (100, 120).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, PDFName } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt, getEditableTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const A = { x: 60, y: 80 };
const B = { x: 100, y: 120 };

async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([300, 300]);
  page.node.set(PDFName.of('Resources'), pdf.context.register(pdf.context.obj({ Font: { Helv: helv.ref } })));
  const content =
    'q 1 0 0 1 40 40 cm 2 0 0 2 0 0 cm 0 0 0 rg BT /Helv 12 Tf 10 20 Td (AAAA) Tj ET Q\n' +
    `0 0 0 rg BT /Helv 12 Tf ${B.x} ${B.y} Td (BBBB) Tj ET`;
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(bytes)));
  return pdf.save();
}

/** pdf.js's own text items: string and origin. */
async function items(bytes: Uint8Array): Promise<{ str: string; x: number; y: number }[]> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const out = (tc.items as { str?: string; transform?: number[] }[])
    .filter(i => i.str && i.transform)
    .map(i => ({ str: i.str as string, x: (i.transform as number[])[4], y: (i.transform as number[])[5] }));
  await doc.loadingTask.destroy();
  return out;
}

const at = (list: { str: string; x: number; y: number }[], p: { x: number; y: number }) =>
  list.find(i => Math.abs(i.x - p.x) < 0.5 && Math.abs(i.y - p.y) < 0.5)?.str;

describe('true-edit — nested cm composes in PDF order (limits row 47)', () => {
  it('fixture: pdf.js draws A at (60, 80) and B at (100, 120)', async () => {
    const list = await items(await makePdf());
    expect(at(list, A)).toBe('AAAA');
    expect(at(list, B)).toBe('BBBB');
  });

  it('a click on A finds A', async () => {
    const doc = await PDFDocument.load(await makePdf());
    expect(getEditableTextAt(doc, 0, A, 3)).toBe('AAAA');
  });

  it('an edit at A changes A and leaves B', async () => {
    const doc = await PDFDocument.load(await makePdf());
    expect(await replaceTextAt(doc, 0, A, 'AXAA', 3)).toBe(true);
    const list = await items(await doc.save());
    expect(at(list, A)).toBe('AXAA');
    expect(at(list, B)).toBe('BBBB');
  });

  it('an edit at B changes B, never A', async () => {
    const doc = await PDFDocument.load(await makePdf());
    expect(await replaceTextAt(doc, 0, B, 'BXBB', 3)).toBe(true);
    const list = await items(await doc.save());
    expect(at(list, B)).toBe('BXBB');
    expect(at(list, A)).toBe('AAAA');
  });

  // Paths 1/2 swap bytes in place, so their position is right whatever the origin says. Path 3 (forced by a
  // non-ASCII WinAnsi character) blanks the run and appends a redraw placed FROM the origin — the one path that
  // reads it for output.
  it('a Path-3 redraw of A lands where A was drawn', async () => {
    const doc = await PDFDocument.load(await makePdf());
    expect(await replaceTextAt(doc, 0, A, 'AöAA', 3)).toBe(true);
    const list = await items(await doc.save());
    expect(at(list, A)).toBe('AöAA');
    expect(at(list, B)).toBe('BBBB');
  });
});
