/**
 * PDF compression (#60) — pure / pdf-lib helpers shared by the export service.
 *
 * Two strategies, surfaced together as the HYBRID "Compress" modal:
 *  - LOSSLESS "quick optimize": re-serialize with cross-reference object streams
 *    (`useObjectStreams:true`) and strip /Info + XMP metadata. Keeps selectable
 *    text, vectors and form fields intact — just a smaller, cleaner container.
 *  - LOSSY "flatten to images": render each page to a JPEG at a chosen DPI/quality
 *    and rebuild an image-only PDF. Big win on scans; DROPS selectable text. That
 *    raster loop is DOM-dependent (canvas) and lives in ExportService; this module
 *    only provides the pure DPI→scale math + clamps it shares.
 *
 * True in-place image-XObject downsampling (keep text, shrink only the embedded
 * rasters) is the ceiling #60b — pdf-lib has no XObject-replace API.
 */

import type { PDFDocument as PDFDocumentT } from '@cantoo/pdf-lib';
import { sweepUnreachableObjects } from '../utils/pdfObjectGc';

export type CompressMode = 'lossless' | 'lossy';

export interface CompressOptions {
  mode: CompressMode;
  /** Lossy render resolution in DPI. Ignored for lossless. */
  dpi?: number;
  /** Lossy JPEG quality (0–1). Ignored for lossless. */
  quality?: number;
}

// PDF user space is 72 units/inch, so scale = dpi / 72.
const PDF_DPI = 72;

export const COMPRESS_DPI_DEFAULT = 200;
export const COMPRESS_DPI_MIN = 72;
export const COMPRESS_DPI_MAX = 300;
export const COMPRESS_QUALITY_DEFAULT = 0.8;
export const COMPRESS_QUALITY_MIN = 0.3;
export const COMPRESS_QUALITY_MAX = 0.95;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Clamp a DPI to [MIN, MAX]; NaN/blank → the default (not the floor). */
export function clampDpi(dpi: number): number {
  return Number.isNaN(dpi) ? COMPRESS_DPI_DEFAULT : clamp(dpi, COMPRESS_DPI_MIN, COMPRESS_DPI_MAX);
}

/** Clamp a JPEG quality to [MIN, MAX]; NaN/blank → the default. */
export function clampQuality(q: number): number {
  return Number.isNaN(q) ? COMPRESS_QUALITY_DEFAULT : clamp(q, COMPRESS_QUALITY_MIN, COMPRESS_QUALITY_MAX);
}

/** A pdf.js render scale for the requested DPI (clamped). 72 DPI → 1×, 144 → 2×. */
export function dpiToScale(dpi: number): number {
  return clampDpi(dpi) / PDF_DPI;
}

/**
 * Remove /Info (document information) and the catalog XMP /Metadata stream + the
 * trailer /ID from an already-loaded document. Mirrors the metadata subset of the
 * sanitizer — compress is about a smaller, cleaner container, not the full
 * active-content scrub (that's the 🧹 Sanitize button / #53). Page content,
 * form values and annotations are untouched.
 *
 * The caller MUST have loaded the doc with `{ updateMetadata: false }` — otherwise
 * pdf-lib re-stamps Producer + ModDate into /Info at load time and the strip is
 * silently undone on the next save.
 */
export async function stripDocMetadata(doc: PDFDocumentT): Promise<void> {
  const { PDFName, PDFDict } = await import('@cantoo/pdf-lib');
  const ctx = doc.context;

  const infoObj = ctx.trailerInfo.Info;
  if (infoObj) {
    const infoDict = ctx.lookup(infoObj);
    if (infoDict instanceof PDFDict) {
      for (const k of infoDict.keys()) infoDict.delete(k);
    }
    ctx.trailerInfo.Info = undefined;
  }
  doc.catalog.delete(PDFName.of('Metadata'));
  if (ctx.trailerInfo.ID) ctx.trailerInfo.ID = undefined;
}

/**
 * Lossless "quick optimize": load, strip metadata, and re-serialize the SAME
 * content with cross-reference object streams. Returns the optimized bytes. Pure
 * pdf-lib (jsdom-safe). The caller (ExportService) feeds this the ASSEMBLED
 * export bytes so the user's edits are already baked in; encryption, when needed,
 * is applied by the caller on the shared save (see ExportService.compressAndDownload).
 */
export async function compressLossless(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, PDFRef, PDFStream, PDFDict, PDFArray } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  await stripDocMetadata(doc);
  // `stripDocMetadata` deletes REFERENCES; pdf-lib has no reachability collection, so without this
  // the detached XMP packet is re-serialised and the "quick optimize" hands back the metadata it
  // just removed. The sanitizer fixed exactly this and this sibling kept the defect — the docstring
  // above even says it "mirrors the metadata subset of the sanitizer". One shared sweep now, so the
  // two cannot drift again. [WS7 round 2, 2026-09-04]
  sweepUnreachableObjects(
    doc.context as never,
    { PDFRef, PDFStream, PDFDict, PDFArray } as never,
  );
  return doc.save({ useObjectStreams: true });
}
