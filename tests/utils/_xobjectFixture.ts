/**
 * Shared fixture: a PDF whose ONLY text ("InsideXObj", at (50, 300) in form space) lives inside a Form XObject
 * drawn from the page by `Do`. Used by the jsdom and real-pdf.js true-edit tests, so both build the same file.
 *
 * Options (limits row 48): `pageDo` replaces the page's `q /Fx0 Do Q` (to place the form with a `cm`, or draw it
 * twice); `matrix` sets the form's /Matrix; `secondPage` adds a page naming the same form stream, whose content is
 * `secondPageContent` (default: it draws the form); `inheritResources` moves page 0's /Resources onto the Pages
 * node so every page inherits it; `alias` also registers the form as /Fx1 on page 0. `fill` (e.g. `'0 0 1'`) sets the
 * text's colour with an `rg` before the text object, so a colour edit has an operator to change.
 */
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, StandardFonts } from '@cantoo/pdf-lib';

export interface XObjectFixtureOptions {
  pageDo?: string;
  matrix?: number[];
  secondPage?: boolean;
  secondPageContent?: string;
  inheritResources?: boolean;
  alias?: boolean;
  fill?: string;
}

export async function makeXObjectTextPdf(opts: XObjectFixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Embed the font into the page once so the XObject can reference it by name.
  page.drawText(' ', { x: 0, y: 0, size: 1, font });

  const ctx = doc.context;
  // Form XObject content: draw "InsideXObj" at (50,300) in the XObject's space.
  const xContent = `q ${opts.fill ? `${opts.fill} rg ` : ''}BT /F1 12 Tf 1 0 0 1 50 300 Tm (InsideXObj) Tj ET Q`;
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
  if (opts.matrix) {
    const m = PDFArray.withContext(ctx);
    opts.matrix.forEach(n => m.push(ctx.obj(n)));
    xDict.set(PDFName.of('Matrix'), m);
  }
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
  if (opts.alias) xobjDict.set(PDFName.of('Fx1'), xRef);

  // Append a `Do` to the page content stream so the XObject is actually drawn.
  const pageContent = opts.pageDo ?? '\nq /Fx0 Do Q';
  const pcBytes = new Uint8Array(pageContent.length);
  for (let i = 0; i < pageContent.length; i++) pcBytes[i] = pageContent.charCodeAt(i) & 0xff;
  const doStream = ctx.stream(pcBytes);
  const doRef = ctx.register(doStream);
  const existing = page.node.get(PDFName.of('Contents'));
  const contentsArr = PDFArray.withContext(ctx);
  if (existing) contentsArr.push(existing);
  contentsArr.push(doRef);
  page.node.set(PDFName.of('Contents'), contentsArr);

  if (opts.secondPage) {
    // A second page naming the SAME form stream: an edit to it would change both pages if it draws it.
    const p2 = doc.addPage([400, 400]);
    if (opts.inheritResources) {
      p2.node.delete(PDFName.of('Resources'));
    } else {
      const xo2 = PDFDict.fromMapWithContext(new Map(), ctx);
      xo2.set(PDFName.of('Fx0'), xRef);
      const res2 = PDFDict.fromMapWithContext(new Map(), ctx);
      res2.set(PDFName.of('XObject'), xo2);
      p2.node.set(PDFName.of('Resources'), res2);
    }
    p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(opts.secondPageContent ?? 'q /Fx0 Do Q')));
  }

  if (opts.inheritResources) {
    // One /Resources on the Pages node, none on the leaves: every page NAMES the form, whatever it draws.
    doc.catalog.Pages().set(PDFName.of('Resources'), ctx.register(pageRes));
    page.node.delete(PDFName.of('Resources'));
  }

  return doc.save();
}
