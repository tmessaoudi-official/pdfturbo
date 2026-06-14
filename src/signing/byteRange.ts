/**
 * Pure ByteRange / placeholder utilities for PDF signing. No DOM, no crypto,
 * no pdf-lib — fully unit-testable in jsdom.
 *
 * A signed PDF reserves a fixed-width hex slot for the signature inside the
 * signature dictionary's `/Contents <...>` entry. After the PDF is serialised we
 * must:
 *   1. locate that `/Contents <0000…0000>` hex slot in the saved bytes,
 *   2. compute a `/ByteRange [0 a b c]` that spans the whole file EXCEPT the hex
 *      payload (but INCLUDING the surrounding `<` and `>`),
 *   3. overwrite the `/ByteRange [...]` placeholder with the real numbers
 *      (without changing its byte length), and
 *   4. splice the real signature hex into the slot (same length).
 */

const ASCII_LT = 0x3c; // '<'
const ASCII_GT = 0x3e; // '>'

/** Result of locating the `/Contents` hex slot in serialised PDF bytes. */
export interface ContentsSlot {
  /** Index of the opening `<`. */
  open: number;
  /** Index of the closing `>`. */
  close: number;
  /** Number of hex characters between `<` and `>` (= 2 × signature byte capacity). */
  hexLength: number;
}

/** Find the byte index of an ASCII needle in a byte array, or -1. */
export function indexOfAscii(haystack: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  if (n === 0) return from;
  const last = haystack.length - n;
  for (let i = from; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

const ASCII_WS = new Set([0x20, 0x0a, 0x0d, 0x09, 0x00]);

/**
 * Locate the signature `/Contents <...>` hex slot in serialised PDF bytes.
 *
 * IMPORTANT: a page object ALSO has a `/Contents` key (its content stream, e.g.
 * `/Contents [ 6 0 R ]` or `/Contents 6 0 R`) and it is serialised BEFORE the
 * signature dictionary. We therefore scan EVERY `/Contents` token and accept
 * only the one whose value is a hex string (whitespace then `<`); other forms
 * (indirect ref `N G R`, array `[...]`) are skipped, not treated as errors.
 *
 * @throws {Error} if no `/Contents <...>` hex slot is found at all.
 */
export function findContentsSlot(bytes: Uint8Array): ContentsSlot {
  const key = '/Contents';
  let searchFrom = 0;
  let sawAnyToken = false;

  for (;;) {
    const tokenAt = indexOfAscii(bytes, key, searchFrom);
    if (tokenAt < 0) break;
    sawAnyToken = true;
    searchFrom = tokenAt + key.length;

    // Skip whitespace after the key; the NEXT non-whitespace byte decides the form.
    let i = tokenAt + key.length;
    while (i < bytes.length && ASCII_WS.has(bytes[i])) i++;

    // Only a hex-string value (`<...>`) is the signature slot. Anything else
    // (ref digit, array `[`) belongs to a page content stream — skip it.
    if (i >= bytes.length || bytes[i] !== ASCII_LT) continue;

    const open = i;
    let close = -1;
    for (let k = open + 1; k < bytes.length; k++) {
      if (bytes[k] === ASCII_GT) {
        close = k;
        break;
      }
    }
    if (close < 0) continue; // unterminated; keep scanning for a valid slot

    return { open, close, hexLength: close - open - 1 };
  }

  if (!sawAnyToken) throw new Error('No /Contents entry found in serialised PDF.');
  throw new Error('No /Contents <...> hex signature slot found in serialised PDF.');
}

/**
 * Compute the `/ByteRange [start1 len1 start2 len2]` for a Contents slot: the
 * file is covered everywhere EXCEPT the hex payload between `<` and `>`. The
 * angle brackets themselves are part of the covered range.
 *
 * @returns a 4-tuple `[0, open+1, close, total-close]`
 */
export function computeByteRange(slot: ContentsSlot, totalLength: number): [number, number, number, number] {
  const start1 = 0;
  const len1 = slot.open + 1; // include the '<'
  const start2 = slot.close; // include the '>'
  const len2 = totalLength - slot.close;
  return [start1, len1, start2, len2];
}

/** The sentinel value placed in each of the 4 ByteRange slots at build time. */
export const BYTE_RANGE_SENTINEL = 9999999999; // 10 digits → files up to ~9.9 GB

/**
 * Locate the serialised `/ByteRange [ … ]` token in PDF bytes.
 *
 * pdf-lib (and the PDF spec) serialise an array as `/ByteRange [ a b c d ]`
 * with a space after `[` and before `]`. We match from `/ByteRange` through the
 * first `]` and return the inclusive byte span so it can be overwritten in place.
 *
 * @returns `{ start, end }` byte offsets (end is the index AFTER the `]`).
 * @throws {Error} if not found.
 */
export function findByteRangeToken(bytes: Uint8Array): { start: number; end: number } {
  const key = '/ByteRange';
  const start = indexOfAscii(bytes, key);
  if (start < 0) throw new Error('No /ByteRange entry found in serialised PDF.');
  // Find the closing ']' after the key.
  for (let k = start + key.length; k < bytes.length; k++) {
    if (bytes[k] === 0x5d /* ']' */) return { start, end: k + 1 };
    // Guard: a digit/space/'[' is expected; anything wildly off means malformed.
  }
  throw new Error('Malformed /ByteRange entry (no closing "]").');
}

/**
 * Render the real `/ByteRange [ a b c d ]` string padded with trailing spaces to
 * EXACTLY `targetLen` bytes so it overwrites the build-time token without
 * changing file length. The sentinel token (four 10-digit values) is the widest
 * the real values can be, so the real string is always ≤ the reserved span.
 *
 * @throws {Error} if the real string cannot fit in `targetLen`.
 */
export function byteRangeReplacement(range: [number, number, number, number], targetLen: number): string {
  const out = `/ByteRange [ ${range[0]} ${range[1]} ${range[2]} ${range[3]} ]`;
  if (out.length > targetLen) {
    throw new Error(`Real /ByteRange (${out.length}B) longer than reserved span (${targetLen}B).`);
  }
  return out + ' '.repeat(targetLen - out.length);
}

/**
 * Concatenate the two covered spans of a signed PDF (everything except the hex
 * payload) — the exact bytes that must be hashed/signed.
 */
export function collectSignedBytes(bytes: Uint8Array, range: [number, number, number, number]): Uint8Array {
  const [s1, l1, s2, l2] = range;
  const out = new Uint8Array(l1 + l2);
  out.set(bytes.subarray(s1, s1 + l1), 0);
  out.set(bytes.subarray(s2, s2 + l2), l1);
  return out;
}

/**
 * Convert signature bytes to an uppercase hex string padded with '0' to a fixed
 * capacity (the reserved hex slot width).
 *
 * @throws {Error} if the signature is too large for the reserved slot.
 */
export function signatureToPaddedHex(sig: Uint8Array, hexCapacity: number): string {
  let hex = '';
  for (const b of sig) hex += b.toString(16).padStart(2, '0');
  if (hex.length > hexCapacity) {
    throw new Error(
      `Signature (${hex.length} hex chars) exceeds reserved slot (${hexCapacity}); increase capacity.`,
    );
  }
  return hex + '0'.repeat(hexCapacity - hex.length);
}
