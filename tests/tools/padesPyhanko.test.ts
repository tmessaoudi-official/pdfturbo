/**
 * Limits row 24 — an INDEPENDENT validator over PdfSigner's output, both profiles: pyHanko (coverage, integrity, the
 * ESS signing-certificate check) and `openssl cms -verify -cades` (which rejects a CMS whose ESS attribute is missing
 * or names another certificate).
 *
 * Inert unless PYHANKO_PYTHON points at a Python with pyHanko installed (not in CI, like the C9 corpus test):
 *   python3 -m venv /tmp/v && /tmp/v/bin/pip install pyhanko pyhanko-certvalidator
 *   PYHANKO_PYTHON=/tmp/v/bin/python npx vitest run tests/tools/padesPyhanko.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfSigner } from '../../src/signing/pdfSigner';
import { generateSelfSignedP12 } from '../../src/signing/certGen';

const PY = process.env.PYHANKO_PYTHON;

const VALIDATE = `
import json, sys
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pyhanko.keys import load_cert_from_pemder
cert = load_cert_from_pemder(sys.argv[1])
out = {}
for f in sys.argv[2:]:
    with open(f, 'rb') as fh:
        s = PdfFileReader(fh).embedded_signatures[0]
        st = validate_pdf_signature(s, ValidationContext(trust_roots=[cert], allow_fetching=False))
        out[f] = {'intact': st.intact, 'valid': st.valid, 'coverage': st.coverage.name, 'bottomLine': st.bottom_line}
print(json.dumps(out))
`;

/** The CMS DER and the covered span, cut out by the file's own ByteRange. */
function cut(bytes: Uint8Array): { der: Uint8Array; span: Uint8Array } {
  const s = new TextDecoder('latin1').decode(bytes);
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s);
  if (!m) throw new Error('no ByteRange');
  const [a, l1, c, l2] = m.slice(1).map(Number);
  const hex = s.slice(a + l1 + 1, c - 1);
  const raw = Uint8Array.from(hex.match(/../g) ?? [], h => parseInt(h, 16));
  // Drop the zero padding: the DER length of the outer SEQUENCE says where the CMS ends.
  const n = raw[1] & 0x80 ? raw[1] & 0x7f : 0;
  const len = n ? raw.slice(2, 2 + n).reduce((acc, b) => acc * 256 + b, 0) : raw[1];
  const span = new Uint8Array(l1 + l2);
  span.set(bytes.subarray(a, a + l1));
  span.set(bytes.subarray(c, c + l2), l1);
  return { der: raw.slice(0, 2 + n + len), span };
}

describe.skipIf(!PY)('PdfSigner output under pyHanko and openssl -cades', () => {
  it('both profiles cover the whole file and verify; only PAdES carries the ESS attribute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pades-'));
    const g = await generateSelfSignedP12({ commonName: 'Validator Probe', country: 'FR' }, 'pw');
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const pdf = await doc.save({ useObjectStreams: false });
    writeFileSync(join(dir, 'cert.pem'), g.pem);
    const files: Record<string, string> = {};
    for (const profile of ['pkcs7', 'pades'] as const) {
      const { bytes } = await new PdfSigner().sign(pdf, {
        p12: g.p12, passphrase: 'pw', page: 0, rect: { x: 20, y: 20, width: 160, height: 50 }, profile,
      });
      files[profile] = join(dir, `${profile}.pdf`);
      writeFileSync(files[profile], bytes);
      const { der, span } = cut(bytes);
      writeFileSync(join(dir, `${profile}.der`), der);
      writeFileSync(join(dir, `${profile}.span`), span);
    }

    const report = JSON.parse(execFileSync(PY as string, ['-c', VALIDATE, join(dir, 'cert.pem'), files.pkcs7, files.pades]).toString());
    for (const f of [files.pkcs7, files.pades]) {
      expect(report[f]).toEqual({ intact: true, valid: true, coverage: 'ENTIRE_FILE', bottomLine: true });
    }

    const cades = (profile: string) => {
      try {
        execFileSync('openssl', ['cms', '-verify', '-cades', '-CAfile', join(dir, 'cert.pem'), '-binary', '-inform', 'DER',
          '-in', join(dir, `${profile}.der`), '-content', join(dir, `${profile}.span`), '-out', '/dev/null'], { stdio: 'pipe' });
        return 'ok';
      } catch (e) {
        return String((e as { stderr?: Buffer }).stderr);
      }
    };
    expect(cades('pades')).toBe('ok');
    expect(cades('pkcs7')).toContain('missing signing certificate attribute'); // proves -cades checks ESS at all
  }, 120_000);
});
