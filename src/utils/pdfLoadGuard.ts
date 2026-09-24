/**
 * The ONE place this repo loads a PDF with pdf-lib. Two checks run here, and a document failing either is refused.
 *
 * 1. Dropped objects. `@cantoo/pdf-lib` 2.11.0 changed `PDFParser.tryToParseInvalidIndirectObject`: an object it
 * cannot parse, with no `endobj` before EOF, is now DROPPED ("instead of failing the whole parse") where 2.8.1 threw
 * `Failed to parse invalid PDF object`. pdf.js is more lenient, so the page still renders on screen — and every export
 * built from the pdf-lib copy silently comes out without the dropped object. Measured: a page whose content stream was
 * that object exported as an EMPTY page while pdf.js read the text from the source.
 *
 * This restores the loud failure by RECORDING each drop at the point pdf-lib makes it, then refusing a document when a
 * recorded drop is reachable from the trailer and nothing later replaced it. pdf-lib drops objects in exactly two
 * places, and both are wrapped (`installDropRecorder`):
 *  - `PDFParser.tryToParseInvalidIndirectObject` returning nothing — a classic `N G obj`;
 *  - `PDFObjectStreamParser.parseIntoContext` throwing part-way — every member of the object stream not yet assigned
 *    is lost, while the stream itself is kept as an opaque invalid object.
 * The wrappers return what the originals return and rethrow what they throw, so no parse changes. "Nothing later
 * replaced it" is read off the ORDER of pdf-lib's own assignments, never off the value: pdf-lib interns null, booleans
 * and names, so an older revision and its replacement can be the very same object (WS7 round 13). WS7 rounds 10–12
 * detected drops by scanning the file's text for object headers and found that scan wrong six ways — every one a
 * second tokenizer disagreeing with pdf-lib's. Asking the parser leaves nothing to disagree about; do not bring a text
 * scan back.
 *
 * 2. The viewer check (WS8, 2026-09-24). A file can show one page on screen and export or sign another with nothing
 * dropped: pdf.js follows `startxref` and the cross-reference chain, pdf-lib keeps the last definition of each object,
 * and the two walk a page tree differently. WS7 rounds 13–17 answered that with a MIRROR of pdf.js's reader built on
 * pdf-lib's parse, and the closing audit measured ten crafted shapes that still got past it — wherever the two
 * libraries tokenize the same bytes differently, the mirror saw a success pdf.js did not have. So the mirror is gone:
 * for a SOURCE document, `viewerVerdict` runs pdf.js itself on the original and on the copy the export builds, and
 * compares every page (`src/utils/viewerCheck.ts`). A mismatch refuses with `PdfPageMismatchError`.
 *
 * `viewerCheck` has no default, so every call site chooses. `'source'` for bytes that came from outside — the user's
 * file, or bytes derived from a checked source (a true edit inherits its source's verdict). `false` for bytes pdf-lib
 * wrote in the same operation from documents already checked here (the assembled export, the sanitized or compressed
 * copy, the signer's input): pdf-lib's own `save()` writes a clean cross-reference table, and running pdf.js over every
 * intermediate would double the cost of every export. `tests/utils/pdfLoadGuard.test.ts` fails when a new direct
 * `PDFDocument.load` appears in `src/`, and the type makes a call site without the choice fail to compile.
 *
 * Kept deliberately (drop check):
 *  - a dangling reference nothing was dropped for loads (a legal null, common in old files);
 *  - a damaged object that IS terminated loads — pdf-lib keeps it as a `PDFInvalidObject`;
 *  - a drop that a LATER revision of the same object replaces loads.
 * Bounds, stated rather than hidden. Bytes pdf-lib never parses as an object — skipped as junk, or swallowed by a
 * preceding stream whose end it placed too late — are not a drop and are not detected by the drop check (the viewer
 * check sees them only if they change what a page draws). When an object stream fails before its member list is
 * known, the lost members cannot be named, so ANY reachable dangling or damaged reference refuses the document. A
 * reachable damaged object's references cannot be read at all, so while one exists every drop still standing refuses.
 * The viewer check's own bounds are in `viewerCheck.ts`.
 */
