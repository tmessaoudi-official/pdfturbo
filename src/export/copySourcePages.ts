/**
 * Copy source pages into an export document WITH the source's optional-content settings (WS8 step 5, 2026-09-24),
 * and WITHOUT anything of the pages left out (SEC-1, 2026-10-08).
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
 * object to a single copy. Every reference that copier follows to a source PAGE is answered here instead — see
 * `copySourcePages`.
 */
import type { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFPage, PDFRef } from '@cantoo/pdf-lib';
import { groupOps, tokenizeContentStream } from '../utils/contentStreamEditor';

type Lib = typeof import('@cantoo/pdf-lib');

export interface CopySourcePagesOptions {
  /**
   * Source page indices that are NOT copied but are replaced in the destination by a page built later — a redacted
   * page's image. A reference to one is held on a stand-in, which `resolveStandIns` must then point at that page.
   */
  standIns?: number[];
  /**
   * M1-S1: a resource a page left out reaches is carried only where a kept page — or a form, pattern, appearance,
   * Type3 font or field default resources (`/DR`) it reaches — DRAWS it (see `ResourcePruner`). For the PDF outputs only;
   * a page rendered to pixels shows nothing it does not draw. Refuses (`ExportResourcesUnreadableError`) when a kept
   * page's drawing cannot be read, rather than guessing which entries are safe to keep.
   */
  pruneSharedResources?: boolean;
  /**
   * Each source page's `/Annots` references as they were before the source was edited in place (Flatten draws
   * annotations into their page and removes them from `/Annots`): an annotation listed there is still that page's
   * (round 7, R7-S-12). Indexed by source page.
   */
  annotsBefore?: PDFRef[][];
}

/** A page's `/Annots` entries that are references (an inline one cannot be named from elsewhere). */
export function listedAnnots(lib: Lib, page: PDFPage): PDFRef[] {
  return annotRefs(lib, page);
}

export interface CopiedSourcePages {
  pages: PDFPage[];
  /** The source's `/OCProperties`, copied into the destination's context; absent when the source has none. */
  ocProperties?: PDFDict;
  /** Source page index → its stand-in, for each `standIns` page something copied actually references. */
  standIns: Map<number, PDFRef>;
}

/**
 * A kept page shares its resources with a page left out of the export, and its content could not be read, so which
 * shared images and forms it draws is unknown. Ruled 2026-10-08: refuse rather than export the left-out page's
 * content — the user can flatten to images (`toast.exportResourcesUnreadable`).
 */
export class ExportResourcesUnreadableError extends Error {
  constructor() {
    super('EXPORT_RESOURCES_UNREADABLE: a kept page shares resources with a removed page and its content cannot be read');
    this.name = 'ExportResourcesUnreadableError';
  }
}

/**
 * SEC-1 (review 2026-10-07, P0). The copier deep-copies everything a kept page reaches, so a reference to a page
 * that is NOT exported — a GoTo link, a form field whose widgets span pages, a `/Popup` or `/IRT` — used to carry
 * that whole page into the file, absent from `/Pages` but with its text in the bytes; and because the copier
 * memoises a page on its CLONE, a link to a page that WAS kept landed on a second, orphan copy of it (pdf.js then
 * resolved such a link to page 1, and an annotation's `/P` duplicated its own page). So every reference to a source
 * page is answered here, never copied: a kept page → its own destination object (allocated lazily, so a document
 * with no page references keeps its exact object numbering and bytes); a stand-in → a ref `resolveStandIns` points
 * at its replacement; anything else — any other page dictionary, in the tree or not, an annotation listed only on an
 * excluded page, a form field no kept widget descends to — → one CUT marker, which `rewritePageRefs` then removes:
 * a link to it is dropped, a `/Kids` entry removed, any other use deleted. Ruled by the developer 2026-10-08
 * (docs/plans/review-remediation.plan.md).
 */
