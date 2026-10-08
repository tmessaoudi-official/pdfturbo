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
import type { PDFDict, PDFDocument, PDFObject, PDFPage, PDFRef } from '@cantoo/pdf-lib';

export interface CopySourcePagesOptions {
  /**
   * Source page indices that are NOT copied but are replaced in the destination by a page built later — a redacted
   * page's image. A reference to one is held on a stand-in, which `resolveStandIns` must then point at that page.
   */
  standIns?: number[];
}

export interface CopiedSourcePages {
  pages: PDFPage[];
  /** The source's `/OCProperties`, copied into the destination's context; absent when the source has none. */
  ocProperties?: PDFDict;
  /** Source page index → its stand-in, for each `standIns` page something copied actually references. */
  standIns: Map<number, PDFRef>;
}

/**
 * SEC-1 (review 2026-10-07, P0). The copier deep-copies everything a kept page reaches, so a reference to a page
 * that is NOT exported — a GoTo link, a form field whose widgets span pages, a `/Popup` or `/IRT` — used to carry
 * that whole page into the file, absent from `/Pages` but with its text in the bytes; and because the copier
 * memoises a page on its CLONE, a link to a page that WAS kept landed on a second, orphan copy of it (pdf.js then
 * resolved every internal link to page 1, and an annotation's `/P` duplicated its own page). So every reference to
 * a source page is answered here, never copied: a kept page → its own destination object (allocated lazily, so a
 * document with no page references keeps its exact object numbering and bytes); a stand-in → a ref
 * `resolveStandIns` points at its replacement; anything else, and any annotation listed only on an excluded page →
 * one CUT marker, which `rewritePageRefs` then removes: a link to it is dropped, a `/Kids` entry removed, any other
 * use deleted. Ruled by the developer 2026-10-08 (docs/plans/review-remediation.plan.md).
 */
export async function copySourcePages(
  dest: PDFDocument, src: PDFDocument, indices: number[], opts: CopySourcePagesOptions = {},
): Promise<CopiedSourcePages> {
  const { PDFObjectCopier, PDFPage: Page, PDFName, PDFDict: Dict } = await import('@cantoo/pdf-lib');
  await src.flush();
  const copier = PDFObjectCopier.for(src.context, dest.context);
  const srcPages = src.getPages();
  const keep = new Set(indices);
  const standInIndices = new Set((opts.standIns ?? []).filter(i => !keep.has(i)));

  const pageIndexOf = new Map<PDFRef, number>(srcPages.map((p, i) => [p.ref, i]));
  const keptAnnots = new Set<PDFRef>();
  for (const i of keep) for (const r of await annotRefs(srcPages[i])) keptAnnots.add(r);
  const excludedAnnots = new Set<PDFRef>();
  for (let i = 0; i < srcPages.length; i++) {
    if (keep.has(i)) continue;
    for (const r of await annotRefs(srcPages[i])) if (!keptAnnots.has(r)) excludedAnnots.add(r);
  }

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
  const internals = copier as unknown as { copyPDFIndirectObject: (ref: PDFRef) => PDFRef };
  const copyRef = internals.copyPDFIndirectObject;
  internals.copyPDFIndirectObject = (ref: PDFRef): PDFRef => {
    const i = pageIndexOf.get(ref);
    if (i !== undefined) {
      if (keep.has(i)) return lazy(destRefOf, i);
      if (standInIndices.has(i)) return lazy(standIns, i);
      return (cut ??= dest.context.nextRef());
    }
    if (excludedAnnots.has(ref)) return (cut ??= dest.context.nextRef());
    return copyRef(ref);
  };

  const assigned = new Set<number>();
  const pages = indices.map(i => {
    const node = copier.copy(srcPages[i].node);
    let ref = assigned.has(i) ? undefined : destRefOf.get(i);
    if (ref) dest.context.assign(ref, node);
    else ref = dest.context.register(node);
    if (!destRefOf.has(i)) destRefOf.set(i, ref);
    assigned.add(i);
    return Page.of(node, ref, dest);
  });
  const oc = src.catalog.lookupMaybe(PDFName.of('OCProperties'), Dict);
  const ocProperties = oc ? copier.copy(oc) : undefined;
  if (cut) {
    const marker = cut;
    await rewritePageRefs(dest, ref => (ref === marker ? null : undefined));
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
  await rewritePageRefs(dest, ref => (targets.has(ref) ? (targets.get(ref) ?? null) : undefined));
}

async function annotRefs(page: PDFPage): Promise<PDFRef[]> {
  const { PDFName, PDFArray, PDFRef: Ref } = await import('@cantoo/pdf-lib');
  const annots = page.node.lookup(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.asArray().filter((r): r is PDFRef => r instanceof Ref) : [];
}

/**
 * Rewrite every reference in `dest` that `map` answers: a ref to repoint it, `null` to cut it, `undefined` to leave
 * it. A cut is removed by its meaning, not left dangling: a Link or GoTo whose target is cut leaves its page's
 * `/Annots` (and the file), a `/Kids` entry is removed, an array element becomes null, a dictionary key is deleted.
 */
async function rewritePageRefs(dest: PDFDocument, map: (ref: PDFRef) => PDFRef | null | undefined): Promise<void> {
  const { PDFName, PDFArray, PDFDict, PDFRef: Ref, PDFStream, PDFNull } = await import('@cantoo/pdf-lib');
  const ctx = dest.context;
  const targetOf = (annot: PDFObject | undefined): PDFObject | undefined => {
    if (!(annot instanceof PDFDict)) return undefined;
    const destArr = annot.lookup(PDFName.of('Dest'));
    if (destArr instanceof PDFArray) return destArr.get(0);
    const action = annot.lookup(PDFName.of('A'));
    if (action instanceof PDFDict && action.lookup(PDFName.of('S')) === PDFName.of('GoTo')) {
      const d = action.lookup(PDFName.of('D'));
      if (d instanceof PDFArray) return d.get(0);
    }
    return undefined;
  };
  // 1. Links whose target is cut leave their page.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Page')) continue;
    const annots = obj.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let k = annots.size() - 1; k >= 0; k--) {
      const entry = annots.get(k);
      const target = targetOf(entry instanceof Ref ? ctx.lookup(entry) : entry);
      if (target instanceof Ref && map(target) === null) {
        annots.remove(k);
        if (entry instanceof Ref) ctx.delete(entry);
      }
    }
  }
  // 2. Every other use, in every object and the direct containers inside it.
  const seen = new Set<PDFObject>();
  const visit = (obj: PDFObject | undefined, key?: string): void => {
    if (obj instanceof PDFStream) return visit(obj.dict);
    if (!(obj instanceof PDFDict || obj instanceof PDFArray) || seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFArray) {
      for (let k = obj.size() - 1; k >= 0; k--) {
        const v = obj.get(k);
        if (v instanceof Ref) {
          const to = map(v);
          if (to === null) { if (key === 'Kids') obj.remove(k); else obj.set(k, PDFNull); } else if (to) obj.set(k, to);
        } else visit(v);
      }
      return;
    }
    for (const [name, v] of obj.entries()) {
      if (v instanceof Ref) {
        const to = map(v);
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
