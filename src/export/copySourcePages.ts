/**
 * Copy source pages into an export document WITH the source's optional-content settings (WS8 step 5, 2026-09-24).
 *
 * `PDFDocument.copyPages` copies a page and everything it references — including the optional-content groups its
 * `/Properties` name — but not the catalog's `/OCProperties`, which is where a document says which of those groups
 * are OFF. Without it every viewer treats every group as ON, so a layer the source switches off comes out VISIBLE in
 * the export. Measured before this fix: 0 dark pixels in the hidden layer's band on the original, 307 on the export;
 * an ON-layer control drew 164 on both. It reached every export that copies source pages, and the rasterising ones
 * (a page as image, a thumbnail, a redacted page) baked the hidden layer into pixels.
 *
 * The groups the page references and the groups `/OCProperties` lists must be the SAME objects in the export — pdf.js
 * and Acrobat match a group by reference — so both are copied with ONE `PDFObjectCopier`, whose memo maps each source
 * object to a single copy. This is `copyPages` itself (`PDFDocument.copyPages` is those same four lines) plus that one
 * extra `copy`.
 */
import type { PDFDict, PDFDocument, PDFPage } from '@cantoo/pdf-lib';

export interface CopiedSourcePages {
  pages: PDFPage[];
  /** The source's `/OCProperties`, copied into the destination's context; absent when the source has none. */
  ocProperties?: PDFDict;
}

export async function copySourcePages(dest: PDFDocument, src: PDFDocument, indices: number[]): Promise<CopiedSourcePages> {
  const { PDFObjectCopier, PDFPage: Page, PDFName, PDFDict: Dict } = await import('@cantoo/pdf-lib');
  await src.flush();
  const copier = PDFObjectCopier.for(src.context, dest.context);
  const srcPages = src.getPages();
  const pages = indices.map(i => {
    const node = copier.copy(srcPages[i].node);
    return Page.of(node, dest.context.register(node), dest);
  });
  const oc = src.catalog.lookupMaybe(PDFName.of('OCProperties'), Dict);
  return { pages, ocProperties: oc ? copier.copy(oc) : undefined };
}

/** Make `ocProperties` (from `copySourcePages` on this same destination) the destination's layer settings. */
export async function carryLayers(dest: PDFDocument, ocProperties: PDFDict): Promise<void> {
  const { PDFName } = await import('@cantoo/pdf-lib');
  dest.catalog.set(PDFName.of('OCProperties'), dest.context.register(ocProperties));
}

/**
 * One export page-set combines two or more sources that each carry layer settings, and at least one of them switches
 * a layer OFF. A PDF has ONE `/OCProperties`; merging two means reconciling their `/Order`, radio-button groups and
 * base states, which nothing here does — and dropping them would publish the hidden layer. So the export refuses.
 * (Two sources whose layers are all ON lose nothing by keeping neither: every group is visible either way.)
 */
export class ExportLayersConflictError extends Error {
  constructor() {
    super('EXPORT_LAYERS_CONFLICT: the export combines documents whose hidden layers cannot be carried into one file');
    this.name = 'ExportLayersConflictError';
  }
}