export async function copySourcePages(
  dest: PDFDocument, src: PDFDocument, indices: number[], opts: CopySourcePagesOptions = {},
): Promise<CopiedSourcePages> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFObjectCopier, PDFPage: Page, PDFName, PDFDict: Dict } = lib;
  await src.flush();
  const copier = PDFObjectCopier.for(src.context, dest.context);
  const srcPages = src.getPages();
  const keep = new Set(indices);
  const standInIndices = new Set((opts.standIns ?? []).filter(i => !keep.has(i)));

  const pageIndexOf = new Map<PDFRef, number>(srcPages.map((p, i) => [p.ref, i]));
  const listed = (i: number) => [...annotRefs(lib, srcPages[i]), ...(opts.annotsBefore?.[i] ?? [])];
  const keptAnnots = new Set<PDFRef>();
  for (const i of keep) for (const r of listed(i)) keptAnnots.add(r);
  // An annotation written inline in `/Annots` (against the spec, but met) has no reference; its field chain counts too.
  const keptInline = [...keep].flatMap(i => inlineAnnots(lib, srcPages[i]));
  const cutRefs = new Set<PDFRef>();
  for (let i = 0; i < srcPages.length; i++) {
    if (keep.has(i)) continue;
    for (const r of listed(i)) if (!keptAnnots.has(r)) cutRefs.add(r);
  }
  // With every page kept, no field is cut (R2-7). References to a page, an orphan page, the catalog or the page tree
  // are still answered below either way — a copy never carries the document.
  const anyLeftOut = keep.size < srcPages.length;
  const fieldChain = keptFieldChain(lib, src, keptAnnots, keptInline);
  if (anyLeftOut) for (const r of fieldsNoKeptWidgetReaches(lib, src, keptAnnots, fieldChain)) cutRefs.add(r);
  // Any other form field — reached through an action's /Fields or /T, say — is one no kept widget belongs to.
  // A node of the AcroForm field tree counts even without /FT of its own or above it: a parent holding the
  // inheritable /V of a kid that does carry /FT (round 6, R6-S-2).
  const fieldTree = anyLeftOut ? fieldTreeRefs(lib, src) : new Set<PDFRef>();
  // A node holding a value whose kid names it by /Parent alone (no /Kids, against the spec) is that kid's field too,
  // and pdf.js reads the value through the /Parent (round 8, R8-S-3). Finding who points up means reading every object
  // (350 ms and more on a 71 000-object file, paid by every single-page copy), so it is done only when a dictionary
  // carrying a field key (PDF 32000-1 Tables 220 and 222) and no /Subtype is about to be copied and is no field
  // otherwise. A page-tree node carries none of them.
  let fieldAncestors: Set<PDFRef> | undefined;
  const mayHoldValue = (obj: PDFObject | undefined): boolean => obj instanceof Dict && !obj.has(PDFName.of('Subtype'))
    && FIELD_KEYS.some(k => obj.has(PDFName.of(k)));
  const foreignField = (ref: PDFRef, obj: PDFObject | undefined): boolean => anyLeftOut
    && !fieldChain.has(ref) && !keptAnnots.has(ref)
    && (fieldTree.has(ref) || isField(lib, src, obj) || (mayHoldValue(obj) && (fieldAncestors ??= fieldAncestorRefs(lib, src)).has(ref)));
  // An annotation whose /P is a page left out is that page's, listed in its /Annots or not — Flatten takes the
  // removed page's notes out of /Annots before the copy, and a reply's /IRT still names them (round 7, R7-S-8/12).
  // Whatever its /Subtype says (it is required, and met missing), and when /P is a page dictionary outside the tree —
  // a page left out too (round 8, R8-S-7/8).
  const leftOutAnnot = (ref: PDFRef, obj: PDFObject | undefined): boolean => {
    if (!anyLeftOut || !(obj instanceof Dict) || keptAnnots.has(ref)) return false;
    const page = obj.get(PDFName.of('P'));
    if (!(page instanceof lib.PDFRef)) return false;
    const i = pageIndexOf.get(page);
    return i === undefined ? isPageDict(lib, src.context.lookup(page)) : !keep.has(i);
  };
  const isCut = (ref: PDFRef): boolean => cutRefs.has(ref) || leftOutAnnot(ref, src.context.lookup(ref));
  // A field on a kept widget's chain carries the /V (and /DV) only a removed page's widget inherits from it: those
  // values are dropped from the copy (round 7, R7-S-3).
  const unshown = anyLeftOut ? valuesNoKeptWidgetShows(lib, src, fieldChain, keptAnnots, keptInline) : new Map<PDFRef, string[]>();
  // The catalog and the page-tree nodes are the whole document: a signature's /Reference /Data, say, names the
  // catalog, and copying it would carry every page, field and outline (R2-3).
  const catalogRef = src.context.trailerInfo.Root;
  const isDocument = (ref: PDFRef, obj: PDFObject | undefined): boolean => ref === catalogRef
    || (obj instanceof Dict && obj.lookup(PDFName.of('Type')) === PDFName.of('Pages'));
  // The structure tree is the document's too: a PDF 2.0 structure destination (/SD, or a /Dest whose first element is
  // a structure element) names an element whose /P chain is the whole tree — every page's marked content (/Stm) and
  // /ActualText (round 6, R6-S-1). With every page kept the tree carries nothing the export lacks, so it is copied as
  // before (like the field tree above). Membership in the tree OR the shape of an element decides — a cut that only
  // catches what its walk found fails open, and an element the walk cannot reach (no root, listed under no /K) is
  // still the tree's (round 7, R7-S-1/2).
  // A kept page's own annotation or field written in a structure /K (no OBJR — against the spec, pdf.js renders it)
  // is the kept page's: it holds no reference into the tree (round 8, R8-C-3, a round-7 regression).
  let structure: Set<PDFRef> | undefined;
  const isStructure = (ref: PDFRef, obj: PDFObject | undefined): boolean => {
    if (!anyLeftOut || !(obj instanceof Dict) || keptAnnots.has(ref) || fieldChain.has(ref)) return false;
    structure ??= structureTree(lib, src);
    return structure.has(ref) || isStructElement(lib, src, obj, structure);
  };
  // An element written DIRECTLY where a reference belongs — the first element of an /SD or /Dest — never reaches the
  // reference hook: the copier's dictionary path answers it with the cut marker (round 8, R8-S-4).
  const isInlineStructure = (obj: PDFDict): boolean => {
    if (!anyLeftOut || obj instanceof lib.PDFPageLeaf) return false;
    structure ??= structureTree(lib, src);
    return isStructElement(lib, src, obj, structure);
  };
  // An inline kid of a kept chain field is no kept widget (a kept widget is listed by reference, or inline in its own
  // page's /Annots, never here): unless its /P is a kept page it is dropped (round 8, R8-S-5).
  const onKeptPage = (d: PDFDict): boolean => {
    const page = d.get(PDFName.of('P'));
    const i = page instanceof lib.PDFRef ? pageIndexOf.get(page) : undefined;
    return i !== undefined && keep.has(i);
  };
  const reached = opts.pruneSharedResources && anyLeftOut ? reachableFromPages(lib, src, srcPages.filter((_, i) => !keep.has(i))) : undefined;
  const pruner = reached ? new ResourcePruner(lib, src, reached.refs, reached.direct, isCut) : undefined;

  const destRefOf = new Map<number, PDFRef>();
  const standIns = new Map<number, PDFRef>();
  let cut: PDFRef | undefined;
  const lazy = (map: Map<number, PDFRef>, i: number): PDFRef => {
    let ref = map.get(i);
    if (!ref) { ref = dest.context.nextRef(); map.set(i, ref); }
    return ref;
  };
  // `copyPDFIndirectObject` is private in pdf-lib's typings, but `copy` reaches it through the property at call
  // time, so replacing it routes every reference through here. Pinned by tests/export/copySourcePages.test.ts.
  const internals = copier as unknown as {
    copyPDFIndirectObject: (ref: PDFRef) => PDFRef; traversedObjects: Map<unknown, PDFObject>;
  };
  const copyRef = internals.copyPDFIndirectObject;
  internals.copyPDFIndirectObject = (ref: PDFRef): PDFRef => {
    const i = pageIndexOf.get(ref);
    if (i !== undefined) {
      if (keep.has(i)) return lazy(destRefOf, i);
      if (standInIndices.has(i)) return lazy(standIns, i);
      return (cut ??= dest.context.nextRef());
    }
    const obj = src.context.lookup(ref);
    // A page dictionary outside the page tree — what a pre-fix export left behind — is a page left out too.
    // foreignField last: its one costly read (every object) never runs for the catalog or a structure element.
    if (isCut(ref) || isPageDict(lib, obj) || isDocument(ref, obj) || isStructure(ref, obj) || foreignField(ref, obj)) return (cut ??= dest.context.nextRef());
    if (internals.traversedObjects.has(ref)) return copyRef(ref);
    let replacement: PDFObject | undefined;
    const drop = unshown.get(ref);
    if (drop && obj instanceof Dict) {
      replacement = obj.clone();
      for (const key of drop) (replacement as PDFDict).delete(PDFName.of(key));
    }
    const kids = anyLeftOut && fieldChain.has(ref) && obj instanceof Dict ? obj.lookup(PDFName.of('Kids')) : undefined;
    if (kids instanceof lib.PDFArray && kids.asArray().some(k => k instanceof Dict && !onKeptPage(k))) {
      replacement ??= (obj as PDFDict).clone();
      const left = lib.PDFArray.withContext(src.context);
      for (const k of kids.asArray()) if (!(k instanceof Dict) || onKeptPage(k)) left.push(k);
      (replacement as PDFDict).set(PDFName.of('Kids'), left);
    }
    // A form, pattern, appearance or Type3 font with resources of its own carries only what it draws of them (M1-S1),
    // and so does an owner written inline inside what is copied, through dictionaries, arrays and stream dictionaries
    // — a widget's /DR, a Type3 font in an ExtGState's /Font array (rounds 4 and 5).
    if (pruner) {
      const base = replacement ?? obj;
      replacement = pruner.pruneNested(base, pruner.pageContent.get(ref) ?? pruner.appearance(ref, obj), pruner.isReached(obj)) ?? replacement;
    }
    if (replacement) {
      const newRef = dest.context.nextRef();
      internals.traversedObjects.set(ref, newRef);
      dest.context.assign(newRef, copier.copy(replacement));
      return newRef;
    }
    return copyRef(ref);
  };
  const copyDict = (copier as unknown as { copyPDFDict: (d: PDFDict) => PDFObject }).copyPDFDict;
  (copier as unknown as { copyPDFDict: (d: PDFDict) => PDFObject }).copyPDFDict = (d: PDFDict): PDFObject =>
    (isInlineStructure(d) ? (cut ??= dest.context.nextRef()) : copyDict(d));

  // Every kept page's content is registered BEFORE any copy, so how a shared stream is pruned never depends on which
  // page reaches it first (round 6, R6-K-1).
  const reading = new Map<number, Reading>();
  for (const i of indices) {
    const node = srcPages[i].node;
    const contents = node.get(PDFName.of('Contents'));
    const read = () => [contentOf(lib, src, contents)];
    // pdf.js reads a single content stream through its own /Resources merged over the page's (round 4, R4-C-2): what
    // the page draws is collected there, and the stream's own dictionary is pruned against the same drawing.
    const stream = src.context.lookup(contents);
    const local = stream instanceof lib.PDFStream ? stream.dict.lookup(PDFName.of('Resources')) : undefined;
    const from = pruner && local instanceof Dict && local.keys().length > 0 ? mergeResources(lib, src, local, pageResources(lib, src, node)) : undefined;
    // A stream that is the single /Contents of two kept pages draws what EITHER reads (round 7, R7-C-4).
    if (from && contents instanceof lib.PDFRef) pruner?.pageContent.set(contents, [...(pruner.pageContent.get(contents) ?? []), { contents: read, from }]);
    reading.set(i, { contents: read, from });
    // A kept widget's /DA is noted before any appearance is copied: two kept widgets sharing one appearance each
    // regenerate it with their own font (round 7, R7-C-3).
    for (const annot of [...annotRefs(lib, srcPages[i]).map(r => src.context.lookup(r)), ...inlineAnnots(lib, srcPages[i])]) {
      if (pruner && annot instanceof Dict) pruner.noteAppearances(annot);
    }
  }
  // A member of an ARRAY /Contents is read as part of a sequence with no dictionary, so its own /Resources is never
  // read by pdf.js: it draws nothing from them (round 5, R5-S-3) — unless the same stream is also a form (pdf.js draws
  // only a /Subtype /Form) or another kept page's single /Contents, whose drawing then decides (round 6, R6-K-1).
  if (pruner) {
    for (const i of indices) {
      const stream = src.context.lookup(srcPages[i].node.get(PDFName.of('Contents')));
      if (!(stream instanceof lib.PDFArray)) continue;
      for (const member of stream.asArray()) {
        if (!(member instanceof lib.PDFRef) || pruner.pageContent.has(member)) continue;
        const target = src.context.lookup(member);
        if (target instanceof lib.PDFStream && target.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Form')) continue;
        pruner.pageContent.set(member, [{ contents: () => [] }]);
      }
    }
  }

  // Every kept page is pruned before ANY page is copied: a pattern two kept pages draw records what each draws through
  // it, and is copied once — with the first page, which must already hold the second page's record (round 8, R8-C-2).
  const prepared = indices.map(i => {
    let node = srcPages[i].node;
    // pdf.js reads a /Resources that is not a dictionary as empty; one that HOLDS the dictionary a removed page draws
    // from — an array [R], a stream — would be copied whole with it, so it is refused (round 8, R8-S-9).
    pruner?.refuseIfNotADict(node.getInheritableAttribute(PDFName.of('Resources')));
    const resources = pruner?.pruned([reading.get(i) as Reading], pageResources(lib, src, node));
    if (resources) {
      node = node.clone();
      node.set(PDFName.of('Resources'), resources);
    }
    // The page's other direct entries — an inline widget in /Annots with a /DR — hold owners too (round 5, R5-C-1).
    if (pruner) {
      for (const [key, value] of node.entries()) {
        if (key === PDFName.of('Resources') || key === PDFName.of('Parent') || key === PDFName.of('Contents')) continue;
        if (pruner.dropsUndrawn(key, value, false)) {
          if (node === srcPages[i].node) node = node.clone();
          node.delete(key);
          continue;
        }
        const nested = pruner.pruneNested(value);
        if (!nested) continue;
        if (node === srcPages[i].node) node = node.clone();
        node.set(key, nested);
      }
    }
    return node;
  });
  const assigned = new Set<number>();
  const pages = indices.map((i, k) => {
    const copied = copier.copy(prepared[k]);
    let ref = assigned.has(i) ? undefined : destRefOf.get(i);
    if (ref) dest.context.assign(ref, copied);
    else ref = dest.context.register(copied);
    if (!destRefOf.has(i)) destRefOf.set(i, ref);
    assigned.add(i);
    return Page.of(copied, ref, dest);
  });
  const oc = src.catalog.lookupMaybe(PDFName.of('OCProperties'), Dict);
  const ocProperties = oc ? copier.copy(oc) : undefined;
  if (cut) {
    const marker = cut;
    rewritePageRefs(lib, dest, ref => (ref === marker ? null : undefined));
  }
  return { pages, ocProperties, standIns };
}

