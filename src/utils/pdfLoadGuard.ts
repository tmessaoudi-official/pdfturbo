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
 * This restores the loud failure by RECORDING each drop at the point pdf-lib makes it, then refusing a
 * document when a recorded drop is reachable from the trailer and nothing later replaced it. pdf-lib
 * drops objects in exactly two places, and both are wrapped (`installDropRecorder`):
 *  - `PDFParser.tryToParseInvalidIndirectObject` returning nothing — a classic `N G obj`;
 *  - `PDFObjectStreamParser.parseIntoContext` throwing part-way — every member of the object stream
 *    not yet assigned is lost, while the stream itself is kept as an opaque invalid object.
 * The wrappers return what the originals return and rethrow what they throw, so no parse changes.
 * "Nothing later replaced it" is read off the ORDER of pdf-lib's own assignments, never off the value:
 * pdf-lib interns null, booleans and names, so an older revision and its replacement can be the very
 * same object (WS7 round 13).
 *
 * WS7 rounds 10 and 11 detected the same drops by scanning the file's text for object headers. Round 12
 * found that scan wrong six ways — a stream with no `endstream`, a header glued to a delimiter, `>> stream`
 * inside a string, a comment between header tokens, object-stream members (which have no header), and a
 * string that merely reads ` 9 0 obj ` — every one a second tokenizer disagreeing with pdf-lib's. Asking
 * the parser leaves nothing to disagree about.
 *
 * WS7 round 13 found the other half of "pdf-lib's copy is not what the viewer shows". pdf-lib reads the
 * file in order and keeps the LAST definition of an object and the LAST trailer; pdf.js follows
 * `startxref` and the cross-reference chain. A file whose table names an EARLIER copy of an object, or
 * whose startxref trailer names a different /Root, therefore shows one page on screen while every export
 * and signature is built from another — with nothing dropped. The recorder also keeps where each
 * definition started and the cross-reference sections pdf-lib parsed (and then discarded), and a
 * reachable object refuses (`PdfXrefMismatchError`) when the chain from `startxref` lands exactly on a
 * definition pdf-lib did not keep and the two differ. Round 13 took pdf.js to rebuild its table by scanning
 * whenever a table offset is wrong; round 16 measured that true only on its load-time walk to the first or
 * last page (below).
 *
 * WS7 round 14 found three more, each measured in pdf.js 6.3.289 before the code changed:
 *  - pdf.js finds NOTHING for an entry that is absent, free or at offset 0 (`XRef.getEntry`) — a page whose
 *    content stream is marked free draws blank — while pdf-lib ignores the table and exports the content.
 *    Such an object refuses when the document root reaches it. When the root itself, or its /Pages, does not
 *    resolve to a dictionary, pdf.js instead rebuilds by scanning (`XRef.parse`) and agrees with pdf-lib, so
 *    nothing is compared for that file.
 *  - pdf-lib replaces a /Root that lacks `/Type /Catalog` with another catalog in the file
 *    (`PDFParser.maybeRecoverRoot`), where pdf.js keeps the trailer's. That refuses whether or not the chain
 *    can be followed.
 *  - "Differ" means a different VALUE: two byte-identical copies of a stream or dictionary are two pdf-lib
 *    objects, and comparing them by identity refused a file both parsers read the same.
 * Measuring those fixes on real files showed the comparison had not been running on most of them. pdf-lib
 * inflates a cross-reference STREAM but never applies its /DecodeParms /Predictor, which Acrobat and most
 * producers set, so the entries it parses from one are noise: 11 of the 15 corpus files had a chain that
 * resolved and landed on nothing. The recorder now decodes those entries itself, the way pdf.js's
 * `PredictorStream` and `XRef.readXRefStream` do.
 *
 * WS7 round 16 found the comparison stopping where pdf.js keeps reading, and skipping what pdf.js cannot read, each
 * measured in pdf.js 6.3.289:
 *  - pdf.js reads each queued cross-reference section inside a try/catch (`XRef.readXRef`), so a /Prev or /XRefStm
 *    offset it cannot read is skipped and the startxref table still names the page on screen. The chain used to be
 *    abandoned at the first such offset, leaving the round-13 shape uncompared behind one bad pointer.
 *  - An entry that does not land on its object makes pdf.js throw where it reads it (`XRef.fetchUncompressed`). It
 *    rebuilds by scanning only when that happens on its load-time walk to the first or last page (`checkFirstPage` /
 *    `checkLastPage`, mirrored); anywhere else the page draws blank or fails while pdf-lib exports it, so such an
 *    object refuses when the document root reaches it, exactly as one pdf.js finds nothing for.
 *
 *
 * WS7 round 17 found that "skipped" was not the whole story, and a gap no cross-reference table shows:
 *  - A table pdf.js cannot finish leaves `XRef._tableState` behind, so every later table in the queue fails and
 *    reads no rows; a stream read after a rejected stream uses the rejected one's state. The queue mirror stops
 *    reading tables after the first, and refuses the second case rather than model it. /Prev and /XRefStm written
 *    as references are followed, as `Dict.get` resolves them. A linearized file is read from where pdf.js enters it.
 *  - `Catalog.getPageDict` skips a subtree by its /Count and counts any dictionary without /Kids as a page, while
 *    pdf-lib's `PDFPageTree.traverse` ignores /Count and keeps only `/Type /Page` leaves: a /Count lie showed one
 *    page and exported or signed another. Every page pdf.js shows is compared with the page pdf-lib holds at the
 *    same index (`PdfPageMismatchError`); pdf.js showing fewer pages is not a mismatch, a different or extra one is.
 *
 * Kept deliberately:
 *  - a dangling reference nothing was dropped for loads (a legal null, common in old files);
 *  - a damaged object that IS terminated loads — pdf-lib keeps it as a `PDFInvalidObject`;
 *  - a drop that a LATER revision of the same object replaces loads;
 *  - a duplicate whose copies serialize to the same bytes, or that nothing uses, loads;
 *  - an object only /Info, /Encrypt or /ID reaches loads when pdf.js finds nothing for it: pdf-lib merges
 *    trailers field by field, so an update that deletes /Info leaves the old one in pdf-lib's trailer.
 * Closed by the recorder, where the header scan could not: when the NEWEST revision of an object is the
 * one dropped and an older revision stands in, the file is refused rather than exported stale.
 *
 * Bounds, stated rather than hidden. Bytes pdf-lib never parses as an object — skipped as jibberish, or
 * swallowed by a preceding stream whose end it placed too late — are not a drop, leave no record, and
 * are not detected here; that is pdf-lib's reading of the file, the same one 2.8.1 had. When an object
 * stream fails before its member list is known, the lost members cannot be named, so ANY reachable
 * dangling or damaged reference in that document refuses it. A reachable damaged object's references
 * cannot be read at all, so while one exists every drop still standing refuses the document, reachable or
 * not. The cross-reference comparison is skipped when no section of the chain yields a trailer or its root is
 * one pdf.js rejects, and when pdf.js meets an entry it cannot read on its walk to the first or last page (pdf.js
 * then rebuilds by scanning — except its choice of trailer in that mode, which is not mirrored); when the chain
 * reaches a cross-reference stream whose decoding is not modelled (abbreviated /F or /DP keys, a predictor under a
 * later filter, a TIFF predictor at other than 8 bits, PNG predictor parameters that do not size a row), which
 * pdf.js reads; and for objects the table places inside an object stream. A stream pdf.js rejects part-way (a
 * predictor it does not support, an entry type other than 0, 1 or 2) keeps the rows pdf.js reads before failing.
 * A cross-reference stream queued after one pdf.js rejected refuses the file: pdf.js reads it with the rejected
 * stream's state, which is not modelled. Pages are not compared when pdf-lib cannot list them, as every export
 * then fails too; pages written directly in /Kids are compared by position only.
 *
 * Every load in `src/` goes through here; `tests/utils/pdfLoadGuard.test.ts` fails by file name on
 * a new direct `PDFDocument.load`. A per-site check is how a sibling path keeps the defect.
 */
import type { LoadOptions, PDFContext, PDFDict as PDFDictT, PDFDocument, PDFRef as PDFRefT } from '@cantoo/pdf-lib';

// pdf-lib is imported lazily and DESTRUCTURED, like every caller here: handing the module
// namespace around as a value would keep all of it in whichever chunk did so.
type PdfLib = typeof import('@cantoo/pdf-lib');
type InspectLib = Pick<
  PdfLib, 'PDFRef' | 'PDFDict' | 'PDFArray' | 'PDFStream' | 'PDFInvalidObject' | 'PDFNull' | 'PDFName' | 'PDFNumber' | 'PDFPageLeaf'
