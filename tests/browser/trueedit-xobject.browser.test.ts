/**
 * A3a (true-edit) — text inside a Form XObject is editable IN PLACE when the edit is
 * Path-1/2-safe (the engine writes the XObject's own content stream via
 * writeBack→setFormXObjectContent). Pre-A3a this always refused → overlay.
 *
 * Built at the object level: a Form XObject draws "Hello" in a STANDARD Helvetica
 * font (Path-1 safe), invoked on the page with an identity CTM so its text origin is
 * page-space (50, 120). We edit it to "World" and re-extract with real pdf.js to
 * prove the XObject stream changed. jsdom can't run pdf.js text extraction here.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFArray, PDFRawStream } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt, getEditableTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const ORIGIN = { x: 50, y: 120 };

/** One-page PDF whose only text ("Hello", Helvetica) lives inside a Form XObject. */
async function makeXObjectPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(' ', { x: 0, y: 0, size: 1, font }); // embed Helvetica → /Resources/Font
  const ctx = doc.context;
  const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDictRef = pageRes.get(PDFName.of('Font'));
  // pdf-lib named the embedded font; alias it to /F1 for a stable XObject reference.
  const fontDict = ctx.lookup(fontDictRef) as PDFDict;
  const helvVal = [...fontDict.entries()][0][1];
  fontDict.set(PDFName.of('F1'), helvVal);

  const xContent = `BT /F1 18 Tf 1 0 0 1 ${ORIGIN.x} ${ORIGIN.y} Tm (Hello) Tj ET`;
  const xBytes = new Uint8Array(xContent.length);
  for (let i = 0; i < xContent.length; i++) xBytes[i] = xContent.charCodeAt(i) & 0xff;
  const xDict = PDFDict.fromMapWithContext(new Map(), ctx);
  xDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  xDict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  const bbox = PDFArray.withContext(ctx);
  [0, 0, 300, 200].forEach(n => bbox.push(ctx.obj(n)));
  xDict.set(PDFName.of('BBox'), bbox);
  const xRes = PDFDict.fromMapWithContext(new Map(), ctx);
  if (fontDictRef) xRes.set(PDFName.of('Font'), fontDictRef);
  xDict.set(PDFName.of('Resources'), xRes);
  xDict.set(PDFName.of('Length'), ctx.obj(xBytes.length));
  const xRef = ctx.register(PDFRawStream.of(xDict, xBytes));
  const xobjDict = PDFDict.fromMapWithContext(new Map(), ctx);
  xobjDict.set(PDFName.of('X0'), xRef);
  pageRes.set(PDFName.of('XObject'), xobjDict);
  // Invoke the XObject with an identity CTM → its text origin is page-space.
  const pageContent = 'q 1 0 0 1 0 0 cm /X0 Do Q';
  const pBytes = new Uint8Array(pageContent.length);
  for (let i = 0; i < pageContent.length; i++) pBytes[i] = pageContent.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pBytes)));
  return doc.save();
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return (tc.items as Array<{ str: string }>).map(i => i.str).join('');
}

describe('true-edit — Path-1/2 text inside a Form XObject (A3a)', () => {
  it('edits XObject text in place (Path-1) and pdf.js reads the new text', async () => {
    const original = await makeXObjectPdf();
    expect(await extractText(original)).toContain('Hello'); // sanity: text is in the XObject

    // Prefill is now derivable for the (standard-font) XObject target.
    const docPrefill = await PDFDocument.load(original.slice(0));
    expect(await getEditableTextAt(docPrefill, 0, ORIGIN, 5)).toBe('Hello');

    const doc = await PDFDocument.load(original.slice(0));
    expect(await replaceTextAt(doc, 0, ORIGIN, 'World', 5)).toBe(true);
    const after = await extractText(await doc.save());
    expect(after).toContain('World');
    expect(after).not.toContain('Hello');
  });
});
