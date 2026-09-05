/**
 * Client-side PDF sanitizer (Wave 2 #53). Strips privacy/security artifacts from
 * a PDF without touching page content, using @cantoo/pdf-lib key-deletion only.
 * No new dependency; pdf-lib is dynamically imported like the rest of the export
 * layer so it stays out of the initial bundle.
 *
 * What it removes:
 *  - /Info document-information dictionary (Title/Author/Subject/Keywords/
 *    Producer/Creator/CreationDate/ModDate) — incl. pdf-lib's own producer stamp.
 *  - XMP /Metadata streams on EVERY object — catalog, pages, form and image XObjects, fonts
 *    (PDF 32000 §14.3.2 allows one on any stream, and Photoshop/Illustrator images routinely
 *    carry CreatorTool, DocumentID and dc:creator there) [WS7 round 9].
 *  - /PieceInfo private application data on every object (Illustrator/InDesign embed the full
 *    source document with author paths there) [WS7 round 9].
 *  - /OpenAction (a common JavaScript launch vector).
 *  - /AA additional-actions dictionaries on EVERY dictionary in the file — catalog, pages, the
 *    /Pages tree above them, annotations, fields and their /Parent chain, bookmarks. pdf.js reads
 *    /AA by INHERITANCE (`collectActions` walks /Parent up to the page-tree root), so a script on
 *    the /Pages root or on a widget's unlisted parent field ran after sanitize while the report
 *    said clean [WS7 round 9, two P1s]. /A is NOT inherited and is spliced per node, below.
 *  - A 3D annotation's /3DD /OnInstantiate script [WS7 round 9].
 *  - /AA on every annotation, form field and /Outlines bookmark, and — spliced out of the
 *    /A action chain at EVERY position (head, /Next, array element, cycle) — any action that
 *    executes script (/S /JavaScript, /S /Rendition carrying /JS) or reaches OUTSIDE the
 *    document without one: /S /SubmitForm (posts form data to a URL), /S /Launch (starts an
 *    external application), /S /GoToR and /S /GoToE (open another document), /S /ImportData
 *    (reads a file into the form) [developer ruling, 2026-09-05]. A continuation chained
 *    behind a removed action is promoted into its place, so hyperlink /A actions
 *    (/S /URI, /S /GoTo, /S /Named) SURVIVE even when a script preceded them.
 *  - /FileAttachment ("paperclip") annotations, together with their /Popup (on whichever page
 *    it is listed) and the /FS→/EF file they carry, so the attached bytes leave the FILE and not
 *    only the annotation list — including a paperclip listed on no page and reached only through
 *    AcroForm /Fields → /Kids [WS7 round 9].
 *  - /AF associated-files arrays on EVERY object — catalog, pages, annotations, fields, bookmarks
 *    AND XObjects (PDF 2.0 §14.13 allows /AF on a form or image): /AF is a second path from a
 *    dict to a Filespec, and a paperclip that carried both /FS and /AF kept its file through the
 *    first version of the paperclip strip whenever anything still referenced the dict [review of
 *    3fc0863, 2026-09-05; XObjects added by WS7 round 9].
 *  - **The Filespec itself loses /EF and /RF**, wherever it was reached from. A Filespec is an
 *    object and may be shared — by a paperclip and a kept /Rendition media clip's /D, say — so
 *    deleting the REFERENCE alone left the sweep a live path to the bytes with the flag saying
 *    removed [WS7 round 9]. A media clip that shared it degrades to a name-only file reference.
 *  - AcroForm /XFA (XFA can carry script), and recursively each form field's
 *    /AA and JavaScript-only /A action (/Kids walked depth-first).
 *  - /Names -> /JavaScript (document-level JS) and /Names -> /EmbeddedFiles
 *    (attached files) name trees; other Names sub-trees (e.g. /Dests) survive.
 *  - The trailer /ID (a privacy/tracking document identifier).
 *
 * It does NOT touch page content streams, AcroForm field values, hyperlink actions, or
 * annotations' visual appearance — only metadata, active-content and egress vectors. Not
 * stripped, and deliberately: /S /Rendition WITHOUT /JS, /Sound, /Movie, /GoTo3DView and
 * /RichMediaExecute are media playback inside the document (pdf.js runs none of them), and
 * stripping them would delete legitimate content to no security end.
 *
 * Structure: targeted walks first (catalog, pages, listed annotations, /Fields downward,
 * bookmarks), then ONE pass over every dictionary in the file as the backstop for whatever no
 * walk reaches. The walks carry the per-surface reporting; the backstop carries the guarantee.
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
  /**
   * /AA additional actions removed from the catalog, a page, or ANY other dictionary — the
   * /Pages tree above a page, a widget's parent field that /Fields never names. pdf.js inherits
   * /AA through /Parent, so those two ran their scripts after sanitize [WS7 round 9].
   */
  additionalActions: boolean;
  /** /Names -> /JavaScript removed. */
  javascript: boolean;
  /** /Names -> /EmbeddedFiles removed. */
  embeddedFiles: boolean;
  /**
   * Annotation or form-field actions removed: an annotation/field /AA, a JavaScript-only /A
   * action (/S /JavaScript), or a 3D annotation's /OnInstantiate script. Hyperlinks (/URI, /GoTo)
   * are preserved and never counted here.
   */
  annotActions: boolean;
  /**
   * A non-JavaScript EGRESS action removed from an annotation, form field or bookmark:
   * /SubmitForm, /Launch, /GoToR, /GoToE or /ImportData [developer ruling, 2026-09-05].
   * Counted separately from `annotActions` so the toast's artifact count says which it found.
   */
  externalActions: boolean;
  /**
   * ≥1 /FileAttachment annotation removed together with its /Popup and embedded file — listed on
   * a page, or reached only through AcroForm /Fields → /Kids [WS7 round 9].
   */
  fileAttachments: boolean;
  /** AcroForm /XFA stream removed. */
  xfa: boolean;
  /**
   * XMP /Metadata stream removed from ≥1 page, or from any other object than the catalog — a
   * form or image XObject, a font [WS7 round 9].
   */
  pageMetadata: boolean;
  /** /AF associated-files array removed from any object (catalog, page, annotation, field, bookmark, XObject). */
  associatedFiles: boolean;
  /** /PieceInfo private application data removed from ≥1 object [WS7 round 9]. */
  pieceInfo: boolean;
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
    r.externalActions ||
    r.fileAttachments ||
    r.xfa ||
    r.pageMetadata ||
    r.associatedFiles ||
    r.pieceInfo ||
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
    externalActions: false,
    fileAttachments: false,
    xfa: false,
    pageMetadata: false,
    associatedFiles: false,
    pieceInfo: false,
    documentId: false,
  };

  const NAME_A = PDFName.of('A');
  const NAME_AA = PDFName.of('AA');
  const NAME_S = PDFName.of('S');
  const NAME_JS = PDFName.of('JavaScript');

  const NAME_NEXT = PDFName.of('Next');
  const NAME_JS_ENTRY = PDFName.of('JS');
  const NAME_RENDITION = PDFName.of('Rendition');
  const NAME_SUBTYPE = PDFName.of('Subtype');
  const NAME_FILE_ATTACHMENT = PDFName.of('FileAttachment');
  const NAME_PARENT = PDFName.of('Parent');
  const NAME_POPUP = PDFName.of('Popup');
  const NAME_FS = PDFName.of('FS');
  const NAME_AF = PDFName.of('AF');
  const NAME_EF = PDFName.of('EF');
  const NAME_RF = PDFName.of('RF');
  const NAME_METADATA = PDFName.of('Metadata');
  const NAME_PIECE_INFO = PDFName.of('PieceInfo');
  const NAME_ON_INSTANTIATE = PDFName.of('OnInstantiate');
  const NAME_TYPE = PDFName.of('Type');
  const NAME_ANNOT = PDFName.of('Annot');
  const NAME_RECT = PDFName.of('Rect');
  let associatedFiles = false;
  let fileAttachments = false;
  let pieceInfo = false;
  let annotActions = false;

  /**
   * Cut the embedded bytes out of a Filespec — or an array of them, or a reference to either —
   * wherever the Filespec was reached from. A Filespec is an OBJECT and can be shared: the
   * paperclip's /FS, the catalog's /AF and a kept /Rendition media clip's /D may all name the same
   * one, so deleting the REFERENCE on the paperclip left the sweep a live path to /EF through the
   * holder that was kept — measured by the round-9 safety lens as `fileAttachments: true` with the
   * file still in the bytes. The Filespec keeps its name (/F, /UF) and loses /EF and /RF; a media
   * clip that shared it degrades to an external reference, which is the ruling's direction.
   */
  const severFilespecs = (value: unknown, seen: Set<unknown> = new Set()): void => {
    const resolved = ctx.lookup(value as never) as object | undefined;
    if (resolved === undefined || seen.has(resolved)) return;
    seen.add(resolved);
    if (resolved instanceof PDFArray) {
      for (const el of (resolved as unknown as PDFArrayT).asArray()) severFilespecs(el, seen);
      return;
    }
    if (!(resolved instanceof PDFDict)) return;
    const fs = resolved as unknown as PDFDictT;
    fs.delete(NAME_EF);
    fs.delete(NAME_RF);
  };

  /** Sever every Filespec an /AF names, then drop the key. True when there was one. */
  const cutAssociatedFiles = (node: PDFDictT): boolean => {
    const af = node.get(NAME_AF);
    if (af === undefined) return false;
    severFilespecs(af);
    node.delete(NAME_AF);
    return true;
  };

  /** An /EmbeddedFiles name tree: sever every Filespec it names, through /Kids. */
  const severEmbeddedFilesTree = (node: unknown, seen: Set<unknown>): void => {
    const looked = ctx.lookup(node as never) as object | undefined;
    if (!(looked instanceof PDFDict) || seen.has(looked)) return;
    seen.add(looked);
    const dict = looked as unknown as PDFDictT;
    const names = dict.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (names) {
      const arr = names.asArray();
      for (let i = 1; i < arr.length; i += 2) severFilespecs(arr[i]);
    }
    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (const kid of kids.asArray()) severEmbeddedFilesTree(kid, seen);
  };

  const isPaperclip = (d: PDFDictT): boolean => ctx.lookup(d.get(NAME_SUBTYPE)) === NAME_FILE_ATTACHMENT;
  /**
   * The non-JavaScript EGRESS class — actions that reach outside the document without running
   * script. Ruled 2026-09-05 after the round-8 panel found `/SubmitForm` and `/Launch` surviving
   * with their URLs intact: `/SubmitForm` posts form data to a remote URL, `/Launch` starts an
   * external application or file, `/GoToR`/`/GoToE` open another document, `/ImportData` reads a
   * file into the form. Ruled as a CLASS rather than the two the panel named, because fixing one
   * member and leaving its siblings is the defect shape this module has already suffered three
   * times. `/URI` is egress too and is the one hyperlink SECURITY.md promises survives.
   */
  const EGRESS_SUBTYPES = new Set([
    PDFName.of('SubmitForm'), PDFName.of('Launch'), PDFName.of('GoToR'), PDFName.of('GoToE'),
    PDFName.of('ImportData'),
  ]);
  let externalActions = false;

  /**
   * Does this action execute script?
   *
   * `/S` is RESOLVED: any value may be indirect, and `/S 12 0 R` -> /JavaScript is a PDFRef.
   *
   * `/S /Rendition` counts when it carries a `/JS` entry, which a reader runs at `/OP 4`. That is
   * JavaScript by any reading, it survived every sanitize with `report.javascript` saying `false`,
   * and `SECURITY.md` marks the JavaScript row `[pinned]` to claim a test vouches for it [WS7 r8].
   * The discriminator is the `/JS` entry and NOT the `/Rendition` subtype: a rendition without one
   * is ordinary multimedia content, and stripping those would delete legitimate media to no
   * security end.
   */
  const isScriptAction = (v: unknown): boolean => {
    if (!(v instanceof PDFDict)) return false;
    const s = ctx.lookup(v.get(NAME_S));
    if (s === NAME_JS) return true;
    return s === NAME_RENDITION && v.get(NAME_JS_ENTRY) !== undefined;
  };

  /** Does this action reach outside the document? `/S` resolved, same as above. */
  const isEgressAction = (v: unknown): boolean =>
    v instanceof PDFDict && EGRESS_SUBTYPES.has(ctx.lookup(v.get(NAME_S)) as never);

  /** Script or egress: the whole set the splice removes. */
  const isStrippedAction = (v: unknown): boolean => isScriptAction(v) || isEgressAction(v);

  /** Write 0, 1 or many surviving actions back into `key`, collapsing a single-element chain. */
  const setActions = (node: PDFDictT, key: typeof NAME_A, kept: unknown[]): void => {
    if (kept.length === 0) node.delete(key);
    else if (kept.length === 1) node.set(key, kept[0] as never);
    else node.set(key, ctx.obj(kept as never[]));
  };

  /**
   * The actions that SURVIVE in place of `value`, with every script action spliced out and its own
   * `/Next` continuation promoted into the gap — so a `/URI` chained behind a script still works.
   * `/Next` may be a single action or an ARRAY of them, and a real engine runs both
   * (`pdf.worker.mjs` `_collectJS` recurses `getRaw("Next")` and array elements).
   *
   * **One function for every position, which is the actual fix.** Round 7 spliced the middle of a
   * chain and truncated at the head of `/A`, inside an array, and at a cycle; all three lenses of
   * the round-8 panel found the head case independently. Returning the survivors — rather than
   * mutating in place and reporting a boolean — makes head, middle, array element and cycle the
   * same operation, so the distinction that let this class reopen twice is no longer expressible.
   *
   * `seen` is what makes it terminate, and round 7's version only *looked* like it did: it recorded
   * the dict each call was ENTERED on, while the splice branch re-pointed `/Next` at the same script
   * every iteration without ever recording it. A self-cycle therefore looped forever in a
   * synchronous `for(;;)` on the main thread — a frozen tab, not a slow sanitize, and unreachable by
   * the caller's catch because nothing throws. Revisiting a NON-script action returns it unchanged
   * instead of cutting it, so a legitimate diamond (two array entries chaining to one continuation)
   * survives. A revisited STRIPPED action yields the continuation it already yielded — round 9 found
   * it returned `[]`, so two entries chaining to one shared script lost the `/URI` behind it on the
   * second path — and `null` in `memo` marks one whose own `/Next` is still being expanded, i.e. a
   * cycle, which contributes nothing.
   */
  const spliceActions = (
    value: unknown, seen: Set<unknown>, state: { hit: boolean }, memo: Map<object, unknown[] | null>,
  ): unknown[] => {
    if (value === undefined) return [];
    // `instanceof` narrowing against pdf-lib's runtime classes collapses to `never` (they carry a
    // private `context`), so the walk goes through `object | undefined` and the type-only aliases
    // the rest of this module already uses — the same dodge as the /Outlines walk below.
    const resolved = ctx.lookup(value as never) as object | undefined;
    if (resolved instanceof PDFArray) {
      // Arrays are memoised, not merely marked: `seen` recorded dicts only, so an array that
      // contained ITSELF recursed until `RangeError` (fail-closed, but the CHANGELOG said cycles
      // terminate) [review of 3fc0863]. `null` marks an array still being expanded — a revisit
      // during its own expansion is the cycle, and contributes nothing; a revisit afterwards gets
      // the survivors it already yielded, so a legitimate diamond is preserved.
      const seenArray = memo.get(resolved);
      if (seenArray === null) return [];
      if (seenArray !== undefined) return seenArray;
      memo.set(resolved, null);
      const arr = resolved as unknown as PDFArrayT;
      const survivors = arr.asArray().flatMap(el => spliceActions(el, seen, state, memo));
      memo.set(resolved, survivors);
      return survivors;
    }
    if (!(resolved instanceof PDFDict)) return [value];
    const action = resolved as unknown as PDFDictT;
    if (seen.has(action)) return isStrippedAction(action) ? (memo.get(action) ?? []) : [value];
    seen.add(action);
    if (isStrippedAction(action)) {
      // Egress is reported on its own flag so the artifact count names it; a script keeps the
      // `annotActions` flag it always had. Either way the continuation is promoted.
      if (isScriptAction(action)) state.hit = true;
      else externalActions = true;
      memo.set(action, null);
      const survivors = spliceActions(action.get(NAME_NEXT), seen, state, memo);
      memo.set(action, survivors);
      return survivors;
    }
    const before = action.get(NAME_NEXT);
    const kept = spliceActions(before, seen, state, memo);
    if (!(kept.length === 1 && kept[0] === before)) setActions(action, NAME_NEXT, kept);
    return [value];
  };

  /**
   * Strip action vectors from one annotation, form field or outline item: always delete `/AA`, and
   * splice every script out of `/A` while URI/GoTo hyperlinks survive.
   *
   * Round 6 fixed the top-level `/S`, round 7 the middle of the chain, round 8 the rest. Fixing one
   * member of a class and leaving its siblings is this repo's most repeated defect, and this one
   * function has now suffered it three times — which is why the traversal above is shaped so the
   * positions cannot drift apart again.
   */
  const stripNodeActions = (node: PDFDictT): boolean => {
    const state = { hit: node.delete(NAME_AA) };
    // /AF on the node itself — an embedded file hung on an ordinary annotation or field.
    if (cutAssociatedFiles(node)) associatedFiles = true;
    // A paperclip loses its file HERE, whichever walk reached it: the page pass, the /Fields walk
    // (round 9 found one hung on a field's /Kids and listed on no page, with the flag false) or the
    // backstop. /FS may be a bare string (a simple file specification) — then there is no Filespec
    // to sever and the key just goes.
    if (isPaperclip(node)) {
      const fs = node.get(NAME_FS);
      if (fs !== undefined) {
        severFilespecs(fs);
        node.delete(NAME_FS);
        fileAttachments = true;
      }
      node.delete(NAME_POPUP);
    }
    const raw = node.get(NAME_A);
    if (raw !== undefined) {
      const kept = spliceActions(raw, new Set(), state, new Map());
      if (!(kept.length === 1 && kept[0] === raw)) setActions(node, NAME_A, kept);
    }
    return state.hit;
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
  let pageMetadata = false;
  if (cutAssociatedFiles(cat)) associatedFiles = true;

  // ── /FileAttachment ("paperclip") annotations go whole [developer ruling, 2026-09-05] ──────
  // Collected across ALL pages before any page is edited, because a Popup may be listed on a
  // different page than the paperclip it belongs to [review of 3fc0863]. Removing the annotation
  // from /Annots is NOT enough on its own: a /Popup /Parent or a reply note's /IRT keeps the dict
  // reachable, and the sweep below then serialises the file bytes with the annotation gone — the
  // exact reference-deleted, payload-serialised shape WS5 P1 found. So BOTH paths from the dict to
  // the file are cut on the dict itself — /FS and /AF; the first version cut /FS only and a
  // paperclip carrying both kept its file. The Popup entry goes with them. And the dict's OWN
  // actions go through `stripNodeActions` like any annotation's: pulling it out of /Annots before
  // the strip loop left its /A and /AA script text in the bytes whenever a reply note kept the dict
  // alive — a regression from the first version, found by round 9.
  const attachments = new Set<unknown>();
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      const annot = ctx.lookup(ref) as object | undefined;
      if (!(annot instanceof PDFDict)) continue;
      const dict = annot as unknown as PDFDictT;
      if (!isPaperclip(dict)) continue;
      attachments.add(dict);
      if (stripNodeActions(dict)) annotActions = true;
    }
  }

  // Per-page: additional actions, per-page XMP, associated files, and every
  // annotation's action vectors.
  for (const page of doc.getPages()) {
    const node = page.node;
    if (node.delete(NAME_AA)) aa = true;
    if (node.delete(NAME_METADATA)) pageMetadata = true;
    if (cutAssociatedFiles(node)) associatedFiles = true;

    const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
      // Drop every paperclip and every Popup whose /Parent is one, on this page. The array is
      // walked in REVERSE because `PDFArray.remove` shifts later indices down — a forward loop
      // skips the neighbour after each removal (a recorded trap, and the Popup IS that neighbour).
      if (attachments.size > 0) {
        for (let i = annots.size() - 1; i >= 0; i--) {
          const annot = ctx.lookup(annots.get(i)) as object | undefined;
          if (!(annot instanceof PDFDict)) continue;
          const dict = annot as unknown as PDFDictT;
          const parent = ctx.lookup(dict.get(NAME_PARENT)) as object | undefined;
          if (attachments.has(dict) || (parent !== undefined && attachments.has(parent))) {
            annots.remove(i);
          }
        }
      }
      for (const ref of annots.asArray()) {
        const annot = ctx.lookup(ref);
        if (annot instanceof PDFDict && stripNodeActions(annot)) annotActions = true;
      }
    }
  }

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
    // Siblings are a LINEAR list, so they are walked with a LOOP; only the /First descent needs a
    // stack, and that stack lives on the heap. Round 7 recursed on the sibling `/Next` as well,
    // which put the length of a document's bookmark list on the JS call stack: measured fine at
    // 8000 siblings and `RangeError` at 10000 [WS7 r8]. It failed CLOSED, which is the right
    // direction, but the outcome was that a book-sized document which sanitized before round 7
    // stopped being sanitizable after it — a regression dressed as a safe failure.
    const pending: Array<ReturnType<PDFDictT['get']>> = [outlines.get(PDFName.of('First'))];
    while (pending.length > 0) {
      let itemRef = pending.pop();
      while (itemRef !== undefined) {
        const looked = ctx.lookup(itemRef) as object | undefined;
        if (!(looked instanceof PDFDict) || seenItems.has(looked)) break;
        // `instanceof` narrowing against pdf-lib's runtime class collapses to `never` here (its
        // classes carry a private `context`), so the walk goes through the type-only alias the rest
        // of this module already uses.
        const item = looked as unknown as PDFDictT;
        seenItems.add(item);
        if (stripNodeActions(item)) annotActions = true;
        const child = item.get(PDFName.of('First'));
        if (child !== undefined) pending.push(child);
        itemRef = item.get(NAME_NEXT);
      }
    }
  }

  // /Names sub-trees: drop active-content trees, keep the rest (e.g. /Dests). The embedded files
  // are severed before the tree goes, for the same reason a paperclip's Filespec is: the tree
  // holds REFERENCES to Filespecs that anything else may share.
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) {
    report.javascript = names.delete(PDFName.of('JavaScript'));
    const embedded = names.get(PDFName.of('EmbeddedFiles'));
    if (embedded !== undefined) {
      severEmbeddedFilesTree(embedded, new Set());
      names.delete(PDFName.of('EmbeddedFiles'));
      report.embeddedFiles = true;
    }
  }

  // ── Every dictionary in the file — the backstop for what no walk reaches ────────────────────
  // The walks above strip what they are handed: the catalog, LEAF pages, annotations LISTED on a
  // page, /Fields DOWNWARD, bookmarks. pdf.js reads /AA by INHERITANCE — `collectActions` calls
  // `getInheritableProperty({ key: "AA" })`, which walks /Parent up to the /Pages root — so a
  // script on the page-tree root, or on a widget's parent field that no /Fields entry names, ran
  // after sanitize with every flag false [WS7 round 9, both P1]. XMP, /PieceInfo and /AF are
  // likewise legal on objects no walk visits (XObjects, fonts). One pass over every dictionary in
  // the file closes the CLASS, for the keys whose meaning is the same wherever they appear; /A is
  // not among them (a structure element's /A is an attribute dictionary), so the action splice
  // runs only on annotation-shaped dicts. Direct dicts nested inside an indirect object are
  // visited too; references are not followed, because every indirect object is enumerated.
  const isAnnotation = (d: PDFDictT): boolean =>
    ctx.lookup(d.get(NAME_TYPE)) === NAME_ANNOT || (d.has(NAME_RECT) && d.has(NAME_SUBTYPE));
  const stripEverywhere = (d: PDFDictT): void => {
    if (d.delete(NAME_AA)) aa = true;
    if (d.delete(NAME_METADATA)) pageMetadata = true;
    if (d.delete(NAME_PIECE_INFO)) pieceInfo = true;
    if (d.delete(NAME_ON_INSTANTIATE)) annotActions = true;
    if (cutAssociatedFiles(d)) associatedFiles = true;
    if ((isPaperclip(d) || isAnnotation(d)) && stripNodeActions(d)) annotActions = true;
  };
  const visitEveryDict = (value: unknown): void => {
    if (value instanceof PDFStream) { visitEveryDict((value as unknown as { dict: unknown }).dict); return; }
    if (value instanceof PDFArray) {
      for (const el of (value as unknown as PDFArrayT).asArray()) visitEveryDict(el);
      return;
    }
    if (!(value instanceof PDFDict)) return;
    const dict = value as unknown as PDFDictT;
    stripEverywhere(dict);
    for (const [, entry] of dict.entries()) visitEveryDict(entry);
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) visitEveryDict(obj);

  report.additionalActions = aa;
  report.pageMetadata = pageMetadata;
  report.associatedFiles = associatedFiles;
  report.annotActions = annotActions;
  report.externalActions = externalActions;
  report.fileAttachments = attachments.size > 0 || fileAttachments;
  report.pieceInfo = pieceInfo;

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
