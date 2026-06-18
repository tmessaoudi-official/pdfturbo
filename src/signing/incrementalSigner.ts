/**
 * F-D D3 SPIKE — append-only incremental-update multi-signature engine.
 *
 * ⚠️ EXPERIMENTAL / NOT WIRED INTO THE APP. This module exists to prove or
 * disprove TRUE N independent cryptographic signatures client-side, which the
 * shipped {@link PdfSigner} refuses (`ALREADY_SIGNED`) because @cantoo/pdf-lib's
 * full re-save (`doc.save`) renumbers objects and shifts every byte offset,
 * invalidating an existing signature's `/ByteRange`.
 *
 * The escape hatch is a HYBRID approach:
 *   • pdf-lib is used ONLY to READ structure (object numbers, Root/AcroForm/page
 *     refs) — never to re-save.
 *   • the second signature is written as a hand-built, APPEND-ONLY incremental
 *     update: the original bytes are preserved verbatim, then we append
 *       new sig dict + sig field/widget, a NEW revision of the page (+ /Annots)
 *       and of the AcroForm owner (+ /Fields, SigFlags), a classic incremental
 *       `xref` section, and a `trailer << … /Prev origStartxref >>`.
 *
 * Why both signatures stay valid: sig-1's `/ByteRange` second span ends at the
 * ORIGINAL EOF, so appending bytes after it leaves every byte sig-1 covered
 * untouched (this is precisely what PDF incremental-update signing is designed
 * for). Sig-2's `/ByteRange` covers the whole extended file minus its own
 * `/Contents` hex slot.
 *
 * ASCII assumption: every object we emit (sig dict, widget, page dict, catalog/
 * AcroForm dict) serialises to ASCII, so a character index in the appended blob
 * equals its byte offset. True for PDFs this app produces; a PDF with binary
 * literal strings in the page/catalog dict would need byte-accurate offsets.
 *
 * See the verdict: docs/reviews/2026-06-18-incremental-multisign-spike-verdict.md
 */

import { SignError, type SignatureRect } from './types';
import { formatPdfDate, rectToPdfArray } from './appearance';
import type { P12Material } from './p12';
import { buildDetachedCms } from './cms';
import {
  collectSignedBytes,
  computeByteRange,
  findByteRangeToken,
  findContentsSlot,
  indexOfAscii,
  signatureToPaddedHex,
  BYTE_RANGE_SENTINEL,
} from './byteRange';

/** Bytes reserved for the embedded signature (hex slot = 2×). Mirrors PdfSigner. */
const SIGNATURE_CAPACITY_BYTES = 8192;
const HEX_SLOT_CAPACITY = SIGNATURE_CAPACITY_BYTES * 2;

export interface IncrementalSignOptions {
  /** Zero-based page index for the (invisible — spike) signature field. */
  page: number;
  /** Signature field rectangle (points, bottom-left origin). */
  rect: SignatureRect;
  /** Optional signer name written into the signature dictionary. */
  name?: string;
  /** Optional reason string. */
  reason?: string;
}

export interface IncrementalSignResult {
  /** The doubly-signed PDF bytes (original prefix preserved verbatim). */
  bytes: Uint8Array;
  /** Hex SHA-256 of the exact span sig-2's ByteRange covers — for verification. */
  signedSpanSha256: string;
}

/** ASCII → bytes. */
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Byte offset of the integer following the LAST `startxref` keyword — the head of
 * the xref chain a reader resolves first. Used as the incremental trailer `/Prev`.
 *
 * @throws {Error} if no `startxref` is present.
 */
export function parseLastStartxref(bytes: Uint8Array): number {
  const key = 'startxref';
  let at = -1;
  for (;;) {
    const next = indexOfAscii(bytes, key, at + 1);
    if (next < 0) break;
    at = next;
  }
  if (at < 0) throw new Error('No startxref found in PDF.');
  let i = at + key.length;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  let digits = '';
  while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x39) {
    digits += String.fromCharCode(bytes[i]);
    i++;
  }
  if (!digits) throw new Error('Malformed startxref (no offset).');
  return parseInt(digits, 10);
}

