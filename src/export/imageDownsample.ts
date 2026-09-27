/**
 * Compress → "shrink images" (limits row 27, D20): re-encode embedded JPEGs at a lower resolution IN PLACE,
 * keeping text, vectors, links and form fields. Closes the #60b ceiling ("pdf-lib has no XObject-replace
 * API" — it does not need one: the image stream is re-assigned under the SAME object number).
 *
 * Every decision errs towards leaving an image alone, because a picture shrunk below the resolution it is
 * shown at is a visible loss while an image left big only costs bytes:
 *
 * - **Measured, never guessed.** An image's displayed size comes from walking the page content and every
 *   Form XObject it draws (`q`/`Q`/`cm`/`Do`, the form `/Matrix`, `/UserUnit`), and its LARGEST placement on
 *   each axis sets the target. An image drawn anywhere this walk does not model — an annotation appearance,
 *   a pattern, a Type3 glyph, `/Alternates`, another image's mask — is left alone: every reference to it
 *   must lead up through resource dictionaries and forms the walk used, to a page (the parent-map check in
 *   `usedOnlyWhereMeasured`).
 * - **A stream the tokenizer cannot follow measures nothing.** A malformed `cm` or a throw leaves the
 *   images of that stream unmeasured, never measured with a wrong transform.
 * - **Only what survives a re-encode unchanged in meaning.** `/Filter /DCTDecode` alone, 8 bits, DeviceRGB,
 *   DeviceGray (rewritten DeviceRGB — a canvas cannot write a one-channel JPEG) or a three-component
 *   ICCBased space; no `/Decode`, no `/ImageMask`, no colour-key `/Mask`, no `/SMask` with `/Matte` (whose
 *   dimensions must equal the image's).
 * - **Smaller or not at all.** A re-encode that is not smaller than the original stream is discarded.
 *
 * The re-encoder is injected so the planner and the replacement run in jsdom; `browserJpegReencode` is the
 * production one.
 */
import type {
  PDFDocument as PDFDocumentT, PDFDict as PDFDictT, PDFRawStream as PDFRawStreamT, PDFRef as PDFRefT,
  PDFObject as PDFObjectT,
} from '@cantoo/pdf-lib';
import { groupOps, tokenizeContentStream, multiplyMatrix, type Matrix } from '../utils/contentStreamEditor';

/** Below this factor the saving is not worth a generation of JPEG loss. */
export const MIN_SHRINK = 0.9;
const MAX_FORM_DEPTH = 12;
const PDF_DPI = 72;

export interface ImagePlan {
  ref: PDFRefT;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  /** DeviceGray: the re-encoded JPEG is RGB, so the colour space is rewritten. */
  toRgb: boolean;
}

/** (bytes, width, height, quality) → a JPEG of exactly width × height, or null if it cannot decode. */
export type JpegReencoder = (jpeg: Uint8Array, width: number, height: number, quality: number) => Promise<Uint8Array | null>;

/**
 * The pixel size to shrink a width × height image to so it shows at `dpi` on its largest placement, or null
 * when it is already at or below that (or within `MIN_SHRINK` of it). `ptX`/`ptY` are the physical lengths,
 * in points, its x and y axes are drawn at.
 */
export function targetSize(width: number, height: number, ptX: number, ptY: number, dpi: number): { w: number; h: number } | null {
  if (!(ptX > 0) || !(ptY > 0) || !(width > 0) || !(height > 0) || !(dpi > 0)) return null;
  const dpiX = width / (ptX / PDF_DPI);
  const dpiY = height / (ptY / PDF_DPI);
  const f = dpi / Math.min(dpiX, dpiY);
  if (!(f < MIN_SHRINK)) return null;
  return { w: Math.max(1, Math.round(width * f)), h: Math.max(1, Math.round(height * f)) };
}

type Lib = typeof import('@cantoo/pdf-lib');

function nameOf(lib: Lib, v: PDFObjectT | undefined): string | undefined {
  return v instanceof lib.PDFName ? v.decodeText() : undefined;
}

