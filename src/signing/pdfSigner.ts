/**
 * PdfSigner — client-side PKCS#12 visible PDF signing core (Agent S, v1).
 *
 * Pipeline:
 *   1. Validate options + load the page/cert (forge dynamically imported).
 *   2. Draw a visible appearance box + text on the target page.
 *   3. Build a signature dictionary with a fixed-width `/ByteRange` placeholder
 *      and a fixed-width `/Contents <0…0>` hex slot; wire it into AcroForm as a
 *      signature field + widget annotation over the appearance rect.
 *   4. Serialise the PDF, locate the `/Contents` slot, compute the real ByteRange,
 *      overwrite the ByteRange placeholder in place, hash+sign the covered span
 *      via detached CMS, and splice the signature hex into the slot.
 *
 * SCOPE (v1): a single basic embedded PKCS#7/CMS signature with a visible
 * appearance. No timestamp authority (TSA), no LTV/DSS, no multi-signature
 * incremental rounds — see the wiring spec.
 *
 * 100% client-side: the .p12 bytes and passphrase are only ever passed to forge
 * in memory; nothing is uploaded.
 */

import { SignError, type SignOptions, type SignResult } from './types';
import {
  buildAppearanceLines,
  formatPdfDate,
  rectToPdfArray,
  validatePageIndex,
  validateRect,
  validateSignOptionsShape,
} from './appearance';
import { loadP12, type P12Material } from './p12';
import { buildDetachedCms } from './cms';
import {
  BYTE_RANGE_SENTINEL,
  byteRangeReplacement,
  collectSignedBytes,
  computeByteRange,
  findByteRangeToken,
  findContentsSlot,
  signatureToPaddedHex,
} from './byteRange';

/** Number of bytes reserved for the embedded signature (hex slot = 2× this). */
const SIGNATURE_CAPACITY_BYTES = 8192;
const HEX_SLOT_CAPACITY = SIGNATURE_CAPACITY_BYTES * 2;