/**
 * Count embedded signatures: each pairs a `/Contents <…>` hex slot with a sig
 * dict. We count document-order hex `/Contents` slots, which is exact for files
 * this engine produces (one hex slot per signature).
 */
export function countSignatures(bytes: Uint8Array): number {
  let from = 0;
  let count = 0;
  for (;;) {
    let slot;
    try {
      slot = findContentsSlot(bytes.subarray(from));
    } catch {
      break; // findContentsSlot throws (by design, byteRange.ts:92) when no more
      // hex /Contents slots remain — that IS the loop's terminating condition.
    }
    count++;
    from += slot.close + 1;
  }
  return count;
}

/** One classic xref entry: a 20-byte `nnnnnnnnnn ggggg n\r\n` line. */
function xrefEntry(offset: number, gen: number): string {
  return `${offset.toString().padStart(10, '0')} ${gen.toString().padStart(5, '0')} n\r\n`;
}

/**
 * Build the classic incremental `xref` table for a set of changed/new objects,
 * grouping consecutive object numbers into subsections. `entries` maps object
 * number → { offset, gen }.
 */
function buildIncrementalXref(entries: Map<number, { offset: number; gen: number }>): string {
  const nums = Array.from(entries.keys()).sort((a, b) => a - b);
  let out = 'xref\n';
  let i = 0;
  while (i < nums.length) {
    const start = nums[i];
    let count = 1;
    while (i + count < nums.length && nums[i + count] === start + count) count++;
    out += `${start} ${count}\n`;
    for (let k = 0; k < count; k++) {
      const e = entries.get(nums[i + k]);
      if (e) out += xrefEntry(e.offset, e.gen);
    }
    i += count;
  }
  return out;
}

/**
 * Add a second independent CMS signature via an append-only incremental update.
 * The input is NOT validated against ALREADY_SIGNED — that guard intentionally
 * blocks the shipped path; this spike deliberately signs an already-signed PDF.
 *
 * @throws {SignError} PDF_PARSE_FAILED | SIGN_FAILED | PLACEHOLDER_NOT_FOUND
 */
