/**
 * The ONE place this repo loads a PDF with pdf-lib.
 *
 * `@cantoo/pdf-lib` 2.11.0 changed `PDFParser.tryToParseInvalidIndirectObject`: an object it cannot
 * parse, with no `endobj` before EOF, is now DROPPED ("instead of failing the whole parse") where
 * 2.8.1 threw `Failed to parse invalid PDF object`. pdf.js is more lenient, so the page still
 * renders on screen — and every export built from the pdf-lib copy silently comes out without the
 * dropped object. Measured: a page whose content stream was that object exported as an EMPTY page
 * while pdf.js read the text from the source. The upgrade had turned a loud failure into data loss.
 *
 * This restores the loud failure, and deliberately nothing wider. A document is refused only when
 * a reference it actually USES (reachable from the trailer) resolves to nothing AND an `N G obj`
 * header for that object is present in the bytes — i.e. the object existed and the parser threw it
 * away. Two neighbouring shapes must keep loading, and are pinned:
 *  - a dangling reference with no header anywhere (a legal null, common in old files);
 *  - a damaged object that IS terminated, which pdf-lib keeps as a `PDFInvalidObject`.
 *
 * Bound, stated rather than hidden: in an incrementally-updated file, if the NEWEST revision of an
 * object is the one dropped, an earlier revision with the same number is still in the context and
 * nothing dangles — the export then carries the stale revision. Detecting that needs the xref
 * sections, which pdf-lib does not keep after load.
 *
 * Every load in `src/` goes through here; `tests/utils/pdfLoadGuard.test.ts` fails by file name on
 * a new direct `PDFDocument.load`. A per-site check is how a sibling path keeps the defect.
 */
import type { LoadOptions, PDFDocument, PDFRef as PDFRefT } from '@cantoo/pdf-lib';

// pdf-lib is imported lazily and DESTRUCTURED, like every caller here: handing the module
// namespace around as a value would keep all of it in whichever chunk did so.
type PdfLib = typeof import('@cantoo/pdf-lib');
type WalkLib = Pick<PdfLib, 'PDFRef' | 'PDFDict' | 'PDFArray' | 'PDFStream'>;

export class PdfObjectDroppedError extends Error {
  readonly refs: string[];
  constructor(refs: string[]) {
    super(`PDF_OBJECT_DROPPED: pdf-lib could not parse ${refs.join(', ')} and dropped it`);
    this.name = 'PdfObjectDroppedError';
    this.refs = refs;
  }
}

export async function loadPdfDocument(bytes: Uint8Array, options: LoadOptions = {}): Promise<PDFDocument> {
  const { PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream } = await import('@cantoo/pdf-lib');
  const { updateMetadata = true, ...rest } = options;
  // Load WITHOUT pdf-lib's metadata stamp, check, and only then stamp. The stamp registers a new
  // /Info dictionary under the next free object number — and after a drop that number IS the dropped
  // object's, so every reference to the lost object silently resolves to the Info dict and nothing
  // dangles. Measured: checking after a default load passed the broken file, and the export wrote the
  // Info dict where the page content had been. `updateInfoDict()` is the last statement of pdf-lib's
  // constructor when `updateMetadata` is true, so calling it here is the same stamp in the same order.
  const doc = await PDFDocument.load(bytes, { ...rest, updateMetadata: false });
  const dropped = findDroppedObjects({ PDFRef, PDFDict, PDFArray, PDFStream }, doc, bytes);
  if (dropped.length > 0) throw new PdfObjectDroppedError(dropped);
  if (updateMetadata) (doc as unknown as { updateInfoDict(): void }).updateInfoDict();
  return doc;
}

/** Reachable references that resolve to nothing, restricted to those whose object header is in the bytes. */
function findDroppedObjects(lib: WalkLib, doc: PDFDocument, bytes: Uint8Array): string[] {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const ctx = doc.context;
  const seen = new Set<string>();
  const dangling: PDFRefT[] = [];
  const queue: unknown[] = [
    ctx.trailerInfo.Root, ctx.trailerInfo.Encrypt, ctx.trailerInfo.Info, ctx.trailerInfo.ID,
  ];
  while (queue.length > 0) {
    const value = queue.pop();
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const target = ctx.lookup(value);
      if (target === undefined) dangling.push(value);
      else queue.push(target);
    } else if (value instanceof PDFStream) {
      queue.push(value.dict);
    } else if (value instanceof PDFDict) {
      for (const v of value.values()) queue.push(v);
    } else if (value instanceof PDFArray) {
      for (let i = 0; i < value.size(); i++) queue.push(value.get(i));
    }
  }
  if (dangling.length === 0) return [];

  // Only now pay for a text view of the file — a clean document never gets here.
  const text = new TextDecoder('latin1').decode(bytes);
  return dangling
    .filter(ref => new RegExp(`(?:^|[^0-9])${ref.objectNumber}\\s+${ref.generationNumber}\\s+obj\\b`).test(text))
    .map(ref => ref.toString());
}