>;
type RecorderLib = Pick<
  PdfLib, 'PDFParser' | 'PDFObjectStreamParser' | 'PDFXRefStreamParser' | 'PDFContext' | 'PDFRef' | 'PDFName' | 'PDFNumber' | 'PDFDict' | 'PDFArray'
>;

export class PdfObjectDroppedError extends Error {
  readonly refs: string[];
  constructor(refs: string[]) {
    super(`PDF_OBJECT_DROPPED: pdf-lib could not parse ${refs.join(', ')}, and the document uses what it lost`);
    this.name = 'PdfObjectDroppedError';
    this.refs = refs;
  }
}

export class PdfXrefMismatchError extends Error {
  readonly refs: string[];
  constructor(refs: string[]) {
    super(`PDF_XREF_MISMATCH: the cross-reference table and the file order disagree about ${refs.join(', ')}, `
      + 'so the page on screen is not the content pdf-lib kept');
    this.name = 'PdfXrefMismatchError';
    this.refs = refs;
  }
}

export class PdfPageMismatchError extends Error {
  readonly refs: string[];
  constructor(refs: string[]) {
    super(`PDF_PAGE_MISMATCH: pdf.js shows a different page than pdf-lib holds at ${refs.join(', ')}, `
      + 'so the page on screen is not the page exported or signed');
    this.name = 'PdfPageMismatchError';
    this.refs = refs;
  }
}

/**
 * True when `err`, or anything on its `cause` chain, is one of this module's refusals. A refusal is
 * deterministic — the same bytes refuse every time — so callers show it as its own message instead of their
 * generic "failed, please try again" (WS7 round 15). Keyed on the NAME, like the sanitizer refusal in
 * `exportService`, and walking `cause` because the signer wraps a load failure in `SignError('PDF_PARSE_FAILED')`.
 */
export function isPdfLoadRefusal(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e instanceof Error && !seen.has(e); e = e.cause) {
    seen.add(e);
    if (e.name === 'PdfObjectDroppedError' || e.name === 'PdfXrefMismatchError' || e.name === 'PdfPageMismatchError') return true;
  }
  return false;
}

export async function loadPdfDocument(bytes: Uint8Array, options: LoadOptions = {}): Promise<PDFDocument> {
  const {
    PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject, PDFNull, PDFName, PDFNumber, PDFPageLeaf,
    PDFParser, PDFObjectStreamParser, PDFXRefStreamParser, PDFContext,
  } = await import('@cantoo/pdf-lib');
  installDropRecorder({ PDFParser, PDFObjectStreamParser, PDFXRefStreamParser, PDFContext, PDFRef, PDFName, PDFNumber, PDFDict, PDFArray });
  const { updateMetadata = true, ...rest } = options;
  // Load WITHOUT pdf-lib's metadata stamp, check, and only then stamp. The stamp registers a new
  // /Info dictionary under the next free object number — and after a drop that number IS the dropped
  // object's, so every reference to the lost object silently resolves to the Info dict and nothing
  // dangles. Measured: checking after a default load passed the broken file, and the export wrote the
  // Info dict where the page content had been. `updateInfoDict()` is the last statement of pdf-lib's
  // constructor when `updateMetadata` is true, so calling it here is the same stamp in the same order.
  const doc = await PDFDocument.load(bytes, { ...rest, updateMetadata: false });
  // An encrypted file is parsed twice by pdf-lib; `doc.context` is the second, decrypting parse.
  const { dropped, mismatched, pages } = inspectParse(
    { PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject, PDFNull, PDFName, PDFNumber, PDFPageLeaf }, doc.context, bytes,
  );
  records.delete(doc.context); // the record is only needed for this check
  if (dropped.length > 0) throw new PdfObjectDroppedError(dropped);
  if (mismatched.length > 0) throw new PdfXrefMismatchError(mismatched);
  if (pages.length > 0) throw new PdfPageMismatchError(pages);
  if (updateMetadata) (doc as unknown as { updateInfoDict(): void }).updateInfoDict();
  return doc;
}

interface Drop {
  ref: PDFRefT;
  /** The assignment clock when pdf-lib dropped it: any later assignment to the object supersedes it. */
  clock: number;
}
/** A classic `N G obj` definition pdf-lib parsed, at the offset its header starts. */
interface Definition {
  offset: number;
  clock: number;
  object: unknown;
}
interface XrefEntry {
  num: number;
  gen: number;
  offset: number;
  inUse: boolean;
  inObjectStream: boolean;
}
/** A cross-reference section pdf-lib parsed — a table with its trailer, or a stream with its dict. */
interface XrefSection {
  kind: 'table' | 'stream';
  entries: XrefEntry[];
  dict?: PDFDictT;
  /** pdf.js throws part-way through this stream: it keeps the rows it read before failing and skips the rest. */
  rejected?: boolean;
}
interface ParseRecord {
  /** True only inside `parseDocument`, so edits made to the document later are not counted. */
  parsing: boolean;
  clock: number;
  lastAssigned: Map<string, number>;
  /** Some object was assigned more than once: a revision, a duplicate, or a member over a classic copy. */
  reassigned: boolean;
  drops: Map<string, Drop>;
  membersUnknown: boolean;
  definitions: Map<string, Definition[]>;
  /** Keyed by the offset the section starts at: `xref`, or the xref stream's object header. */
  sections: Map<number, XrefSection>;
  /** Where a cross-reference stream starts that pdf.js reads and the recorder cannot decode the way it does. */
  unmodelledSections: Set<number>;
  pendingSection: XrefSection | null;
  /** Header offset of the indirect object being parsed, for an xref stream found inside it. */
  objectAt: number | undefined;
  trailerDicts: number;
  /** The trailer's /Root, when pdf-lib's `maybeRecoverRoot` replaced it with another catalog. */
  recoveredFrom: unknown;
}

// Keyed by the parse's own context, so two documents loading at once cannot see each other's records.
const records = new WeakMap<PDFContext, ParseRecord>();
// Module-local, not `Symbol.for`: a second copy of this module must install its own recorder rather
// than find a marker and leave its own record permanently empty.
const INSTALLED = Symbol('pdfLoadGuard.dropRecorder');
const TRAILER = Array.from('trailer', c => c.charCodeAt(0));
const NO_BYTES = new Uint8Array(0);

function recordFor(ctx: PDFContext): ParseRecord {
  let rec = records.get(ctx);
  if (!rec) {
    rec = {
      parsing: false, clock: 0, lastAssigned: new Map(), reassigned: false, drops: new Map(),
      membersUnknown: false, definitions: new Map(), sections: new Map(), unmodelledSections: new Set(), pendingSection: null,
      objectAt: undefined, trailerDicts: 0, recoveredFrom: undefined,
    };
    records.set(ctx, rec);
  }
  return rec;
}

function recordDrop(rec: ParseRecord, ref: PDFRefT, clock: number): void {
  // A later drop of the same object overwrites: what matters is whether anything was assigned after the LAST one.
  rec.drops.set(ref.toString(), { ref, clock });
}

function define(rec: ParseRecord, ctx: PDFContext, ref: PDFRefT, offset: number): void {
  const key = ref.toString();
  const definition = { offset, clock: rec.lastAssigned.get(key) ?? rec.clock, object: ctx.lookup(ref) };
  const list = rec.definitions.get(key);
  if (list) list.push(definition);
  else rec.definitions.set(key, [definition]);
}

/** The references pdf-lib dropped while parsing into `ctx`, as `"N G R"`. For tests. */
export function recordedDrops(ctx: PDFContext): string[] {
  return [...(records.get(ctx)?.drops.keys() ?? [])];
}

/**
 * Whether a parse into `ctx` gave the cross-reference comparison anything to compare. For tests. Throws when
 * nothing was recorded for `ctx`: a document pdf-lib parsed before the first `loadPdfDocument` installed the
 * recorder has no record, and describing it as "nothing to compare" made a corpus run filtered to one test
 * report its first file as unread by pdf.js.
 */
