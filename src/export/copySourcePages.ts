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
  // With every page kept nothing is left out, so nothing is cut and the copy is pdf-lib's own (R2-7).
  const anyLeftOut = keep.size < srcPages.length;
  const fieldChain = keptFieldChain(lib, src, keptAnnots);
  if (anyLeftOut) for (const r of fieldsNoKeptWidgetReaches(lib, src, keptAnnots, fieldChain)) cutRefs.add(r);
  // Any other form field — reached through an action's /Fields or /T, say — is one no kept widget belongs to.
  const foreignField = (ref: PDFRef, obj: PDFObject | undefined): boolean => anyLeftOut
    && obj instanceof Dict && obj.has(PDFName.of('FT')) && !fieldChain.has(ref) && !keptAnnots.has(ref);
  // The catalog and the page-tree nodes are the whole document: a signature's /Reference /Data, say, names the
  // catalog, and copying it would carry every page, field and outline (R2-3).
  const catalogRef = src.context.trailerInfo.Root;
  const isDocument = (ref: PDFRef, obj: PDFObject | undefined): boolean => ref === catalogRef
    || (obj instanceof Dict && obj.lookup(PDFName.of('Type')) === PDFName.of('Pages'));
  const pruner = opts.pruneSharedResources && anyLeftOut
    ? new ResourcePruner(lib, src, reachableFromPages(lib, src, srcPages.filter((_, i) => !keep.has(i))))
    : undefined;

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
    if (cutRefs.has(ref) || isPageDict(lib, obj) || foreignField(ref, obj) || isDocument(ref, obj)) return (cut ??= dest.context.nextRef());
    // A form, pattern, appearance or Type3 font with resources of its own carries only what it draws of them (M1-S1).
    if (pruner && !internals.traversedObjects.has(ref)) {
      const owner = pruner.prunedOwner(obj);
      if (owner) {
        const newRef = dest.context.nextRef();
        internals.traversedObjects.set(ref, newRef);
        dest.context.assign(newRef, copier.copy(owner));
        return newRef;
      }
    }
    return copyRef(ref);
  };

  const assigned = new Set<number>();
  const pages = indices.map(i => {
    let node = srcPages[i].node;
    const resources = pruner?.pruned(
      () => [contentOf(lib, src, node.get(PDFName.of('Contents')))], node.Resources());
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
  return obj instanceof lib.PDFDict && obj.lookup(lib.PDFName.of('Type')) === lib.PDFName.of('Page');
}

/** Every field on a kept widget's `/Parent` chain: the fields the kept pages show. */
function keptFieldChain(lib: Lib, src: PDFDocument, keptAnnots: Set<PDFRef>): Set<PDFRef> {
  const { PDFName, PDFDict, PDFRef: Ref } = lib;
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
function reachableFromPages(lib: Lib, src: PDFDocument, pages: PDFPage[]): Set<PDFRef> {
  const { PDFDict, PDFArray, PDFRef: Ref, PDFStream, PDFName } = lib;
  const reach = new Set<PDFRef>();
  const parent = PDFName.of('Parent');
  const visit = (obj: PDFObject | undefined, fromPage: boolean): void => {
    if (obj instanceof Ref) {
      if (reach.has(obj)) return;
      const target = src.context.lookup(obj);
      if (isPageDict(lib, target)) return;
      reach.add(obj);
      return visit(target, false);
    }
    if (obj instanceof PDFStream) return visit(obj.dict, false);
    if (obj instanceof PDFArray) return obj.asArray().forEach(v => visit(v, false));
    if (obj instanceof PDFDict) for (const [k, v] of obj.entries()) if (!(fromPage && k === parent)) visit(v, false);
  };
  for (const page of pages) {
    visit(page.node, true);
    visit(page.node.Resources(), false);
  }
  return reach;
}

const PRUNED = ['XObject', 'Pattern', 'Shading', 'ExtGState', 'Font', 'Properties', 'ColorSpace'] as const;
type Category = (typeof PRUNED)[number];
type Drawn = Record<Category, Set<string>> & { anyColorSpace: boolean };

/**
 * M1-S1, round 2. A `/Resources` dictionary a kept page shares with a removed one — by reference, through the page
 * tree, through a shared sub-dictionary, or as the resources of a form, pattern, appearance or Type3 font the kept
 * page reaches (FPDI's templates carry `/Resources 2 0 R`, FPDF's one dictionary) — is replaced, per OWNER, by a copy
 * holding only what that owner draws. An entry stays when the owner draws it or no removed page reaches it.
 */
class ResourcePruner {
  constructor(private readonly lib: Lib, private readonly src: PDFDocument, private readonly excluded: Set<PDFRef>) {}

  /** A clone of a form / pattern / appearance stream or Type3 font with its resources pruned, or undefined. */
  prunedOwner(obj: PDFObject | undefined): PDFObject | undefined {
    const { PDFName, PDFDict, PDFStream } = this.lib;
    const key = PDFName.of('Resources');
    if (obj instanceof PDFStream) {
      const resources = obj.dict.lookup(key);
      if (!(resources instanceof PDFDict)) return undefined;
      const pruned = this.pruned(() => [contentOf(this.lib, this.src, obj)], resources);
      if (!pruned) return undefined;
      const clone = obj.clone();
      clone.dict.set(key, pruned);
      return clone;
    }
    if (obj instanceof PDFDict && !isPageDict(this.lib, obj)) {
      const resources = obj.lookup(key);
      if (!(resources instanceof PDFDict)) return undefined;
      // Only a Type3 font draws from resources of its own; any other owner cannot be read, so it refuses if it must.
      const contents = () => (obj.lookup(PDFName.of('Subtype')) === PDFName.of('Type3') ? charProcs(this.lib, this.src, obj) : [null]);
      const pruned = this.pruned(contents, resources);
      if (!pruned) return undefined;
      const clone = obj.clone();
      clone.set(key, pruned);
      return clone;
    }
    return undefined;
  }

  /** `resources` holding only what `contents` draws of the entries a removed page reaches; undefined when unchanged. */
  pruned(contents: () => (string | null)[], resources: PDFDict | undefined): PDFDict | undefined {
    const { PDFName, PDFDict } = this.lib;
    if (!resources || !PRUNED.some(cat => {
      const sub = resources.lookup(PDFName.of(cat));
      return this.touches(resources.get(PDFName.of(cat))) || (sub instanceof PDFDict && sub.values().some(v => this.touches(v)));
    })) return undefined;
    const drawn: Drawn = { XObject: new Set(), Pattern: new Set(), Shading: new Set(), ExtGState: new Set(), Font: new Set(),
      Properties: new Set(), ColorSpace: new Set(), anyColorSpace: false };
    for (const content of contents()) {
      if (content === null || !this.collect(content, resources, drawn, new Set(), 0)) throw new ExportResourcesUnreadableError();
    }
    let changed = false;
    const out = resources.clone(this.src.context);
    for (const cat of PRUNED) {
      const sub = resources.lookup(PDFName.of(cat));
      if (!(sub instanceof PDFDict)) continue;
      const kept = this.src.context.obj({});
      for (const [name, value] of sub.entries()) {
        const used = drawn[cat].has(name.decodeText()) || (cat === 'ColorSpace' && drawn.anyColorSpace);
        if (used || !this.touches(value)) kept.set(name, value);
        else changed = true;
      }
      if (kept.entries().length !== sub.entries().length) out.set(PDFName.of(cat), kept);
    }
    return changed ? out : undefined;
  }

  /** Whether a value is, or directly contains, a reference a removed page reaches. */
  private touches(value: PDFObject | undefined): boolean {
    const { PDFRef: Ref, PDFDict, PDFArray } = this.lib;
    if (value instanceof Ref) return this.excluded.has(value);
    if (value instanceof PDFDict) return value.values().some(v => this.touches(v));
    if (value instanceof PDFArray) return value.asArray().some(v => this.touches(v));
    return false;
  }

  /**
   * The names `content` draws from `resources` — `Do`, `Tf`, `gs`, `scn`/`SCN`, `sh`, `cs`/`CS`, `BDC`/`DP`; an inline
   * image may name any colour space — through every form, Type3 font, soft-mask group and tiling pattern it draws that
   * has no resources of its own, since that draws from the same dictionary. False when anything cannot be read.
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
      if (op.operator === 'INLINE_IMAGE') { drawn.anyColorSpace = true; continue; }
      const first = op.operands[0];
      const last = op.operands[op.operands.length - 1];
      const nameOf = (t: typeof first) => (t?.type === 'name' ? decodeName(t.raw) : undefined);
      const name = op.operator === 'Tf' ? nameOf(first) : nameOf(last);
      if (!name) continue;
      switch (op.operator) {
        case 'Do': {
          drawn.XObject.add(name);
          const form = entry('XObject', name);
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
          break;
        }
        case 'scn': case 'SCN': {
          drawn.Pattern.add(name);
          const pattern = entry('Pattern', name);
          if (pattern instanceof PDFStream && !inherit(pattern, () => [contentOf(this.lib, this.src, pattern)], true)) return false;
          break;
        }
        case 'sh': drawn.Shading.add(name); break;
        case 'cs': case 'CS': drawn.ColorSpace.add(name); break;
        case 'BDC': case 'DP': if (op.operands.length === 2) drawn.Properties.add(name); break;
      }
    }
    return true;
  }
}

/** A Type3 font's glyph procedures, each as content text (null when one cannot be decoded). */
function charProcs(lib: Lib, src: PDFDocument, font: PDFDict): (string | null)[] {
  const procs = font.lookup(lib.PDFName.of('CharProcs'));
  return procs instanceof lib.PDFDict ? procs.values().map(v => contentOf(lib, src, v)) : [];
}

/** A page's or form's content as text, or null when a stream cannot be decoded. */
function contentOf(lib: Lib, src: PDFDocument, value: PDFObject | undefined): string | null {
  const { PDFRawStream, PDFStream, PDFArray, decodePDFRawStream } = lib;
  const obj = value !== undefined ? src.context.lookup(value) : undefined;
  const streams = obj instanceof PDFArray ? obj.asArray().map(v => src.context.lookup(v)) : obj === undefined ? [] : [obj];
  let text = '';
  for (const s of streams) {
    // A raw stream is decoded; one pdf-lib built since the load (a flatten, a typed value) holds its bytes unencoded.
    let bytes: Uint8Array;
    try {
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
