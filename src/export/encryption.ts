/**
 * PDF export encryption ("Lock PDF") — CORE-P0-2.
 *
 * @cantoo/pdf-lib selects the encryption revision purely from the document's
 * header version string (PDFSecurity.initialize switch): header "1.7" → V4/AESV2
 * (128-bit); header "1.7ext3" → V5/R5/AESV3 (256-bit). There is no `algorithm`
 * option — the header is the lever. We therefore bump the header to 1.7ext3 so a
 * locked PDF gets modern AES-256 instead of the silent AES-128 default.
 *
 * Revision note: since @cantoo/pdf-lib 2.11.0 the V5 handler writes /R 6 — AES-256 with
 * the PDF-2.0 iterated key derivation (Algorithm 2.B), `PDFSecurity.js` "revision 6". Until
 * the 2026-09-13 upgrade this comment said the library hardcoded /R 5 with no R6 path; that
 * was true of 2.8.1 and stopped being true with the bump. Re-check `/R` in a locked export
 * after any pdf-lib upgrade rather than trusting this sentence.
 *
 * We also pass an EXPLICIT permissions object. Omitting `permissions` makes the
 * library clear every allow-bit (`0xfffff0c0`), producing a doc that denies
 * printing/copying/accessibility even to a legitimate reader — a confidentiality
 * lock should protect OPENING, not cripple usage. FULL_PERMISSIONS grants all.
 */
import type { PDFDocument } from '@cantoo/pdf-lib';

export interface EncryptionPasswords {
  /** Restricts the reader to FULL_PERMISSIONS on open. */
  userPassword: string;
  /** Grants unlimited (owner) access; MUST differ from userPassword to be meaningful. */
  ownerPassword: string;
}

/**
 * Usage permissions for a confidentiality-only lock: everything allowed. The
 * password gates document OPENING, not what a legitimate reader may then do.
 */
export const FULL_PERMISSIONS = {
  printing: 'highResolution',
  modifying: true,
  copying: true,
  annotating: true,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: true,
} as const;

/**
 * Encrypt a pdf-lib document in place with AES-256 and full usage permissions.
 * Async because PDFHeader is dynamically imported (keeps pdf-lib lazy).
 */
export async function encryptPdf(pdfDoc: PDFDocument, pw: EncryptionPasswords): Promise<void> {
  const { PDFHeader } = await import('@cantoo/pdf-lib');
  // forVersion stringifies its args, so minor '7ext3' yields getVersionString()
  // === '1.7ext3' → V5/AESV3. The signature types minor as number; the runtime
  // accepts the string, hence the cast.
  pdfDoc.context.header = PDFHeader.forVersion(1, '7ext3' as unknown as number);
  pdfDoc.encrypt({
    userPassword: pw.userPassword,
    ownerPassword: pw.ownerPassword,
    permissions: { ...FULL_PERMISSIONS },
  });
}

/** Minimum open-password length for Lock PDF. NIST SP 800-63B floor for user-chosen secrets. */
export const MIN_PASSWORD_LENGTH = 8;

/** Returns an i18n toast key when the open password is unacceptable, else null. */
export function validateUserPassword(pw: string): 'toast.passwordRequired' | 'toast.passwordTooWeak' | null {
  if (!pw) return 'toast.passwordRequired';
  if (pw.length < MIN_PASSWORD_LENGTH) return 'toast.passwordTooWeak';
  return null;
}

/**
 * Generate a strong random owner password (used when the user supplies only a
 * user/open password). A distinct, unknown owner password makes the permission
 * flags actually enforceable — owner==user is security theater because anyone
 * with the open password could otherwise assume owner rights. Browser crypto.
 */
export function randomOwnerPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