export async function describeParse(
  ctx: PDFContext, bytes: Uint8Array,
): Promise<{
  reassigned: boolean; trailerDicts: number; chainResolved: boolean; viewerReadsChain: boolean;
  directEntries: number; directOnDefinition: number;
}> {
  const { PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject, PDFNull, PDFName, PDFNumber, PDFPageLeaf } = await import('@cantoo/pdf-lib');
  const rec = records.get(ctx);
  if (!rec) throw new Error('pdfLoadGuard: nothing was recorded for this parse — was the recorder installed before it?');
  const lib = { PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject, PDFNull, PDFName, PDFNumber, PDFPageLeaf };
  const chain = readXrefChain(lib, ctx, rec, bytes);
  // Non-vacuity of the chain itself: its in-use entries at a file offset should land on objects pdf-lib parsed there.
  // A chain decoded wrongly still resolves, and lands on nothing.
  let directEntries = 0;
  let directOnDefinition = 0;
  for (const e of chain?.entries.values() ?? []) {
    if (!chain || !e.inUse || e.inObjectStream || e.offset === 0) continue;
    directEntries += 1;
    const at = skipWhitespace(bytes, e.offset + chain.base);
    if (rec.definitions.get(`${e.num} ${e.gen} R`)?.some(d => d.offset === at)) directOnDefinition += 1;
  }
  return {
    reassigned: rec.reassigned,
    trailerDicts: rec.trailerDicts,
    chainResolved: chain !== undefined,
    viewerReadsChain: viewerOf(lib, ctx, rec, bytes, linearizationOf(lib, rec, bytes), 0).kind === 'chain',
    directEntries,
    directOnDefinition,
  };
}

interface CrossRefSectionShape {
  subsections: Array<Array<{ ref: PDFRefT; offset: number; deleted: boolean }>>;
}
interface ParserInternals {
  context: PDFContext;
  bytes: { offset(): number; moveTo(offset: number): void };
  parseDocument(): Promise<PDFContext>;
  parseIndirectObjectHeader(): PDFRefT;
  parseIndirectObject(): Promise<PDFRefT>;
  tryToParseInvalidIndirectObject(): PDFRefT | undefined;
  maybeParseCrossRefSection(): CrossRefSectionShape | undefined;
  maybeParseTrailerDict(): void;
  skipWhitespaceAndComments(): void;
  matchKeyword(keyword: number[]): boolean;
  parseDict(): PDFDictT;
  maybeRecoverRoot(): void;
}
interface ObjStmInternals {
  context: PDFContext;
  parseOffsetsAndObjectNumbers(): Array<{ objectNumber: number; offset: number }>;
  parseIntoContext(): Promise<void>;
}
interface XRefStreamInternals {
  context: PDFContext;
  dict: PDFDictT;
  /** The stream after pdf-lib's filters — which never include a /Predictor. */
  bytes: { bytes: Uint8Array };
  subsections: Array<{ firstObjectNumber: number; length: number }>;
  byteWidths: number[];
  parseIntoContext(): Array<{ ref: PDFRefT; offset: number; deleted: boolean; inObjectStream: boolean }>;
}
interface ContextInternals {
  assign(ref: PDFRefT, object: unknown): void;
}
type ForStream = (rawStream: { dict: { context: PDFContext } }, ...rest: unknown[]) => unknown;

/** A decode parameter as pdf.js reads it (`params.get(key) || fallback`), or `undefined` when it is not a number. */
function decodeParam(lib: RecorderLib, params: PDFDictT, keys: string[], fallback: number): number | undefined {
  const value = keys.map(k => params.lookup(lib.PDFName.of(k))).find(v => v !== undefined);
  if (value === undefined) return fallback;
  return value instanceof lib.PDFNumber ? value.asNumber() || fallback : undefined;
}

/**
 * Undoes a /Predictor the way pdf.js's `PredictorStream` does: a predictor pdf.js does not support makes its
 * `makeFilter` read the stream as EMPTY, and an unknown PNG row filter ends the data at that row, where pdf.js throws
 * after serving the rows before it. `undefined` where the parameters are not modelled. The row loops are pdf.js's own,
 * down to a short last row padding with zeros.
 */
function unpredict(lib: RecorderLib, data: Uint8Array, params: PDFDictT): Uint8Array | undefined {
  const predictor = decodeParam(lib, params, ['Predictor'], 1);
  const colors = decodeParam(lib, params, ['Colors'], 1);
  const bits = decodeParam(lib, params, ['BPC', 'BitsPerComponent'], 8);
  const columns = decodeParam(lib, params, ['Columns'], 1);
  if (predictor === undefined || colors === undefined || bits === undefined || columns === undefined) return undefined;
  if (predictor <= 1) return data;
  if (predictor !== 2 && (predictor < 10 || predictor > 15)) return NO_BYTES;
  const pixBytes = (colors * bits + 7) >> 3;
  const rowBytes = (columns * colors * bits + 7) >> 3;
  if (pixBytes < 1 || rowBytes < pixBytes || rowBytes < colors) return undefined;
  const png = predictor !== 2;
  if (!png && bits !== 8) return undefined; // pdf.js's other TIFF depths are not modelled
  const out = new Uint8Array(Math.ceil(data.length / (png ? rowBytes + 1 : rowBytes)) * rowBytes);
  let pos = 0;
  let j = 0;
  while (pos < data.length) {
    const filter = png ? data[pos++] : 2;
    const raw = data.subarray(pos, pos + rowBytes);
    pos += rowBytes;
    if (raw.length === 0) break;
    const start = j;
    // Uint8Array stores wrap modulo 256 and turn the NaN of a missing byte into 0, exactly as pdf.js's buffer does.
    const up = (i: number): number => (start >= rowBytes ? out[start - rowBytes + i] : 0);
    if (!png) {
      for (let i = 0; i < rowBytes; i++, j++) out[j] = i < colors ? raw[i] : out[j - colors] + raw[i];
      continue;
    }
    switch (filter) {
      case 0:
        for (let i = 0; i < rowBytes; i++) out[j++] = raw[i];
        break;
      case 1:
        for (let i = 0; i < rowBytes; i++, j++) out[j] = i < pixBytes ? raw[i] : out[j - pixBytes] + raw[i];
        break;
      case 2:
        for (let i = 0; i < rowBytes; i++) out[j++] = up(i) + raw[i];
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++, j++) {
          out[j] = i < pixBytes ? (up(i) >> 1) + raw[i] : ((up(i) + out[j - pixBytes]) >> 1) + raw[i];
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++, j++) {
          if (i < pixBytes) {
            out[j] = up(i) + raw[i];
            continue;
          }
          const left = out[j - pixBytes];
          const upLeft = up(i - pixBytes);
          const p = left + up(i) - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up(i));
          const pc = Math.abs(p - upLeft);
          out[j] = (pa <= pb && pa <= pc ? left : pb <= pc ? up(i) : upLeft) + raw[i];
        }
        break;
      default:
        return out.subarray(0, start);
    }
  }
  return out.subarray(0, j);
}

/**
 * The entries pdf.js's `XRef.readXRefStream` reads from a cross-reference stream, and whether it throws part-way — it
 * then keeps the rows it read and skips the rest of the section. `undefined` where how pdf.js decodes the stream is not
 * modelled. pdf-lib parses its own entries from the stream WITHOUT applying /Predictor, which Acrobat and most producers
 * set, so those entries are noise for such a file; these are decoded from the same filtered bytes with the predictor
 * applied.
 */
function viewerXrefStreamEntries(
  lib: RecorderLib, parser: XRefStreamInternals,
): { entries: XrefEntry[]; rejected: boolean } | undefined {
  const { PDFName, PDFDict, PDFArray } = lib;
  const { dict } = parser;
  // pdf.js reads the abbreviated /F and /DP before the full names; pdf-lib reads only the full names.
  if (dict.has(PDFName.of('F')) || dict.has(PDFName.of('DP'))) return undefined;
  const predictable = (name: unknown): boolean => name === PDFName.of('FlateDecode') || name === PDFName.of('LZWDecode');
  const filter = dict.lookup(PDFName.of('Filter'));
  const parms = dict.lookup(PDFName.of('DecodeParms'));
  let params: unknown;
  if (filter instanceof PDFName) {
    params = predictable(filter) ? parms : undefined;
  } else if (filter instanceof PDFArray) {
    const last = filter.size() - 1;
    for (let i = 0; i <= last; i++) {
      const p = parms instanceof PDFArray && i < parms.size() ? parms.lookup(i) : undefined;
      if (!predictable(filter.lookup(i)) || !(p instanceof PDFDict)) continue;
      if (i === last) params = p;
      // A predictor applied BEFORE a later filter cannot be undone on pdf-lib's fully filtered bytes.
      else if ((decodeParam(lib, p, ['Predictor'], 1) ?? 2) > 1) return undefined;
    }
  }
  const data = params instanceof PDFDict ? unpredict(lib, parser.bytes.bytes, params) : parser.bytes.bytes;
  if (!data) return undefined;

  const [typeWidth, offsetWidth, genWidth] = parser.byteWidths;
  const widths = [typeWidth, offsetWidth, genWidth];
  const entries: XrefEntry[] = [];
  // pdf.js throws at the first range, width or row it cannot read, and the rows it read before stay in its table.
  const rejected = { entries, rejected: true };
  if (!widths.every(w => Number.isInteger(w))) return rejected;
  if (!widths.every(w => w >= 0)) return undefined;
  let pos = 0;
  const field = (width: number): number | undefined => {
    if (pos + width > data.length) return undefined;
    let value = 0;
    for (let k = 0; k < width; k++) value = (value << 8) | data[pos++];
    return value;
  };
  for (const { firstObjectNumber, length } of parser.subsections) {
    if (!Number.isInteger(firstObjectNumber) || !Number.isInteger(length)) return rejected;
    for (let i = 0; i < length; i++) {
      const rawType = field(typeWidth);
      const offset = field(offsetWidth);
      const gen = field(genWidth);
      if (rawType === undefined || offset === undefined || gen === undefined) return rejected;
      const type = typeWidth === 0 ? 1 : rawType;
      if (type > 2) return rejected; // pdf.js throws `Invalid XRef entry type`
      entries.push({ num: firstObjectNumber + i, gen, offset, inUse: type !== 0, inObjectStream: type === 2 });
    }
  }
  return { entries, rejected: false };
}

