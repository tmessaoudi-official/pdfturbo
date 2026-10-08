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
import type { PDFArray, PDFDict, PDFDocument, PDFObject, PDFPage, PDFRef } from '@cantoo/pdf-lib';
import { groupOps, tokenizeContentStream } from '../utils/contentStreamEditor';

type Lib = typeof import('@cantoo/pdf-lib');

export interface CopySourcePagesOptions {
  /**
   * Source page indices that are NOT copied but are replaced in the destination by a page built later — a redacted
   * page's image. A reference to one is held on a stand-in, which `resolveStandIns` must then point at that page.
   */
  standIns?: number[];
  /**
   * M1-S1: a kept page whose `/Resources` it shares with — or inherits through the page tree from the same node as —
   * a page left out carries only the XObjects, patterns and shadings the kept pages DRAW. For the PDF outputs only;
   * a page rendered to pixels shows nothing it does not draw. Refuses (`ExportResourcesUnreadableError`) when a kept
   * page's drawing cannot be read, rather than guessing which entries are safe to keep.
   */
  pruneSharedResources?: boolean;
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
  const keptAnnots = new Set<PDFRef>();
  for (const i of keep) for (const r of annotRefs(lib, srcPages[i])) keptAnnots.add(r);
  const cutRefs = new Set<PDFRef>();
  for (let i = 0; i < srcPages.length; i++) {
    if (keep.has(i)) continue;
    for (const r of annotRefs(lib, srcPages[i])) if (!keptAnnots.has(r)) cutRefs.add(r);
  }
  for (const r of fieldsNoKeptWidgetReaches(lib, src, keptAnnots)) cutRefs.add(r);
  const ownResources = opts.pruneSharedResources && keep.size < srcPages.length
    ? prunedSharedResources(lib, src, srcPages, keep)
    : new Map<number, PDFDict>();

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
    // A page dictionary outside the page tree — what a pre-fix export left behind — is a page left out too.
    if (cutRefs.has(ref) || isPageDict(lib, src.context.lookup(ref))) return (cut ??= dest.context.nextRef());
    return copyRef(ref);
  };

  const assigned = new Set<number>();
  const pages = indices.map(i => {
    let node = srcPages[i].node;
    const resources = ownResources.get(i);
    if (resources) {
      node = node.clone();
      node.set(PDFName.of('Resources'), resources);
    }
    const copied = copier.copy(node);
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

function isPageDict(lib: Lib, obj: PDFObject | undefined): boolean {
  return obj instanceof lib.PDFDict && obj.get(lib.PDFName.of('Type')) === lib.PDFName.of('Page');
}

/**
 * M1-C1: the form fields a copy would carry although no kept widget belongs to them. A kept widget's `/Parent` chain
 * brings its ancestors, and their `/Kids` name the SIBLING fields — whose `/V` holds a value typed on a page left
 * out. Every child of a chain field that is neither on a kept chain nor a kept widget is cut.
 */
function fieldsNoKeptWidgetReaches(lib: Lib, src: PDFDocument, keptAnnots: Set<PDFRef>): PDFRef[] {
  const { PDFName, PDFDict, PDFArray, PDFRef: Ref } = lib;
  const chain = new Set<PDFRef>();
  for (const widget of keptAnnots) {
    let node = src.context.lookup(widget);
    while (node instanceof PDFDict) {
      const parent = node.get(PDFName.of('Parent'));
      if (!(parent instanceof Ref) || chain.has(parent)) break;
      chain.add(parent);
      node = src.context.lookup(parent);
    }
  }
  const cut: PDFRef[] = [];
  for (const field of chain) {
    const node = src.context.lookup(field);
    const kids = node instanceof PDFDict ? node.lookup(PDFName.of('Kids')) : undefined;
    if (!(kids instanceof PDFArray)) continue;
    for (const kid of kids.asArray()) if (kid instanceof Ref && !chain.has(kid) && !keptAnnots.has(kid)) cut.push(kid);
  }
  return cut;
}

const PRUNED = ['XObject', 'Pattern', 'Shading'] as const;
type Drawn = Record<(typeof PRUNED)[number], Set<string>>;

/**
 * M1-S1: for each kept page whose resources dictionary is also a removed page's — by reference or inherited from the
 * same tree node — the replacement dictionary holding only what the KEPT users of it draw. A dictionary whose every
 * entry is drawn is left alone, so the output changes only where something would have been carried.
 */
function prunedSharedResources(lib: Lib, src: PDFDocument, srcPages: PDFPage[], keep: Set<number>): Map<number, PDFDict> {
  const { PDFName, PDFDict } = lib;
  const effective = srcPages.map(p => {
    const r = p.node.Resources();
    return r instanceof PDFDict ? r : undefined;
  });
  const out = new Map<number, PDFDict>();
  const groups = new Map<PDFDict, number[]>();
  effective.forEach((dict, i) => {
    if (!dict || !keep.has(i)) return;
    const shared = effective.some((other, j) => other === dict && !keep.has(j));
    if (!shared) return;
    groups.set(dict, [...(groups.get(dict) ?? []), i]);
  });
  for (const [dict, users] of groups) {
    const drawn: Drawn = { XObject: new Set(), Pattern: new Set(), Shading: new Set() };
    for (const i of users) {
      const content = contentOf(lib, src, srcPages[i].node.get(PDFName.of('Contents')));
      if (content === null || !collectDrawn(lib, src, content, dict, drawn, new Set(), 0)) throw new ExportResourcesUnreadableError();
    }
    let changed = false;
    const pruned = dict.clone(src.context);
    for (const cat of PRUNED) {
      const sub = dict.lookup(PDFName.of(cat));
      if (!(sub instanceof PDFDict)) continue;
      const kept = src.context.obj({});
      for (const [name, value] of sub.entries()) {
        if (drawn[cat].has(name.decodeText())) kept.set(name, value);
        else changed = true;
      }
      pruned.set(PDFName.of(cat), kept);
    }
    if (changed) for (const i of users) out.set(i, pruned);
  }
  return out;
}

/** A page's or form's content as text, or null when a stream cannot be decoded. */
function contentOf(lib: Lib, src: PDFDocument, value: PDFObject | undefined): string | null {
  const { PDFRawStream, PDFArray, decodePDFRawStream } = lib;
  const obj = value !== undefined ? src.context.lookup(value) : undefined;
  const streams = obj instanceof PDFArray ? obj.asArray().map(v => src.context.lookup(v)) : obj === undefined ? [] : [obj];
  let text = '';
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) return null;
    let bytes: Uint8Array;
    try { bytes = decodePDFRawStream(s).decode(); } catch { return null; }
    for (let k = 0; k < bytes.length; k++) text += String.fromCharCode(bytes[k]);
    text += '\n';
  }
  return text;
}