/**
 * Point every stand-in `copySourcePages` returned at the page that replaced it, or — mapped to `undefined`, because
 * nothing replaced it — cut it like an excluded page. Every stand-in must pass through here before the save: an
 * unresolved one is a reference to no object.
 */
export async function resolveStandIns(dest: PDFDocument, targets: Map<PDFRef, PDFRef | undefined>): Promise<void> {
  if (targets.size === 0) return;
  const lib = await import('@cantoo/pdf-lib');
  rewritePageRefs(lib, dest, ref => (targets.has(ref) ? (targets.get(ref) ?? null) : undefined));
}

function annotRefs(lib: Lib, page: PDFPage): PDFRef[] {
  const annots = page.node.lookup(lib.PDFName.of('Annots'));
  return annots instanceof lib.PDFArray ? annots.asArray().filter((r): r is PDFRef => r instanceof lib.PDFRef) : [];
}

function inlineAnnots(lib: Lib, page: PDFPage): PDFDict[] {
  const annots = page.node.lookup(lib.PDFName.of('Annots'));
  return annots instanceof lib.PDFArray ? annots.asArray().filter((a): a is PDFDict => a instanceof lib.PDFDict) : [];
}

/**
 * A form field: `/FT` on the node or inherited through its `/Parent` chain (round 3 — an action may name a child), or a
 * node above a field — its `/Kids` lead to one — whether or not `/AcroForm /Fields` lists it (round 7, R7-S-4).
 */
function isField(lib: Lib, src: PDFDocument, obj: PDFObject | undefined): boolean {
  const { PDFName, PDFDict, PDFArray } = lib;
  let node = obj;
  for (let depth = 0; node instanceof PDFDict && depth < 64; depth++) {
    if (node.has(PDFName.of('FT'))) return true;
    node = src.context.lookup(node.get(PDFName.of('Parent')));
  }
  if (!(obj instanceof PDFDict) || isPageDict(lib, obj) || obj.lookup(PDFName.of('Type')) === PDFName.of('Pages')) return false;
  const seen = new Set<PDFObject>([obj]);
  const stack: PDFObject[] = [obj];
  while (stack.length && seen.size < 10000) {
    const kids = (stack.pop() as PDFDict).lookup(PDFName.of('Kids'));
    if (!(kids instanceof PDFArray)) continue;
    for (const k of kids.asArray()) {
      const kid = src.context.lookup(k);
      if (!(kid instanceof PDFDict) || seen.has(kid) || isPageDict(lib, kid)) continue;
      if (kid.has(PDFName.of('FT')) || kid.lookup(PDFName.of('Subtype')) === PDFName.of('Widget')) return true;
      seen.add(kid);
      stack.push(kid);
    }
  }
  return false;
}

/**
 * The inheritable values (`/V`, `/DV`, `/RV`) held by a field on a kept widget's chain that no kept widget inherits — the
 * nearest holder up its own chain is another node — so only a removed page's widget shows them (round 7, R7-S-3).
 */
function valuesNoKeptWidgetShows(lib: Lib, src: PDFDocument, chain: Set<PDFRef>, keptAnnots: Set<PDFRef>, keptInline: PDFDict[]): Map<PDFRef, string[]> {
  const { PDFName, PDFDict, PDFRef: Ref } = lib;
  const out = new Map<PDFRef, string[]>();
  // /RV, the rich-text value, is inheritable like /V (PDF 32000-1 Table 228; round 8, R8-S-2).
  for (const key of ['V', 'DV', 'RV']) {
    const shown = new Set<PDFRef>();
    for (const widget of [...keptAnnots, ...keptInline]) {
      let ref: PDFRef | undefined = widget instanceof Ref ? widget : undefined;
      let node = widget instanceof Ref ? src.context.lookup(widget) : widget;
      for (let depth = 0; node instanceof PDFDict && depth < 64; depth++) {
        if (node.has(PDFName.of(key))) { if (ref) shown.add(ref); break; }
        const up = node.get(PDFName.of('Parent'));
        ref = up instanceof Ref ? up : undefined;
        node = src.context.lookup(up);
      }
    }
    for (const field of chain) {
      const node = src.context.lookup(field);
      if (!(node instanceof PDFDict) || !node.has(PDFName.of(key)) || shown.has(field)) continue;
      out.set(field, [...(out.get(field) ?? []), key]);
    }
  }
  return out;
}

/**
 * A structure element the tree walk did not reach: typed as one, or shaped like one (`/S` a name) with a `/P` chain
 * that leads into the tree or to a typed element or root (round 7, R7-S-2). An annotation's `/P` is a page, which
 * leads nowhere, and a rendition's `/P` is its play parameters, which carry no `/S`.
 */
function isStructElement(lib: Lib, src: PDFDocument, obj: PDFDict, tree: Set<PDFRef>): boolean {
  const { PDFName, PDFDict, PDFRef: Ref } = lib;
  const typed = (d: PDFDict) => {
    const type = d.lookup(PDFName.of('Type'));
    return type === PDFName.of('StructElem') || type === PDFName.of('StructTreeRoot');
  };
  if (typed(obj)) return true;
  if (!(obj.lookup(PDFName.of('S')) instanceof PDFName)) return false;
  let up = obj.get(PDFName.of('P'));
  for (let depth = 0; up instanceof Ref && depth < 64; depth++) {
    if (tree.has(up)) return true;
    const parent = src.context.lookup(up);
    if (!(parent instanceof PDFDict)) return false;
    if (typed(parent)) return true;
    if (!(parent.lookup(PDFName.of('S')) instanceof PDFName)) return false;
    up = parent.get(PDFName.of('P'));
  }
  return false;
}

