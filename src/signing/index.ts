/**
 * Public entry point for the client-side PDF e-signing core (Agent S).
 *
 * Usage (UI wiring lives in the app, NOT here):
 *
 *   import { PdfSigner } from './signing';
 *   const signer = new PdfSigner();
 *   const { bytes } = await signer.sign(pdfBytes, {
 *     p12, passphrase, page: 0,
 *     rect: { x: 72, y: 72, width: 220, height: 64 },
 *     reason: 'I approve this document', location: 'Paris, FR',
 *   });
 *
 * The heavy crypto dependency (node-forge) is dynamically imported inside the
 * core, so importing this module does NOT pull forge into the main bundle.
 */

export { PdfSigner, signPdf, isPdfSigned } from './pdfSigner';
export { SignError } from './types';
export type {
  SignOptions,
  SignResult,
  SignatureRect,
  SignErrorCode,
} from './types';
export {
  validateRect,
  validatePageIndex,
  validateSignOptionsShape,
  rectToPdfArray,
  buildAppearanceLines,
  formatPdfDate,
  type PageSize,
} from './appearance';
