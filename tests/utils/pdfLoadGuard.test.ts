/**
 * pdf-lib 2.11.0 DROPS an indirect object it cannot parse when no `endobj` follows it before EOF
 * (`PDFParser.tryToParseInvalidIndirectObject`: "Drop it instead of failing the whole parse").
 * 2.8.1 threw `Failed to parse invalid PDF object` on the same bytes. So the upgrade turned a loud
 * load failure into a silent one: pdf.js still renders the page, and every export built from the
 * pdf-lib copy comes out without the dropped object — measured, a page whose content stream was
 * the unterminated object exported as an EMPTY page while pdf.js read "KEEPME" from the source.
 *
 * `loadPdfDocument` restores the loud failure for exactly that shape and nothing wider: a reference
 * the document actually USES, that resolves to nothing, whose `N G obj` header IS in the bytes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfLib from '@cantoo/pdf-lib';
import { loadPdfDocument, PdfObjectDroppedError } from '../../src/utils/pdfLoadGuard';
import { buildContentStreamPdf as build } from './_invalidObjectFixture';

describe('loadPdfDocument', () => {
  it('REFUSES a document whose used object pdf-lib silently dropped, naming the object', async () => {
    const bytes = build({ brokenLast: true });
    // Non-vacuity: the raw pdf-lib load really does succeed on these bytes (the silent drop).
    const raw = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
    expect(raw.context.lookup(pdfLib.PDFRef.of(5))).toBeUndefined();

    const err = await loadPdfDocument(bytes, { updateMetadata: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['5 0 R']);
  });

  it('REFUSES with DEFAULT options too — the shape every export source load uses', async () => {
    // pdf-lib's default `updateMetadata: true` registers a new /Info dict under the next free object
    // number, which after a drop IS the dropped number: /Contents 5 0 R then resolves to the Info dict
    // and nothing dangles. Measured before this case existed — the export wrote an empty page and
    // this guard, checking after the stamp, saw a clean document.
    const raw = await pdfLib.PDFDocument.load(build({ brokenLast: true }));
    expect(raw.context.lookup(pdfLib.PDFRef.of(5))).toBeInstanceOf(pdfLib.PDFDict); // the hijack

    const err = await loadPdfDocument(build({ brokenLast: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['5 0 R']);
  });

  it('still applies pdf-lib\'s load-time metadata stamp by default on a clean document', async () => {
    const doc = await loadPdfDocument(build());
    expect(doc.getProducer()).toContain('pdf-lib');
    expect(doc.getModificationDate()).toBeInstanceOf(Date);
  });

  it('loads the same document when the object is intact (control)', async () => {
    const doc = await loadPdfDocument(build(), { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads a damaged but TERMINATED object — pdf-lib keeps it, so nothing was dropped', async () => {
    const doc = await loadPdfDocument(build({ brokenTerminated: true }), { updateMetadata: false });
    expect(doc.context.lookup(pdfLib.PDFRef.of(5))).toBeInstanceOf(pdfLib.PDFInvalidObject);
  });

  it('loads a document with a dangling reference that has no object header (a legal null)', async () => {
    const doc = await loadPdfDocument(build({ danglingInfo: true }), { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('passes load options through (ignoreEncryption / updateMetadata)', async () => {
    const src = await pdfLib.PDFDocument.create();
    src.addPage([100, 100]);
    const bytes = await src.save({ useObjectStreams: false });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false, ignoreEncryption: true });
    expect(doc.getProducer()).toBe(src.getProducer());
  });
});

describe('every pdf-lib load in src/ goes through the guard', () => {
  // A per-site check is how a sibling path keeps the defect the others fixed. Only the guard itself
  // may call PDFDocument.load directly; a new load site that bypasses it fails here by name.
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  it('has no direct PDFDocument.load outside src/utils/pdfLoadGuard.ts', () => {
    const offenders = walk('src')
      .filter(p => !p.endsWith(join('utils', 'pdfLoadGuard.ts')))
      .filter(p => /PDFDocument\s*\.\s*load\s*\(/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the scan is not vacuous: it sees the guard file itself', () => {
    expect(/PDFDocument\s*\.\s*load\s*\(/.test(readFileSync('src/utils/pdfLoadGuard.ts', 'utf8'))).toBe(true);
  });
});