/**
 * A page's resources as pdf.js reads them: the nearest `/Resources` up the page tree, and none when that is not a
 * dictionary. pdf-lib's `Resources()` throws there, which failed every export leaving a page out of such a file — one
 * pdf.js renders (round 7, R7-C-2).
 */
function pageResources(lib: Lib, src: PDFDocument, node: PDFPage['node']): PDFDict | undefined {
  const resources = src.context.lookup(node.getInheritableAttribute(lib.PDFName.of('Resources')));
  return resources instanceof lib.PDFDict ? resources : undefined;
}

function isPageDict(lib: Lib, obj: PDFObject | undefined): boolean {
  return obj instanceof lib.PDFDict && obj.lookup(lib.PDFName.of('Type')) === lib.PDFName.of('Page');
}

/** Every field on a kept widget's `/Parent` chain: the fields the kept pages show. */
function keptFieldChain(lib: Lib, src: PDFDocument, keptAnnots: Set<PDFRef>, keptInline: PDFDict[]): Set<PDFRef> {
  const { PDFName, PDFDict, PDFRef: Ref } = lib;
  const chain = new Set<PDFRef>();
  for (const widget of [...keptAnnots, ...keptInline]) {
    let node = widget instanceof Ref ? src.context.lookup(widget) : widget;
    while (node instanceof PDFDict) {
      const parent = node.get(PDFName.of('Parent'));
      if (!(parent instanceof Ref) || chain.has(parent)) break;
      chain.add(parent);
      node = src.context.lookup(parent);
    }
  }
  return chain;
}

/**
 * M1-C1: the form fields a copy would carry although no kept widget belongs to them. A kept widget's `/Parent` chain
 * brings its ancestors, and their `/Kids` name the SIBLING fields — whose `/V` holds a value typed on a page left
 * out. Every child of a chain field that is neither on a kept chain nor a kept widget is cut — such a child may
 * inherit `/FT`, so the copier's own `/FT` check (which catches a field an action names, R2-S4) would not see it.
 */
function fieldsNoKeptWidgetReaches(lib: Lib, src: PDFDocument, keptAnnots: Set<PDFRef>, chain: Set<PDFRef>): PDFRef[] {
  const { PDFName, PDFDict, PDFArray, PDFRef: Ref } = lib;
  const cut: PDFRef[] = [];
  const seen = new Set<PDFRef>();
  for (const field of chain) {
    const node = src.context.lookup(field);
    const kids = node instanceof PDFDict ? node.lookup(PDFName.of('Kids')) : undefined;
    if (!(kids instanceof PDFArray)) continue;
    for (const kid of kids.asArray()) {
      if (!(kid instanceof Ref) || seen.has(kid)) continue;
      seen.add(kid);
      if (!chain.has(kid) && !keptAnnots.has(kid)) cut.push(kid);
    }
  }
  return cut;
}

/**
 * Every object a page left out reaches, not crossing into another page or up its page tree. A resource entry is
 * pruned only when it is in here AND nothing kept draws it — so a document whose kept pages share nothing with the
 * removed ones is copied exactly as before, and content is read only where pruning can matter.
 */
function reachableFromPages(lib: Lib, src: PDFDocument, pages: PDFPage[]): { refs: Set<PDFRef>; direct: Set<PDFObject> } {
  const { PDFDict, PDFArray, PDFRef: Ref, PDFStream, PDFName } = lib;
  const reach = new Set<PDFRef>();
  // The /Resources a removed page draws from that are written DIRECTLY — its own, or a /Pages node's it inherits: no
  // reference names them, so they are returned as objects (round 8, R8-S-1).
  const direct = new Set<PDFObject>();
  const parent = PDFName.of('Parent');
  const catalog = src.context.trailerInfo.Root;
  // Iterative: a chain of 20 000 outline items overflowed the stack recursively (round 3). It stops where the copy
  // stops — at another page, the catalog and the page tree, which the copier hook cuts.
  const stack: Array<[PDFObject | undefined, boolean]> = [];
  const start = (resources: PDFObject | undefined) => {
    if (resources instanceof PDFDict) direct.add(resources);
    stack.push([resources, false]);
  };
  for (const page of pages) {
    stack.push([page.node, true]);
    start(page.node.getInheritableAttribute(PDFName.of('Resources')));
    // pdf.js merges the page's /Resources with every ancestor's (first category found wins), so a removed page draws
    // through a /Pages node's categories its own dictionary lacks (round 6, R6-C-1). The values, never the nodes.
    let up = page.node.lookup(PDFName.of('Parent'));
    for (let k = 0; k < 64 && up instanceof PDFDict; k++, up = up.lookup(PDFName.of('Parent'))) start(up.get(PDFName.of('Resources')));
  }
  while (stack.length) {
    const [obj, fromPage] = stack.pop() as [PDFObject | undefined, boolean];
    if (obj instanceof Ref) {
      if (reach.has(obj) || obj === catalog) continue;
      const target = src.context.lookup(obj);
      if (isPageDict(lib, target) || (target instanceof PDFDict && target.lookup(PDFName.of('Type')) === PDFName.of('Pages'))) continue;
      reach.add(obj);
      stack.push([target, false]);
    } else if (obj instanceof PDFStream) stack.push([obj.dict, false]);
    else if (obj instanceof PDFArray) for (const v of obj.asArray()) stack.push([v, false]);
    else if (obj instanceof PDFDict) for (const [k, v] of obj.entries()) if (!(fromPage && k === parent)) stack.push([v, false]);
  }
  return { refs: reach, direct };
}

// `/ColorSpace` is not pruned: a colour space draws nothing, and pdf.js resolves its names in places no operator shows
// (a shading's `/ColorSpace`, an Indexed or Separation base, an alias entry) — round 3 found pruning it recoloured pages.
const PRUNED = ['XObject', 'Pattern', 'Shading', 'ExtGState', 'Font', 'Properties'] as const;
type Category = (typeof PRUNED)[number];
const STANDARD_CATEGORIES = new Set<string>([...PRUNED, 'ColorSpace', 'ProcSet']);
const FIELD_KEYS = ['T', 'TU', 'TM', 'Ff', 'V', 'DV', 'RV', 'DA', 'Q', 'Opt', 'MaxLen', 'AA', 'DR'];
const UNDRAWN = new Set(['PieceInfo', 'Thumb', 'DPart', 'Alternates', 'Metadata', 'AF', 'PtData']);
type Drawn = Record<Category, Set<string>>;
const noneDrawn = (): Drawn => ({ XObject: new Set(), Pattern: new Set(), Shading: new Set(), ExtGState: new Set(), Font: new Set(), Properties: new Set() });
/**
 * One way an owner's resources are read: its content (or a page's whole content) with names resolving in `from`
 * (default: the resources themselves), or names already known to be drawn.
 */
interface Reading { contents: () => (string | null)[]; from?: PDFDict; drawn?: Drawn }

/**
 * M1-S1, round 2. A `/Resources` dictionary a kept page shares with a removed one — by reference, through the page
 * tree, through a shared sub-dictionary, or as the resources of a form, pattern, appearance or Type3 font the kept
 * page reaches (FPDI's templates carry `/Resources 2 0 R`, FPDF's one dictionary) — is replaced, per OWNER, by a copy
 * holding only what that owner draws. An entry stays when the owner draws it or no removed page reaches it.
 */
class ResourcePruner {
  private readonly inProgress = new Set<PDFObject>();
  /** A page's single content stream → each kept page's whole content and the merged resources pdf.js reads it with. */
  readonly pageContent = new Map<PDFRef, Reading[]>();
  /** A tiling pattern → the names of ITS OWN categories it draws as read from a parent — a form it draws from the
   * parent's dictionary resolves in the pattern's merged view, its own /Font included (round 7, R7-C-5). */
  private readonly patternDrawn = new Map<PDFObject, Drawn>();
  /** The objects a removed page reaches (`excluded` resolved): a direct value inside one is the removed page's too. */
  private reachedObjects?: Set<PDFObject>;
  /** References known not to reach anything a removed page reaches (a memo for `touches`). */
  private readonly clean = new Set<PDFRef>();
  /** An annotation appearance → the /DA strings of the kept annotations it serves (accumulated, never overwritten). */
  private readonly appearanceDA = new Map<PDFRef, string[]>();

