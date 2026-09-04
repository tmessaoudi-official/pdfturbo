/**
 * Reachability collection for a pdf-lib document.
 *
 * pdf-lib serialises **every indirect object its context holds** and performs no reachability
 * collection of its own. So deleting a REFERENCE — `catalog.delete('/Metadata')`,
 * `node.delete('/A')` — detaches the payload from the document graph and leaves it in the FILE,
 * where a `useObjectStreams: false` save writes it out in plaintext. Measured: an XMP packet and a
 * JavaScript action both survived a sanitize, and the same detached-XMP payload survived a lossless
 * compress.
 *
 * **This lives in one place because it had already diverged.** The sweep was written inside
 * `sanitizePdf`, and `compressLossless` — whose own docstring says it "mirrors the metadata subset
 * of the sanitizer" — kept the defect the sanitizer had just fixed. A sibling path that shares a
 * promise but not the filter is this repo's most-repeated defect shape; copying the sweep would
 * have been the third instance of it in a day. [WS7 round 2, 2026-09-04]
 *
 * Reachability, rather than deleting the specific refs a caller detached, is deliberate: an object
 * may still be referenced from somewhere else (a shared stream), and deleting it blindly corrupts
 * the output — the one direction worse than leaving an orphan.
 */

/** The pdf-lib classes the walk needs. Passed in because every caller imports pdf-lib dynamically. */
export interface PdfGcLib {
  PDFRef: new (...args: never[]) => unknown;
  PDFStream: new (...args: never[]) => unknown;
  PDFDict: new (...args: never[]) => unknown;
  PDFArray: new (...args: never[]) => unknown;
}

interface GcContext {
  trailerInfo: Record<string, unknown>;
  lookup(ref: unknown): unknown;
  enumerateIndirectObjects(): Array<[{ toString(): string }, unknown]>;
  delete(ref: unknown): void;
}

/**
 * Delete every indirect object unreachable from the trailer roots. Returns how many were removed.
 *
 * The roots are the trailer's own entries — `Root`, `Encrypt`, `Info`, `ID` — which is exactly the
 * set pdf-lib's `PDFWriter` writes back into the trailer. `Encrypt` is easy to forget and would
 * leave the trailer naming a deleted object.
 */
export function sweepUnreachableObjects(ctx: GcContext, lib: PdfGcLib): number {
  const { PDFRef, PDFStream, PDFDict, PDFArray } = lib;
  const roots: unknown[] = [
    ctx.trailerInfo.Root, ctx.trailerInfo.Encrypt, ctx.trailerInfo.Info, ctx.trailerInfo.ID,
  ];
  const reached = new Set<string>();
  const queue: unknown[] = [];

  const visit = (value: unknown): void => {
    if (value instanceof PDFRef) {
      const key = String(value);
      if (reached.has(key)) return;
      reached.add(key);
      queue.push(ctx.lookup(value));
      return;
    }
    if (value instanceof PDFStream) { visit((value as { dict: unknown }).dict); return; }
    if (value instanceof PDFDict) {
      for (const v of (value as { values(): Iterable<unknown> }).values()) visit(v);
      return;
    }
    if (value instanceof PDFArray) {
      const arr = value as { size(): number; get(i: number): unknown };
      for (let i = 0; i < arr.size(); i++) visit(arr.get(i));
    }
  };

  for (const r of roots) visit(r);
  while (queue.length > 0) visit(queue.pop());

  let removed = 0;
  // Snapshot before deleting — mutating the context while iterating its own enumeration is the
  // kind of thing that works until the implementation changes.
  for (const [ref] of [...ctx.enumerateIndirectObjects()]) {
    if (!reached.has(String(ref))) { ctx.delete(ref); removed++; }
  }
  return removed;
}