/**
 * Names `content` draws from `resources`: `Do` (XObject), a name operand of `scn`/`SCN` (Pattern), `sh` (Shading) —
 * through every form it draws that has no `/Resources` of its own, since that form draws from the same dictionary.
 * False when anything on the way cannot be read.
 */
function collectDrawn(
  lib: Lib, src: PDFDocument, content: string, resources: PDFDict, drawn: Drawn, seen: Set<unknown>, depth: number,
): boolean {
  const { PDFName, PDFDict, PDFRawStream } = lib;
  if (depth > 12) return false;
  let ops;
  try { ops = groupOps(tokenizeContentStream(content)); } catch { return false; }
  const xobjects = resources.lookup(PDFName.of('XObject'));
  for (const op of ops) {
    const last = op.operands[op.operands.length - 1];
    const name = last?.type === 'name' ? decodeName(last.raw) : undefined;
    if (!name) continue;
    if (op.operator === 'Do') {
      drawn.XObject.add(name);
      const form = xobjects instanceof PDFDict ? src.context.lookup(xobjects.get(PDFName.of(name))) : undefined;
      if (!(form instanceof PDFRawStream) || seen.has(form)) continue;
      if (form.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Form') || form.dict.get(PDFName.of('Resources'))) continue;
      seen.add(form);
      const inner = contentOf(lib, src, form);
      if (inner === null || !collectDrawn(lib, src, inner, resources, drawn, seen, depth + 1)) return false;
    } else if (op.operator === 'scn' || op.operator === 'SCN') drawn.Pattern.add(name);
    else if (op.operator === 'sh') drawn.Shading.add(name);
  }
  return true;
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
    if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype')) !== PDFName.of('Link')) return undefined;
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
    if (obj.get(PDFName.of('Type')) !== PDFName.of('Page')) continue;
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
