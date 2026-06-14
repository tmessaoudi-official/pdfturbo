/**
 * Pure, DOM-free helpers for validating signing inputs and computing the
 * visible signature appearance geometry. No crypto, no pdf-lib — these are the
 * functions that CAN be exercised fully in jsdom.
 */

import { SignError, type SignOptions, type SignatureRect } from './types';

/** A page's media box dimensions in points. */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * Validate a {@link SignatureRect} against a page size.
 *
 * Rules: width/height must be finite and > 0; the rectangle must lie fully
 * within the page media box (with a small epsilon tolerance for float noise).
 *
 * @throws {SignError} code `INVALID_RECT` on any violation.
 */
export function validateRect(rect: SignatureRect, page: PageSize): void {
  const eps = 0.01;
  const finite = (n: number): boolean => typeof n === 'number' && Number.isFinite(n);

  if (!finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) {
    throw new SignError('INVALID_RECT', 'Signature rectangle has non-finite coordinates.');
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new SignError('INVALID_RECT', 'Signature rectangle width and height must be positive.');
  }
  if (rect.x < -eps || rect.y < -eps) {
    throw new SignError('INVALID_RECT', 'Signature rectangle starts off the page (negative origin).');
  }
  if (rect.x + rect.width > page.width + eps || rect.y + rect.height > page.height + eps) {
    throw new SignError(
      'INVALID_RECT',
      `Signature rectangle (${rect.x},${rect.y} ${rect.width}x${rect.height}) exceeds page ` +
        `bounds (${page.width}x${page.height}).`,
    );
  }
}

/**
 * Convert a {@link SignatureRect} (x, y, width, height) to the PDF `/Rect`
 * array form `[llx, lly, urx, ury]` used by annotation dictionaries.
 */
export function rectToPdfArray(rect: SignatureRect): [number, number, number, number] {
  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}

/**
 * Build the multi-line appearance text shown inside the visible signature box.
 * Empty/whitespace-only fields are dropped. Returns at least the signer line.
 */
export function buildAppearanceLines(opts: {
  name?: string;
  reason?: string;
  location?: string;
  date?: Date;
}): string[] {
  const lines: string[] = [];
  const name = (opts.name ?? '').trim();
  lines.push(name ? `Signed by: ${name}` : 'Digitally signed');

  const reason = (opts.reason ?? '').trim();
  if (reason) lines.push(`Reason: ${reason}`);

  const location = (opts.location ?? '').trim();
  if (location) lines.push(`Location: ${location}`);

  const date = opts.date ?? new Date();
  lines.push(`Date: ${formatSignDate(date)}`);

  return lines;
}

/**
 * Format a date as a PDF date string `D:YYYYMMDDHHmmSS±HH'mm'` (ISO 32000 §7.9.4).
 * Used for the signature dictionary `/M` entry.
 */
export function formatPdfDate(date: Date): string {
  const pad = (n: number, w = 2): string => String(Math.abs(n)).padStart(w, '0');
  const y = pad(date.getFullYear(), 4);
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());

  const offMin = -date.getTimezoneOffset(); // minutes east of UTC
  const sign = offMin >= 0 ? '+' : '-';
  const offH = pad(Math.trunc(Math.abs(offMin) / 60));
  const offM = pad(Math.abs(offMin) % 60);

  return `D:${y}${mo}${d}${h}${mi}${s}${sign}${offH}'${offM}'`;
}

/** Human-readable date for the visible appearance box. */
export function formatSignDate(date: Date): string {
  const iso = date.toISOString().replace('T', ' ').slice(0, 19);
  return `${iso} UTC`;
}

/**
 * Validate the page index against a page count.
 * @throws {SignError} code `INVALID_PAGE` if out of range.
 */
export function validatePageIndex(page: number, pageCount: number): void {
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
    throw new SignError(
      'INVALID_PAGE',
      `Page index ${page} is out of range (document has ${pageCount} page(s)).`,
    );
  }
}

/**
 * Validate the high-level {@link SignOptions} that can be checked without
 * touching the PDF or the certificate (cheap pre-flight). Page/rect bounds that
 * depend on the document are validated later by {@link validatePageIndex} /
 * {@link validateRect}.
 *
 * @throws {SignError} on any structurally-invalid option.
 */
export function validateSignOptionsShape(opts: SignOptions): void {
  if (!(opts.p12 instanceof Uint8Array) || opts.p12.byteLength === 0) {
    throw new SignError('INVALID_P12', 'A non-empty PKCS#12 (.p12) byte array is required.');
  }
  if (typeof opts.passphrase !== 'string') {
    throw new SignError('WRONG_PASSPHRASE', 'Passphrase must be a string (use "" for none).');
  }
  if (!Number.isInteger(opts.page) || opts.page < 0) {
    throw new SignError('INVALID_PAGE', 'Page index must be a non-negative integer.');
  }
  if (!opts.rect || typeof opts.rect !== 'object') {
    throw new SignError('INVALID_RECT', 'A signature appearance rectangle is required.');
  }
}
