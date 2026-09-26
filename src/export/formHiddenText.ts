/**
 * A2 (2026-09-26) — text a Form XObject draws past its own `/BBox` is clipped away on screen and in
 * every raster export, yet `getTextContent` reports it, so it used to export verbatim into
 * DOCX / Markdown / TXT and the CSV / XLSX tables. Measured on 15 real files: 5 such runs in one of
 * them (figure labels in an arXiv paper), each render-confirmed invisible.
 *
 * pdf.js's text extraction recurses into a form with only its `/Matrix` applied — no `/BBox`, no marker
 * (`pdf.worker.mjs:36468-36495`, 6.3.289) — so its items carry no form identity at all. The attribution
 * here is EXACT per item rather than guessed by position:
 *
 *   1. The page is copied into a throwaway document and every form reachable from it gets its stream
 *      wrapped in a unique `/<tag> BMC … EMC`.
 *   2. `getTextContent({ includeMarkedContent: true })` on the copy brackets every item with the chain of
 *      forms it came from; pdf.js flushes the current item at each marker, so no item straddles one.
 *   3. The copy's operator list carries the same tags right after each `paintFormXObjectBegin`, in the
 *      same order, so the k-th occurrence of a tag in the text pairs with the k-th placement of that form
 *      and its clip (`walkPageOps`' `markedClips`).
 *   4. An item is dropped only when its grown footprint lies wholly outside that clip.
 *
 * Every decision errs towards KEEPING, because this deletes prose: an unattributed item, a form whose
 * stream cannot be decoded, a copy whose text does not match the source item for item, a tag whose
 * occurrence counts disagree, a vertical-writing run — each leaves the text where it is, which is exactly
 * the behaviour before this module existed. A run that crosses the clip edge is ONE item and pdf.js gives
 * no per-glyph advances, so it exports whole.
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocument, PDFPage } from '@cantoo/pdf-lib';
import { walkPageOps, type ClipBox } from './opStreamWalker';
import { copySourcePages } from './copySourcePages';
import { loadPdfDocument } from '../utils/pdfLoadGuard';
import { withCMaps } from '../utils/pdfjsParams';

/** The marker tag prefix. Distinctive so a document's own marked content can never be mistaken for it. */
export const FORM_MARK_PREFIX = 'PDFTurboForm';

/** The part of a pdf.js text item this module reads. */
export interface FormTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir?: string;
}

/** A marked-content marker as `getTextContent({ includeMarkedContent: true })` emits it. */
export interface FormTextMarker {
  type: string;
  tag?: string | null;
}

/**
 * Whether a text item lies WHOLLY outside `clip` (a null clip means unclipped → never). The footprint is
 * the run's advance along its own direction and its height plus a quarter em of descender below the
 * baseline, turned by the item's transform, as an axis-aligned box — every widening keeps more text.
 * Touching the edge counts as inside. An EMPTY clip (nested forms whose boxes do not meet) draws nothing,
 * so everything in it is outside.
 */