  constructor(private readonly lib: Lib, private readonly src: PDFDocument, private readonly excluded: Set<PDFRef>,
    private readonly direct: Set<PDFObject>, private readonly isCut: (ref: PDFRef) => boolean) {}

  /**
   * Whether a removed page reaches this very object — by reference, or as a DIRECT /Resources it draws from (its own,
   * or a /Pages ancestor's it inherits, round 8, R8-S-1) — so its direct values are the removed page's too.
   */
  isReached(obj: PDFObject | undefined): boolean {
    if (obj === undefined) return false;
    this.reachedObjects ??= new Set([...this.direct, ...[...this.excluded].map(r => this.src.context.lookup(r)).filter((o): o is PDFObject => o !== undefined)]);
    return this.reachedObjects.has(obj) || (obj instanceof this.lib.PDFStream && this.reachedObjects.has(obj.dict));
  }

  /**
   * A `/Resources` (or `/DR`) that is not a dictionary draws nothing in pdf.js, but the copy would carry what it holds.
   * Where that reaches what a removed page reaches — an array `[R]`, a stream whose dictionary is `R` — the export is
   * refused rather than guessed at (round 8, R8-S-9/10). One that holds nothing a removed page reaches (`5`, `[1]`)
   * is copied as it is (R7-C-2).
   */
  refuseIfNotADict(value: PDFObject | undefined): void {
    if (value === undefined || this.src.context.lookup(value) instanceof this.lib.PDFDict) return;
    if (this.touches(value)) throw new ExportResourcesUnreadableError();
  }

  /**
   * A clone of a form / pattern / appearance stream, Type3 font or field (`/DR`) with its resources pruned, or
   * undefined. `page` is given for a page's content stream: it draws the page's whole content, read the way pdf.js does.
   */
  prunedOwner(obj: PDFObject | undefined, page?: Reading[], reached = false): PDFObject | undefined {
    const { PDFName, PDFDict, PDFStream } = this.lib;
    let key = PDFName.of('Resources');
    if (obj instanceof PDFStream) {
      const resources = obj.dict.lookup(key);
      if (!(resources instanceof PDFDict)) { this.refuseIfNotADict(obj.dict.get(key)); return undefined; }
      const readings: Reading[] = page ?? [{ contents: () => [contentOf(this.lib, this.src, obj)] }];
      const recorded = this.patternDrawn.get(obj);
      const pruned = this.pruned(recorded ? [...readings, { contents: () => [], drawn: recorded }] : readings, resources, reached);
      if (!pruned) return undefined;
      const clone = obj.clone();
      clone.dict.set(key, pruned);
      return clone;
    }
    if (obj instanceof PDFDict && !isPageDict(this.lib, obj)) {
      let resources = obj.lookup(key);
      // A field's or widget's /DR is the resources its /DA draws from when a viewer builds the appearance (pdf.js
      // inherits both through /Parent): it carries what those default appearances name (round 4, R4-S-2).
      if (!(resources instanceof PDFDict)) {
        this.refuseIfNotADict(obj.get(key));
        key = PDFName.of('DR');
        resources = obj.lookup(key);
        if (!(resources instanceof PDFDict)) { this.refuseIfNotADict(obj.get(key)); return undefined; }
        // A widget a removed page holds is cut, and so is what only its /DA names (round 7, R7-S-6).
        const das = defaultAppearances(this.lib, this.src, obj, this.isCut);
        const pruned = this.pruned([{ contents: () => das }], resources, reached);
        if (!pruned) return undefined;
        const clone = obj.clone();
        clone.set(key, pruned);
        return clone;
      }
      // An inline owner reached again while it is being pruned draws itself (a Type3 glyph using its own font). Where
      // its resources share nothing with a removed page it is kept as it is (round 5, R5-C-2); where they do, the
      // inner copy would carry them unpruned, so it is refused rather than guessed at.
      if (this.inProgress.has(obj)) {
        if (this.isShared(resources)) throw new ExportResourcesUnreadableError();
        return undefined;
      }
      // Only a Type3 font draws from resources of its own; any other owner cannot be read, so it refuses if it must.
      const contents = () => (obj.lookup(PDFName.of('Subtype')) === PDFName.of('Type3') ? charProcs(this.lib, this.src, obj) : [null]);
      this.inProgress.add(obj);
      let pruned: PDFDict | undefined;
      try { pruned = this.pruned([{ contents }], resources, reached); } finally { this.inProgress.delete(obj); }
      if (!pruned) return undefined;
      const clone = obj.clone();
      clone.set(key, pruned);
      return clone;
    }
    return undefined;
  }

  /**
   * `resources` holding only what the readings draw of the entries a removed page reaches, and every inline owner in
   * it pruned in turn; undefined when unchanged. An entry stays when ANY reading draws it.
   */
  pruned(readings: Reading[], resources: PDFDict | undefined, inReached = false): PDFDict | undefined {
    const { PDFName, PDFDict, PDFRef: Ref } = this.lib;
    if (!resources) return undefined;
    // A direct value has no reference to test: inside a dictionary a removed page reaches — itself, or the owner it is
    // written in (`inReached`, a form's direct /Resources) — it is that page's too (round 7, R7-S-10 and its 6C check).
    const reached = inReached || this.isReached(resources);
    const theirs = (value: PDFObject, container: PDFObject) => this.touches(value)
      || (!(value instanceof Ref) && (reached || this.isReached(container)));
    // The readings are read the first time an entry is the removed page's — never otherwise: a reached dictionary
    // holding nothing to prune refused a predicted page it had no need to read (round 8, R8-C-4).
    let drawn: { set: Drawn; from: PDFDict }[] | undefined;
    const read = () => (drawn ??= readings.map(reading => {
      const from = reading.from ?? resources;
      if (reading.drawn) return { set: reading.drawn, from };
      const set = noneDrawn();
      for (const content of reading.contents()) {
        if (content === null || !this.collect(content, from, set, new Set(), 0)) throw new ExportResourcesUnreadableError();
      }
      return { set, from };
    }));
    let changed = false;
    const out = resources.clone(this.src.context);
    {
      for (const cat of PRUNED) {
        const sub = resources.lookup(PDFName.of(cat));
        if (!(sub instanceof PDFDict)) {
          // pdf.js resolves no name through a category that is not a dictionary, so nothing draws it: dropped where
          // it is the removed page's, like a category no viewer reads (round 8, R8-S-11).
          const raw = resources.get(PDFName.of(cat));
          if (raw !== undefined && theirs(raw, resources)) { out.delete(PDFName.of(cat)); changed = true; }
          continue;
        }
        let catChanged = false;
        const kept = this.src.context.obj({});
        for (const [name, value] of sub.entries()) {
          // Drawn by name, and — when names resolve in a merged view — only if that view resolves this name to THIS
          // entry: a content stream's own /Fm1 shadows the page's, and pdf.js draws the stream's (round 4).
          const isDrawn = () => read().some(({ set, from }) => {
            if (!set[cat].has(name.decodeText())) return false;
            const fromSub = from === resources ? undefined : from.lookup(PDFName.of(cat));
            return from === resources || (fromSub instanceof PDFDict && fromSub.get(name) === value);
          });
          if (theirs(value, sub) && !isDrawn()) { catChanged = true; continue; }
          // An inline owner (a Type3 font written in the dictionary, or one inside an inline ExtGState's /Font array)
          // never reaches the copier hook: prune it here.
          const inline = this.pruneNested(value, undefined, reached || this.isReached(sub));
          if (inline) catChanged = true;
          kept.set(name, inline ?? value);
        }
        if (catChanged) { out.set(PDFName.of(cat), kept); changed = true; }
      }
    }
    // A category no viewer reads (spec-invalid) draws nothing: dropped wherever it reaches a removed page (R6-S-8).
    for (const [key, value] of resources.entries()) {
      if (STANDARD_CATEGORIES.has(key.decodeText()) || !theirs(value, resources)) continue;
      out.delete(key);
      changed = true;
    }
    return changed ? out : undefined;
  }

