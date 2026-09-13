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
 *
 * WS7 rounds 10 and 11 detected the same drops by scanning the file's text for object headers. Round 12
 * found that scan wrong six ways — a stream with no `endstream`, a header glued to a delimiter, `>> stream`
 * inside a string, a comment between header tokens, object-stream members (which have no header), and a
 * string that merely reads ` 9 0 obj ` — every one a second tokenizer disagreeing with pdf-lib's. Asking
 * the parser leaves nothing to disagree about.
 *
 * Kept deliberately:
 *  - a dangling reference nothing was dropped for loads (a legal null, common in old files);
 *  - a damaged object that IS terminated loads — pdf-lib keeps it as a `PDFInvalidObject`;
 *  - a drop that a LATER revision of the same object replaces loads.
 * Closed by the recorder, where the header scan could not: when the NEWEST revision of an object is the
 * one dropped and an older revision stands in, the file is refused rather than exported stale.
 *
 * Bounds, stated rather than hidden. Bytes pdf-lib never parses as an object — skipped as jibberish, or
 * swallowed by a preceding stream whose end it placed too late — are not a drop, leave no record, and
 * are not detected here; that is pdf-lib's reading of the file, the same one 2.8.1 had. When an object
 * stream fails before its member list is known, the lost members cannot be named, so ANY reachable
 * dangling reference in that document refuses it.
 *
 * Every load in `src/` goes through here; `tests/utils/pdfLoadGuard.test.ts` fails by file name on
 * a new direct `PDFDocument.load`. A per-site check is how a sibling path keeps the defect.
 */
import type { LoadOptions, PDFContext, PDFDocument, PDFRef as PDFRefT } from '@cantoo/pdf-lib';

// pdf-lib is imported lazily and DESTRUCTURED, like every caller here: handing the module
// namespace around as a value would keep all of it in whichever chunk did so.
type PdfLib = typeof import('@cantoo/pdf-lib');
type WalkLib = Pick<PdfLib, 'PDFRef' | 'PDFDict' | 'PDFArray' | 'PDFStream'>;
type RecorderLib = Pick<PdfLib, 'PDFParser' | 'PDFObjectStreamParser' | 'PDFRef'>;

export class PdfObjectDroppedError extends Error {
  readonly refs: string[];
  constructor(refs: string[]) {
    super(`PDF_OBJECT_DROPPED: pdf-lib could not parse ${refs.join(', ')} and dropped it`);
    this.name = 'PdfObjectDroppedError';
    this.refs = refs;
  }
}

export async function loadPdfDocument(bytes: Uint8Array, options: LoadOptions = {}): Promise<PDFDocument> {
  const { PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream, PDFParser, PDFObjectStreamParser } = await import('@cantoo/pdf-lib');
  installDropRecorder({ PDFParser, PDFObjectStreamParser, PDFRef });
  const { updateMetadata = true, ...rest } = options;
  // Load WITHOUT pdf-lib's metadata stamp, check, and only then stamp. The stamp registers a new
  // /Info dictionary under the next free object number — and after a drop that number IS the dropped
  // object's, so every reference to the lost object silently resolves to the Info dict and nothing
  // dangles. Measured: checking after a default load passed the broken file, and the export wrote the
  // Info dict where the page content had been. `updateInfoDict()` is the last statement of pdf-lib's
  // constructor when `updateMetadata` is true, so calling it here is the same stamp in the same order.
  const doc = await PDFDocument.load(bytes, { ...rest, updateMetadata: false });
  // An encrypted file is parsed twice by pdf-lib; `doc.context` is the second, decrypting parse.
  const dropped = findDroppedObjects({ PDFRef, PDFDict, PDFArray, PDFStream }, doc.context);
  if (dropped.length > 0) throw new PdfObjectDroppedError(dropped);
  if (updateMetadata) (doc as unknown as { updateInfoDict(): void }).updateInfoDict();
  return doc;
}

interface Drop {
  ref: PDFRefT;
  /** What the reference resolved to when pdf-lib dropped it — `undefined`, or an older revision. */
  before: unknown;
}

// Keyed by the parse's own context, so two documents loading at once cannot see each other's drops.
const drops = new WeakMap<PDFContext, Map<string, Drop>>();
const membersUnknown = new WeakSet<PDFContext>();
// Module-local, not `Symbol.for`: a second copy of this module must install its own recorder rather
// than find a marker and leave its own record permanently empty.
const INSTALLED = Symbol('pdfLoadGuard.dropRecorder');

function recordDrop(ctx: PDFContext, ref: PDFRefT, before: unknown): void {
  let map = drops.get(ctx);
  if (!map) drops.set(ctx, (map = new Map()));
  // A later drop of the same object overwrites: what matters is what stood in after the LAST one.
  map.set(ref.toString(), { ref, before });
}