// Optional chaining, so a pdf-lib that lost a whole class reaches the loud error below instead of a TypeError.
const protoOf = <T>(cls: unknown): T => ((cls as { prototype?: T } | undefined)?.prototype ?? {}) as T;

/**
 * Wraps the parser methods the checks read, once. Throws if any of them is gone: after a pdf-lib release
 * renames one, a silent no-op would leave every drop unrecorded and every load passing.
 */
export function installDropRecorder(lib: RecorderLib): void {
  const parser = protoOf<ParserInternals & { [INSTALLED]?: true }>(lib.PDFParser);
  const objStm = protoOf<ObjStmInternals>(lib.PDFObjectStreamParser);
  const objStmClass = (lib.PDFObjectStreamParser ?? {}) as unknown as { forStream: ForStream };
  const xrefStream = protoOf<XRefStreamInternals>(lib.PDFXRefStreamParser);
  const context = protoOf<ContextInternals>(lib.PDFContext);
  const required: Array<[object, string]> = [
    [parser, 'tryToParseInvalidIndirectObject'], [parser, 'parseIndirectObjectHeader'],
    [parser, 'parseIndirectObject'], [parser, 'parseDocument'], [parser, 'maybeParseCrossRefSection'],
    [parser, 'maybeParseTrailerDict'], [parser, 'skipWhitespaceAndComments'], [parser, 'matchKeyword'],
    [parser, 'parseDict'], [parser, 'maybeRecoverRoot'],
    [objStm, 'parseIntoContext'], [objStm, 'parseOffsetsAndObjectNumbers'], [objStmClass, 'forStream'],
    [xrefStream, 'parseIntoContext'], [context, 'assign'],
  ];
  for (const [owner, name] of required) {
    if (typeof (owner as Record<string, unknown>)[name] !== 'function') {
      throw new Error(`pdfLoadGuard: @cantoo/pdf-lib no longer has ${name}, so dropped objects cannot be detected`);
    }
  }
  if (parser[INSTALLED]) return;

  const assign = context.assign;
  context.assign = function (this: PDFContext, ref: PDFRefT, object: unknown) {
    const rec = records.get(this);
    if (rec?.parsing) {
      const key = ref.toString();
      if (rec.lastAssigned.has(key)) rec.reassigned = true;
      rec.lastAssigned.set(key, ++rec.clock);
    }
    return assign.call(this, ref, object);
  };

  const parseDocument = parser.parseDocument;
  parser.parseDocument = async function (this: ParserInternals) {
    const rec = recordFor(this.context);
    rec.parsing = true;
    try {
      return await parseDocument.call(this);
    } finally {
      rec.parsing = false;
    }
  };

  const parseIndirectObject = parser.parseIndirectObject;
  parser.parseIndirectObject = async function (this: ParserInternals) {
    const rec = recordFor(this.context);
    const offset = this.bytes.offset(); // pdf-lib skipped whitespace and comments before calling
    const outer = rec.objectAt;
    rec.objectAt = offset;
    try {
      const ref = await parseIndirectObject.call(this);
      define(rec, this.context, ref, offset);
      return ref;
    } finally {
      rec.objectAt = outer;
    }
  };

  const tryInvalid = parser.tryToParseInvalidIndirectObject;
  parser.tryToParseInvalidIndirectObject = function (this: ParserInternals) {
    // pdf-lib keeps the dropped object's reference in a local, so read the header here and rewind.
    // When it does not parse, the original throws on the same header — after its own
    // `throwOnInvalidObject` check, whose error must stay the one the caller sees — so no ref is needed.
    const at = this.bytes.offset();
    let ref: PDFRefT | undefined;
    try {
      ref = this.parseIndirectObjectHeader();
    } catch {
      ref = undefined;
    }
    this.bytes.moveTo(at);
    const result = tryInvalid.call(this);
    const rec = recordFor(this.context);
    if (result === undefined && ref) recordDrop(rec, ref, rec.clock);
    else if (result) define(rec, this.context, result, at);
    return result;
  };

  // pdf-lib parses a cross-reference table and throws the result away; keep its entries by start offset.
  const crossRef = parser.maybeParseCrossRefSection;
  parser.maybeParseCrossRefSection = function (this: ParserInternals) {
    this.skipWhitespaceAndComments(); // the original's own first step, so the offset is where `xref` starts
    const offset = this.bytes.offset();
    const section = crossRef.call(this);
    const rec = recordFor(this.context);
    rec.pendingSection = null;
    if (section) {
      const entries: XrefEntry[] = [];
      section.subsections.forEach((sub, s) => {
        // pdf-lib puts a synthetic `0 65535 f` entry in front of a section whose first row is free, and a first
        // subsection numbered from 1 then lands right behind it, in the same run. pdf.js renumbers that
        // subsection from 0 (`readXRefTable`: first === 1 and its first entry free), so each row is one object
        // lower. A later subsection continuing the numbering is merged into that run by pdf-lib and shifts too.
        const shifted = s === 0 && sub.length > 1 && sub[0].deleted && sub[0].ref.objectNumber === 0
          && sub[1].deleted && sub[1].ref.objectNumber === 1;
        sub.forEach((e, i) => {
          if (shifted && i === 0) return;
          entries.push({
            num: e.ref.objectNumber - (shifted ? 1 : 0), gen: e.ref.generationNumber, offset: e.offset,
            inUse: !e.deleted, inObjectStream: false,
          });
        });
      });
      rec.pendingSection = { kind: 'table', entries };
      rec.sections.set(offset, rec.pendingSection);
    }
    return section;
  };

  // pdf-lib merges a trailer into `trailerInfo` and keeps no /Prev or /XRefStm, which the chain needs.
  // Read the dict first, rewind, and let the original parse the same bytes.
  const trailerDict = parser.maybeParseTrailerDict;
  parser.maybeParseTrailerDict = function (this: ParserInternals) {
    const rec = recordFor(this.context);
    const section = rec.pendingSection;
    rec.pendingSection = null;
    const start = this.bytes.offset();
    this.skipWhitespaceAndComments();
    let dict: PDFDictT | undefined;
    if (this.matchKeyword(TRAILER)) {
      try {
        this.skipWhitespaceAndComments();
        dict = this.parseDict();
      } catch {
        dict = undefined; // the original throws on the same bytes
      }
    }
    this.bytes.moveTo(start);
    const result = trailerDict.call(this);
    if (dict) {
      rec.trailerDicts += 1;
      if (section) section.dict = dict;
    }
    return result;
  };

  // pdf-lib replaces a /Root that is not a `/Type /Catalog` dictionary with another catalog it holds; pdf.js
  // keeps the trailer's. Keep the one it replaced.
  const recoverRoot = parser.maybeRecoverRoot;
  parser.maybeRecoverRoot = function (this: ParserInternals) {
    const declared = this.context.trailerInfo.Root;
    const result = recoverRoot.call(this);
    if (this.context.trailerInfo.Root !== declared) recordFor(this.context).recoveredFrom = declared;
    return result;
  };

  // pdf-lib's own entries are what it returns; the section keeps the entries pdf.js decodes, which differ whenever
  // the stream has a /Predictor. A stream the recorder cannot decode the way pdf.js does is marked, so no chain is
  // guessed through it.
  const xrefInto = xrefStream.parseIntoContext;
  xrefStream.parseIntoContext = function (this: XRefStreamInternals) {
    const entries = xrefInto.call(this);
    const rec = recordFor(this.context);
    rec.trailerDicts += 1;
    if (rec.objectAt !== undefined) {
      const viewed = viewerXrefStreamEntries(lib, this);
      if (viewed) rec.sections.set(rec.objectAt, { kind: 'stream', dict: this.dict, ...viewed });
      else rec.unmodelledSections.add(rec.objectAt);
    }
    return entries;
  };

  // The member list is parsed inside `parseIntoContext`, which consumes the stream, so capture it on
  // the way out of its own method, stamped with the clock before any member is assigned. On a throw
  // EVERY listed member is recorded: one assigned before the throw carries a later assignment, so the
  // end-of-load check passes over it exactly as it passes over any superseded drop.
  const members = new WeakMap<object, Drop[]>();
  const memberTable = objStm.parseOffsetsAndObjectNumbers;
  objStm.parseOffsetsAndObjectNumbers = function (this: ObjStmInternals) {
    const table = memberTable.call(this);
    const { clock } = recordFor(this.context);
    members.set(this, table.map(({ objectNumber }) => ({ ref: lib.PDFRef.of(objectNumber, 0), clock })));
    return table;
  };
  const intoContext = objStm.parseIntoContext;
  objStm.parseIntoContext = async function (this: ObjStmInternals) {
    try {
      return await intoContext.call(this);
    } catch (e) {
      const rec = recordFor(this.context);
      const listed = members.get(this);
      if (!listed) rec.membersUnknown = true; // the member table itself failed to parse
      else for (const m of listed) recordDrop(rec, m.ref, m.clock);
      throw e;
    }
  };
  const forStream = objStmClass.forStream;
  objStmClass.forStream = (rawStream, ...rest) => {
    try {
      return forStream(rawStream, ...rest);
    } catch (e) {
      // Decoding the stream or reading /N and /First failed: no member of it will ever be assigned.
      recordFor(rawStream.dict.context).membersUnknown = true;
      throw e;
    }
  };
  parser[INSTALLED] = true;
}