  /**
   * A kept widget's or free-text annotation's appearance also serves the /DA a viewer regenerates it with, and pdf.js
   * resolves that font in the merge of /DR and the appearance's own /Resources — the only place it is left once the
   * AcroForm is not copied (round 6, R6-C-4). Registered when the annotation is pruned, read when its stream is.
   */
  appearance(ref: PDFRef, obj: PDFObject | undefined): Reading[] | undefined {
    const das = this.appearanceDA.get(ref);
    if (!das || !(obj instanceof this.lib.PDFStream)) return undefined;
    return [{ contents: () => [contentOf(this.lib, this.src, obj), ...das] }];
  }

  noteAppearances(annot: PDFDict): void {
    const { PDFName, PDFDict, PDFRef: Ref } = this.lib;
    const ap = annot.lookup(PDFName.of('AP'));
    if (!(ap instanceof PDFDict)) return;
    const [da] = defaultAppearances(this.lib, this.src, annot);
    if (da === undefined) return;
    for (const key of ['N', 'R', 'D']) {
      const v = ap.get(PDFName.of(key));
      const states = v instanceof Ref ? this.src.context.lookup(v) : v;
      const refs = states instanceof PDFDict && !(v instanceof Ref && states instanceof this.lib.PDFStream) ? states.values() : [v];
      for (const r of refs) {
        if (!(r instanceof Ref)) continue;
        const list = this.appearanceDA.get(r) ?? [];
        if (!list.includes(da)) list.push(da);
        this.appearanceDA.set(r, list);
      }
    }
  }

  /**
   * Keys a viewer never draws for the object that holds them — application data, a thumbnail, a PDF/VT document part,
   * an image's print alternates — are dropped from a kept object when they reach anything a removed page reaches
   * (round 6, R6-S-3/4/6/7) — or, written directly, sit in an object a removed page reaches (round 7). Metadata,
   * associated files and measurement point data joined the list in round 7 (R7-S-5). Unshared, they are kept as they are.
   */
  dropsUndrawn(key: PDFName, value: PDFObject | undefined, reached: boolean): boolean {
    return UNDRAWN.has(key.decodeText()) && (this.touches(value) || (reached && value !== undefined && !(value instanceof this.lib.PDFRef)));
  }

  /**
   * Whether any category of `resources` reaches something a removed page reaches — for the self-drawing inline owner
   * alone since round 8 (`pruned` decides reach entry by entry). There the reached term is implied by the owner's own
   * `/Resources` reference back to the dictionary, which `touches` already sees; kept as the direct statement of it.
   */
  isShared(resources: PDFDict): boolean {
    const { PDFName, PDFDict } = this.lib;
    return this.isReached(resources) || PRUNED.some(cat => {
      const sub = resources.lookup(PDFName.of(cat));
      return this.touches(resources.get(PDFName.of(cat))) || (sub instanceof PDFDict && sub.values().some(v => this.touches(v)));
    });
  }

  /**
   * A clone of `value` — an owner pruned, and every owner written inline inside it (through dictionaries, arrays and a
   * stream's dictionary, not crossing references) pruned in turn — or undefined when nothing changed.
   */
  pruneNested(value: PDFObject | undefined, page?: Reading[], reached = false): PDFObject | undefined {
    const { PDFDict, PDFArray, PDFStream, PDFName } = this.lib;
    // Inside an object a removed page reaches, a direct value is that page's too (round 7).
    const here = reached || this.isReached(value);
    // The owner's resources were pruned by `prunedOwner`, with every inline owner in them.
    const skip = (k: PDFName) => k === PDFName.of('Resources') || k === PDFName.of('DR');
    if (value instanceof PDFStream) {
      let out = this.prunedOwner(value, page, here) as InstanceType<typeof PDFStream> | undefined;
      for (const [k, v] of value.dict.entries()) {
        if (skip(k)) continue;
        if (this.dropsUndrawn(k, v, here)) { out ??= value.clone(); out.dict.delete(k); continue; }
        const n = this.pruneNested(v, undefined, here);
        if (n) { out ??= value.clone(); out.dict.set(k, n); }
      }
      return out;
    }
    if (value instanceof PDFDict) {
      if (value.has(PDFName.of('AP'))) this.noteAppearances(value);
      let out = this.prunedOwner(value, undefined, here) as PDFDict | undefined;
      for (const [k, v] of value.entries()) {
        if (skip(k)) continue;
        if (this.dropsUndrawn(k, v, here)) { out ??= value.clone(); out.delete(k); continue; }
        const n = this.pruneNested(v, undefined, here);
        if (n) { out ??= value.clone(); out.set(k, n); }
      }
      return out;
    }
    if (value instanceof PDFArray) {
      let out: PDFArray | undefined;
      value.asArray().forEach((v, k) => {
        const n = this.pruneNested(v, undefined, here);
        if (n) { out ??= value.clone(); out.set(k, n); }
      });
      return out;
    }
    return undefined;
  }

  /**
   * Whether a value reaches — at any depth, not crossing into a page, the catalog or the page tree — something a
   * removed page reaches. Transitive since round 5 (R5-S-1): an entry only the kept page reaches, but whose own
   * resources name the removed page's form, carries that form when kept undrawn.
   */
  private touches(value: PDFObject | undefined): boolean {
    const { PDFRef: Ref, PDFDict, PDFArray, PDFStream, PDFName } = this.lib;
    const catalog = this.src.context.trailerInfo.Root;
    const visited = new Set<PDFRef>();
    const stack: (PDFObject | undefined)[] = [value];
    while (stack.length) {
      const v = stack.pop();
      if (v instanceof Ref) {
        if (this.excluded.has(v)) return true;
        if (this.clean.has(v) || visited.has(v) || v === catalog) continue;
        visited.add(v);
        const target = this.src.context.lookup(v);
        if (isPageDict(this.lib, target) || (target instanceof PDFDict && target.lookup(PDFName.of('Type')) === PDFName.of('Pages'))) continue;
        stack.push(target);
      } else if (v instanceof PDFStream) stack.push(v.dict);
      else if (v instanceof PDFDict) stack.push(...v.values());
      else if (v instanceof PDFArray) stack.push(...v.asArray());
    }
    for (const r of visited) this.clean.add(r);
    return false;
  }

