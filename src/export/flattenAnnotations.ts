/**
 * Limits row 23 (D12) — "Flatten & download" draws each source annotation's normal appearance (`/AP /N`) into the
 * page, per ISO 32000 §12.5.5, and removes the annotation. Before this only AcroForm widgets were flattened
 * (`form.flatten()`); a sticky note, a stamp or a square authored elsewhere survived as an annotation (C12).
 *
 * The drawing mirrors what PDFturbo's own editor canvas shows — pdf.js rendering with no annotation-canvas map, which
 * paints every viewable annotation onto the page canvas (`pdf.mjs` `beginAnnotation`): clipped to the annotation's
 * /Rect, from the page's base transform, through `getTransformMatrix(rect, bbox, matrix)` (`pdf.worker.mjs`), and
 * inside its /OC marked content when it has one. So NoRotate is ignored on a rotated page, exactly as that canvas
 * ignores it. One difference is inherent: `Do` also clips to the form's /BBox, which pdf.js does not — identical
 * whenever the appearance stays inside its BBox, and spec-correct when it does not.
 *
 * Nothing here converts a frame: /Rect and the appearance live in the page's own user space, the same space as its
 * content stream, so the result is right at every /Rotate and CropBox by construction.
 */
import type { PDFDocument, PDFPage, PDFArray as PdfArray, PDFDict as PdfDict, PDFOperator as PdfOperator } from '@cantoo/pdf-lib';

/** Left as annotations on purpose, never counted: drawing their appearance would lose what they ARE. */
const KEPT_SUBTYPES = new Set([
  'Link',          // navigation — stays clickable
  'Popup',         // a markup annotation's window; removed only with its flattened parent
  'Redact',        // a PENDING redaction: its /N is the mark that one was placed; baked, it sits over live text
  'Widget',        // form.flatten()'s job; a widget it could not flatten would be baked showing a stale value
  'FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D', // the icon is not the payload
]);

// pdf.js AnnotationFlag: INVISIBLE 0x1, HIDDEN 0x2, NOVIEW 0x20 — `mustBeViewed` shows none of them.
const NOT_VIEWED = 0x1 | 0x2 | 0x20;

export interface FlattenAnnotationsResult {
  flattened: number;
  /** Annotations that were eligible but carry no usable appearance: left as they were. */
  skipped: number;
}

/** pdf.js `getTransformMatrix`: map the appearance's BBox, under its /Matrix, onto /Rect (§12.5.5, steps 1–2). */
export function appearanceTransform(
  rect: readonly number[], bbox: readonly number[], matrix: readonly number[],
): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = matrix;
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minX === maxX || minY === maxY) return [1, 0, 0, 1, rect[0], rect[1]];
  const xr = (rect[2] - rect[0]) / (maxX - minX);
  const yr = (rect[3] - rect[1]) / (maxY - minY);
  return [xr, 0, 0, yr, rect[0] - minX * xr, rect[1] - minY * yr];
}

/**
 * Flatten every page of `doc` in place. Popups are swept only after EVERY page is drawn: a popup may be listed on a
 * different page than its parent (the sanitizer met the same shape), and it must go with its parent wherever it is.
 */
export async function flattenDocumentAnnotations(doc: PDFDocument): Promise<FlattenAnnotationsResult> {
  const total: FlattenAnnotationsResult = { flattened: 0, skipped: 0 };
  const flattened = new Set<unknown>();
  for (const page of doc.getPages()) {
    const r = await drawPageAnnotations(doc, page, flattened);
    total.flattened += r.flattened;
    total.skipped += r.skipped;
  }
  for (const page of doc.getPages()) await pruneAnnots(doc, page, flattened);
  return total;
}

/** Flatten one page in place (its popups included). */
export async function flattenPageAnnotations(doc: PDFDocument, page: PDFPage): Promise<FlattenAnnotationsResult> {
  const flattened = new Set<unknown>();
  const r = await drawPageAnnotations(doc, page, flattened);
  await pruneAnnots(doc, page, flattened);
  return r;
}

/** Remove the flattened annotations, and every popup whose parent was flattened, from `page`'s /Annots. */
async function pruneAnnots(doc: PDFDocument, page: PDFPage, flattened: Set<unknown>): Promise<void> {
  if (!flattened.size) return;
  const { PDFName, PDFDict, PDFArray } = await import('@cantoo/pdf-lib');
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  const kept = PDFArray.withContext(doc.context);
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i);
    if (flattened.has(annot)) continue;
    // A popup is its parent's window; once the parent is page content it points at nothing.
    if (annot instanceof PDFDict && annot.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Popup') {
      const parent = annot.get(PDFName.of('Parent'));
      if (parent && flattened.has(doc.context.lookup(parent))) continue;
    }
    kept.push(annots.get(i));
  }
  if (kept.size() === annots.size()) return;
  if (kept.size()) page.node.set(PDFName.of('Annots'), kept);
  else page.node.delete(PDFName.of('Annots'));
}