/** Is this image stream one a JPEG re-encode leaves meaning-identical? Returns the gray flag, or null. */
function eligibleJpeg(lib: Lib, doc: PDFDocumentT, s: PDFRawStreamT): { gray: boolean } | null {
  const { PDFName, PDFArray, PDFNumber, PDFBool, PDFStream } = lib;
  const d = s.dict;
  const look = (k: string) => doc.context.lookup(d.get(PDFName.of(k)));
  if (nameOf(lib, look('Subtype')) !== 'Image') return null;
  const filter = look('Filter');
  const f = filter instanceof PDFArray
    ? (filter.size() === 1 ? nameOf(lib, doc.context.lookup(filter.get(0))) : undefined)
    : nameOf(lib, filter);
  if (f !== 'DCTDecode') return null;
  if (d.has(PDFName.of('DecodeParms')) || d.has(PDFName.of('Decode'))) return null;
  const im = look('ImageMask');
  if (im instanceof PDFBool && im.asBoolean()) return null;
  const bpc = look('BitsPerComponent');
  if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) return null;
  if (look('Mask') instanceof PDFArray) return null;               // colour-key masking reads exact samples
  if (d.has(PDFName.of('SMaskInData'))) return null;
  const smask = look('SMask');
  if (smask instanceof PDFStream && smask.dict.has(PDFName.of('Matte'))) return null;
  const cs = look('ColorSpace');
  const csName = nameOf(lib, cs);
  if (csName === 'DeviceRGB') return { gray: false };
  if (csName === 'DeviceGray') return { gray: true };
  if (cs instanceof PDFArray && cs.size() === 2 && nameOf(lib, doc.context.lookup(cs.get(0))) === 'ICCBased') {
    const prof = doc.context.lookup(cs.get(1));
    const n = prof instanceof PDFStream ? doc.context.lookup(prof.dict.get(PDFName.of('N'))) : undefined;
    if (n instanceof PDFNumber && n.asNumber() === 3) return { gray: false };
  }
  return null;
}

function contentOf(lib: Lib, doc: PDFDocumentT, obj: PDFObjectT | undefined): string | null {
  const { PDFRawStream, PDFArray, decodePDFRawStream } = lib;
  const streams: PDFRawStreamT[] = [];
  const o = obj !== undefined ? doc.context.lookup(obj) : undefined;
  if (o instanceof PDFRawStream) streams.push(o);
  else if (o instanceof PDFArray) {
    for (let i = 0; i < o.size(); i++) {
      const s = doc.context.lookup(o.get(i));
      if (!(s instanceof PDFRawStream)) return null;
      streams.push(s);
    }
  } else return null;
  let out = '';
  for (const s of streams) {
    const bytes = decodePDFRawStream(s).decode();
    let chunk = '';
    for (let i = 0; i < bytes.length; i++) chunk += String.fromCharCode(bytes[i]);
    out += chunk + '\n';
  }
  return out;
}

interface Walked {
  /** Largest physical x/y axis length (points) each image ref is drawn at. */
  placements: Map<string, { ptX: number; ptY: number; ref: PDFRefT }>;
  /** Resource and XObject dictionaries and form streams the walk used — the allowed path up from an image. */
  used: Set<unknown>;
  /** Page leaves and page-tree nodes: where the path up from an image may stop. */
  roots: Set<unknown>;
  /** Image refs drawn by a stream the walk could not follow: never shrunk. */
  unmeasured: Set<string>;
}

function readMatrix(lib: Lib, doc: PDFDocumentT, v: PDFObjectT | undefined): Matrix | null {
  const a = v !== undefined ? doc.context.lookup(v) : undefined;
  if (a === undefined) return [1, 0, 0, 1, 0, 0];
  if (!(a instanceof lib.PDFArray) || a.size() !== 6) return null;
  const m: number[] = [];
  for (let i = 0; i < 6; i++) {
    const n = doc.context.lookup(a.get(i));
    if (!(n instanceof lib.PDFNumber) || !Number.isFinite(n.asNumber())) return null;
    m.push(n.asNumber());
  }
  return m as Matrix;
}

/**
 * Walk one content stream: record every image placement under its CTM, recurse into forms. Returns false if the
 * stream could not be followed; the caller then marks every image its resources can draw unmeasured.
 */