  /**
   * The names `content` draws from `resources` — `Do`, `Tf`, `gs`, `scn`/`SCN`, `sh`, `BDC`/`DP` — through every form,
   * Type3 font, soft-mask group and tiling pattern it draws that reads this dictionary too. False when anything
   * cannot be read.
   */
  private collect(content: string, resources: PDFDict, drawn: Drawn, seen: Set<unknown>, depth: number): boolean {
    const { PDFName, PDFDict, PDFStream } = this.lib;
    if (depth > 12) return false;
    let ops;
    try { ops = groupOps(tokenizeContentStream(content)); } catch { return false; }
    const entry = (cat: Category, name: string) => {
      const sub = resources.lookup(PDFName.of(cat));
      return sub instanceof PDFDict ? this.src.context.lookup(sub.get(PDFName.of(name))) : undefined;
    };
    // A drawn object draws from `resources` too, the way pdf.js reads it: a form, Type3 font or soft-mask group whose
    // own `/Resources` is not a dictionary, and a tiling pattern always (pdf.js merges its resources with these).
    const inherit = (obj: PDFObject | undefined, read: () => (string | null)[], always = false): boolean => {
      if (!obj || seen.has(obj)) return true;
      const own = obj instanceof PDFStream ? obj.dict : obj;
      if (!(own instanceof PDFDict) || (!always && own.lookup(PDFName.of('Resources')) instanceof PDFDict)) return true;
      seen.add(obj);
      return read().every(c => c !== null && this.collect(c, resources, drawn, seen, depth + 1));
    };
    for (const op of ops) {
      const first = op.operands[0];
      const last = op.operands[op.operands.length - 1];
      const nameOf = (t: typeof first) => (t?.type === 'name' ? decodeName(t.raw) : undefined);
      const name = op.operator === 'Tf' ? nameOf(first) : nameOf(last);
      if (!name) continue;
      switch (op.operator) {
        case 'Do': {
          drawn.XObject.add(name);
          const form = entry('XObject', name);
          // An XObject whose /OC is a NAME (against the spec, but pdf.js renders it) is resolved in these /Properties
          // (round 6, R6-C-3).
          const oc = form instanceof PDFStream ? form.dict.get(PDFName.of('OC')) : undefined;
          if (oc instanceof PDFName) drawn.Properties.add(oc.decodeText());
          if (form instanceof PDFStream && form.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Form')
            && !inherit(form, () => [contentOf(this.lib, this.src, form)])) return false;
          break;
        }
        case 'Tf': {
          drawn.Font.add(name);
          const font = entry('Font', name);
          if (font instanceof PDFDict && font.lookup(PDFName.of('Subtype')) === PDFName.of('Type3')
            && !inherit(font, () => charProcs(this.lib, this.src, font))) return false;
          break;
        }
        case 'gs': {
          drawn.ExtGState.add(name);
          const gs = entry('ExtGState', name);
          const mask = gs instanceof PDFDict ? gs.lookup(PDFName.of('SMask')) : undefined;
          const group = mask instanceof PDFDict ? this.src.context.lookup(mask.get(PDFName.of('G'))) : undefined;
          if (group instanceof PDFStream && !inherit(group, () => [contentOf(this.lib, this.src, group)])) return false;
          // An ExtGState /Font [font size] sets the font the way Tf does, and pdf.js hands a Type3 font without
          // resources of its own these ones (round 4, R4-C-1).
          const setFont = gs instanceof PDFDict ? gs.lookup(PDFName.of('Font')) : undefined;
          const font = setFont instanceof this.lib.PDFArray ? this.src.context.lookup(setFont.get(0)) : undefined;
          if (font instanceof PDFDict && font.lookup(PDFName.of('Subtype')) === PDFName.of('Type3')
            && !inherit(font, () => charProcs(this.lib, this.src, font))) return false;
          break;
        }
        case 'scn': case 'SCN': {
          drawn.Pattern.add(name);
          const pattern = entry('Pattern', name);
          if (!(pattern instanceof PDFStream)) break;
          const own = pattern.dict.lookup(PDFName.of('Resources'));
          if (!(own instanceof PDFDict)) {
            if (!inherit(pattern, () => [contentOf(this.lib, this.src, pattern)], true)) return false;
            break;
          }
          // pdf.js merges a tiling pattern's resources over these WITHOUT merging sub-dictionaries: a category the
          // pattern has hides this one's whole, so only names in the categories it lacks are drawn from here (R5-S-2).
          if (seen.has(pattern)) break;
          seen.add(pattern);
          // Its own `seen`: a form reached first through the pattern (in the pattern's view) must still be followed
          // when the page draws it directly (round 6, R6-C-2, a round-5 regression). A form the page reached first is
          // skipped inside the pattern — its names already count for the page, and the pattern's own categories would
          // hide them anyway: over-keeping, the safe direction.
          const inner = new Set(seen);
          const mine: Drawn = { XObject: new Set(), Pattern: new Set(), Shading: new Set(), ExtGState: new Set(), Font: new Set(), Properties: new Set() };
          const view = this.src.context.obj({});
          for (const [k, v] of resources.entries()) view.set(k, v);
          for (const [k, v] of own.entries()) view.set(k, v);
          const text = contentOf(this.lib, this.src, pattern);
          if (text === null || !this.collect(text, view, mine, inner, depth + 1)) return false;
          for (const cat of PRUNED) if (!own.has(PDFName.of(cat))) for (const n of mine[cat]) drawn[cat].add(n);
          // The rest it draws from its own categories, through forms that read the merged view too: kept for its own
          // prune, which reads its content against its own dictionary alone (round 7, R7-C-5).
          const record = this.patternDrawn.get(pattern) ?? noneDrawn();
          for (const cat of PRUNED) if (own.has(PDFName.of(cat))) for (const n of mine[cat]) record[cat].add(n);
          this.patternDrawn.set(pattern, record);
          break;
        }
        case 'sh': drawn.Shading.add(name); break;
        case 'BDC': case 'DP': if (op.operands.length === 2) drawn.Properties.add(name); break;
      }
    }
    return true;
  }
}

/** Every node of the AcroForm field tree, by reference, down from `/Fields`. */
function fieldTreeRefs(lib: Lib, src: PDFDocument): Set<PDFRef> {
  const { PDFName, PDFDict, PDFArray, PDFRef: Ref } = lib;
  const out = new Set<PDFRef>();
  const form = src.catalog.lookup(PDFName.of('AcroForm'));
  const fields = form instanceof PDFDict ? form.lookup(PDFName.of('Fields')) : undefined;
  const stack: PDFObject[] = fields instanceof PDFArray ? fields.asArray() : [];
  while (stack.length) {
    const v = stack.pop();
    if (!(v instanceof Ref) || out.has(v)) continue;
    out.add(v);
    const node = src.context.lookup(v);
    const kids = node instanceof PDFDict ? node.lookup(PDFName.of('Kids')) : undefined;
    if (kids instanceof PDFArray) stack.push(...kids.asArray());
  }
  return out;
}

/**
 * Every `/Parent` ancestor of a field or widget anywhere in the file (round 8, R8-S-3). A set of its own: added to the
 * walk down's set first, it marked every `/Fields` root and that walk never expanded their kids (the 6C check).
 */
function fieldAncestorRefs(lib: Lib, src: PDFDocument): Set<PDFRef> {
  const { PDFName, PDFDict, PDFRef: Ref } = lib;
  const out = new Set<PDFRef>();
  for (const [, obj] of src.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || !(obj.has(PDFName.of('FT')) || obj.lookup(PDFName.of('Subtype')) === PDFName.of('Widget'))) continue;
    let up = obj.get(PDFName.of('Parent'));
    for (let depth = 0; up instanceof Ref && !out.has(up) && depth < 64; depth++) {
      const parent = src.context.lookup(up);
      if (!(parent instanceof PDFDict) || isPageDict(lib, parent) || parent.lookup(PDFName.of('Type')) === PDFName.of('Pages')) break;
      out.add(up);
      up = parent.get(PDFName.of('Parent'));
    }
  }
  return out;
}

/** The structure tree root and every structure element below it, by reference — never the content they mark. */
function structureTree(lib: Lib, src: PDFDocument): Set<PDFRef> {
  const { PDFName, PDFDict, PDFArray, PDFRef: Ref } = lib;
  const out = new Set<PDFRef>();
  const root = src.catalog.get(PDFName.of('StructTreeRoot'));
  const stack: PDFObject[] = root ? [root] : [];
  const seen = new Set<PDFRef>();
  while (stack.length) {
    const v = stack.pop();
    if (v instanceof Ref) { if (seen.has(v)) continue; seen.add(v); }
    // An array may itself be an indirect object — a /K array stored on its own (round 7, R7-S-1).
    const node = v instanceof Ref ? src.context.lookup(v) : v;
    if (node instanceof PDFArray) { stack.push(...node.asArray()); continue; }
    if (!(node instanceof PDFDict)) continue;
    const type = node.lookup(PDFName.of('Type'));
    // A marked-content or object reference names a page's content or an annotation, which are not the tree's.
    if (type === PDFName.of('MCR') || type === PDFName.of('OBJR')) continue;
    // Every dictionary below the root is an element, whatever its /S holds (R7-S-2).
    if (v instanceof Ref) out.add(v);
    const kids = node.get(PDFName.of('K'));
    if (kids) stack.push(kids);
  }
  return out;
}

/** A Type3 font's glyph procedures, each as content text (null when one cannot be decoded). */
function charProcs(lib: Lib, src: PDFDocument, font: PDFDict): (string | null)[] {
  const procs = font.lookup(lib.PDFName.of('CharProcs'));
  return procs instanceof lib.PDFDict ? procs.values().map(v => contentOf(lib, src, v)) : [];
}

/**
 * The default appearances a field's or widget's `/DR` serves: its own `/DA` (inherited through `/Parent`, then the
 * form's) and every descendant's, each as content text.
 */