/** Draw `page`'s flattenable annotations into its content and add them to `flattenedDicts`; /Annots is untouched. */
async function drawPageAnnotations(
  doc: PDFDocument, page: PDFPage, flattenedDicts: Set<unknown>,
): Promise<FlattenAnnotationsResult> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFStream, PDFOperator, PDFOperatorNames: Op } = lib;
  const ctx = doc.context;
  const result: FlattenAnnotationsResult = { flattened: 0, skipped: 0 };
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots || annots.size() === 0) return result;

  const nums = (arr: PdfArray | undefined, n: number): number[] | null => {
    if (!arr || arr.size() !== n) return null;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = arr.lookup(i);
      if (!(v instanceof PDFNumber)) return null;
      out.push(v.asNumber());
    }
    return out;
  };
  const nameOf = (d: PdfDict, key: string): string | undefined =>
    d.lookupMaybe(PDFName.of(key), PDFName)?.decodeText();

  const ops: PdfOperator[] = [];
  let resources: PdfDict | undefined;
  const props = () => {
    resources ??= page.node.normalizedEntries().Resources;
    let p = resources.lookupMaybe(PDFName.of('Properties'), PDFDict);
    if (!p) { p = ctx.obj({}); resources.set(PDFName.of('Properties'), p); }
    return p;
  };
  const uniqueProp = (p: PdfDict) => {
    let i = 1;
    while (p.has(PDFName.of(`PdfturboOC${i}`))) i++;
    return PDFName.of(`PdfturboOC${i}`);
  };

  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i);
    if (!(annot instanceof PDFDict)) continue;
    const subtype = nameOf(annot, 'Subtype');
    if (!subtype || KEPT_SUBTYPES.has(subtype)) continue;
    const flags = annot.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
    if (flags & NOT_VIEWED) continue;

    // pdf.js `setAppearance`: /N itself when it is a stream, else the /AS state inside it — no fallback.
    const raw = annot.lookup(PDFName.of('Rect'));
    const r = nums(raw instanceof PDFArray ? raw : undefined, 4);
    const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict);
    let nRaw = ap?.get(PDFName.of('N'));
    let n = nRaw ? ctx.lookup(nRaw) : undefined;
    if (n instanceof PDFDict && !(n instanceof PDFStream)) {
      const as = annot.lookupMaybe(PDFName.of('AS'), PDFName);
      nRaw = as ? n.get(as) : undefined;
      n = nRaw ? ctx.lookup(nRaw) : undefined;
    }
    if (!r || !(n instanceof PDFStream)) { result.skipped++; continue; }
    const rect = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
    const w = rect[2] - rect[0], h = rect[3] - rect[1];
    if (w <= 0 || h <= 0) { result.skipped++; continue; }

    // `Do` needs a Form XObject with a BBox; pdf.js reads the stream as one whatever it declares, and defaults the
    // BBox to the rect's size. The stream belongs to this throwaway load of the source, so it is safe to complete it.
    const sd = n.dict;
    if (!sd.has(PDFName.of('Subtype'))) sd.set(PDFName.of('Subtype'), PDFName.of('Form'));
    let bbox = nums(sd.lookupMaybe(PDFName.of('BBox'), PDFArray), 4);
    if (!bbox) { bbox = [0, 0, w, h]; sd.set(PDFName.of('BBox'), ctx.obj(bbox)); }
    const matrix = nums(sd.lookupMaybe(PDFName.of('Matrix'), PDFArray), 6) ?? [1, 0, 0, 1, 0, 0];
    const ref = nRaw instanceof PDFRef ? nRaw : ctx.register(n);
    const xName = page.node.newXObject('PdfturboAnnot', ref);

    const oc = annot.get(PDFName.of('OC'));
    if (oc) {
      const p = props();
      const key = uniqueProp(p);
      p.set(key, oc);
      ops.push(PDFOperator.of(Op.BeginMarkedContentSequence, [PDFName.of('OC'), key]));
    }
    ops.push(
      PDFOperator.of(Op.PushGraphicsState),
      PDFOperator.of(Op.AppendRectangle, [rect[0], rect[1], w, h].map(v => PDFNumber.of(v))),
      PDFOperator.of(Op.ClipNonZero),
      PDFOperator.of(Op.EndPath),
      PDFOperator.of(Op.ConcatTransformationMatrix, appearanceTransform(rect, bbox, matrix).map(v => PDFNumber.of(v))),
      PDFOperator.of(Op.DrawObject, [xName]),
      PDFOperator.of(Op.PopGraphicsState),
    );
    if (oc) ops.push(PDFOperator.of(Op.EndMarkedContent));
    flattenedDicts.add(annot);
    result.flattened++;
  }
  if (!result.flattened) return result;

  // pdf-lib wraps the existing content in q…Q before the first append, so these draw from the page's base
  // transform, as pdf.js's `beginAnnotation` does — pinned by a fixture whose content leaves a `cm` behind.
  page.pushOperators(...ops);
  return result;
}