import type { LoadOptions, PDFContext, PDFDocument, PDFRef as PDFRefT } from '@cantoo/pdf-lib';
import { viewerVerdict } from './viewerVerdict';

// pdf-lib is imported lazily and DESTRUCTURED, like every caller here: handing the module
// namespace around as a value would keep all of it in whichever chunk did so.
type PdfLib = typeof import('@cantoo/pdf-lib');
type InspectLib = Pick<PdfLib, 'PDFRef' | 'PDFDict' | 'PDFArray' | 'PDFStream' | 'PDFInvalidObject'>;
type RecorderLib = Pick<PdfLib, 'PDFParser' | 'PDFObjectStreamParser' | 'PDFContext' | 'PDFRef'>;

/** Which check a load runs besides the drop check — see the header. */
export type ViewerCheck = 'source' | false;
export type GuardedLoadOptions = LoadOptions & { viewerCheck: ViewerCheck };

export class PdfObjectDroppedError extends Error {
  readonly refs: string[];
  constructor(refs: string[]) {
    super(`PDF_OBJECT_DROPPED: pdf-lib could not parse ${refs.join(', ')}, and the document uses what it lost`);
    this.name = 'PdfObjectDroppedError';
    this.refs = refs;
  }
}

/**
 * No longer thrown: the mirror that raised it was replaced by the viewer check (WS8), which reports every mismatch
 * as a page. Kept so a caller or test keyed on the name keeps compiling and `isPdfLoadRefusal` keeps recognising it.
 */
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

export async function loadPdfDocument(bytes: Uint8Array, options: GuardedLoadOptions): Promise<PDFDocument> {
  const { PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject, PDFParser, PDFObjectStreamParser, PDFContext } =
    await import('@cantoo/pdf-lib');
  installDropRecorder({ PDFParser, PDFObjectStreamParser, PDFContext, PDFRef });
  const { updateMetadata = true, viewerCheck, ...rest } = options;
  // Load WITHOUT pdf-lib's metadata stamp, check, and only then stamp. The stamp registers a new
  // /Info dictionary under the next free object number — and after a drop that number IS the dropped
  // object's, so every reference to the lost object silently resolves to the Info dict and nothing
  // dangles. Measured: checking after a default load passed the broken file, and the export wrote the
  // Info dict where the page content had been. `updateInfoDict()` is the last statement of pdf-lib's
  // constructor when `updateMetadata` is true, so calling it here is the same stamp in the same order.
  const doc = await PDFDocument.load(bytes, { ...rest, updateMetadata: false });
  // An encrypted file is parsed twice by pdf-lib; `doc.context` is the second, decrypting parse.
  const dropped = droppedObjects({ PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject }, doc.context);
  records.delete(doc.context); // the record is only needed for this check
  if (dropped.length > 0) throw new PdfObjectDroppedError(dropped);
  if (viewerCheck === 'source') {
    // `doc` is unmodified here and only read by the check, which settles before the caller gets it.
    const { pages } = await viewerVerdict(bytes, doc);
    if (pages.length > 0) throw new PdfPageMismatchError(pages.map(p => `page ${p}`));
  }
  if (updateMetadata) (doc as unknown as { updateInfoDict(): void }).updateInfoDict();
  return doc;
}

interface Drop {
  ref: PDFRefT;
  /** The assignment clock when pdf-lib dropped it: any later assignment to the object supersedes it. */
  clock: number;
}
interface ParseRecord {
  /** True only inside `parseDocument`, so edits made to the document later are not counted. */
  parsing: boolean;
  clock: number;
  lastAssigned: Map<string, number>;
  drops: Map<string, Drop>;
  membersUnknown: boolean;
}

// Keyed by the parse's own context, so two documents loading at once cannot see each other's records.
const records = new WeakMap<PDFContext, ParseRecord>();
// Module-local, not `Symbol.for`: a second copy of this module must install its own recorder rather
// than find a marker and leave its own record permanently empty.
const INSTALLED = Symbol('pdfLoadGuard.dropRecorder');