/** The references pdf-lib dropped while parsing into `ctx`, as `"N G R"`. For tests. */
export function recordedDrops(ctx: PDFContext): string[] {
  return [...(drops.get(ctx)?.keys() ?? [])];
}

interface ParserInternals {
  context: PDFContext;
  bytes: { offset(): number; moveTo(offset: number): void };
  parseIndirectObjectHeader(): PDFRefT;
  tryToParseInvalidIndirectObject(): PDFRefT | undefined;
}
interface ObjStmInternals {
  context: PDFContext;
  parseOffsetsAndObjectNumbers(): Array<{ objectNumber: number; offset: number }>;
  parseIntoContext(): Promise<void>;
}
type ForStream = (rawStream: { dict: { context: PDFContext } }, ...rest: unknown[]) => unknown;

/**
 * Wraps pdf-lib's two drop points, once. Throws if any wrapped method is gone: after a pdf-lib release
 * renames one, a silent no-op would leave every drop unrecorded and every load passing.
 */
export function installDropRecorder(lib: RecorderLib): void {
  const parser = lib.PDFParser.prototype as unknown as ParserInternals & { [INSTALLED]?: true };
  const objStm = lib.PDFObjectStreamParser.prototype as unknown as ObjStmInternals;
  const objStmClass = lib.PDFObjectStreamParser as unknown as { forStream: ForStream };
  const required: Array<[object, string]> = [
    [parser, 'tryToParseInvalidIndirectObject'], [parser, 'parseIndirectObjectHeader'],
    [objStm, 'parseIntoContext'], [objStm, 'parseOffsetsAndObjectNumbers'], [objStmClass, 'forStream'],
  ];
  for (const [owner, name] of required) {
    if (typeof (owner as Record<string, unknown>)[name] !== 'function') {
      throw new Error(`pdfLoadGuard: @cantoo/pdf-lib no longer has ${name}, so dropped objects cannot be detected`);
    }
  }
  if (parser[INSTALLED]) return;

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
    const before = ref ? this.context.lookup(ref) : undefined;
    const result = tryInvalid.call(this);
    if (result === undefined && ref) recordDrop(this.context, ref, before);
    return result;
  };

  // The member list is parsed inside `parseIntoContext`, which consumes the stream, so capture it on
  // the way out of its own method, together with what each member resolved to before this stream.
  // On a throw EVERY listed member is recorded: one assigned before the throw resolves to something new,
  // so the end-of-load comparison passes over it exactly as it passes over any superseded drop.
  const members = new WeakMap<object, Drop[]>();
  const memberTable = objStm.parseOffsetsAndObjectNumbers;
  objStm.parseOffsetsAndObjectNumbers = function (this: ObjStmInternals) {
    const table = memberTable.call(this);
    members.set(this, table.map(({ objectNumber }) => {
      const ref = lib.PDFRef.of(objectNumber, 0);
      return { ref, before: this.context.lookup(ref) };
    }));
    return table;
  };
  const intoContext = objStm.parseIntoContext;
  objStm.parseIntoContext = async function (this: ObjStmInternals) {
    try {
      return await intoContext.call(this);
    } catch (e) {
      const listed = members.get(this);
      if (!listed) membersUnknown.add(this.context); // the member table itself failed to parse
      else for (const m of listed) recordDrop(this.context, m.ref, m.before);
      throw e;
    }
  };
  const forStream = objStmClass.forStream;
  objStmClass.forStream = (rawStream, ...rest) => {
    try {
      return forStream(rawStream, ...rest);
    } catch (e) {
      // Decoding the stream or reading /N and /First failed: no member of it will ever be assigned.
      membersUnknown.add(rawStream.dict.context);
      throw e;
    }
  };
  parser[INSTALLED] = true;
}

/** Recorded drops that are reachable from the trailer and still stand, plus — when an object stream's
 *  members could not be listed — every reachable dangling reference. */
function findDroppedObjects(lib: WalkLib, ctx: PDFContext): string[] {
  const recorded = drops.get(ctx);
  const unknown = membersUnknown.has(ctx);
  if (!recorded && !unknown) return []; // a clean parse pays nothing
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const seen = new Set<string>();
  const dangling: string[] = [];
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
      if (target === undefined) dangling.push(key);
      else queue.push(target);
    } else if (value instanceof PDFStream) {
      queue.push(value.dict);
    } else if (value instanceof PDFDict) {
      for (const v of value.values()) queue.push(v);
    } else if (value instanceof PDFArray) {
      for (let i = 0; i < value.size(); i++) queue.push(value.get(i));
    }
  }
  const refused = new Set<string>();
  for (const [key, { ref, before }] of recorded ?? []) {
    // Still resolving to what stood when pdf-lib dropped it — nothing, or the older revision.
    if (seen.has(key) && ctx.lookup(ref) === before) refused.add(key);
  }
  if (unknown) for (const key of dangling) refused.add(key);
  return [...refused];
}