function walkContent(
  lib: Lib, doc: PDFDocumentT, content: string, resources: PDFDictT | undefined, base: Matrix,
  w: Walked, stack: Set<unknown>, depth: number,
): boolean {
  const { PDFName, PDFDict, PDFRawStream, PDFRef } = lib;
  let ops;
  try { ops = groupOps(tokenizeContentStream(content)); } catch { return false; }
  if (resources) w.used.add(resources);
  const xobjects = resources ? doc.context.lookup(resources.get(PDFName.of('XObject'))) : undefined;
  const xdict = xobjects instanceof PDFDict ? xobjects : undefined;
  if (xdict) w.used.add(xdict);
  let ctm = base;
  const saved: Matrix[] = [];
  let ok = true;
  for (const op of ops) {
    if (op.operator === 'q') saved.push(ctm);
    else if (op.operator === 'Q') { const s = saved.pop(); if (s) ctm = s; }
    else if (op.operator === 'cm') {
      const m = op.operands.map(t => Number(t.raw));
      if (m.length !== 6 || !m.every(Number.isFinite)) { ok = false; break; }
      // `cm` maps the new space into the old one: a point goes through M first, then the old CTM.
      ctm = multiplyMatrix(m as Matrix, ctm);
    } else if (op.operator === 'Do') {
      const raw = op.operands[0]?.raw ?? '';
      if (!raw.startsWith('/') || !xdict) continue;
      const decoded = raw.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      const entry = xdict.get(PDFName.of(decoded)) ?? xdict.get(PDFName.of(raw.slice(1)));
      // A draw the walk cannot resolve may be an image drawn larger than anywhere it was measured.
      if (entry === undefined) { markUnmeasured(lib, doc, resources, w); continue; }
      if (!(entry instanceof PDFRef)) continue;       // a direct object has no number to re-assign
      const target = doc.context.lookup(entry);
      if (!(target instanceof PDFRawStream)) continue;
      const sub = nameOf(lib, doc.context.lookup(target.dict.get(PDFName.of('Subtype'))));
      if (sub === 'Image') {
        const key = entry.toString();
        const ptX = Math.hypot(ctm[0], ctm[1]), ptY = Math.hypot(ctm[2], ctm[3]);
        const prev = w.placements.get(key);
        w.placements.set(key, { ref: entry, ptX: Math.max(ptX, prev?.ptX ?? 0), ptY: Math.max(ptY, prev?.ptY ?? 0) });
      } else if (sub === 'Form') {
        if (stack.has(target)) continue;               // a form drawing itself: pdf.js stops there too
        const fm = readMatrix(lib, doc, target.dict.get(PDFName.of('Matrix')));
        const fres = doc.context.lookup(target.dict.get(PDFName.of('Resources')));
        const formRes = fres instanceof PDFDict ? fres : resources;
        if (depth >= MAX_FORM_DEPTH) { markUnmeasured(lib, doc, formRes, w); continue; }
        const text = fm ? contentOf(lib, doc, entry) : null;
        stack.add(target);
        w.used.add(target);
        // The form's own q/Q balance never leaks out: it is walked from a COPY of the CTM, and this
        // stream's CTM is untouched by it (pdf.js saves and restores around a form the same way).
        const followed = text !== null && fm !== null && walkContent(lib, doc, text, formRes, multiplyMatrix(fm, ctm), w, stack, depth + 1);
        stack.delete(target);
        if (!followed) markUnmeasured(lib, doc, formRes, w);
      }
    }
  }
  if (!ok) markUnmeasured(lib, doc, resources, w);
  return ok;
}

/** Every image a resources dictionary can draw (directly or through its forms' own resources) is unmeasured. */
function markUnmeasured(lib: Lib, doc: PDFDocumentT, resources: PDFDictT | undefined, w: Walked, seen = new Set<unknown>()): void {
  const { PDFName, PDFDict, PDFRawStream, PDFRef } = lib;
  if (!resources || seen.has(resources)) return;
  seen.add(resources);
  const x = doc.context.lookup(resources.get(PDFName.of('XObject')));
  if (!(x instanceof PDFDict)) return;
  for (const [, v] of x.entries()) {
    if (!(v instanceof PDFRef)) continue;
    const t = doc.context.lookup(v);
    if (!(t instanceof PDFRawStream)) continue;
    const sub = nameOf(lib, doc.context.lookup(t.dict.get(PDFName.of('Subtype'))));
    if (sub === 'Image') w.unmeasured.add(v.toString());
    else if (sub === 'Form') {
      const r = doc.context.lookup(t.dict.get(PDFName.of('Resources')));
      markUnmeasured(lib, doc, r instanceof PDFDict ? r : undefined, w, seen);
    }
  }
}