/** Where the lexer that reads `offset` would start: past whitespace and `%` comments, as pdf.js reads it. */
function skipWhitespace(bytes: Uint8Array, offset: number): number {
  let at = offset;
  while (at < bytes.length) {
    const c = bytes[at];
    if (c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20) at++;
    else if (c === 0x25) {
      while (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) at++;
    } else break;
  }
  return at;
}

/** pdf.js counts cross-reference offsets from the first `%PDF-` in the first 1024 bytes, or from 0. */
function headerOffset(bytes: Uint8Array): number {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const end = Math.min(bytes.length, 1024) - sig.length;
  for (let i = 0; i <= end; i++) {
    if (sig.every((b, j) => bytes[i + j] === b)) return i;
  }
  return 0;
}

interface XrefChain {
  entries: Map<number, XrefEntry>;
  top: PDFDictT;
  base: number;
}

/** What the guard uses of pdf.js's `Linearization.create` result. */
interface Linearization {
  numPages: number;
  objectNumberFirst: number;
  pageFirst: number;
}

/**
 * The linearization dictionary pdf.js accepts (`Linearization.create`), or `undefined`. pdf.js parses the first object
 * after the header with no cross-reference table, so a reference in it is never resolved, and every check must pass
 * or the file is read as not linearized: /Linearized a positive number, /L the length from the header to the end of
 * the file, /H two or four positive integers, /O /E /N /T positive integers, and /P, when present, a non-negative one.
 */
function linearizationOf(lib: InspectLib, rec: ParseRecord, bytes: Uint8Array): Linearization | undefined {
  const { PDFDict, PDFStream, PDFArray, PDFNumber, PDFName } = lib;
  const base = headerOffset(bytes);
  const at = skipWhitespace(bytes, base);
  let first: unknown;
  for (const list of rec.definitions.values()) {
    const found = list.find(d => d.offset === at);
    if (found) {
      first = found.object;
      break;
    }
  }
  const dict = first instanceof PDFStream ? first.dict : first;
  if (!(dict instanceof PDFDict)) return undefined;
  const int = (value: unknown, min: number): number | undefined =>
    (value instanceof PDFNumber && Number.isInteger(value.asNumber()) && value.asNumber() >= min ? value.asNumber() : undefined);
  const get = (key: string): unknown => dict.get(PDFName.of(key));
  const linearized = get('Linearized');
  if (!(linearized instanceof PDFNumber && linearized.asNumber() > 0)) return undefined;
  if (int(get('L'), 1) !== bytes.length - base) return undefined;
  const hints = get('H');
  if (!(hints instanceof PDFArray) || (hints.size() !== 2 && hints.size() !== 4)) return undefined;
  for (let i = 0; i < hints.size(); i++) if (int(hints.get(i), 1) === undefined) return undefined;
  const [objectNumberFirst, endFirst, numPages, mainXRefEntriesOffset] = ['O', 'E', 'N', 'T'].map(k => int(get(k), 1));
  if (objectNumberFirst === undefined || endFirst === undefined || numPages === undefined || mainXRefEntriesOffset === undefined) {
    return undefined;
  }
  const pageFirst = dict.has(PDFName.of('P')) ? int(get('P'), 0) : 0;
  return pageFirst === undefined ? undefined : { numPages, objectNumberFirst, pageFirst };
}

/**
 * Where pdf.js starts reading a linearized file's cross-reference queue (`PDFDocument.startXRef`): past the first
 * `endobj` in the 1024 bytes after the header and the whitespace after it, not at `startxref`. 0 when there is none.
 */
function linearizedStart(bytes: Uint8Array, base: number): number {
  const sig = Array.from('endobj', c => c.charCodeAt(0));
  const end = Math.min(bytes.length, base + 1024) - sig.length;
  if (end - base <= 0) return 0;
  for (let i = base; i <= end; i++) {
    if (!sig.every((b, j) => bytes[i + j] === b)) continue;
    let pos = i + sig.length;
    while (pos < bytes.length && [0x20, 0x09, 0x0d, 0x0a].includes(bytes[pos])) pos++;
    return pos - base;
  }
  return 0;
}

/** The cross-reference queue as pdf.js reads it; see `readXrefQueue`. */
interface XrefQueueRead {
  entries: Map<number, XrefEntry>;
  base: number;
  /** The first trailer read, pdf.js's `topDict`; absent when none was, and pdf.js rebuilds by scanning. */
  top?: PDFDictT;
  /** The queue reached a cross-reference stream whose decoding is not modelled; pdf.js reads it, nothing is guessed. */
  unmodelled?: true;
  /** Where a cross-reference stream is queued after one pdf.js rejected: pdf.js reads it with the rejected one's state. */
  staleStreamAt?: number;
}

/**
 * The cross-reference queue pdf.js reads (`XRef.readXRef`) — from `startxref`, or for a linearized file from the
 * section after its first object; a table's /XRefStm, then /Prev; the first section to name an object winning it —
 * built from the sections pdf-lib itself parsed. Each queued section is read inside a try/catch, and what a failure
 * costs is measured in pdf.js 6.3.289 rather than assumed:
 *  - A table pdf.js cannot finish — no trailer, a trailer that is not a dictionary, or object 0 in use once its rows
 *    are in ("unexpected first object") — keeps the rows it read, and leaves `XRef._tableState` behind: every later
 *    table in the queue restores that state and fails the same way, reading no rows (WS7 round 17). A stream does not
 *    use that state.
 *  - A stream pdf.js rejects part-way keeps the rows read before the failure and leaves `streamState` behind: a later
 *    stream is read at the rejected one's position with its widths and ranges. That is not modelled, so the queue
 *    stops there and the file is refused.
 *  - /Prev and /XRefStm written as references are resolved through the rows read so far, as `Dict.get` does. One that
 *    cannot be read throws inside the section's try, so nothing after it in that section is queued; a /Prev resolving
 *    to a reference queues that reference's object number, as pdf.js does.
 * A section pdf-lib did not parse is skipped. WS7 round 16: stopping at one instead left a file whose startxref table
 * names an earlier copy uncompared.
 */
