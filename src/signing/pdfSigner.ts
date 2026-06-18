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

import { SignError, type SignOptions, type SignResult, type SignatureRect } from './types';
import {
  buildAppearanceLines,
  formatPdfDate,
  rectToPdfArray,
  validatePageIndex,
  validateRect,
  validateSignOptionsShape,
} from './appearance';
import { loadP12, scrubP12Material, type P12Material } from './p12';
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

/**
 * Whether a PDF already carries a signature. A signature dictionary always pairs
 * a `/ByteRange [` with a known signature `/SubFilter` (or `/Type /Sig`); an
 * unsigned PDF has neither. Requiring BOTH avoids false positives from those byte
 * sequences appearing incidentally in content streams.
 *
 * Cert-free and synchronous — exported so the UI can gate cert generation on it
 * (S-FLOW: never download a generated .p12 for a PDF that can't be signed).
 */
export function isPdfSigned(bytes: Uint8Array): boolean {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  const hasByteRange = /\/ByteRange\s*\[/.test(s);
  const hasSig = /\/SubFilter\s*\/(adbe\.pkcs7|adbe\.x509|ETSI\.)/.test(s) || /\/Type\s*\/Sig\b/.test(s);
  return hasByteRange && hasSig;
}

export class PdfSigner {
  /**
   * Sign a PDF and return the signed bytes. The input is never mutated.
   *
   * @throws {SignError} with a {@link SignErrorCode} on any validation/crypto failure.
   */
  async sign(pdfBytes: Uint8Array, opts: SignOptions): Promise<SignResult> {
    validateSignOptionsShape(opts);

    // Cert-free checks first (already-signed + page + rect bounds). Doing these
    // before loadP12 means the UI can run the SAME preflight up front to gate
    // certificate generation (S-FLOW), and a standalone caller still fails fast on
    // a bad placement before paying for crypto.
    await this.preflight(pdfBytes, opts.page, opts.rect);

    const material = await loadP12(opts.p12, opts.passphrase);

    try {
      const pdfLib = await import('@cantoo/pdf-lib');
      const doc = await this._loadDocument(pdfLib, pdfBytes);
      const page = doc.getPage(opts.page);

      const signerName = (opts.name ?? '').trim() || material.commonName;
      const signDate = new Date();

      await this._drawAppearance(pdfLib, doc, page, opts, signerName, signDate);
      const sigFieldRef = this._buildSignatureDict(pdfLib, doc, page, opts, signerName, signDate);
      this._registerAcroFormField(pdfLib, doc, sigFieldRef);

      // Serialise WITHOUT object streams so /Contents stays a plain literal we can find.
      const draftBytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });

      const signedBytes = await this._spliceSignature(draftBytes, material);

      return { bytes: signedBytes, signerCommonName: material.commonName };
    } finally {
      // Clear the private-key digits from memory the moment signing finishes
      // (success OR failure), shrinking the secret's residency window.
      scrubP12Material(material);
    }
  }

  /**
   * Cert-free validation that a PDF CAN be signed at the requested placement:
   * not already signed (S3), page index in range, and appearance rect within the
   * target page's media box. Touches no certificate — callers run this BEFORE
   * generating/loading key material so a placement error never triggers an orphan
   * cert download (S-FLOW). {@link sign} reuses it so the standalone API stays safe.
   *
   * @throws {SignError} `ALREADY_SIGNED` | `INVALID_PAGE` | `INVALID_RECT` | `PDF_PARSE_FAILED`.
   */
  async preflight(pdfBytes: Uint8Array, page: number, rect: SignatureRect): Promise<void> {
    // Refuse re-signing an already-signed PDF up front (S3): pdf-lib does a FULL
    // re-save, not an incremental update, which corrupts an existing signature's
    // ByteRange and throws an opaque internal error. The trust model stays honest —
    // re-editing a signed PDF must invalidate it, never silently re-sign.
    if (isPdfSigned(pdfBytes)) {
      throw new SignError(
        'ALREADY_SIGNED',
        'This PDF is already signed. Re-signing would invalidate the existing signature — export an unsigned copy first.',
      );
    }

    const pdfLib = await import('@cantoo/pdf-lib');
    const doc = await this._loadDocument(pdfLib, pdfBytes);
    validatePageIndex(page, doc.getPageCount());
    const { width, height } = doc.getPage(page).getSize();
    validateRect(rect, { width, height });
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

  private async _drawAppearance(
    pdfLib: typeof import('@cantoo/pdf-lib'),
    doc: import('@cantoo/pdf-lib').PDFDocument,
    page: import('@cantoo/pdf-lib').PDFPage,
    opts: SignOptions,
    signerName: string | undefined,
    signDate: Date,
  ): Promise<void> {
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

    const padding = Math.min(4, rect.width * 0.05);

    // F-C: when a drawn-signature PNG is supplied, embed it in the TOP portion of
    // the rect (aspect-preserved, centred) and shrink the text area to the bottom.
    // A decode failure must never abort signing — fall back to text-only.
    let textTop = rect.y + rect.height; // top of the text band (default: whole rect)
    if (opts.appearanceImage && opts.appearanceImage.length) {
      try {
        const png = await doc.embedPng(opts.appearanceImage);
        const imgBandH = rect.height * 0.6;
        const availW = rect.width - padding * 2;
        const availH = imgBandH - padding;
        const scale = Math.min(availW / png.width, availH / png.height, 1);
        const drawW = png.width * scale;
        const drawH = png.height * scale;
        page.drawImage(png, {
          x: rect.x + (rect.width - drawW) / 2,
          y: rect.y + rect.height - padding - drawH,
          width: drawW,
          height: drawH,
        });
        textTop = rect.y + rect.height - imgBandH;
      } catch {
        // Corrupt/unsupported PNG → keep the text-only appearance.
        textTop = rect.y + rect.height;
      }
    }

    const textBandH = textTop - rect.y;
    const fontSize = Math.max(6, Math.min(11, textBandH / (lines.length + 1)));
    const lineGap = fontSize * 1.25;
    let cursorY = textTop - padding - fontSize;
    for (const line of lines) {
      if (cursorY < rect.y + padding) break;
      page.drawText(line, {
        x: rect.x + padding,
        y: cursorY,
        size: fontSize,
        color: pdfLib.rgb(0.1, 0.1, 0.1),
        maxWidth: rect.width - padding * 2,
      });
      cursorY -= lineGap;
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