/** Child → parents over the whole object graph (direct children and resolved references alike). */
function parentMap(lib: Lib, doc: PDFDocumentT): Map<unknown, unknown[]> {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = lib;
  const parents = new Map<unknown, unknown[]>();
  const add = (child: unknown, parent: unknown) => {
    const list = parents.get(child);
    if (list) list.push(parent); else parents.set(child, [parent]);
  };
  const visited = new Set<unknown>();
  const visit = (node: unknown) => {
    if (visited.has(node)) return;
    visited.add(node);
    const children: PDFObjectT[] = [];
    if (node instanceof PDFStream) for (const [, v] of node.dict.entries()) children.push(v);
    else if (node instanceof PDFDict) for (const [, v] of node.entries()) children.push(v);
    else if (node instanceof PDFArray) for (let i = 0; i < node.size(); i++) children.push(node.get(i));
    for (const c of children) {
      const child = c instanceof PDFRef ? doc.context.lookup(c) : c;
      if (child instanceof PDFDict || child instanceof PDFArray || child instanceof PDFStream) {
        add(child, node);
        if (!(c instanceof PDFRef)) visit(child);
      }
    }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj);
  return parents;
}

/** Every path up from `node` runs through dictionaries/forms the walk used and ends at a page or page-tree node. */
function usedOnlyWhereMeasured(node: unknown, parents: Map<unknown, unknown[]>, w: Walked): boolean {
  const seen = new Set<unknown>([node]);
  const queue = [node];
  while (queue.length) {
    const n = queue.pop();
    const ps = parents.get(n) ?? [];
    if (n !== node && !ps.length) return false;   // an orphan dict on the path: not something the walk reached
    for (const p of ps) {
      if (w.roots.has(p)) continue;
      if (!w.used.has(p)) return false;
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
  }
  return true;
}

/** Which images to shrink, and to what size, so each shows at `dpi` where it is drawn largest. */
export async function planImageDownsample(doc: PDFDocumentT, dpi: number): Promise<ImagePlan[]> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFName, PDFDict, PDFRawStream, PDFNumber } = lib;
  const w: Walked = { placements: new Map(), used: new Set(), roots: new Set(), unmeasured: new Set() };
  for (const page of doc.getPages()) {
    const leaf = page.node;
    w.roots.add(leaf);
    for (let n = leaf.lookup(PDFName.of('Parent')); n instanceof PDFDict; n = n.lookup(PDFName.of('Parent'))) w.roots.add(n);
    const r = doc.context.lookup(leaf.getInheritableAttribute(PDFName.of('Resources')));
    const resources = r instanceof PDFDict ? r : undefined;
    const uu = doc.context.lookup(leaf.get(PDFName.of('UserUnit')));
    const unit = uu instanceof PDFNumber && uu.asNumber() > 0 ? uu.asNumber() : 1;
    const content = contentOf(lib, doc, leaf.get(PDFName.of('Contents')));
    if (content === null) { if (leaf.has(PDFName.of('Contents'))) markUnmeasured(lib, doc, resources, w); continue; }
    walkContent(lib, doc, content, resources, [unit, 0, 0, unit, 0, 0], w, new Set(), 0);
  }
  const parents = parentMap(lib, doc);
  const plans: ImagePlan[] = [];
  for (const [key, p] of w.placements) {
    if (w.unmeasured.has(key)) continue;
    const s = doc.context.lookup(p.ref);
    if (!(s instanceof PDFRawStream)) continue;
    const ok = eligibleJpeg(lib, doc, s);
    if (!ok || !usedOnlyWhereMeasured(s, parents, w)) continue;
    const wd = doc.context.lookup(s.dict.get(PDFName.of('Width')));
    const ht = doc.context.lookup(s.dict.get(PDFName.of('Height')));
    if (!(wd instanceof PDFNumber) || !(ht instanceof PDFNumber)) continue;
    const t = targetSize(wd.asNumber(), ht.asNumber(), p.ptX, p.ptY, dpi);
    if (!t) continue;
    plans.push({ ref: p.ref, width: wd.asNumber(), height: ht.asNumber(), targetWidth: t.w, targetHeight: t.h, toRgb: ok.gray });
  }
  return plans;
}

