/**
 * SigningHandler end-to-end (real Chrome): assemble bytes → PKCS#12 detached
 * CMS via forge (dynamically imported) → Blob download. jsdom covers the crypto
 * (pdfSigner.integration.test.ts); this asserts the handler path works in a real
 * bundled browser — the forge lazy-chunk loads, the download fires, the produced
 * bytes are a signed PDF, and the .p12 material is scrubbed afterwards.
 */
import { describe, it, expect } from 'vitest';
import { SigningHandler, type SignFormInput } from '../../src/handlers/signingHandler';

/** Generate a self-signed PKCS#12 container at runtime (no fixtures, no secrets). */
async function makeP12(passphrase: string): Promise<Uint8Array> {
  const forge = (await import('node-forge')).default;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3.15e10);
  const attrs = [{ name: 'commonName', value: 'Browser Test Signer' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  const der = forge.asn1.toDer(asn1).getBytes();
  const out = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
  return out;
}

async function makeAssembledBytes(): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]);
  return doc.save({ useObjectStreams: false });
}

function makeFakeApp(bytes: Uint8Array) {
  return {
    currentFilename: 'my-report.pdf',
    assemblePdfBytes: () => Promise.resolve(bytes),
  };
}

describe('SigningHandler.sign (real Chrome)', () => {
  it('signs the assembled document and downloads a signed PDF', async () => {
    const assembled = await makeAssembledBytes();
    const p12 = await makeP12('pw');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = new SigningHandler(makeFakeApp(assembled) as any);

    // Capture the download instead of navigating.
    let downloadedName = '';
    let downloadedBlob: Blob | null = null;
    const realCreate = document.createElement.bind(document);
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    };
    const realCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      downloadedBlob = obj as Blob;
      return realCreateObjectURL(obj);
    };

    const form: SignFormInput = {
      p12,
      passphrase: 'pw',
      page: 1, // 1-based UI → page 0
      x: 72,
      y: 72,
      width: 220,
      height: 64,
      reason: 'I approve',
    };

    try {
      const cn = await handler.sign(form);
      expect(cn).toBe('Browser Test Signer');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      URL.createObjectURL = realCreateObjectURL;
      void realCreate;
    }

    expect(downloadedName).toBe('my-report-signed.pdf');
    expect(downloadedBlob).not.toBeNull();
    const buf = new Uint8Array(await (downloadedBlob as unknown as Blob).arrayBuffer());
    let head = '';
    for (let i = 0; i < 4; i++) head += String.fromCharCode(buf[i]);
    expect(head).toBe('%PDF');
    let body = '';
    for (const b of buf) body += String.fromCharCode(b);
    expect(body).toContain('/Type /Sig');
    expect(body).toContain('/SubFilter /adbe.pkcs7.detached');

    // The .p12 bytes must be scrubbed (zeroed) after signing.
    expect(p12.every((b) => b === 0)).toBe(true);
    // 60s: node-forge RSA-2048 keygen + CMS is CPU-bound and flakes past the default 30s under
    // full-suite contention (passes in isolation; mirrors the jsdom node-forge timeout bump).
  }, 60_000);
});