function readXrefQueue(
  lib: InspectLib, ctx: PDFContext, rec: ParseRecord, bytes: Uint8Array, lin: Linearization | undefined,
): XrefQueueRead {
  const { PDFName, PDFNumber, PDFRef } = lib;
  const base = headerOffset(bytes);
  const read: XrefQueueRead = { entries: new Map(), base };
  const start = lin
    ? linearizedStart(bytes, base)
    : (ctx as unknown as { pdfFileDetails?: { prevStartXRef?: number } }).pdfFileDetails?.prevStartXRef;
  if (typeof start !== 'number') return read;
  const queue = [start];
  const done = new Set<number>();
  let staleTable = false;
  let staleStream = false;
  while (queue.length > 0) {
    const offset = queue.shift() as number;
    if (done.has(offset)) continue;
    done.add(offset);
    const at = skipWhitespace(bytes, offset + base);
    const section = rec.sections.get(at);
    if (staleStream && (section?.kind === 'stream' || rec.unmodelledSections.has(at))) {
      read.staleStreamAt = at;
      return read;
    }
    if (rec.unmodelledSections.has(at)) {
      read.unmodelled = true;
      return read;
    }
    if (!section || (section.kind === 'table' && staleTable)) continue;
    for (const e of section.entries) if (!read.entries.has(e.num)) read.entries.set(e.num, e);
    if (section.kind === 'stream' && section.rejected) {
      staleStream = true;
      continue;
    }
    if (section.kind === 'table' && (!section.dict || read.entries.get(0)?.inUse)) {
      staleTable = true;
      continue;
    }
    if (!section.dict) continue;
    read.top ??= section.dict;
    // Only a table's /XRefStm is followed; pdf.js never reads one from a stream's dictionary.
    for (const key of section.kind === 'table' ? ['XRefStm', 'Prev'] : ['Prev']) {
      let value: unknown = section.dict.get(PDFName.of(key));
      if (value instanceof PDFRef) {
        const shown = viewerLookup(ctx, rec, read, bytes, value);
        if (shown === 'unreadable') break;
        value = shown === 'nothing' ? undefined : shown.object;
        if (key === 'Prev' && value instanceof PDFRef) {
          queue.push(value.objectNumber);
          continue;
        }
      }
      if (value instanceof PDFNumber && Number.isInteger(value.asNumber())) queue.push(value.asNumber());
    }
  }
  return read;
}

/** The chain pdf.js reads, when it reads one: a trailer was found and no stream the queue reached is left unmodelled. */
function readXrefChain(lib: InspectLib, ctx: PDFContext, rec: ParseRecord, bytes: Uint8Array): XrefChain | undefined {
  const read = readXrefQueue(lib, ctx, rec, bytes, linearizationOf(lib, rec, bytes));
  if (!read.top || read.unmodelled || read.staleStreamAt !== undefined) return undefined;
  return { entries: read.entries, top: read.top, base: read.base };
}

type Shown = { object: unknown } | 'nothing' | 'unreadable';

/**
 * What pdf.js's `XRef.fetch` returns for `ref` through `chain`. `getEntry` answers null for an entry that is
 * absent, free or at offset 0, so those are `'nothing'`. An entry that does not land on a definition pdf-lib
 * parsed for this object is `'unreadable'`: pdf.js throws there, and what follows depends on what it was
 * reading. An entry inside an object stream is not modelled, and pdf-lib's copy stands in.
 */
function viewerLookup(
  ctx: PDFContext, rec: ParseRecord, chain: Pick<XrefChain, 'entries' | 'base'>, bytes: Uint8Array, ref: PDFRefT,
): Shown {
  const entry = chain.entries.get(ref.objectNumber);
  if (!entry || !entry.inUse || entry.offset === 0) return 'nothing';
  if (entry.inObjectStream) return { object: ctx.lookup(ref) };
  if (entry.gen !== ref.generationNumber) return 'unreadable';
  const at = skipWhitespace(bytes, entry.offset + chain.base);
  const shown = rec.definitions.get(ref.toString())?.find(d => d.offset === at);
  return shown ? { object: shown.object } : 'unreadable';
}

/** A root pdf.js keeps: `XRef.parse` needs a dictionary whose /Pages is a dictionary, else it rebuilds by scanning. */
function acceptsAsRoot(lib: InspectLib, value: unknown, resolve: (v: unknown) => unknown): boolean {
  return value instanceof lib.PDFDict && resolve(value.get(lib.PDFName.of('Pages'))) instanceof lib.PDFDict;
}

/** Thrown by the page-walk mirror wherever pdf.js's fetch throws `XRefEntryException`. */
const UNREADABLE = Symbol('pdfLoadGuard.unreadable');
/** Where pdf.js fails to load a page, or a walk throws anything but a fetch error. */
const PAGE_ERROR = 'error';

/** A page at an index: its reference as `"N G R"`, `null` for a page dictionary written directly in /Kids, or `'error'`. */
type PageMarker = string | null;

/**
 * What pdf.js does with the page tree while it opens the document and then shows it (WS7 rounds 16 and 17). `'rebuild'`
 * when, outside recovery mode, its opening walks meet an entry they cannot read: `checkFirstPage` and `checkLastPage`
 * turn that `XRefEntryException` into an `XRefParseException`, and so does `getAllPageDicts` when `checkLastPage` falls
 * back to it. Otherwise the pages it shows, as far as `limit`. Those come from `getPage` for each index up to the page
 * count — `Catalog.getPageDict`, which skips a subtree by its /Count and counts any dictionary without /Kids as a page;
 * for a linearized file the count is /N and the first page the object /O names — unless `checkLastPage` found the
 * count wrong, when they are the whole-tree walk's. Mirrors those functions step for step, the /Count cache shared as
 * pdf.js shares it. A tree where no /Count can change an answer is read in one walk instead of one per page.
 */
