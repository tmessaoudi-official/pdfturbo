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
import { sweepUnreachableObjects } from './pdfObjectGc';

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
  const NAME_NEXT = PDFName.of('Next');

  /** `/S` is RESOLVED: any value may be indirect, and `/S 12 0 R` -> /JavaScript is a PDFRef. */
  const isJsAction = (v: unknown): boolean =>
    v instanceof PDFDict && ctx.lookup(v.get(NAME_S)) === NAME_JS;

  /**
   * Prune JavaScript out of an action's `/Next` chain, SPLICING rather than truncating: a removed
   * JS link's own `/Next` is reattached, so a `/URI` chained after a script still works. `/Next` may
   * be a single action or an ARRAY of them; both are walked, and a real engine runs both
   * (`pdf.worker.mjs` `_collectJS` recurses `getRaw("Next")` and array elements).
   *
   * `seen` guards a malformed cyclic chain — a sanitizer that hangs on a hostile file is its own
   * denial of service.
   */
  const pruneActionChain = (action: PDFDictT, seen: Set<unknown>): boolean => {
    if (seen.has(action)) return false;
    seen.add(action);
    let hit = false;
    for (;;) {
      const next = ctx.lookup(action.get(NAME_NEXT));
      if (next instanceof PDFArray) {
        const kept = next.asArray().filter(r => !isJsAction(ctx.lookup(r)));
        if (kept.length !== next.size()) {
          hit = true;
          if (kept.length === 0) action.delete(NAME_NEXT);
          else action.set(NAME_NEXT, ctx.obj(kept));
        }
        for (const r of kept) {
          const el = ctx.lookup(r);
          if (el instanceof PDFDict && pruneActionChain(el, seen)) hit = true;
        }
        return hit;
      }
      if (!(next instanceof PDFDict)) return hit;
      if (!isJsAction(next)) return pruneActionChain(next, seen) || hit;
      // Splice this JS link out and re-test whatever it pointed at.
      hit = true;
      const after = next.get(NAME_NEXT);
      if (after === undefined) { action.delete(NAME_NEXT); return hit; }
      action.set(NAME_NEXT, after);
    }
  };

  /**
   * Strip action vectors from one annotation, form field or outline item.
   *
   * Round 6 fixed the top-level `/S` and stopped there; round 7 found the CLASS still open — a
   * script reached through `/Next`, or listed in an array-valued `/A`, survived with the report
   * saying `false`. Fixing one member of a class and leaving its siblings is this repo's most
   * repeated defect, and this is now the second time it has happened to this one function.
   */
  const stripNodeActions = (node: PDFDictT): boolean => {
    let hit = node.delete(NAME_AA);
    const action = ctx.lookup(node.get(NAME_A));
    if (action instanceof PDFArray) {
      // `/A` should be a dictionary, but readers accept an array and run every entry.
      const kept = action.asArray().filter(r => !isJsAction(ctx.lookup(r)));
      if (kept.length !== action.size()) hit = true;
      if (kept.length === 0) { if (node.delete(NAME_A)) hit = true; }
      else {
        node.set(NAME_A, ctx.obj(kept));
        for (const r of kept) {
          const el = ctx.lookup(r);
          if (el instanceof PDFDict && pruneActionChain(el, new Set())) hit = true;
        }
      }
      return hit;
    }
    if (action instanceof PDFDict) {
      if (isJsAction(action)) {
        if (node.delete(NAME_A)) hit = true;
      } else if (pruneActionChain(action, new Set())) {
        hit = true;
      }
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
  // /Outlines — bookmarks were NOT walked at all until WS7 round 7, so a JavaScript action on a
  // bookmark survived every sanitize with `javascript` and `annotActions` both false. Note the two
  // meanings of /Next: on an outline ITEM it is the next SIBLING, on an action it is the next
  // ACTION. They are traversed separately and must not be conflated.
  const outlines = cat.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (outlines) {
    const seenItems = new Set<unknown>();
    const walkOutline = (itemRef: ReturnType<PDFDictT['get']>): void => {
      if (itemRef === undefined) return;
      const looked = ctx.lookup(itemRef) as object | undefined;
      if (!(looked instanceof PDFDict) || seenItems.has(looked)) return;
      // `instanceof` narrowing against pdf-lib's runtime class collapses to `never` here (its
      // classes carry a private `context`), so the walk goes through the type-only alias the rest
      // of this module already uses.
      const item = looked as unknown as PDFDictT;
      seenItems.add(item);
      if (stripNodeActions(item)) annotActions = true;
      walkOutline(item.get(PDFName.of('First')));
      walkOutline(item.get(NAME_NEXT));
    };
    walkOutline(outlines.get(PDFName.of('First')));
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
  // Everything above deletes REFERENCES. pdf-lib serialises every indirect object it holds and
  // performs no reachability collection, so the detached XMP stream and JavaScript action were
  // written straight back out — in PLAINTEXT, since this save passes `useObjectStreams: false`.
  // Measured end-to-end: both markers survived a sanitize. Three user-facing docs say those
  // artifacts are "stripped", so this was the promise being broken. [WS5 P1, 2026-09-04]
  //
  // Shared with `compressLossless`, which had the identical defect on the identical payload — see
  // the note in `pdfObjectGc.ts` for why it is one function and not two.
  sweepUnreachableObjects(
    ctx as never,
    { PDFRef, PDFStream, PDFDict, PDFArray } as never,
  );

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report };
}
