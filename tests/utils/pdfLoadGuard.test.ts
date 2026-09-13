/**
 * pdf-lib 2.11.0 DROPS an indirect object it cannot parse when no `endobj` follows it before EOF
 * (`PDFParser.tryToParseInvalidIndirectObject`: "Drop it instead of failing the whole parse").
 * 2.8.1 threw `Failed to parse invalid PDF object` on the same bytes. So the upgrade turned a loud
 * load failure into a silent one: pdf.js still renders the page, and every export built from the
 * pdf-lib copy comes out without the dropped object — measured, a page whose content stream was
 * the unterminated object exported as an EMPTY page while pdf.js read "KEEPME" from the source.
 *
 * `loadPdfDocument` restores the loud failure for exactly that shape and nothing wider: an object pdf-lib
 * DROPPED — recorded inside its own parser — that the document actually USES and nothing later replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfLib from '@cantoo/pdf-lib';
import { installDropRecorder, loadPdfDocument, PdfObjectDroppedError, recordedDrops } from '../../src/utils/pdfLoadGuard';
import { appendRevision, buildContentStreamPdf as build, buildObjStmPdf, buildXrefShapePdf, editPdfText } from './_invalidObjectFixture';

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

  // WS7 round 11, export lens P3: the round-10 guard matched an object header ANYWHERE in the file, so a
  // page that merely SHOWS the text "9 0 obj" made a harmless dangling /Info 9 0 R look like a dropped
  // object, and a legal file was refused. Since round 12 nothing reads the text; these stay as pins.
  it('loads a legal dangling reference whose "N G obj" text is only page content (round-11 repro)', async () => {
    const bytes = build({ danglingInfo: true, content: 'BT /F1 24 Tf 20 200 Td (9 0 obj)Tj ET' });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads it too when the text is whitespace-delimited inside the stream', async () => {
    const bytes = build({ danglingInfo: true, content: 'BT /F1 24 Tf 20 200 Td ( 9 0 obj ) Tj ET' });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads it when the text sits in a string OUTSIDE any stream', async () => {
    const bytes = build({ danglingInfo: true, catalogString: '9 0 obj' });
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('still REFUSES a dropped object that directly follows another object\'s stream', async () => {
    const bytes = build({ brokenAfterStream: true });
    // Non-vacuity: pdf-lib really dropped object 6.
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

// WS7 round 12: every defect in the round-10/11 guard came from re-implementing pdf-lib's tokenizer as a
// text scan — a stream with no `endstream`, a header glued to a delimiter, a `>> stream` inside a string,
// a comment between header tokens, an object-stream member (which has no header at all), and the newest
// revision of an object being the one dropped. Each shape below was probed first: pdf-lib really drops the
// object (the non-vacuity lookup in each case), and the text-scan guard ACCEPTED the file.
describe('loadPdfDocument — drops are recorded where pdf-lib makes them (WS7 round 12)', () => {
  const refusal = (bytes: Uint8Array): Promise<unknown> =>
    loadPdfDocument(bytes, { updateMetadata: false }).then(() => 'loaded', (e: unknown) => e);
  const rawLookup = async (bytes: Uint8Array, n: number): Promise<unknown> =>
    (await pdfLib.PDFDocument.load(bytes, { updateMetadata: false })).context.lookup(pdfLib.PDFRef.of(n));
  const refsOf = (e: unknown): string[] => {
    expect(e).toBeInstanceOf(PdfObjectDroppedError);
    return (e as PdfObjectDroppedError).refs;
  };
  const broken = (): Uint8Array => build({ brokenLast: true });

  it('REFUSES a drop that follows a stream with no endstream (export F1)', async () => {
    const bytes = editPdfText(broken(), 'endobj\n5 0 obj', 'endobj\n6 0 obj\n<< /Length 5 >>\nstream\nabcde\n5 0 obj');
    expect(await rawLookup(bytes, 5)).toBeUndefined();
    // Object 6 is dropped too, but nothing references it: only the reachable drop is named.
    expect(refsOf(await refusal(bytes))).toEqual(['5 0 R']);
  });

  it.each([
    ['endobj', 'endobj\n5 0 obj', 'endobj5 0 obj'],
    ['a dictionary', 'BaseFont /Helvetica >>\nendobj\n5 0 obj', 'BaseFont /Helvetica >>5 0 obj'],
    ['an array', 'endobj\n5 0 obj', 'endobj\n7 0 obj\n[1 2]5 0 obj'],
    ['a string', 'endobj\n5 0 obj', 'endobj\n7 0 obj\n(x)5 0 obj'],
  ])('REFUSES a dropped object whose header is glued to %s (export F2)', async (_what, from, to) => {
    const bytes = editPdfText(broken(), from, to);
    expect(await rawLookup(bytes, 5)).toBeUndefined();
    expect(refsOf(await refusal(bytes))).toEqual(['5 0 R']);
  });

  it('REFUSES a drop after a string that contains ">> stream" (export F3, safety F1, completeness F1)', async () => {
    const bytes = build({ brokenLast: true, catalogString: '>> stream\n' });
    expect(await rawLookup(bytes, 5)).toBeUndefined();
    expect(refsOf(await refusal(bytes))).toEqual(['5 0 R']);
  });

  it('REFUSES a drop whose header carries a comment between its tokens — legal PDF syntax', async () => {
    const bytes = editPdfText(broken(), '\n5 0 obj\n', '\n5 %c\n0 obj\n');
    expect(await rawLookup(bytes, 5)).toBeUndefined();
    expect(refsOf(await refusal(bytes))).toEqual(['5 0 R']);
  });

  it('loads a legal dangling reference whose " 9 0 obj " text sits in a string (export F5, completeness F2)', async () => {
    expect(await refusal(build({ danglingInfo: true, catalogString: ' 9 0 obj ' }))).toBe('loaded');
  });

  it('REFUSES when the NEWEST revision of an object is the one dropped and an older one stands in', async () => {
    const bytes = appendRevision(build(), '5 0 obj\n<< /Length 6 } >>\nstream\nBROKEN\nendstream\n');
    // Non-vacuity: nothing dangles — the stale revision resolves, which is why a dangling-reference check never saw it.
    expect(await rawLookup(bytes, 5)).toBeInstanceOf(pdfLib.PDFRawStream);
    expect(refsOf(await refusal(bytes))).toEqual(['5 0 R']);
  });

  it('loads when a LATER revision replaces the dropped one — the drop was superseded (control)', async () => {
    const content = 'BT /F1 24 Tf 20 200 Td (KEEPME) Tj ET';
    // No `endobj` after the replacement: with one, the broken revision would reach it and be kept, not dropped.
    const bytes = appendRevision(broken(), `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`);
    const doc = await loadPdfDocument(bytes, { updateMetadata: false });
    const stream = doc.context.lookup(pdfLib.PDFRef.of(5));
    expect(stream).toBeInstanceOf(pdfLib.PDFRawStream);
    expect(new TextDecoder('latin1').decode((stream as pdfLib.PDFRawStream).getContents())).toContain('KEEPME');
  });

  it('REFUSES an object-stream member lost after a malformed member (export F4)', async () => {
    const bytes = buildObjStmPdf([7, 9, 8]);
    expect(await rawLookup(bytes, 8)).toBeUndefined();
    expect(refsOf(await refusal(bytes))).toEqual(['8 0 R']);
  });

  it('loads when the malformed member is unreferenced and every used member was parsed (control)', async () => {
    const bytes = buildObjStmPdf([7, 8, 9]);
    expect(await refusal(bytes)).toBe('loaded');
    expect(await rawLookup(bytes, 8)).toBeInstanceOf(pdfLib.PDFDict);
  });

  it.each([
    ['its constructor throws (no /First)', { noFirst: true }],
    ['its member table cannot be parsed (/N too large)', { n: 5 }],
  ])('REFUSES a reachable dangling reference when an object stream fails before its members are known: %s', async (_what, opts) => {
    const bytes = buildObjStmPdf([7, 8, 9], opts);
    expect(await rawLookup(bytes, 8)).toBeUndefined();
    expect(refsOf(await refusal(bytes))).toEqual(['8 0 R']);
  });

  it('keeps pdf-lib\'s own error when throwOnInvalidObject is set — the recorder changes no parse result', async () => {
    const err = await loadPdfDocument(broken(), { updateMetadata: false, throwOnInvalidObject: true }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PdfObjectDroppedError);
    expect(String((err as Error).message)).toContain('Trying to parse invalid object');
  });

  it('records a drop made by pdf-lib\'s OWN PDFDocument.load — the patched parser is the one pdf-lib uses', async () => {
    await loadPdfDocument(build()); // installs the recorder
    const raw = await pdfLib.PDFDocument.load(broken(), { updateMetadata: false });
    expect(recordedDrops(raw.context)).toEqual(['5 0 R']);
  });

  it('fails loudly when pdf-lib no longer has a parser method the recorder wraps', () => {
    const lib = { PDFParser: class {}, PDFObjectStreamParser: class {}, PDFRef: pdfLib.PDFRef };
    expect(() => installDropRecorder(lib as unknown as Parameters<typeof installDropRecorder>[0]))
      .toThrow(/tryToParseInvalidIndirectObject/);
  });
});

describe('loadPdfDocument — what a kept damaged object points at (WS7 round 13)', () => {
  const refusal = (bytes: Uint8Array): Promise<unknown> =>
    loadPdfDocument(bytes, { updateMetadata: false }).then(() => 'loaded', (e: unknown) => e);
  const raw = async (bytes: Uint8Array): Promise<pdfLib.PDFContext> =>
    (await pdfLib.PDFDocument.load(bytes, { updateMetadata: false })).context;
  const refsOf = (e: unknown): string[] => {
    expect(e).toBeInstanceOf(PdfObjectDroppedError);
    return (e as PdfObjectDroppedError).refs;
  };

  it('REFUSES a drop reachable only through a kept damaged object, whose references cannot be read (export F2)', async () => {
    const bytes = editPdfText(
      editPdfText(build({ brokenAfterStream: true }), '/Broken 6 0 R', '/Broken 7 0 R'),
      '6 0 obj\n<< /Type /Foo }', '7 0 obj\n<< /Type /Bar } /Ref 6 0 R >>\nendobj\n6 0 obj\n<< /Type /Foo }',
    );
    const ctx = await raw(bytes);
    // Non-vacuity: 7 is kept opaque and 6 is gone, so nothing the walk can read reaches the drop.
    expect(ctx.lookup(pdfLib.PDFRef.of(7))).toBeInstanceOf(pdfLib.PDFInvalidObject);
    expect(ctx.lookup(pdfLib.PDFRef.of(6))).toBeUndefined();
    expect(recordedDrops(ctx)).toEqual(['6 0 R']);
    expect(refsOf(await refusal(bytes))).toEqual(['6 0 R']);
  });

  it('REFUSES when an object stream lost its member list and a kept damaged object may point into it', async () => {
    const bytes = editPdfText(
      editPdfText(buildObjStmPdf([7, 8, 9], { noFirst: true }), '/Annots [8 0 R]', '/Annots [11 0 R]'),
      '10 0 obj', '11 0 obj\n<< /Subtype } /P 8 0 R >>\nendobj\n10 0 obj',
    );
    const ctx = await raw(bytes);
    expect(ctx.lookup(pdfLib.PDFRef.of(11))).toBeInstanceOf(pdfLib.PDFInvalidObject);
    expect(ctx.lookup(pdfLib.PDFRef.of(8))).toBeUndefined();
    // No dangling reference is readable, so the damaged object is the one named.
    expect(refsOf(await refusal(bytes))).toEqual(['11 0 R']);
  });

  it('loads a reachable damaged object when the only drop was superseded by a later revision (control)', async () => {
    const content = 'BT /F1 24 Tf 20 200 Td (KEEPME) Tj ET';
    const withDamaged = editPdfText(
      editPdfText(build({ brokenLast: true }), '/Pages 2 0 R', '/Pages 2 0 R /Dmg 8 0 R'),
      'endobj\n5 0 obj', 'endobj\n8 0 obj\n<< /A } >>\nendobj\n5 0 obj',
    );
    const bytes = appendRevision(withDamaged, `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`);
    const ctx = await raw(bytes);
    expect(ctx.lookup(pdfLib.PDFRef.of(8))).toBeInstanceOf(pdfLib.PDFInvalidObject);
    expect(recordedDrops(ctx)).toEqual(['5 0 R']);
    expect(await refusal(bytes)).toBe('loaded');
  });
});

describe('loadPdfDocument — a drop is superseded by assignment ORDER, not by identity (WS7 round 13)', () => {
  const refusal = (bytes: Uint8Array): Promise<unknown> =>
    loadPdfDocument(bytes, { updateMetadata: false }).then(() => 'loaded', (e: unknown) => e);
  const raw = async (bytes: Uint8Array): Promise<pdfLib.PDFContext> =>
    (await pdfLib.PDFDocument.load(bytes, { updateMetadata: false })).context;

  it.each([
    ['null', pdfLib.PDFNull],
    ['/X', pdfLib.PDFName.of('X')],
    ['true', pdfLib.PDFBool.True],
  ])('loads when the revision after a drop is the same interned value as the one before it: %s (export F1)', async (value, interned) => {
    // pdf-lib interns null, booleans and names, so "the older revision still stands" and "a later revision
    // replaced the drop" hold the very same object, and an identity comparison cannot tell them apart.
    const withSix = editPdfText(
      editPdfText(build(), '/Pages 2 0 R', '/Pages 2 0 R /Foo 6 0 R'),
      'xref\n0 ', `6 0 obj\n${value}\nendobj\nxref\n0 `,
    );
    const bytes = appendRevision(withSix, `6 0 obj\n<< /Type /Foo }\n6 0 obj\n${value}\n`);
    const ctx = await raw(bytes);
    expect(recordedDrops(ctx)).toEqual(['6 0 R']);
    expect(ctx.lookup(pdfLib.PDFRef.of(6))).toBe(interned);
    expect(await refusal(bytes)).toBe('loaded');
  });

  it('loads when an object-stream member re-assigns the same interned value before a later member throws (export F1)', async () => {
    const bytes = editPdfText(
      editPdfText(buildObjStmPdf([7, 9], { members: { 7: 'null' } }), '/Pages 2 0 R', '/Pages 2 0 R /Foo 7 0 R'),
      '10 0 obj', '7 0 obj\nnull\nendobj\n10 0 obj',
    );
    const ctx = await raw(bytes);
    expect(recordedDrops(ctx).sort()).toEqual(['7 0 R', '9 0 R']);
    expect(ctx.lookup(pdfLib.PDFRef.of(7))).toBe(pdfLib.PDFNull);
    expect(await refusal(bytes)).toBe('loaded');
  });
});

describe('loadPdfDocument — where pdf.js and pdf-lib would read different content (WS7 round 13, safety F1)', () => {
  const refusal = (bytes: Uint8Array): Promise<unknown> =>
    loadPdfDocument(bytes, { updateMetadata: false }).then(() => 'loaded', (e: unknown) => e);
  const pdfjsText = async (bytes: Uint8Array): Promise<string> => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
    const { items } = await (await doc.getPage(1)).getTextContent();
    return (items as Array<{ str?: string }>).map(i => i.str ?? '').join('');
  };
  const pdfLibText = async (bytes: Uint8Array): Promise<string> => {
    const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
    const stream = doc.getPage(0).node.lookup(pdfLib.PDFName.of('Contents')) as pdfLib.PDFRawStream;
    return new TextDecoder('latin1').decode(stream.getContents());
  };
  const mismatchOf = (e: unknown): string[] => {
    expect((e as Error | undefined)?.name).toBe('PdfXrefMismatchError');
    return (e as { refs: string[] }).refs;
  };

  it.each([
    ['dupFirst', ['5 0 R']],
    ['dupFirstLoose', ['5 0 R']],
    ['incrementalStale', ['5 0 R']],
    ['junkRelative', ['5 0 R']],
    ['xrefStreamDupFirst', ['5 0 R']],
    ['dualTrailer', ['11 0 R']],
  ] as const)('REFUSES %s — pdf.js shows one page, the pdf-lib copy every export and signature uses holds another', async (shape, refs) => {
    const bytes = buildXrefShapePdf(shape);
    // Non-vacuity, both halves: the viewer really shows VIEWED, and pdf-lib really kept SIGNED.
    expect(await pdfjsText(bytes)).toBe('VIEWED');
    expect(await pdfLibText(bytes)).toContain('SIGNED');
    expect(mismatchOf(await refusal(bytes))).toEqual(refs);
  });

  it.each(['clean', 'dupLast', 'dupBadXref', 'incremental', 'junkAbsolute'] as const)(
    'loads %s — both parsers read the same page (control)', async shape => {
      const bytes = buildXrefShapePdf(shape);
      const shown = await pdfjsText(bytes);
      expect(shown).toMatch(/^(VIEWED|SIGNED)$/);
      expect(await pdfLibText(bytes)).toContain(shown);
      expect(await refusal(bytes)).toBe('loaded');
    },
  );

  it('loads when the disagreement is about an object nothing uses', async () => {
    const bytes = buildXrefShapePdf('unreachableDupFirst');
    const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
    expect(String(doc.context.lookup(pdfLib.PDFRef.of(9)))).toContain('/A 2'); // the copy the table does not name
    expect(await refusal(bytes)).toBe('loaded');
  });

  it('loads when both copies are the same value — there is nothing to disagree about', async () => {
    expect(await refusal(buildXrefShapePdf('identicalDupFirst'))).toBe('loaded');
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