function viewerPageOrder(
  lib: InspectLib, pages: PDFDictT, pagesRef: unknown, lookup: (ref: PDFRefT) => Shown,
  lin: Linearization | undefined, recovery: boolean, limit: number,
): 'rebuild' | PageMarker[] {
  const { PDFRef, PDFDict, PDFArray, PDFName, PDFNumber } = lib;
  const [TYPE, KIDS, COUNT, PAGE, CONTENTS] = ['Type', 'Kids', 'Count', 'Page', 'Contents'].map(k => PDFName.of(k));
  const fetch = (value: unknown): unknown => {
    if (!(value instanceof PDFRef)) return value;
    const shown = lookup(value);
    if (shown === 'unreadable') throw UNREADABLE;
    return shown === 'nothing' ? undefined : shown.object;
  };
  const integer = (value: unknown): number | undefined =>
    (value instanceof PDFNumber && Number.isInteger(value.asNumber()) ? value.asNumber() : undefined);
  const isPage = (node: PDFDictT): boolean => fetch(node.get(TYPE)) === PAGE || !node.has(KIDS);
  const pagesKey = pagesRef instanceof PDFRef ? pagesRef.toString() : undefined;
  const counts = new Map<string, number>(); // `pageKidsCountCache`
  const ids = new Map<unknown, string>(pagesKey === undefined ? [] : [[pages, pagesKey]]); // a fetched dict's `objId`

  // `getPageDict`: the page it returns, or `undefined` where it throws anything but a fetch error.
  const getPageDict = (pageIndex: number): PageMarker | undefined => {
    const nodes: unknown[] = [pages];
    const visited = new Set<string>(pagesKey === undefined ? [] : [pagesKey]);
    let current = 0;
    while (nodes.length > 0) {
      const node = nodes.pop();
      if (node instanceof PDFRef) {
        const key = node.toString();
        const count = counts.get(key);
        if (count !== undefined && count >= 0 && current + count <= pageIndex) {
          current += count;
          continue;
        }
        if (visited.has(key)) return undefined;
        visited.add(key);
        const obj = fetch(node);
        if (obj instanceof PDFDict) {
          ids.set(obj, key);
          if (isPage(obj)) {
            if (!counts.has(key)) counts.set(key, 1);
            if (current === pageIndex) return key;
            current++;
            continue;
          }
        }
        nodes.push(obj);
        continue;
      }
      if (!(node instanceof PDFDict)) return undefined;
      const count = integer(fetch(node.get(COUNT)));
      if (count !== undefined && count >= 0) {
        const id = ids.get(node);
        if (id !== undefined && !counts.has(id)) counts.set(id, count);
        if (current + count <= pageIndex) {
          current += count;
          continue;
        }
      }
      const kids = fetch(node.get(KIDS));
      if (!(kids instanceof PDFArray)) {
        if (!isPage(node)) return undefined;
        if (current === pageIndex) return null;
        current++;
        continue;
      }
      for (let i = kids.size() - 1; i >= 0; i--) nodes.push(kids.get(i));
    }
    return undefined;
  };

  // `#getLinearizationPage`: the object /O names when it is a page dictionary, else `getPageDict`.
  const getLinearizationPage = (pageIndex: number, objectNumber: number): PageMarker | undefined => {
    const ref = PDFRef.of(objectNumber, 0);
    try {
      const obj = fetch(ref);
      if (obj instanceof PDFDict
        && (fetch(obj.get(TYPE)) === PAGE || (!obj.has(TYPE) && !obj.has(KIDS) && obj.has(CONTENTS)))) {
        const key = ref.toString();
        if (!counts.has(key)) counts.set(key, 1);
        return key;
      }
    } catch (e) {
      if (e !== UNREADABLE) throw e;
    }
    return getPageDict(pageIndex);
  };
  const getPage = (pageIndex: number): PageMarker | undefined =>
    (lin?.pageFirst === pageIndex ? getLinearizationPage(pageIndex, lin.objectNumberFirst) : getPageDict(pageIndex));

  // `getAllPageDicts`: a fetch error is rethrown outside recovery mode; any other failure records an error and ends it.
  const getAllPageDicts = (): PageMarker[] => {
    const out: PageMarker[] = [];
    const fail = (e: unknown): void => {
      if (e === UNREADABLE && !recovery) throw e;
      out.push(PAGE_ERROR);
    };
    const read = (value: unknown): { value?: unknown; failed?: true } => {
      try {
        return { value: fetch(value) };
      } catch (e) {
        if (e !== UNREADABLE) throw e;
        fail(e);
        return { failed: true };
      }
    };
    const queue = [{ node: pages, pos: 0 }];
    const visited = new Set<string>(pagesKey === undefined ? [] : [pagesKey]);
    while (queue.length > 0) {
      const item = queue[queue.length - 1];
      const kids = read(item.node.get(KIDS));
      if (kids.failed) break;
      if (!(kids.value instanceof PDFArray)) {
        const type = read(item.node.get(TYPE));
        if (type.failed) break;
        if (type.value === PAGE || !item.node.has(KIDS)) out.push(null);
        else fail(PAGE_ERROR);
        break;
      }
      if (item.pos >= kids.value.size()) {
        queue.pop();
        continue;
      }
      const kid = kids.value.get(item.pos);
      let obj: unknown = kid;
      if (kid instanceof PDFRef) {
        if (visited.has(kid.toString())) {
          fail(PAGE_ERROR);
          break;
        }
        visited.add(kid.toString());
        const fetched = read(kid);
        if (fetched.failed) break;
        obj = fetched.value;
      }
      if (!(obj instanceof PDFDict)) {
        fail(PAGE_ERROR);
        break;
      }
      const type = read(obj.get(TYPE));
      if (type.failed) break;
      if (type.value === PAGE || !obj.has(KIDS)) out.push(kid instanceof PDFRef ? kid.toString() : null);
      else queue.push({ node: obj, pos: 0 });
      item.pos++;
    }
    return out;
  };

  // The pages `getPageDict` returns for every index, in one walk, when no /Count it could skip by differs from the
  // pages under it, no node repeats and every read succeeds — `undefined` otherwise.
  const regularOrder = (): PageMarker[] | undefined => {
    const order: PageMarker[] = [];
    const visited = new Set<string>(pagesKey === undefined ? [] : [pagesKey]);
    let regular = true;
    const underNode = (node: unknown): number => {
      if (!(node instanceof PDFDict)) {
        regular = false;
        return 0;
      }
      const count = integer(fetch(node.get(COUNT)));
      const kids = fetch(node.get(KIDS));
      let found = 0;
      if (kids instanceof PDFArray) {
        for (let i = 0; i < kids.size() && regular; i++) found += underKid(kids.get(i));
      } else if (isPage(node)) {
        order.push(null);
        found = 1;
      } else {
        regular = false;
      }
      if (count !== undefined && count >= 0 && count !== found) regular = false;
      return found;
    };
    const underKid = (kid: unknown): number => {
      if (!(kid instanceof PDFRef)) return underNode(kid);
      const key = kid.toString();
      if (visited.has(key)) {
        regular = false;
        return 0;
      }
      visited.add(key);
      const obj = fetch(kid);
      if (obj instanceof PDFDict && isPage(obj)) {
        order.push(key);
        return 1;
      }
      return underNode(obj);
    };
    try {
      underNode(pages);
    } catch (e) {
      if (e === UNREADABLE || e instanceof RangeError) return undefined; // RangeError: a tree too deep to recurse
      throw e;
    }
    return regular ? order : undefined;
  };

  // `checkFirstPage`, outside recovery mode only; its page stays what pdf.js shows first.
  let first: PageMarker | undefined;
  if (!recovery) {
    try {
      first = getPage(0);
    } catch (e) {
      if (e !== UNREADABLE) throw e;
      return 'rebuild';
    }
  }
  // `checkLastPage`: `Catalog._pagesCount` is awaited even for a linearized file, whose count is then /N.
  let numPages = 0;
  try {
    const count = integer(fetch(pages.get(COUNT)));
    if (count === undefined) throw PAGE_ERROR;
    numPages = lin ? lin.numPages : count;
    if (numPages > 1 && getPage(numPages - 1) === undefined) throw PAGE_ERROR;
  } catch (e) {
    if (e !== UNREADABLE && e !== PAGE_ERROR) throw e;
    if (e === UNREADABLE && !recovery) return 'rebuild';
    try {
      return getAllPageDicts().slice(0, limit);
    } catch (all) {
      if (all !== UNREADABLE) throw all;
      return 'rebuild';
    }
  }

  const shown: PageMarker[] = [];
  const order = numPages > 0 && limit > 0 ? regularOrder() : undefined;
  for (let i = 0; i < Math.min(numPages, limit); i++) {
    if (i === 0 && !recovery) {
      shown.push(first === undefined ? PAGE_ERROR : first);
    } else if (order && lin?.pageFirst !== i) {
      shown.push(i < order.length ? order[i] : PAGE_ERROR);
    } else {
      try {
        shown.push(getPage(i) ?? PAGE_ERROR);
      } catch (e) {
        if (e !== UNREADABLE) throw e;
        shown.push(PAGE_ERROR);
      }
    }
  }
  return shown;
}

/**
 * The pages pdf-lib holds, in `PDFDocument.getPages` order — the order every export copies and a signature's page
 * index counts in: `PDFPageTree.traverse` visits every kid, ignores /Count, and keeps only `/Type /Page` leaves.
 * `undefined` where that walk throws, as `getPages` then does for every export.
 */
function heldPageOrder(lib: InspectLib, ctx: PDFContext): PageMarker[] | undefined {
  try {
    const catalog = ctx.lookup(ctx.trailerInfo.Root) as unknown as {
      Pages(): { traverse(visit: (node: unknown, ref: unknown) => void): void };
    };
    const held: PageMarker[] = [];
    catalog.Pages().traverse((node, ref) => {
      if (node instanceof lib.PDFPageLeaf) held.push(ref instanceof lib.PDFRef ? ref.toString() : null);
    });
    return held;
  } catch {
    return undefined;
  }
}

/** How pdf.js reads this file; see `viewerOf`. */
type Viewer =
  | { kind: 'chain'; chain: XrefChain; lookup: (ref: PDFRefT) => Shown; pages: PageMarker[] }
  | { kind: 'rebuild' | 'unmodelled' }
  | { kind: 'staleStream'; at: number };

/**
 * How pdf.js reads this file: through the chain, with the pages it then shows as far as `limit` (`'chain'`); by
 * rebuilding its table from a scan, which keeps the last definition of every object as pdf-lib does, because no
 * section yields a trailer, the root is one it rejects, or its opening walks meet an entry they cannot read
 * (`'rebuild'`); through a cross-reference stream whose decoding is not modelled (`'unmodelled'`); or through a stream
 * read with the state of one it rejected (`'staleStream'`), which is refused rather than guessed.
 */
