/**
 * Client-side PDF sanitizer (Wave 2 #53). Strips privacy/security artifacts from
 * a PDF without touching page content, using @cantoo/pdf-lib key-deletion only.
 * No new dependency; pdf-lib is dynamically imported like the rest of the export
 * layer so it stays out of the initial bundle.
 *
 * What it removes:
 *  - /Info document-information dictionary (Title/Author/Subject/Keywords/
 *    Producer/Creator/CreationDate/ModDate) — incl. pdf-lib's own producer stamp.
 *  - XMP /Metadata stream on the catalog AND on every page (per-page XMP).
 *  - /OpenAction (a common JavaScript launch vector).
 *  - /AA additional-actions dictionaries on the catalog and every page.
 *  - /AA on every annotation, and a JavaScript /A action on an annotation
 *    (/S /JavaScript). Hyperlink /A actions (/S /URI, /S /GoTo) SURVIVE.
 *  - AcroForm /XFA (XFA can carry script), and recursively each form field's
 *    /AA and JavaScript-only /A action (/Kids walked depth-first).
 *  - /AF associated-files arrays on the catalog and every page (PDF 2.0
 *    embedded-file vector).
 *  - /Names -> /JavaScript (document-level JS) and /Names -> /EmbeddedFiles
 *    (attached files) name trees; other Names sub-trees (e.g. /Dests) survive.
 *  - The trailer /ID (a privacy/tracking document identifier).
 *
 * It does NOT touch /Pages, page content streams, AcroForm field values,
 * hyperlink actions, or annotations' visual appearance — only metadata and
 * active-content vectors.
 */

// Type-only import (erased at build — keeps the runtime classes lazily loaded
// via the dynamic import() below). pdf-lib's concrete classes have non-public
// constructors, so InstanceType<typeof X> is rejected; the named types work.
import type { PDFDict as PDFDictT, PDFArray as PDFArrayT } from '@cantoo/pdf-lib';

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
  /**
   * Annotation or form-field actions removed: an annotation/field /AA, or a
   * JavaScript-only /A action (/S /JavaScript). Hyperlinks (/URI, /GoTo) are
   * preserved and never counted here.
   */
  annotActions: boolean;
  /** AcroForm /XFA stream removed. */
  xfa: boolean;
  /** Per-page XMP /Metadata stream removed from ≥1 page. */
  pageMetadata: boolean;
  /** /AF associated-files array removed from the catalog and/or a page. */
  associatedFiles: boolean;
  /** Trailer /ID document identifier cleared. */
  documentId: boolean;
}

export interface SanitizeResult {
  bytes: Uint8Array;
  report: SanitizeReport;
}

/** True when at least one artifact category was found and removed. */
export function anyRemoved(r: SanitizeReport): boolean {
  return (
    r.info ||
    r.metadata ||
    r.openAction ||
    r.additionalActions ||
    r.javascript ||
    r.embeddedFiles ||
    r.annotActions ||
    r.xfa ||
    r.pageMetadata ||
    r.associatedFiles ||
    r.documentId
  );
}

