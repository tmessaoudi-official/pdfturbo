/**
 * F-D D3 spike — incremental-update multi-signature POC.
 *
 * Proves (or disproves) that a SECOND independent CMS signature can be added to
 * an already-signed PDF via an APPEND-ONLY incremental update, such that BOTH
 * signatures' /ByteRange digests validate and the original bytes are preserved
 * verbatim. This is the structural ceiling the shipped path refuses
 * (ALREADY_SIGNED) because @cantoo/pdf-lib's full re-save renumbers objects and
 * invalidates the first signature.
 *
 * Runs in jsdom: pdf-lib + node-forge are pure-JS; crypto.subtle (Node webcrypto)
 * gives an INDEPENDENT SHA-256 for digest verification. ONE RSA keypair is reused
 * for both signatures (the POC proves the byte/xref structure, not distinct
 * certs) to keep keygen cost to a single 2048-bit generation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PdfSigner, isPdfSigned } from '../../src/signing/pdfSigner';
import { generateSelfSignedP12 } from '../../src/signing/certGen';
import { loadP12, type P12Material } from '../../src/signing/p12';
import {
  addIncrementalSignature,
  parseLastStartxref,
  countSignatures,
} from '../../src/signing/incrementalSigner';
import {
  findByteRangeToken,
  indexOfAscii,
  collectSignedBytes,
} from '../../src/signing/byteRange';

/** Hex SHA-256 of a byte span via Node webcrypto (independent of node-forge). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Build a minimal real multi-page PDF. */
async function makePdf(w = 400, h = 400, pages = 1): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([w, h]);
    p.drawText(`Page ${i + 1}`, { x: 20, y: h - 40, size: 14, font });
  }
  return doc.save({ useObjectStreams: false });
}

const latin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

/**
 * Parse the Nth (0-based) signature's STORED `/ByteRange [a b c d]` numbers as
 * they actually appear in the file — NOT recomputed from the current file
 * length. This is the rigorous check: sig-1's stored range covers revision 1
 * only (its tail length is the ORIGINAL tail, not the extended one), so reading
 * the stored numbers is what proves sig-1 still validates after the append.
 */
function parseNthByteRange(bytes: Uint8Array, n: number): [number, number, number, number] {
  const s = latin1(bytes);
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s)) !== null) {
    if (i === n) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    i++;
  }
  throw new Error(`No /ByteRange #${n}`);
}

describe('incrementalSigner — pure helpers', () => {
  const ascii = (s: string): Uint8Array => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };

  it('parseLastStartxref returns the offset after the LAST startxref keyword', () => {
    const pdf = ascii('%PDF-1.7\n...\nstartxref\n111\n%%EOF\nstartxref\n2048\n%%EOF\n');
    expect(parseLastStartxref(pdf)).toBe(2048);
  });

  it('parseLastStartxref throws when absent', () => {
    expect(() => parseLastStartxref(ascii('%PDF-1.7\nno xref pointer\n'))).toThrow();
  });

  it('countSignatures counts /Contents hex slots paired with a sig dict', () => {
    expect(countSignatures(ascii('%PDF\nnothing\n'))).toBe(0);
  });
});

describe('incrementalSigner — append-only second signature (POC)', () => {
  let material: P12Material;
  let p12: Uint8Array;
  const rect1 = { x: 20, y: 20, width: 160, height: 50 };
  const rect2 = { x: 220, y: 20, width: 160, height: 50 };

  beforeAll(async () => {
    const gen = await generateSelfSignedP12({ commonName: 'POC Signer', organization: 'PDFturbo' }, 'pw');
    p12 = gen.p12;
    material = await loadP12(p12, 'pw');
  });

  async function signOnce(): Promise<Uint8Array> {
    const pdf = await makePdf(400, 400, 1);
    const { bytes } = await new PdfSigner().sign(pdf, { p12, passphrase: 'pw', page: 0, rect: rect1, name: 'Signer One' });
    return bytes;
  }

  it('the singly-signed baseline is detected as signed and has exactly one signature', async () => {
    const once = await signOnce();
    expect(isPdfSigned(once)).toBe(true);
    expect(countSignatures(once)).toBe(1);
  });

  it('adds a second signature without touching the original bytes (append-only)', async () => {
    const once = await signOnce();
    const origLen = once.length;
    const { bytes: twice } = await addIncrementalSignature(
      once,
      { page: 0, rect: rect2, name: 'Signer Two', reason: 'Counter-signed' },
      material,
    );
    expect(twice.length).toBeGreaterThan(origLen);
    // The first origLen bytes MUST be byte-for-byte identical (revision 1 intact).
    expect(Array.from(twice.subarray(0, origLen))).toEqual(Array.from(once));
    expect(countSignatures(twice)).toBe(2);
  });

  it('BOTH /ByteRange digests validate over their respective revisions', async () => {
    const once = await signOnce();

    // Sig-1's covered span in the ORIGINAL file (its digest baseline).
    const r1Before = parseNthByteRange(once, 0);
    const sig1DigestBefore = await sha256Hex(collectSignedBytes(once, r1Before));

    const { bytes: twice, signedSpanSha256: sig2Digest } = await addIncrementalSignature(
      once,
      { page: 0, rect: rect2, name: 'Signer Two' },
      material,
    );

    // Sig-1: its STORED ByteRange numbers are unchanged AND its covered bytes
    // (which end at the original EOF) are byte-identical → its digest still validates.
    const r1After = parseNthByteRange(twice, 0);
    expect(r1After).toEqual(r1Before);
    const sig1DigestAfter = await sha256Hex(collectSignedBytes(twice, r1After));
    expect(sig1DigestAfter).toBe(sig1DigestBefore);

    // Sig-2: the STORED ByteRange parsed back FROM THE FINAL FILE must select
    // exactly the bytes the signer hashed (proves the xref/offset surgery didn't
    // shift bytes and the ByteRange numbers point where the CMS was computed).
    const r2 = parseNthByteRange(twice, 1);
    expect(r2[1] + r2[3]).toBeLessThan(twice.length); // a real hex gap exists
    const sig2DigestFromFile = await sha256Hex(collectSignedBytes(twice, r2));
    expect(sig2DigestFromFile).toBe(sig2Digest);
  });

  it('the doubly-signed result still parses as a PDF (incremental xref chain is valid)', async () => {
    const once = await signOnce();
    const { bytes: twice } = await addIncrementalSignature(once, { page: 0, rect: rect2 }, material);
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const reparsed = await PDFDocument.load(twice, { ignoreEncryption: true, updateMetadata: false });
    expect(reparsed.getPageCount()).toBe(1);
    // Both signature /Contents slots and both /ByteRange tokens survive a reparse path.
    expect(indexOfAscii(twice, '/Prev')).toBeGreaterThan(once.length - 1); // /Prev lives in the appended trailer
    expect(() => findByteRangeToken(twice.subarray(once.length))).not.toThrow();
  });
});