function viewerOf(
  lib: InspectLib, ctx: PDFContext, rec: ParseRecord, bytes: Uint8Array, lin: Linearization | undefined, limit: number,
): Viewer {
  const read = readXrefQueue(lib, ctx, rec, bytes, lin);
  if (read.staleStreamAt !== undefined) return { kind: 'staleStream', at: read.staleStreamAt };
  if (read.unmodelled) return { kind: 'unmodelled' };
  if (!read.top) return { kind: 'rebuild' };
  const chain: XrefChain = { entries: read.entries, top: read.top, base: read.base };
  const lookup = (ref: PDFRefT): Shown => viewerLookup(ctx, rec, chain, bytes, ref);
  const resolve = (v: unknown): unknown => {
    if (!(v instanceof lib.PDFRef)) return v;
    const shown = lookup(v);
    return typeof shown === 'object' ? shown.object : undefined;
  };
  const root = resolve(chain.top.get(lib.PDFName.of('Root')));
  if (!acceptsAsRoot(lib, root, resolve)) return { kind: 'rebuild' };
  const pagesRef = (root as PDFDictT).get(lib.PDFName.of('Pages'));
  const pages = viewerPageOrder(lib, resolve(pagesRef) as PDFDictT, pagesRef, lookup, lin, false, limit);
  return pages === 'rebuild' ? { kind: 'rebuild' } : { kind: 'chain', chain, lookup, pages };
}

/**
 * The first page pdf.js shows that is not the page pdf-lib holds at the same index, as `page N` (WS7 round 17): a
 * /Count that lets `getPageDict` skip a subtree, a page dictionary without /Type, or a linearized file's /O. pdf.js
 * showing FEWER pages than pdf-lib holds is not a mismatch while every page it does show is the one pdf-lib holds
 * there; showing more is. When pdf.js rebuilds, or reads through an unmodelled stream, the walk runs over pdf-lib's
 * objects — a rebuild keeps the last definition of each, as pdf-lib does — from pdf-lib's root. Nothing is compared
 * when pdf-lib cannot list its pages, since every export then fails too.
 */
function pageMismatch(
  lib: InspectLib, ctx: PDFContext, viewer: Viewer, lin: Linearization | undefined, held: PageMarker[] | undefined,
): string[] {
  if (!held) return [];
  let shown: PageMarker[] | 'rebuild' | undefined;
  if (viewer.kind === 'chain') {
    shown = viewer.pages;
  } else if (viewer.kind === 'rebuild' || viewer.kind === 'unmodelled') {
    const resolve = (v: unknown): unknown => (v instanceof lib.PDFRef ? ctx.lookup(v) : v);
    const root = resolve(ctx.trailerInfo.Root);
    if (acceptsAsRoot(lib, root, resolve)) {
      const pagesRef = (root as PDFDictT).get(lib.PDFName.of('Pages'));
      const lookup = (ref: PDFRefT): Shown => {
        const object = ctx.lookup(ref);
        return object === undefined ? 'nothing' : { object };
      };
      shown = viewerPageOrder(lib, resolve(pagesRef) as PDFDictT, pagesRef, lookup, lin, viewer.kind === 'rebuild', held.length + 1);
    }
  }
  if (!Array.isArray(shown)) return [];
  const at = shown.findIndex((page, i) => page !== held[i]);
  return at < 0 ? [] : [`page ${at + 1}`];
}

/**
 * Whether two parsed objects hold the same value: the same object, or the same serialized bytes. pdf-lib
 * interns only null, booleans and names, so two identical copies of a stream or dictionary are two objects.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const bytesOf = (o: unknown): Uint8Array | undefined => {
    const obj = o as { sizeInBytes?: () => number; copyBytesInto?: (buffer: Uint8Array, offset: number) => number } | undefined;
    if (typeof obj?.sizeInBytes !== 'function' || typeof obj.copyBytesInto !== 'function') return undefined;
    const out = new Uint8Array(obj.sizeInBytes());
    obj.copyBytesInto(out, 0);
    return out;
  };
  const x = bytesOf(a);
  const y = bytesOf(b);
  if (!x || !y || x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * Recorded drops that are reachable (or unreadable behind a reachable damaged object) and still stand,
 * plus — when an object stream's members could not be listed — every reachable dangling reference; and
 * the objects where what pdf.js reads through the cross-reference chain is not what pdf-lib kept.
 */
function inspectParse(
  lib: InspectLib, ctx: PDFContext, bytes: Uint8Array,
): { dropped: string[]; mismatched: string[]; pages: string[] } {
  const rec = records.get(ctx);
  if (!rec) return { dropped: [], mismatched: [], pages: [] };
  const { PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject, PDFNull, PDFName } = lib;
  const mismatched = new Set<string>();
  const keptRoot = ctx.trailerInfo.Root;

  // pdf-lib swapped out a root pdf.js would use: the screen shows that root's pages, every export another's.
  if (rec.recoveredFrom instanceof PDFRef && keptRoot instanceof PDFRef
    && acceptsAsRoot(lib, ctx.lookup(rec.recoveredFrom), v => (v instanceof PDFRef ? ctx.lookup(v) : v))) {
    mismatched.add(keptRoot.toString());
  }

  const lin = linearizationOf(lib, rec, bytes);
  const heldPages = heldPageOrder(lib, ctx);
  const viewer = viewerOf(lib, ctx, rec, bytes, lin, heldPages ? heldPages.length + 1 : 0);
  // pdf.js reads a stream with the state of one it rejected: what it then reads is not modelled.
  if (viewer.kind === 'staleStream') mismatched.add(`cross-reference stream at ${viewer.at}`);
  const pages = pageMismatch(lib, ctx, viewer, lin, heldPages);
  const chain = viewer.kind === 'chain' ? viewer : undefined;
  // Does pdf.js find nothing, or fail to read, where pdf-lib holds an object? The only ways a single-revision file
  // can disagree, and cheap to ask, so a file where they cannot happen still pays for no walk.
  const heldDifferently = chain !== undefined && [...rec.lastAssigned.keys()].some(key => {
    const [num, gen] = key.split(' ').map(Number);
    return typeof chain.lookup(PDFRef.of(num, gen)) !== 'object';
  });
  const compare = chain !== undefined && (rec.reassigned || rec.trailerDicts > 1 || heldDifferently);
  if (rec.drops.size === 0 && !rec.membersUnknown && !compare) return { dropped: [], mismatched: [...mismatched], pages };

  const seen = new Map<string, PDFRefT>();
  const dangling: string[] = [];
  const damaged: string[] = [];
  const walk = (seeds: unknown[]): void => {
    const queue = [...seeds];
    while (queue.length > 0) {
      const value = queue.pop();
      if (value instanceof PDFRef) {
        const key = value.toString();
        if (seen.has(key)) continue;
        seen.set(key, value);
        const target = ctx.lookup(value);
        if (target === undefined) dangling.push(key);
        else if (target instanceof PDFInvalidObject) damaged.push(key); // its references cannot be read
        else queue.push(target);
      } else if (value instanceof PDFStream) {
        queue.push(value.dict);
      } else if (value instanceof PDFDict) {
        for (const v of value.values()) queue.push(v);
      } else if (value instanceof PDFArray) {
        for (let i = 0; i < value.size(); i++) queue.push(value.get(i));
      }
    }
  };
  walk([ctx.trailerInfo.Root]);
  // What the document root reaches is what a viewer can show. /Info, /Encrypt and /ID are walked for drops,
  // but pdf-lib merges trailers field by field, so an update that deletes /Info leaves the old one here.
  const fromRoot = new Set(seen.keys());
  walk([ctx.trailerInfo.Encrypt, ctx.trailerInfo.Info, ctx.trailerInfo.ID]);

  const dropped = new Set<string>();
  for (const [key, drop] of rec.drops) {
    if ((rec.lastAssigned.get(key) ?? -1) > drop.clock) continue; // a later assignment replaced it
    if (seen.has(key) || damaged.length > 0) dropped.add(key);
  }
  if (rec.membersUnknown) {
    for (const key of dangling) dropped.add(key);
    for (const key of damaged) dropped.add(key);
  }

  if (compare && chain) {
    for (const [key, ref] of seen) {
      const shown = chain.lookup(ref);
      const held = ctx.lookup(ref);
      if (typeof shown !== 'object') {
        // pdf.js finds nothing there, or throws reading it and shows the page without it (WS7 rounds 14 and 16).
        if (fromRoot.has(key) && held !== undefined && held !== PDFNull) mismatched.add(key);
      } else if (!sameValue(shown.object, held)) {
        mismatched.add(key);
      }
    }
    const root = chain.chain.top.get(PDFName.of('Root'));
    if (root instanceof PDFRef && keptRoot instanceof PDFRef && root !== keptRoot) {
      const shown = chain.lookup(root);
      if (typeof shown !== 'object' || !sameValue(shown.object, ctx.lookup(keptRoot))) mismatched.add(keptRoot.toString());
    }
  }
  return { dropped: [...dropped], mismatched: [...mismatched], pages };
}