export async function sanitizePdf(input: Uint8Array): Promise<SanitizeResult> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream } = await import('@cantoo/pdf-lib');
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
    annotActions: false,
    xfa: false,
    pageMetadata: false,
    associatedFiles: false,
    documentId: false,
  };

  const NAME_A = PDFName.of('A');
  const NAME_AA = PDFName.of('AA');
  const NAME_S = PDFName.of('S');
  const NAME_JS = PDFName.of('JavaScript');

  /**
   * Strip action vectors from a single annotation or form-field node:
   *  - always delete /AA (additional actions);
   *  - delete /A ONLY when it resolves to a /S /JavaScript action — URI/GoTo
   *    hyperlinks must survive.
   * Returns true if either key was removed.
   */
  const stripNodeActions = (node: PDFDictT): boolean => {
    let hit = node.delete(NAME_AA);
    const action = ctx.lookup(node.get(NAME_A));
    if (action instanceof PDFDict && action.get(NAME_S) === NAME_JS) {
      if (node.delete(NAME_A)) hit = true;
    }
    return hit;
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
  let aa = cat.delete(NAME_AA);
  let annotActions = false;
  let pageMetadata = false;
  let associatedFiles = cat.delete(PDFName.of('AF'));

  // Per-page: additional actions, per-page XMP, associated files, and every
  // annotation's action vectors.
  for (const page of doc.getPages()) {
    const node = page.node;
    if (node.delete(NAME_AA)) aa = true;
    if (node.delete(PDFName.of('Metadata'))) pageMetadata = true;
    if (node.delete(PDFName.of('AF'))) associatedFiles = true;

    const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
      for (const ref of annots.asArray()) {
        const annot = ctx.lookup(ref);
        if (annot instanceof PDFDict && stripNodeActions(annot)) annotActions = true;
      }
    }
  }
  report.additionalActions = aa;
  report.pageMetadata = pageMetadata;
  report.associatedFiles = associatedFiles;

  // AcroForm: drop /XFA, then walk /Fields depth-first (each may have /Kids)
  // stripping /AA and JS-only /A from every field node.
  const acroForm = cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (acroForm) {
    report.xfa = acroForm.delete(PDFName.of('XFA'));
    const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (fields) {
      const seen = new Set<unknown>();
      const walk = (fieldArray: PDFArrayT): void => {
        for (const ref of fieldArray.asArray()) {
          const field = ctx.lookup(ref);
          if (!(field instanceof PDFDict) || seen.has(field)) continue;
          seen.add(field);
          if (stripNodeActions(field)) annotActions = true;
          const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray);
          if (kids) walk(kids);
        }
      };
      walk(fields);
    }
  }
  report.annotActions = annotActions;

  // /Names sub-trees: drop active-content trees, keep the rest (e.g. /Dests).
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) {
    report.javascript = names.delete(PDFName.of('JavaScript'));
    report.embeddedFiles = names.delete(PDFName.of('EmbeddedFiles'));
  }

  // Trailer /ID — a privacy/tracking document identifier.
  if (ctx.trailerInfo.ID) {
    ctx.trailerInfo.ID = undefined;
    report.documentId = true;
  }

  // ── Sweep the detached payloads out of the FILE, not just out of the catalog ────────────────
  // Everything above deletes REFERENCES (`cat.delete('/Metadata')`, `node.delete('/A')`). pdf-lib
  // serialises every indirect object it holds and performs no reachability collection, so the
  // detached XMP stream and JavaScript action were written straight back out — in PLAINTEXT, since
  // this save passes `useObjectStreams: false`. Measured end-to-end: both markers survived a
  // sanitize. Three user-facing docs say those artifacts are "stripped", so this was the promise
  // being broken, not a tidiness issue. [WS5 P1, 2026-09-04]
  //
  // Reachability from the roots is the right test rather than deleting the specific refs we
  // detached: an object may be referenced from somewhere else (a shared stream), and deleting it
  // blindly would corrupt the output — the one direction worse than leaving the orphan.
  // `Encrypt` belongs here: pdf-lib's PDFWriter writes `Encrypt: this.context.trailerInfo.Encrypt`
  // into the trailer, so omitting it would sweep the object the trailer still names and leave a
  // dangling reference. LATENT rather than live — the only caller assembles without encryption —
  // but `sanitizePdf` is an exported generic entry point. [WS7 round 1, 2026-09-04]
  const roots: unknown[] = [
    ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.ID, ctx.trailerInfo.Encrypt,
  ];
  const reached = new Set<string>();
  const queue: unknown[] = [];

  const visit = (value: unknown): void => {
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (reached.has(key)) return;
      reached.add(key);
      queue.push(ctx.lookup(value));
      return;
    }
    if (value instanceof PDFStream) { visit(value.dict); return; }
    if (value instanceof PDFDict) { for (const v of value.values()) visit(v); return; }
    if (value instanceof PDFArray) { for (let i = 0; i < value.size(); i++) visit(value.get(i)); }
  };

  for (const r of roots) visit(r);
  while (queue.length > 0) visit(queue.pop());

  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) ctx.delete(ref);
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report };
}