/**
 * Shrink every planned image with `reencode`, replacing its stream under the same object number when the
 * result is smaller. Returns how many were replaced.
 */
export async function downsampleImages(
  doc: PDFDocumentT, dpi: number, quality: number, reencode: JpegReencoder,
  onImage?: (done: number, total: number) => void,
): Promise<number> {
  const { PDFName, PDFRawStream, PDFNumber } = await import('@cantoo/pdf-lib');
  const plans = await planImageDownsample(doc, dpi);
  let replaced = 0;
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    onImage?.(i, plans.length);
    const old = doc.context.lookup(p.ref);
    if (!(old instanceof PDFRawStream)) continue;
    const jpeg = await reencode(old.getContents(), p.targetWidth, p.targetHeight, quality);
    if (!jpeg || jpeg.length >= old.getContentsSize()) continue;
    const dict = old.dict.clone(doc.context);
    dict.set(PDFName.of('Width'), PDFNumber.of(p.targetWidth));
    dict.set(PDFName.of('Height'), PDFNumber.of(p.targetHeight));
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    if (p.toRgb) dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    doc.context.assign(p.ref, PDFRawStream.of(dict, jpeg));
    replaced++;
  }
  onImage?.(plans.length, plans.length);
  return replaced;
}

/**
 * The JPEG without its EXIF APP1 segments. A PDF reader ignores EXIF orientation (pdf.js draws an
 * Orientation-6 JPEG unturned), but Chrome's `createImageBitmap` applied it even with
 * `imageOrientation: 'none'` when resizing (measured 2026-09-27: the re-encode came out turned 90°). So the
 * orientation is removed from the bytes rather than trusted to an option. Only the marker segments before
 * the scan are walked; anything that does not parse as a JPEG header is returned unchanged.
 */
export function stripExif(jpeg: Uint8Array): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const keep: Array<[number, number]> = [[0, 2]];
  let pos = 2;
  let dropped = false;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const marker = jpeg[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;            // start of scan / end of image: the header is over
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3];
    if (len < 2 || pos + 2 + len > jpeg.length) return jpeg;
    const isExif = marker === 0xe1 && len >= 8 &&
      jpeg[pos + 4] === 0x45 && jpeg[pos + 5] === 0x78 && jpeg[pos + 6] === 0x69 && jpeg[pos + 7] === 0x66 &&
      jpeg[pos + 8] === 0 && jpeg[pos + 9] === 0;
    if (isExif) dropped = true; else keep.push([pos, pos + 2 + len]);
    pos += 2 + len;
  }
  if (!dropped) return jpeg;
  keep.push([pos, jpeg.length]);
  const out = new Uint8Array(keep.reduce((n, [a, b]) => n + b - a, 0));
  let o = 0;
  for (const [a, b] of keep) { out.set(jpeg.subarray(a, b), o); o += b - a; }
  return out;
}

/**
 * The production re-encoder: the browser's JPEG decoder, resized by the browser, re-encoded by a canvas.
 * Colour-space conversion is OFF and EXIF is stripped first — a PDF reader applies neither, so the samples
 * must stay what the PDF means by them.
 */
export const browserJpegReencode: JpegReencoder = async (jpeg, width, height, quality) => {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([stripExif(jpeg) as BlobPart], { type: 'image/jpeg' }), {
      colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' as ImageOrientation,
      resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
    });
  } catch { return null; }
  try {
    if (bmp.width !== width || bmp.height !== height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>(res => { canvas.toBlob(res, 'image/jpeg', quality); });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally { bmp.close(); }
};