export async function addIncrementalSignature(
  signedBytes: Uint8Array,
  opts: IncrementalSignOptions,
  material: P12Material,
): Promise<IncrementalSignResult> {
  const pdfLib = await import('@cantoo/pdf-lib');
  const { PDFName, PDFNumber, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef } = pdfLib;

  let doc: import('@cantoo/pdf-lib').PDFDocument;
  try {
    doc = await pdfLib.PDFDocument.load(signedBytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (cause) {
    throw new SignError('PDF_PARSE_FAILED', 'Could not load the signed PDF for incremental signing.', { cause });
  }
  const ctx = doc.context;
  const origLen = signedBytes.length;
  const origStartxref = parseLastStartxref(signedBytes);

  // ── Read structure (no save) ──────────────────────────────────────────────
  type TrailerInfoLike = {
    Root?: import('@cantoo/pdf-lib').PDFRef;
    ID?: import('@cantoo/pdf-lib').PDFObject;
  };
  const trailer = (ctx as unknown as { trailerInfo: TrailerInfoLike }).trailerInfo;
  const catalogRef = trailer.Root;
  if (!(catalogRef instanceof PDFRef)) {
    throw new SignError('PDF_PARSE_FAILED', 'PDF has no /Root reference; cannot incrementally sign.');
  }
  const catalog = doc.catalog;
  const page = doc.getPage(opts.page);
  const signDate = new Date();
  const signerName = (opts.name ?? '').trim() || material.commonName;

  // ── New objects: signature dict + merged signature field/widget ───────────
  const byteRange = PDFArray.withContext(ctx);
  for (let i = 0; i < 4; i++) byteRange.push(PDFNumber.of(BYTE_RANGE_SENTINEL));

  const sigDict = ctx.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of('Adobe.PPKLite'),
    SubFilter: PDFName.of('adbe.pkcs7.detached'),
    M: PDFString.of(formatPdfDate(signDate)),
  });
  sigDict.set(PDFName.of('ByteRange'), byteRange);
  sigDict.set(PDFName.of('Contents'), PDFHexString.of('0'.repeat(HEX_SLOT_CAPACITY)));
  if (opts.reason?.trim()) sigDict.set(PDFName.of('Reason'), PDFString.of(opts.reason.trim()));
  if (signerName) sigDict.set(PDFName.of('Name'), PDFString.of(signerName));
  const sigRef = ctx.register(sigDict);

  const [llx, lly, urx, ury] = rectToPdfArray(opts.rect);
  const rectArr = PDFArray.withContext(ctx);
  for (const n of [llx, lly, urx, ury]) rectArr.push(PDFNumber.of(n));
  const fieldDict = ctx.obj({
    FT: PDFName.of('Sig'),
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    F: PDFNumber.of(4),
    T: PDFString.of(`Signature2_${signDate.getTime()}`),
  });
  fieldDict.set(PDFName.of('Rect'), rectArr);
  fieldDict.set(PDFName.of('V'), sigRef);
  fieldDict.set(PDFName.of('P'), page.ref);
  const fieldRef = ctx.register(fieldDict);

  // ── Mutate existing objects in memory (page /Annots, AcroForm /Fields) ────
  // Page: append the widget to /Annots.
  const annotsKey = PDFName.of('Annots');
  const existingAnnots = page.node.get(annotsKey);
  if (existingAnnots instanceof PDFArray) {
    existingAnnots.push(fieldRef);
  } else {
    const arr = PDFArray.withContext(ctx);
    arr.push(fieldRef);
    page.node.set(annotsKey, arr);
  }

  // AcroForm: may be an indirect object OR an inline dict on the catalog. The
  // owner object (AcroForm object, or the catalog) is re-emitted as a new rev.
  const acroKey = PDFName.of('AcroForm');
  const acroEntry = catalog.get(acroKey);
  let acroFormDict: import('@cantoo/pdf-lib').PDFDict;
  let acroOwnerRef: import('@cantoo/pdf-lib').PDFRef; // the object number to re-emit for the form change
  let acroOwnerObj: import('@cantoo/pdf-lib').PDFObject;
  if (acroEntry instanceof PDFRef) {
    const looked = ctx.lookup(acroEntry);
    if (!(looked instanceof PDFDict)) {
      throw new SignError('PDF_PARSE_FAILED', '/AcroForm is not a dictionary.');
    }
    acroFormDict = looked;
    acroOwnerRef = acroEntry;
    acroOwnerObj = looked;
  } else if (acroEntry instanceof PDFDict) {
    acroFormDict = acroEntry; // inline on the catalog
    acroOwnerRef = catalogRef;
    acroOwnerObj = catalog;
  } else {
    acroFormDict = ctx.obj({}) as import('@cantoo/pdf-lib').PDFDict;
    acroFormDict.set(PDFName.of('Fields'), PDFArray.withContext(ctx));
    catalog.set(acroKey, acroFormDict); // inline
    acroOwnerRef = catalogRef;
    acroOwnerObj = catalog;
  }
  let fields = acroFormDict.get(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) {
    fields = PDFArray.withContext(ctx);
    acroFormDict.set(PDFName.of('Fields'), fields);
  }
  (fields as import('@cantoo/pdf-lib').PDFArray).push(fieldRef);
  acroFormDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  // ── Serialise new + changed objects, tracking absolute byte offsets ───────
  // Emit order is arbitrary; offsets are absolute (origLen + position in blob).
  const emit: Array<{ ref: import('@cantoo/pdf-lib').PDFRef; obj: import('@cantoo/pdf-lib').PDFObject }> = [
    { ref: sigRef, obj: sigDict },
    { ref: fieldRef, obj: fieldDict },
    { ref: page.ref, obj: page.node },
  ];
  // The AcroForm owner (catalog OR acroform object) — dedupe vs page.ref.
  if (acroOwnerRef.objectNumber !== page.ref.objectNumber) {
    emit.push({ ref: acroOwnerRef, obj: acroOwnerObj });
  }

  const xrefEntries = new Map<number, { offset: number; gen: number }>();
  let blob = '\n'; // separate cleanly from the original trailing %%EOF
  for (const { ref, obj } of emit) {
    const absOffset = origLen + blob.length;
    xrefEntries.set(ref.objectNumber, { offset: absOffset, gen: ref.generationNumber });
    blob += `${ref.objectNumber} ${ref.generationNumber} obj\n${obj.toString()}\nendobj\n`;
  }

  const xrefOffset = origLen + blob.length;
  blob += buildIncrementalXref(xrefEntries);

  const maxObjNum = Math.max(...Array.from(xrefEntries.keys()), ...emit.map((e) => e.ref.objectNumber));
  const idObj = trailer.ID;
  const idStr = idObj ? ` /ID ${idObj.toString()}` : '';
  blob += `trailer\n<< /Size ${maxObjNum + 1} /Root ${catalogRef.objectNumber} ${catalogRef.generationNumber} R /Prev ${origStartxref}${idStr} >>\n`;
  blob += `startxref\n${xrefOffset}\n%%EOF\n`;

  // ── Concatenate (original verbatim) + locate sig-2's placeholders ─────────
  const blobBytes = ascii(blob);
  const draft = new Uint8Array(origLen + blobBytes.length);
  draft.set(signedBytes, 0);
  draft.set(blobBytes, origLen);

  // Search ONLY the appended region so we never hit sig-1's filled /Contents.
  const tail = draft.subarray(origLen);
  let slotRel: ReturnType<typeof findContentsSlot>;
  let brRel: ReturnType<typeof findByteRangeToken>;
  try {
    slotRel = findContentsSlot(tail);
    brRel = findByteRangeToken(tail);
  } catch (cause) {
    throw new SignError('PLACEHOLDER_NOT_FOUND', 'Sig-2 placeholders not found in appended revision.', { cause });
  }
  const slot = { open: slotRel.open + origLen, close: slotRel.close + origLen, hexLength: slotRel.hexLength };
  if (slot.hexLength !== HEX_SLOT_CAPACITY) {
    throw new SignError('PLACEHOLDER_NOT_FOUND', `Unexpected sig-2 /Contents slot size (${slot.hexLength}).`);
  }
  const brStart = brRel.start + origLen;
  const brEnd = brRel.end + origLen;

  // ── Compute ByteRange, overwrite placeholder, sign, splice ────────────────
  const range = computeByteRange(slot, draft.length);
  const brReal = `/ByteRange [ ${range[0]} ${range[1]} ${range[2]} ${range[3]} ]`;
  const targetLen = brEnd - brStart;
  if (brReal.length > targetLen) {
    throw new SignError('PLACEHOLDER_NOT_FOUND', `Real ByteRange (${brReal.length}B) exceeds slot (${targetLen}B).`);
  }
  overwriteAscii(draft, brStart, brReal + ' '.repeat(targetLen - brReal.length));

  const span = collectSignedBytes(draft, range);
  const signedSpanSha256 = await sha256Hex(span);
  const cms = await buildDetachedCms(span, material);
  const hex = signatureToPaddedHex(cms, HEX_SLOT_CAPACITY);
  overwriteAscii(draft, slot.open + 1, hex);

  return { bytes: draft, signedSpanSha256 };
}

/** Overwrite ASCII text into a byte array at an offset (no length change). */
function overwriteAscii(bytes: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i) & 0xff;
}

/** Hex SHA-256 via Web Crypto (Node webcrypto in jsdom; browser native). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh Uint8Array so the buffer is a plain ArrayBuffer (not the
  // ArrayBuffer|SharedArrayBuffer union the source view's .buffer carries).
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex;
}