function defaultAppearances(lib: Lib, src: PDFDocument, node: PDFDict, isCut: (ref: PDFRef) => boolean = () => false): string[] {
  const { PDFName, PDFDict, PDFString, PDFHexString, PDFArray } = lib;
  const da = (d: PDFDict) => {
    const v = d.lookup(PDFName.of('DA'));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  };
  const out: string[] = [];
  let up: PDFObject | undefined = node;
  for (let i = 0; i < 64 && up instanceof PDFDict; i++, up = up.lookup(PDFName.of('Parent'))) {
    const own = da(up);
    if (own !== undefined) { out.push(own); break; }
  }
  if (!out.length) {
    const form = src.catalog.lookup(PDFName.of('AcroForm'));
    const own = form instanceof PDFDict ? da(form) : undefined;
    if (own !== undefined) out.push(own);
  }
  const seen = new Set<PDFObject>([node]);
  const stack: PDFObject[] = [node];
  while (stack.length && seen.size < 10000) {
    const kids = (stack.pop() as PDFDict).lookup(PDFName.of('Kids'));
    if (!(kids instanceof PDFArray)) continue;
    for (const k of kids.asArray()) {
      if (k instanceof lib.PDFRef && isCut(k)) continue;
      const kid = src.context.lookup(k);
      if (!(kid instanceof PDFDict) || seen.has(kid)) continue;
      seen.add(kid);
      const own = da(kid);
      if (own !== undefined) out.push(own);
      stack.push(kid);
    }
  }
  return out;
}

/** pdf.js's `Dict.merge` with `mergeSubDicts`: `local` wins, and two DIRECT sub-dictionaries are merged entry by entry. */
function mergeResources(lib: Lib, src: PDFDocument, local: PDFDict, page: PDFDict | undefined): PDFDict {
  const { PDFDict } = lib;
  const values = new Map<PDFName, PDFObject[]>();
  for (const d of [local, page]) {
    if (!d) continue;
    for (const [k, v] of d.entries()) {
      const list = values.get(k) ?? [];
      if (list.length && !(v instanceof PDFDict)) continue;
      list.push(v);
      values.set(k, list);
    }
  }
  const merged = src.context.obj({});
  for (const [k, list] of values) {
    if (list.length === 1 || !(list[0] instanceof PDFDict)) { merged.set(k, list[0]); continue; }
    const sub = src.context.obj({});
    for (const d of list) if (d instanceof PDFDict) for (const [kk, vv] of d.entries()) if (!sub.has(kk)) sub.set(kk, vv);
    merged.set(k, sub);
  }
  return merged;
}

/**
 * A page's or form's content as text, or null when a stream cannot be decoded the way pdf.js decodes it. pdf-lib's
 * decoder ignores `/Predictor` (pdf.js applies it to Flate and LZW), so a predicted stream would read as different
 * bytes — its tag bytes are whitespace to the tokenizer, `/Fm1 Do` became `/F m1 D o`, and what the page draws was
 * pruned with no refusal (round 7, R7-C-1). It is unreadable instead, and the prune refuses where it must read it.
 */
function contentOf(lib: Lib, src: PDFDocument, value: PDFObject | undefined): string | null {
  const { PDFRawStream, PDFStream, PDFArray, PDFDict, PDFNumber, PDFName, decodePDFRawStream } = lib;
  const predicted = (parms: PDFObject | undefined): boolean => {
    const p = src.context.lookup(parms);
    if (p instanceof PDFArray) return p.asArray().some(predicted);
    const predictor = p instanceof PDFDict ? p.lookup(PDFName.of('Predictor')) : undefined;
    return predictor instanceof PDFNumber && predictor.asNumber() > 1;
  };
  const obj = value !== undefined ? src.context.lookup(value) : undefined;
  const streams = obj instanceof PDFArray ? obj.asArray().map(v => src.context.lookup(v)) : obj === undefined ? [] : [obj];
  let text = '';
  for (const s of streams) {
    // A raw stream is decoded; one pdf-lib built since the load (a flatten, a typed value) holds its bytes unencoded.
    let bytes: Uint8Array;
    try {
      if (s instanceof PDFRawStream && predicted(s.dict.get(PDFName.of('DecodeParms')))) return null;
      // pdf.js reads `/F` before `/Filter` and `/DP` before `/DecodeParms` (the inline-image abbreviations); pdf-lib reads
      // neither, so a stream carrying one is decoded differently by the two (round 8, R8-C-1).
      if (s instanceof PDFRawStream && (s.dict.has(PDFName.of('F')) || s.dict.has(PDFName.of('DP')))) return null;
      if (s instanceof PDFRawStream) bytes = decodePDFRawStream(s).decode();
      else if (s instanceof PDFStream && 'getUnencodedContents' in s) bytes = (s as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents();
      else return null;
    } catch { return null; }
    for (let k = 0; k < bytes.length; k++) text += String.fromCharCode(bytes[k]);
    text += '\n';
  }
  return text;
}

/** A content-stream name token (`/Fm#201`) as the dictionary key text it names (`Fm 1`). */
function decodeName(raw: string): string {
  return raw.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Rewrite every reference in `dest` that `map` answers: a ref to repoint it, `null` to cut it, `undefined` to leave
 * it. A cut is removed by its meaning, not left dangling: a Link whose GoTo target is cut leaves every page's
 * `/Annots` and the file (and a reference to that Link is cut in turn), a `/Kids` entry — direct or indirect array —
 * is removed, another array element becomes null, a dictionary key is deleted.
 */
function rewritePageRefs(lib: Lib, dest: PDFDocument, map: (ref: PDFRef) => PDFRef | null | undefined): void {
  const { PDFName, PDFArray: Arr, PDFDict, PDFRef: Ref, PDFStream, PDFNull } = lib;
  const ctx = dest.context;
  const targetOf = (annot: PDFObject | undefined): PDFObject | undefined => {
    if (!(annot instanceof PDFDict) || annot.lookup(PDFName.of('Subtype')) !== PDFName.of('Link')) return undefined;
    const destArr = annot.lookup(PDFName.of('Dest'));
    if (destArr instanceof Arr) return destArr.get(0);
    const action = annot.lookup(PDFName.of('A'));
    if (action instanceof PDFDict && action.lookup(PDFName.of('S')) === PDFName.of('GoTo')) {
      const d = action.lookup(PDFName.of('D'));
      if (d instanceof Arr) return d.get(0);
    }
    return undefined;
  };
  // 1. Links whose target is cut leave every page; deleted once all pages have dropped them.
  const dropped = new Set<PDFRef>();
  const kidsArrays = new Set<PDFArray>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const kids = obj.lookup(PDFName.of('Kids'));
    if (kids instanceof Arr) kidsArrays.add(kids);
    if (obj.lookup(PDFName.of('Type')) !== PDFName.of('Page')) continue;
    const annots = obj.lookup(PDFName.of('Annots'));
    if (!(annots instanceof Arr)) continue;
    for (let k = annots.size() - 1; k >= 0; k--) {
      const entry = annots.get(k);
      const target = targetOf(entry instanceof Ref ? ctx.lookup(entry) : entry);
      if (target instanceof Ref && map(target) === null) {
        annots.remove(k);
        if (entry instanceof Ref) dropped.add(entry);
      }
    }
  }
  for (const ref of dropped) ctx.delete(ref);
  const answer = (ref: PDFRef): PDFRef | null | undefined => (dropped.has(ref) ? null : map(ref));
  // 2. Every other use, in every object and the direct containers inside it.
  const seen = new Set<PDFObject>();
  const visit = (obj: PDFObject | undefined, key?: string): void => {
    if (obj instanceof PDFStream) return visit(obj.dict);
    if (!(obj instanceof PDFDict || obj instanceof Arr) || seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof Arr) {
      const isKids = key === 'Kids' || kidsArrays.has(obj);
      for (let k = obj.size() - 1; k >= 0; k--) {
        const v = obj.get(k);
        if (v instanceof Ref) {
          const to = answer(v);
          if (to === null) { if (isKids) obj.remove(k); else obj.set(k, PDFNull); } else if (to) obj.set(k, to);
        } else visit(v);
      }
      return;
    }
    for (const [name, v] of obj.entries()) {
      // A structure destination whose element is cut goes whole: [null /Fit] would name nothing (round 6).
      if (name === PDFName.of('SD') && v instanceof Arr && v.get(0) instanceof Ref && answer(v.get(0) as PDFRef) === null) {
        obj.delete(name);
        continue;
      }
      if (v instanceof Ref) {
        const to = answer(v);
        if (to === null) obj.delete(name); else if (to) obj.set(name, to);
      } else visit(v, name.decodeText());
    }
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj);
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
