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

  // WS7 round 11, export lens P3: the header was matched ANYWHERE in the file, so a page that merely
  // SHOWS the text "9 0 obj" made a harmless dangling /Info 9 0 R look like a dropped object, and a
  // legal file was refused. A header counts only at a token boundary and outside every stream body.
  it('loads a legal dangling reference whose "N G obj" text is only page content (round-11 repro)', async () => {
    const bytes = build({ danglingInfo: true, content: 'BT /F1 24 Tf 20 200 Td (9 0 obj)Tj ET' });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads it too when the text is whitespace-delimited inside the stream — the body is not scanned', async () => {
    const bytes = build({ danglingInfo: true, content: 'BT /F1 24 Tf 20 200 Td ( 9 0 obj ) Tj ET' });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads it when the text sits in a string OUTSIDE any stream — a header needs whitespace before it', async () => {
    const bytes = build({ danglingInfo: true, catalogString: '9 0 obj' });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('still REFUSES a dropped object whose header directly follows another object\'s stream', async () => {
    const bytes = build({ brokenAfterStream: true });
    // Non-vacuity: pdf-lib really dropped object 6, so this case is about the scan finding its header.
    const raw = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
    expect(raw.context.lookup(pdfLib.PDFRef.of(6))).toBeUndefined();

    const err = await loadPdfDocument(bytes, { updateMetadata: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['6 0 R']);
  });

  // WS7 round 11, export lens P2: each dangling reference re-scanned the whole file, so the check cost
  // references × size — measured 18 ms → 1267 ms on 20 MB at 300 references. The cost it adds over a
  // plain load must not grow with the number of references. Compared against pdf-lib's own load of the
  // SAME bytes, best of three, so machine load moves both sides together.
  it('adds a cost that does not grow with the number of dangling references', async () => {
    const overhead = async (refs: number): Promise<number> => {
      const bytes = build({ danglingRefs: refs, padStreamBytes: 8_000_000 });
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const t1 = performance.now();
        await loadPdfDocument(bytes, { updateMetadata: false });
        const t2 = performance.now();
        best = Math.min(best, (t2 - t1) - (t1 - t0));
      }
      return Math.max(0, best);
    };
    const one = await overhead(1);
    const many = await overhead(1500);
    expect(many).toBeLessThan(one * 4 + 250);
  }, 60_000);

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