export function isItemOutsideClip(it: FormTextItem, clip: ClipBox | null): boolean {
  if (!clip) return false;
  if (!it.str.trim()) return false;
  // Vertical writing swaps the roles of width and height (see `isItemRedacted`); not modelled → keep.
  if (it.dir === 'ttb') return false;
  const [a, b, c, d, e, f] = it.transform;
  const w = it.width, h = it.height;
  if (![a, b, c, d, e, f, w, h].every(Number.isFinite)) return false;
  const la = Math.hypot(a, b), lc = Math.hypot(c, d);
  if (!(la > 0) || !(lc > 0) || w < 0 || h < 0) return false;
  if (clip.x1 <= clip.x0 || clip.y1 <= clip.y0) return true;
  const ux = a / la, uy = b / la, vx = c / lc, vy = d / lc;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of [0, w]) {
    for (const t of [-0.25 * h, h]) {
      const x = e + ux * s + vx * t, y = f + uy * s + vy * t;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < clip.x0 || x0 > clip.x1 || y1 < clip.y0 || y0 > clip.y1;
}

const SAME_ORIGIN = 0.01;

/**
 * Indices into `source` (the page's own text items, in order) of the items a form's clip hides, read from
 * `marked` — the text content of the marker-injected copy — and `markedClips` from walking the copy's
 * operator list. Returns null, meaning "filter nothing", whenever the two views of the page disagree: a
 * different number of text items, a different string or origin at any position, or a tag whose occurrence
 * count differs between the text content and the operator list.
 */
export function attributeHiddenItems(
  source: readonly FormTextItem[],
  marked: ReadonlyArray<FormTextItem | FormTextMarker>,
  markedClips: ReadonlyMap<string, ReadonlyArray<ClipBox | null>>,
): Set<number> | null {
  const hidden = new Set<number>();
  const seen = new Map<string, number>();
  // One entry per open marker: the clip of one of OUR tags, or `undefined` for the document's own.
  const stack: Array<{ clip: ClipBox | null } | undefined> = [];
  let j = 0;
  for (const it of marked) {
    if ('type' in it) {
      if (it.type === 'endMarkedContent') { stack.pop(); continue; }
      const tag = typeof it.tag === 'string' ? it.tag : '';
      if (!tag.startsWith(FORM_MARK_PREFIX)) { stack.push(undefined); continue; }
      const k = seen.get(tag) ?? 0;
      seen.set(tag, k + 1);
      const clips = markedClips.get(tag);
      if (!clips || k >= clips.length) return null;
      stack.push({ clip: clips[k] });
      continue;
    }
    const src = source[j];
    if (!src || src.str !== it.str ||
      Math.abs(src.transform[4] - it.transform[4]) > SAME_ORIGIN ||
      Math.abs(src.transform[5] - it.transform[5]) > SAME_ORIGIN) return null;
    let inner: { clip: ClipBox | null } | undefined;
    for (let s = stack.length - 1; s >= 0 && !inner; s--) inner = stack[s];
    if (inner && isItemOutsideClip(src, inner.clip)) hidden.add(j);
    j++;
  }
  if (j !== source.length) return null;
  for (const [tag, clips] of markedClips) if ((seen.get(tag) ?? 0) !== clips.length) return null;
  return hidden;
}

/**
 * Wrap the stream of every Form XObject reachable from `page` (through `/Resources /XObject`, nested forms
 * included) in a unique `BMC … EMC`. Mutates `doc`, which must be a throwaway copy. Returns how many forms
 * were marked. A form whose stream cannot be decoded is left unmarked: its text stays unattributed and is
 * therefore kept.
 */
export async function injectFormMarkers(doc: PDFDocument, page: PDFPage): Promise<number> {
  const { PDFName, PDFDict, PDFRef, PDFRawStream, decodePDFRawStream } = await import('@cantoo/pdf-lib');
  const ctx = doc.context;
  const done = new Set<string>();
  const enc = new TextEncoder();
  let n = 0;
  const visit = (res: unknown): void => {
    if (!(res instanceof PDFDict)) return;
    const xo = res.lookup(PDFName.of('XObject'));
    if (!(xo instanceof PDFDict)) return;
    for (const [, v] of xo.entries()) {
      if (!(v instanceof PDFRef) || done.has(v.toString())) continue;
      done.add(v.toString());
      const s = ctx.lookup(v);
      if (!(s instanceof PDFRawStream)) continue;
      // `lookup`, not `get`: an indirect /Subtype would otherwise read as a PDFRef, the form would be
      // skipped, and its hidden text would be kept without anyone noticing.
      if (s.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Form')) continue;
      const dict = s.dict.clone(ctx);
      const resources = dict.lookup(PDFName.of('Resources'));
      let body: Uint8Array | null = null;
      try { body = decodePDFRawStream(s).decode(); } catch { body = null; }
      if (body) {
        const head = enc.encode(`/${FORM_MARK_PREFIX}${n++} BMC\n`);
        const tail = enc.encode('\nEMC\n');
        const out = new Uint8Array(head.length + body.length + tail.length);
        out.set(head, 0); out.set(body, head.length); out.set(tail, head.length + body.length);
        dict.delete(PDFName.of('Filter'));
        dict.delete(PDFName.of('DecodeParms'));
        dict.delete(PDFName.of('Length'));
        ctx.assign(v, PDFRawStream.of(dict, out));
      }
      visit(resources);
    }
  };
  visit(page.node.Resources());
  return n;
}

/**
 * Finds hidden form text on source pages. One instance per export: it keeps each source's pdf-lib parse for
 * the pages that need it, and nothing after the export returns.
 */
export class FormHiddenTextFinder {
  private readonly _docs = new Map<Uint8Array, Promise<PDFDocument>>();

  /**
   * Indices into `source` (the page's text items, markers excluded, in `getTextContent` order) that a
   * form's clip hides. Rejects on any failure; the caller keeps every item then.
   */
  async hiddenItemIndices(srcBytes: Uint8Array, pageIndex: number, source: readonly FormTextItem[]): Promise<Set<number>> {
    let libDoc = this._docs.get(srcBytes);
    if (!libDoc) {
      libDoc = loadPdfDocument(srcBytes, { viewerCheck: 'source', updateMetadata: false });
      this._docs.set(srcBytes, libDoc);
    }
    const { PDFDocument: Doc } = await import('@cantoo/pdf-lib');
    const copy = await Doc.create();
    const { pages } = await copySourcePages(copy, await libDoc, [pageIndex]);
    copy.addPage(pages[0]);
    if (await injectFormMarkers(copy, pages[0]) === 0) return new Set();
    const bytes = await copy.save({ useObjectStreams: false });
    const task = pdfjsLib.getDocument(withCMaps({ data: bytes, verbosity: 0 }));
    const pdf = await task.promise;
    try {
      const page = await pdf.getPage(1);
      const [content, opList] = await Promise.all([
        page.getTextContent({ includeMarkedContent: true }),
        page.getOperatorList(),
      ]);
      const walk = walkPageOps(opList, pdfjsLib.OPS as unknown as Record<string, number>, undefined,
        { markPrefix: FORM_MARK_PREFIX });
      return attributeHiddenItems(
        source,
        content.items as unknown as Array<FormTextItem | FormTextMarker>,
        walk.markedClips ?? new Map(),
      ) ?? new Set();
    } finally {
      await task.destroy();
    }
  }
}