function recordFor(ctx: PDFContext): ParseRecord {
  let rec = records.get(ctx);
  if (!rec) {
    rec = { parsing: false, clock: 0, lastAssigned: new Map(), drops: new Map(), membersUnknown: false };
    records.set(ctx, rec);
  }
  return rec;
}

function recordDrop(rec: ParseRecord, ref: PDFRefT, clock: number): void {
  // A later drop of the same object overwrites: what matters is whether anything was assigned after the LAST one.
  rec.drops.set(ref.toString(), { ref, clock });
}

/** The references pdf-lib dropped while parsing into `ctx`, as `"N G R"`. For tests. */
export function recordedDrops(ctx: PDFContext): string[] {
  return [...(records.get(ctx)?.drops.keys() ?? [])];
}

interface ParserInternals {
  context: PDFContext;
  bytes: { offset(): number; moveTo(offset: number): void };
  parseDocument(): Promise<PDFContext>;
  parseIndirectObjectHeader(): PDFRefT;
  tryToParseInvalidIndirectObject(): PDFRefT | undefined;
}
interface ObjStmInternals {
  context: PDFContext;
  parseOffsetsAndObjectNumbers(): Array<{ objectNumber: number; offset: number }>;
  parseIntoContext(): Promise<void>;
}
interface ContextInternals {
  assign(ref: PDFRefT, object: unknown): void;
}
type ForStream = (rawStream: { dict: { context: PDFContext } }, ...rest: unknown[]) => unknown;

const protoOf = <T>(cls: unknown): T => ((cls as { prototype?: T } | undefined)?.prototype ?? {}) as T;

/**
 * Wraps the parser methods where pdf-lib drops objects, once per pdf-lib copy. Throws if a pdf-lib release renamed
 * one of them, so an upgrade fails loudly instead of silently recording nothing.
 */
export function installDropRecorder(lib: RecorderLib): void {
  const parser = protoOf<ParserInternals & { [INSTALLED]?: true }>(lib.PDFParser);
  const objStm = protoOf<ObjStmInternals>(lib.PDFObjectStreamParser);
  const objStmClass = (lib.PDFObjectStreamParser ?? {}) as unknown as { forStream: ForStream };
  const context = protoOf<ContextInternals>(lib.PDFContext);
  const required: Array<[object, string]> = [
    [parser, 'tryToParseInvalidIndirectObject'], [parser, 'parseIndirectObjectHeader'], [parser, 'parseDocument'],
    [objStm, 'parseIntoContext'], [objStm, 'parseOffsetsAndObjectNumbers'], [objStmClass, 'forStream'],
    [context, 'assign'],
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
    if (rec?.parsing) rec.lastAssigned.set(ref.toString(), ++rec.clock);
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
    return result;
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

/** The drops the document uses: reachable from the trailer and not replaced by a later assignment. */
function droppedObjects(lib: InspectLib, ctx: PDFContext): string[] {
  const rec = records.get(ctx);
  if (!rec || (rec.drops.size === 0 && !rec.membersUnknown)) return [];
  const { PDFRef, PDFDict, PDFArray, PDFStream, PDFInvalidObject } = lib;

  const seen = new Set<string>();
  const dangling: string[] = [];
  const damaged: string[] = [];
  const queue: unknown[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Encrypt, ctx.trailerInfo.Info, ctx.trailerInfo.ID];
  while (queue.length > 0) {
    const value = queue.pop();
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (seen.has(key)) continue;
      seen.add(key);
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

  const dropped = new Set<string>();
  for (const [key, drop] of rec.drops) {
    if ((rec.lastAssigned.get(key) ?? -1) > drop.clock) continue; // a later assignment replaced it
    if (seen.has(key) || damaged.length > 0) dropped.add(key);
  }
  if (rec.membersUnknown) {
    for (const key of dangling) dropped.add(key);
    for (const key of damaged) dropped.add(key);
  }
  return [...dropped];
}
