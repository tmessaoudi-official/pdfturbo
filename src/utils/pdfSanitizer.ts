/**
 * Client-side PDF sanitizer (Wave 2 #53). Strips privacy/security artifacts from
 * a PDF without touching page content, using @cantoo/pdf-lib key-deletion only.
 * No new dependency; pdf-lib is dynamically imported like the rest of the export
 * layer so it stays out of the initial bundle.
 *
 * What it removes:
 *  - /Info document-information dictionary (Title/Author/Subject/Keywords/
 *    Producer/Creator/CreationDate/ModDate) — incl. pdf-lib's own producer stamp.
 *  - XMP /Metadata stream on the catalog.
 *  - /OpenAction (a common JavaScript launch vector).
 *  - /AA additional-actions dictionaries on the catalog and every page.
 *  - /Names -> /JavaScript (document-level JS) and /Names -> /EmbeddedFiles
 *    (attached files) name trees; other Names sub-trees (e.g. /Dests) survive.
 *
 * It does NOT touch /Pages, page content streams, AcroForm field values, or
 * annotations' visual appearance — only metadata and active-content vectors.
 */

export interface SanitizeReport {
  /** /Info dictionary had ≥1 entry and was cleared. */
  info: boolean;
  /** XMP /Metadata stream removed from the catalog. */
  metadata: boolean;
  /** /OpenAction removed. */
  openAction: boolean;
  /** /AA additional actions removed (catalog and/or any page). */
  additionalActions: boolean;
  /** /Names -> /JavaScript removed. */
  javascript: boolean;
  /** /Names -> /EmbeddedFiles removed. */
  embeddedFiles: boolean;
}

export interface SanitizeResult {
  bytes: Uint8Array;
  report: SanitizeReport;
}

/** True when at least one artifact category was found and removed. */
export function anyRemoved(r: SanitizeReport): boolean {
  return r.info || r.metadata || r.openAction || r.additionalActions || r.javascript || r.embeddedFiles;
}

export async function sanitizePdf(input: Uint8Array): Promise<SanitizeResult> {
  const { PDFDocument, PDFName, PDFDict } = await import('@cantoo/pdf-lib');
  // updateMetadata:false — otherwise pdf-lib re-stamps Producer + ModDate into
  // /Info at load time, re-injecting the very identifying metadata we strip.
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const ctx = doc.context;
  const cat = doc.catalog;

  const report: SanitizeReport = {
    info: false,
    metadata: false,
    openAction: false,
    additionalActions: false,
    javascript: false,
    embeddedFiles: false,
  };

  // /Info — clear every entry, then drop the dictionary from the trailer.
  const infoObj = ctx.trailerInfo.Info;
  if (infoObj) {
    const infoDict = ctx.lookup(infoObj);
    if (infoDict instanceof PDFDict) {
      const keys = infoDict.keys();
      if (keys.length > 0) {
        report.info = true;
        for (const k of keys) infoDict.delete(k);
      }
    }
    ctx.trailerInfo.Info = undefined;
  }

  // Catalog-level removals.
  report.metadata = cat.delete(PDFName.of('Metadata'));
  report.openAction = cat.delete(PDFName.of('OpenAction'));
  let aa = cat.delete(PDFName.of('AA'));

  // Per-page additional actions.
  for (const page of doc.getPages()) {
    if (page.node.delete(PDFName.of('AA'))) aa = true;
  }
  report.additionalActions = aa;

  // /Names sub-trees: drop active-content trees, keep the rest (e.g. /Dests).
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) {
    report.javascript = names.delete(PDFName.of('JavaScript'));
    report.embeddedFiles = names.delete(PDFName.of('EmbeddedFiles'));
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report };
}
