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
  // An annotation written inline in `/Annots` (against the spec, but met) has no reference; its field chain counts too.
  const keptInline = [...keep].flatMap(i => inlineAnnots(lib, srcPages[i]));
  const cutRefs = new Set<PDFRef>();
  for (let i = 0; i < srcPages.length; i++) {
    if (keep.has(i)) continue;
    for (const r of annotRefs(lib, srcPages[i])) if (!keptAnnots.has(r)) cutRefs.add(r);
  }
  // With every page kept, no field is cut (R2-7). References to a page, an orphan page, the catalog or the page tree
  // are still answered below either way — a copy never carries the document.
  const anyLeftOut = keep.size < srcPages.length;
  const fieldChain = keptFieldChain(lib, src, keptAnnots, keptInline);
  if (anyLeftOut) for (const r of fieldsNoKeptWidgetReaches(lib, src, keptAnnots, fieldChain)) cutRefs.add(r);
  // Any other form field — reached through an action's /Fields or /T, say — is one no kept widget belongs to.
  const foreignField = (ref: PDFRef, obj: PDFObject | undefined): boolean => anyLeftOut
    && isField(lib, src, obj) && !fieldChain.has(ref) && !keptAnnots.has(ref);
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
    // A form, pattern, appearance or Type3 font with resources of its own carries only what it draws of them (M1-S1),
    // and so does an owner written inline inside what is copied, through dictionaries, arrays and stream dictionaries
    // — a widget's /DR, a Type3 font in an ExtGState's /Font array (rounds 4 and 5).
    if (pruner && !internals.traversedObjects.has(ref)) {
      const owner = pruner.pruneNested(obj, pruner.pageContent.get(ref));
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
    const contents = node.get(PDFName.of('Contents'));
    const read = () => [contentOf(lib, src, contents)];
    // pdf.js reads a single content stream through its own /Resources merged over the page's (round 4, R4-C-2): what
    // the page draws is collected there, and the stream's own dictionary is pruned against the same drawing.
    const stream = src.context.lookup(contents);
    const local = stream instanceof lib.PDFStream ? stream.dict.lookup(PDFName.of('Resources')) : undefined;
    const from = pruner && local instanceof Dict && local.keys().length > 0 ? mergeResources(lib, src, local, node.Resources()) : undefined;
    if (from && contents instanceof lib.PDFRef) pruner?.pageContent.set(contents, { contents: read, from });
    // A member of an ARRAY /Contents is read as part of a sequence with no dictionary, so its own /Resources is never
    // read by pdf.js: it draws nothing from them (round 5, R5-S-3).
    if (pruner && stream instanceof lib.PDFArray) {
      for (const member of stream.asArray()) if (member instanceof lib.PDFRef) pruner.pageContent.set(member, { contents: () => [] });
    }
    const resources = pruner?.pruned(read, node.Resources(), from);
    if (resources) {
      node = node.clone();
      node.set(PDFName.of('Resources'), resources);
    }
    // The page's other direct entries — an inline widget in /Annots with a /DR — hold owners too (round 5, R5-C-1).
    if (pruner) {
      for (const [key, value] of node.entries()) {
        if (key === PDFName.of('Resources') || key === PDFName.of('Parent') || key === PDFName.of('Contents')) continue;
        const nested = pruner.pruneNested(value);
        if (!nested) continue;
        if (node === srcPages[i].node) node = node.clone();
        node.set(key, nested);
      }
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

function inlineAnnots(lib: Lib, page: PDFPage): PDFDict[] {
  const annots = page.node.lookup(lib.PDFName.of('Annots'));
  return annots instanceof lib.PDFArray ? annots.asArray().filter((a): a is PDFDict => a instanceof lib.PDFDict) : [];
}

/** A form field: `/FT` on the node or inherited through its `/Parent` chain (round 3 — an action may name a child). */
function isField(lib: Lib, src: PDFDocument, obj: PDFObject | undefined): boolean {
  const { PDFName, PDFDict } = lib;
  let node = obj;
  for (let depth = 0; node instanceof PDFDict && depth < 64; depth++) {
    if (node.has(PDFName.of('FT'))) return true;
    node = src.context.lookup(node.get(PDFName.of('Parent')));
  }
  return false;
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
function reachableFromPages(lib: Lib, src: PDFDocument, pages: PDFPage[]): Set<PDFRef> {
  const { PDFDict, PDFArray, PDFRef: Ref, PDFStream, PDFName } = lib;
  const reach = new Set<PDFRef>();
  const parent = PDFName.of('Parent');
  const catalog = src.context.trailerInfo.Root;
  // Iterative: a chain of 20 000 outline items overflowed the stack recursively (round 3). It stops where the copy
  // stops — at another page, the catalog and the page tree, which the copier hook cuts.
  const stack: Array<[PDFObject | undefined, boolean]> = [];
  for (const page of pages) stack.push([page.node, true], [page.node.Resources(), false]);
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
  return reach;
}

// `/ColorSpace` is not pruned: a colour space draws nothing, and pdf.js resolves its names in places no operator shows
// (a shading's `/ColorSpace`, an Indexed or Separation base, an alias entry) — round 3 found pruning it recoloured pages.
const PRUNED = ['XObject', 'Pattern', 'Shading', 'ExtGState', 'Font', 'Properties'] as const;
type Category = (typeof PRUNED)[number];
type Drawn = Record<Category, Set<string>>;

/**
 * M1-S1, round 2. A `/Resources` dictionary a kept page shares with a removed one — by reference, through the page
 * tree, through a shared sub-dictionary, or as the resources of a form, pattern, appearance or Type3 font the kept
 * page reaches (FPDI's templates carry `/Resources 2 0 R`, FPDF's one dictionary) — is replaced, per OWNER, by a copy
 * holding only what that owner draws. An entry stays when the owner draws it or no removed page reaches it.
 */
class ResourcePruner {
  private readonly inProgress = new Set<PDFObject>();
  /** A page's single content stream → the page's whole content and the merged resources pdf.js reads it with. */
  readonly pageContent = new Map<PDFRef, { contents: () => (string | null)[]; from?: PDFDict }>();
  /** References known not to reach anything a removed page reaches (a memo for `touches`). */
  private readonly clean = new Set<PDFRef>();

  constructor(private readonly lib: Lib, private readonly src: PDFDocument, private readonly excluded: Set<PDFRef>) {}

  /**
   * A clone of a form / pattern / appearance stream, Type3 font or field (`/DR`) with its resources pruned, or
   * undefined. `page` is given for a page's content stream: it draws the page's whole content, read the way pdf.js does.
   */
  prunedOwner(obj: PDFObject | undefined, page?: { contents: () => (string | null)[]; from?: PDFDict }): PDFObject | undefined {
    const { PDFName, PDFDict, PDFStream } = this.lib;
    let key = PDFName.of('Resources');
    if (obj instanceof PDFStream) {
      const resources = obj.dict.lookup(key);
      if (!(resources instanceof PDFDict)) return undefined;
      const pruned = this.pruned(page?.contents ?? (() => [contentOf(this.lib, this.src, obj)]), resources, page?.from);
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
        key = PDFName.of('DR');
        resources = obj.lookup(key);
        if (!(resources instanceof PDFDict)) return undefined;
        const das = defaultAppearances(this.lib, this.src, obj);
        const pruned = this.pruned(() => das, resources);
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
      try { pruned = this.pruned(contents, resources); } finally { this.inProgress.delete(obj); }
      if (!pruned) return undefined;
      const clone = obj.clone();
      clone.set(key, pruned);
      return clone;
    }
    return undefined;
  }

  /**
   * `resources` holding only what `contents` draws of the entries a removed page reaches, and every inline owner in
   * it pruned in turn; undefined when unchanged. Names resolve in `from` (default `resources`).
   */
  pruned(contents: () => (string | null)[], resources: PDFDict | undefined, from: PDFDict = resources as PDFDict): PDFDict | undefined {
    const { PDFName, PDFDict } = this.lib;
    if (!resources) return undefined;
    const shared = this.isShared(resources);
    // Nothing shared: only an inline owner deeper in may still carry something (an indirect /Resources of its own).
    let drawn: Drawn | undefined;
    if (shared) {
      drawn = { XObject: new Set(), Pattern: new Set(), Shading: new Set(), ExtGState: new Set(), Font: new Set(), Properties: new Set() };
      for (const content of contents()) {
        if (content === null || !this.collect(content, from, drawn, new Set(), 0)) throw new ExportResourcesUnreadableError();
      }
    }
    let changed = false;
    const out = resources.clone(this.src.context);
    {
      for (const cat of PRUNED) {
        const sub = resources.lookup(PDFName.of(cat));
        if (!(sub instanceof PDFDict)) continue;
        let catChanged = false;
        const kept = this.src.context.obj({});
        for (const [name, value] of sub.entries()) {
          // Drawn by name, and — when names resolve in a merged view — only if that view resolves this name to THIS
          // entry: a content stream's own /Fm1 shadows the page's, and pdf.js draws the stream's (round 4).
          const fromSub = from === resources ? undefined : from.lookup(PDFName.of(cat));
          const isDrawn = drawn?.[cat].has(name.decodeText())
            && (from === resources || (fromSub instanceof PDFDict && fromSub.get(name) === value));
          if (drawn && !isDrawn && this.touches(value)) { catChanged = true; continue; }
          // An inline owner (a Type3 font written in the dictionary, or one inside an inline ExtGState's /Font array)
          // never reaches the copier hook: prune it here.
          const inline = this.pruneNested(value);
          if (inline) catChanged = true;
          kept.set(name, inline ?? value);
        }
        if (catChanged) { out.set(PDFName.of(cat), kept); changed = true; }
      }
    }
    return changed ? out : undefined;
  }

  /** Whether any category of `resources` reaches something a removed page reaches. */
  isShared(resources: PDFDict): boolean {
    const { PDFName, PDFDict } = this.lib;
    return PRUNED.some(cat => {
      const sub = resources.lookup(PDFName.of(cat));
      return this.touches(resources.get(PDFName.of(cat))) || (sub instanceof PDFDict && sub.values().some(v => this.touches(v)));
    });
  }

  /**
   * A clone of `value` — an owner pruned, and every owner written inline inside it (through dictionaries, arrays and a
   * stream's dictionary, not crossing references) pruned in turn — or undefined when nothing changed.
   */
  pruneNested(value: PDFObject | undefined, page?: { contents: () => (string | null)[]; from?: PDFDict }): PDFObject | undefined {
    const { PDFDict, PDFArray, PDFStream, PDFName } = this.lib;
    // The owner's resources were pruned by `prunedOwner`, with every inline owner in them.
    const skip = (k: PDFName) => k === PDFName.of('Resources') || k === PDFName.of('DR');
    if (value instanceof PDFStream) {
      let out = this.prunedOwner(value, page) as InstanceType<typeof PDFStream> | undefined;
      for (const [k, v] of value.dict.entries()) {
        if (skip(k)) continue;
        const n = this.pruneNested(v);
        if (n) { out ??= value.clone(); out.dict.set(k, n); }
      }
      return out;
    }
    if (value instanceof PDFDict) {
      let out = this.prunedOwner(value) as PDFDict | undefined;
      for (const [k, v] of value.entries()) {
        if (skip(k)) continue;
        const n = this.pruneNested(v);
        if (n) { out ??= value.clone(); out.set(k, n); }
      }
      return out;
    }
    if (value instanceof PDFArray) {
      let out: PDFArray | undefined;
      value.asArray().forEach((v, k) => {
        const n = this.pruneNested(v);
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
          const mine: Drawn = { XObject: new Set(), Pattern: new Set(), Shading: new Set(), ExtGState: new Set(), Font: new Set(), Properties: new Set() };
          const view = this.src.context.obj({});
          for (const [k, v] of resources.entries()) view.set(k, v);
          for (const [k, v] of own.entries()) view.set(k, v);
          const text = contentOf(this.lib, this.src, pattern);
          if (text === null || !this.collect(text, view, mine, seen, depth + 1)) return false;
          for (const cat of PRUNED) if (!own.has(PDFName.of(cat))) for (const n of mine[cat]) drawn[cat].add(n);
          break;
        }
        case 'sh': drawn.Shading.add(name); break;
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

/**
 * The default appearances a field's or widget's `/DR` serves: its own `/DA` (inherited through `/Parent`, then the
 * form's) and every descendant's, each as content text.
 */
function defaultAppearances(lib: Lib, src: PDFDocument, node: PDFDict): string[] {
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
