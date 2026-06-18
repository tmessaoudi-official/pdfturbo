/**
 * Public types for the client-side PDF e-signing core (Agent S).
 *
 * Everything here is DOM-free and crypto-library-agnostic so the core can be
 * unit-tested in jsdom and wired into the app UI without leaking node-forge or
 * pdf-lib types across the boundary.
 */

/** A signature appearance rectangle, in PDF user-space points, origin bottom-left. */
export interface SignatureRect {
  /** Distance from the left edge of the page, in points. */
  x: number;
  /** Distance from the bottom edge of the page, in points. */
  y: number;
  /** Width of the appearance box, in points. Must be > 0. */
  width: number;
  /** Height of the appearance box, in points. Must be > 0. */
  height: number;
}

/** Options for producing a signed PDF. The .p12 bytes + passphrase never leave the browser. */
export interface SignOptions {
  /** Raw PKCS#12 (.p12 / .pfx) container bytes. */
  p12: Uint8Array;
  /** Passphrase protecting the PKCS#12 container. May be '' for an unprotected container. */
  passphrase: string;
  /** Zero-based page index on which to draw the visible signature. */
  page: number;
  /** Visible signature appearance rectangle (points, bottom-left origin). */
  rect: SignatureRect;
  /** Optional reason string (e.g. "I approve this document"). */
  reason?: string;
  /** Optional location string (e.g. "Paris, FR"). */
  location?: string;
  /** Optional signer common name shown in the appearance; defaults to the cert subject CN. */
  name?: string;
  /** Optional contact info string embedded in the signature dictionary. */
  contactInfo?: string;
  /**
   * Optional PNG bytes of a drawn signature image (F-C). When present it is
   * embedded into the appearance rect (image on top, the name/date text below);
   * absent → the existing text-only appearance.
   */
  appearanceImage?: Uint8Array;
}

/** Result of a successful signing operation. */
export interface SignResult {
  /** The signed PDF bytes (a new byte array; the input is not mutated). */
  bytes: Uint8Array;
  /** The common name (CN) resolved from the signing certificate, if present. */
  signerCommonName?: string;
}

/** Machine-readable failure categories so the UI can show targeted messages. */
export type SignErrorCode =
  | 'INVALID_P12' // container could not be parsed at all
  | 'WRONG_PASSPHRASE' // container parsed but MAC/passphrase check failed
  | 'NO_PRIVATE_KEY' // no private key found in the container
  | 'NO_CERTIFICATE' // no signing certificate found in the container
  | 'INVALID_PAGE' // page index out of range
  | 'INVALID_RECT' // appearance rectangle is degenerate / off-page
  | 'PDF_PARSE_FAILED' // the input PDF could not be loaded
  | 'PLACEHOLDER_NOT_FOUND' // internal: signature placeholder lost after save
  | 'ALREADY_SIGNED' // the input PDF already carries a signature (re-signing refused)
  | 'SIGN_FAILED'; // CMS/PKCS#7 production failed

/** Typed error carrying a {@link SignErrorCode} for UI branching. */
export class SignError extends Error {
  readonly code: SignErrorCode;

  constructor(code: SignErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SignError';
    this.code = code;
  }
}