export class PdfSigner {
  /**
   * Sign a PDF and return the signed bytes. The input is never mutated.
   *
   * @throws {SignError} with a {@link SignErrorCode} on any validation/crypto failure.
   */
  async sign(pdfBytes: Uint8Array, opts: SignOptions): Promise<SignResult> {
    validateSignOptionsShape(opts);

    // Load cert material first — fail fast on bad passphrase before touching the PDF.
    const material = await loadP12(opts.p12, opts.passphrase);

    const pdfLib = await import('@cantoo/pdf-lib');
    const doc = await this._loadDocument(pdfLib, pdfBytes);

    const pageCount = doc.getPageCount();
    validatePageIndex(opts.page, pageCount);
    const page = doc.getPage(opts.page);
    const { width, height } = page.getSize();
    validateRect(opts.rect, { width, height });

    const signerName = (opts.name ?? '').trim() || material.commonName;
    const signDate = new Date();

    this._drawAppearance(pdfLib, doc, page, opts, signerName, signDate);
    const sigFieldRef = this._buildSignatureDict(pdfLib, doc, page, opts, signerName, signDate);
    this._registerAcroFormField(pdfLib, doc, sigFieldRef);

    // Serialise WITHOUT object streams so /Contents stays a plain literal we can find.
    const draftBytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });

    const signedBytes = await this._spliceSignature(draftBytes, material);

    return { bytes: signedBytes, signerCommonName: material.commonName };
  }

  private async _loadDocument(
    pdfLib: typeof import('@cantoo/pdf-lib'),
    pdfBytes: Uint8Array,
  ): Promise<import('@cantoo/pdf-lib').PDFDocument> {
    try {
      return await pdfLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    } catch (cause) {
      throw new SignError('PDF_PARSE_FAILED', 'Could not load the PDF for signing.', { cause });
    }
  }

  private _drawAppearance(
    pdfLib: typeof import('@cantoo/pdf-lib'),
    doc: import('@cantoo/pdf-lib').PDFDocument,
    page: import('@cantoo/pdf-lib').PDFPage,
    opts: SignOptions,
    signerName: string | undefined,
    signDate: Date,
  ): void {
    const { rect } = opts;
    const lines = buildAppearanceLines({
      name: signerName,
      reason: opts.reason,
      location: opts.location,
      date: signDate,
    });

    // Border + faint background.
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      borderColor: pdfLib.rgb(0.1, 0.2, 0.5),
      borderWidth: 1,
      color: pdfLib.rgb(0.94, 0.96, 1),
      opacity: 0.6,
      borderOpacity: 0.9,
    });

    const fontSize = Math.max(6, Math.min(11, rect.height / (lines.length + 1)));
    const lineGap = fontSize * 1.25;
    const padding = Math.min(4, rect.width * 0.05);
    let cursorY = rect.y + rect.height - padding - fontSize;
    for (const line of lines) {
      page.drawText(line, {
        x: rect.x + padding,
        y: cursorY,
        size: fontSize,
        color: pdfLib.rgb(0.1, 0.1, 0.1),
        maxWidth: rect.width - padding * 2,
      });
      cursorY -= lineGap;
      if (cursorY < rect.y + padding) break;
    }
  }

  /** Build the signature dictionary + widget annotation; returns the field's ref. */
  private _buildSignatureDict(
    pdfLib: typeof import('@cantoo/pdf-lib'),
    doc: import('@cantoo/pdf-lib').PDFDocument,
    page: import('@cantoo/pdf-lib').PDFPage,
    opts: SignOptions,
    signerName: string | undefined,
    signDate: Date,
  ): import('@cantoo/pdf-lib').PDFRef {
    const { PDFName, PDFNumber, PDFString, PDFHexString, PDFArray } = pdfLib;
    const ctx = doc.context;

    // Reserved placeholders — overwritten after serialisation. Four max-width
    // sentinel values reserve enough bytes for the real ByteRange numbers.
    const byteRange = PDFArray.withContext(ctx);
    for (let i = 0; i < 4; i++) byteRange.push(PDFNumber.of(BYTE_RANGE_SENTINEL));

    const sigDict = ctx.obj({
      Type: PDFName.of('Sig'),
      Filter: PDFName.of('Adobe.PPKLite'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      M: PDFString.of(formatPdfDate(signDate)),
    });
    sigDict.set(PDFName.of('ByteRange'), byteRange);
    // Fixed-capacity zero hex slot; pdf-lib serialises this as <00…00>.
    sigDict.set(PDFName.of('Contents'), PDFHexString.of('0'.repeat(HEX_SLOT_CAPACITY)));
    if (opts.reason?.trim()) sigDict.set(PDFName.of('Reason'), PDFString.of(opts.reason.trim()));
    if (opts.location?.trim()) sigDict.set(PDFName.of('Location'), PDFString.of(opts.location.trim()));
    if (opts.contactInfo?.trim()) {
      sigDict.set(PDFName.of('ContactInfo'), PDFString.of(opts.contactInfo.trim()));
    }
    if (signerName) sigDict.set(PDFName.of('Name'), PDFString.of(signerName));
    const sigRef = ctx.register(sigDict);

    // The signature field IS the widget annotation (merged field/widget).
    const [llx, lly, urx, ury] = rectToPdfArray(opts.rect);
    const rectArr = PDFArray.withContext(ctx);
    for (const n of [llx, lly, urx, ury]) rectArr.push(PDFNumber.of(n));

    const fieldDict = ctx.obj({
      FT: PDFName.of('Sig'),
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      F: PDFNumber.of(4), // Print flag
      T: PDFString.of(`Signature_${Date.now()}`),
    });
    fieldDict.set(PDFName.of('Rect'), rectArr);
    fieldDict.set(PDFName.of('V'), sigRef);
    fieldDict.set(PDFName.of('P'), page.ref);
    const fieldRef = ctx.register(fieldDict);

    // Attach the widget to the page's /Annots.
    this._appendToPageAnnots(pdfLib, doc, page, fieldRef);

    return fieldRef;
  }

  private _appendToPageAnnots(
    pdfLib: typeof import('@cantoo/pdf-lib'),
    doc: import('@cantoo/pdf-lib').PDFDocument,
    page: import('@cantoo/pdf-lib').PDFPage,
    annotRef: import('@cantoo/pdf-lib').PDFRef,
  ): void {
    const { PDFName, PDFArray } = pdfLib;
    const ctx = doc.context;
    const key = PDFName.of('Annots');
    const existing = page.node.get(key);
    if (existing instanceof pdfLib.PDFArray) {
      existing.push(annotRef);
    } else {
      const arr = PDFArray.withContext(ctx);
      arr.push(annotRef);
      page.node.set(key, arr);
    }
  }

  /** Register the signature field in the document AcroForm (creating it if absent). */
  private _registerAcroFormField(
    pdfLib: typeof import('@cantoo/pdf-lib'),
    doc: import('@cantoo/pdf-lib').PDFDocument,
    fieldRef: import('@cantoo/pdf-lib').PDFRef,
  ): void {
    const { PDFName, PDFNumber, PDFArray, PDFDict } = pdfLib;
    const ctx = doc.context;
    const catalog = doc.catalog;
    const acroKey = PDFName.of('AcroForm');

    let acroForm = catalog.get(acroKey);
    if (!(acroForm instanceof PDFDict)) {
      acroForm = ctx.obj({});
      const fields = PDFArray.withContext(ctx);
      (acroForm as import('@cantoo/pdf-lib').PDFDict).set(PDFName.of('Fields'), fields);
      catalog.set(acroKey, acroForm);
    }
    const af = acroForm as import('@cantoo/pdf-lib').PDFDict;

    let fields = af.get(PDFName.of('Fields'));
    if (!(fields instanceof PDFArray)) {
      fields = PDFArray.withContext(ctx);
      af.set(PDFName.of('Fields'), fields);
    }
    (fields as import('@cantoo/pdf-lib').PDFArray).push(fieldRef);

    // SigFlags: 3 = SignaturesExist | AppendOnly.
    af.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  /**
   * Given the serialised draft (with placeholders), compute the real ByteRange,
   * overwrite it in place, build the detached CMS over the covered span, and
   * splice the signature hex into the Contents slot.
   */
  private async _spliceSignature(draft: Uint8Array, material: P12Material): Promise<Uint8Array> {
    // Work on a mutable copy so the input is never touched.
    const bytes = new Uint8Array(draft);

    const slot = (() => {
      try {
        return findContentsSlot(bytes);
      } catch (cause) {
        throw new SignError(
          'PLACEHOLDER_NOT_FOUND',
          'Signature /Contents placeholder not found after serialisation.',
          { cause },
        );
      }
    })();

    if (slot.hexLength !== HEX_SLOT_CAPACITY) {
      throw new SignError(
        'PLACEHOLDER_NOT_FOUND',
        `Unexpected /Contents slot size (${slot.hexLength} != ${HEX_SLOT_CAPACITY}).`,
      );
    }

    const range = computeByteRange(slot, bytes.length);

    // Overwrite the /ByteRange [ … ] token in place (same byte length: the real
    // numbers are ≤ the reserved sentinel width and the token is space-padded).
    const brToken = (() => {
      try {
        return findByteRangeToken(bytes);
      } catch (cause) {
        throw new SignError(
          'PLACEHOLDER_NOT_FOUND',
          'Signature /ByteRange placeholder not found after serialisation.',
          { cause },
        );
      }
    })();
    const brReal = byteRangeReplacement(range, brToken.end - brToken.start);
    this._overwriteAscii(bytes, brToken.start, brReal);

    // Hash + sign the covered span (everything except the hex payload).
    const signedSpan = collectSignedBytes(bytes, range);
    const cms = await buildDetachedCms(signedSpan, material);

    // Splice the signature hex into the reserved slot.
    const hex = signatureToPaddedHex(cms, HEX_SLOT_CAPACITY);
    this._overwriteAscii(bytes, slot.open + 1, hex);

    return bytes;
  }

  /** Overwrite ASCII text into a byte array at a given offset (no length change). */
  private _overwriteAscii(bytes: Uint8Array, at: number, text: string): void {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i) & 0xff;
  }
}

/** Convenience one-shot helper around {@link PdfSigner}. */
export function signPdf(pdfBytes: Uint8Array, opts: SignOptions): Promise<SignResult> {
  return new PdfSigner().sign(pdfBytes, opts);
}
