/**
 * The redaction promise, checked at the BYTE level — because every other way of checking it lies.
 *
 * ONE confirmed leak and one hardening, and the difference between them is stated because conflating
 * the two is how a security document starts over-claiming:
 *
 *  1. CONFIRMED, and it was live: a redaction on a BLANK page never reached the rasteriser (the
 *     `blank` branch is checked before `hasRedaction`), so it was an opaque vector rect drawn over
 *     live, fully extractable overlay text. Reverting the fix makes the test below extract the secret
 *     verbatim — that is the proof, and it is why the fix exists.
 *  2. NOT CONFIRMED end-to-end: `_assemblePdfDoc` pre-copied every needed page, including
 *     redaction-bearing ones whose copy is never `addPage`d. In ISOLATION that demonstrably leaves the
 *     page serialised (pdf-lib does not garbage-collect) and the source text recoverable from the raw
 *     bytes. But the real assembler shows no such trace with or without the filter, so the filter is
 *     defence in depth and the scan here is a REGRESSION guard — not evidence that a leak was closed.
 *
 * So this file does what the audit's own redaction pin could not: it scans the RAW EXPORTED BYTES,
 * inflating every stream. That is normally the wrong tool — per CLAUDE.md § "A flaky gate", scanning
 * compressed bytes for a short string is a coin flip — which is why the secret here is a long, unique
 * token and the scan DECODES streams rather than pattern-matching the container. The false-positive
 * risk that rule warns about is real; the mitigation is decoding, not avoiding the question.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { unzlibSync } from 'fflate';
import { dropElementsUnderRedactions } from '../../src/export/exportService';
import { RedactionElement } from '../../src/elements/redactionElement';
import { TextElement } from '../../src/elements/textElement';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 400, H = 300;
/** Long and unique, so a coincidental byte match in compressed data is not a plausible explanation. */
const SECRET = 'CONFIDENTIAL-CASE-4417-WOLGAST-KLEINMACHNOW';

/**
 * Every byte of every stream in `bytes`, inflated where possible, concatenated as latin1 — plus the
 * raw bytes themselves, so an uncompressed stream is covered too.
 */
function decodedBytes(bytes: Uint8Array): string {
  const raw = new TextDecoder('latin1').decode(bytes);
  let all = raw;
  const marker = 'stream';
  for (let i = raw.indexOf(marker); i !== -1; i = raw.indexOf(marker, i + 1)) {
    if (raw.startsWith('endstream', i - 3)) continue;
    let s = i + marker.length;
    if (raw[s] === '\r') s++;
    if (raw[s] === '\n') s++;
    const end = raw.indexOf('endstream', s);
    if (end === -1) continue;
    let slice = bytes.subarray(s, end);
    // TRIM the trailing EOL before the `endstream` keyword. Without this `unzlibSync` THROWS on every
    // pdf-lib stream, the catch swallows it, only the raw bytes get searched — and since pdf-lib
    // Flate-compresses content streams, the scan then finds nothing and the test passes vacuously.
    // That is exactly what the first version of this file did.
    while (slice.length && (slice[slice.length - 1] === 0x0a || slice[slice.length - 1] === 0x0d)) {
      slice = slice.subarray(0, slice.length - 1);
    }
    if (slice.length < 2) continue;
    try {
      all += new TextDecoder('latin1').decode(unzlibSync(slice));
    } catch {
      /* not a zlib stream — the raw copy above already covers it */
    }
  }
  return all;
}

/** Hex-encoded show-op form, e.g. `<434F4E...> Tj`, which is how a CID font emits the same text. */
function hexOf(s: string): string {
  return [...s].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
}

function leaks(bytes: Uint8Array): boolean {
  const decoded = decodedBytes(bytes);
  return decoded.includes(SECRET) || decoded.toUpperCase().includes(hexOf(SECRET));
}

/** Source PDF bytes carrying the secret on page 1. */
async function secretSource(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  page.drawText(SECRET, { x: 20, y: H - 60, size: 9, font });
  return doc.save({ useObjectStreams: false });
}

/** Run the production export over a one-page document carrying `elements`. */
async function assembleWithRedaction(elements: PDFElement[]): Promise<Uint8Array> {
  const { ExportService } = await import('../../src/export/exportService');
  const { InkLayer } = await import('../../src/infra/inkLayer');
  const bytes = await secretSource();
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes, doc }]]),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements,
    formValues: {},
    currentFilename: 'case.pdf',
    exportPassword: null,
    inkLayer: new InkLayer(),
    reportError: {
      info() {},
      // Fail loud: a swallowed render error would make every assertion below meaningless.
      warn(k: string) { throw new Error(`export warned: ${k}`); },
      error(k: string) { throw new Error(`export errored: ${k}`); },
      silent() {},
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  };
  return new ExportService(ctx as never).assemblePdfBytes();
}

describe('AUDIT — a redacted page leaves NO recoverable copy in the exported bytes', () => {
  it('the un-redacted page is not serialised as an orphan object', async () => {
    // Drives the REAL assembler (`assemblePdfBytes` → `_assemblePdfDoc`), not a hand-rolled copy of it.
    // That distinction is the whole value of this test: the defect lived in the assembler's decision to
    // pre-copy pages it would later rasterise, so a test that performs the copy itself proves nothing
    // about the shipped code — it just re-creates the bug and asserts it exists.
    const { ExportService } = await import('../../src/export/exportService');
    const redaction = new RedactionElement(15, 30, 320, 30, 'p1', '#000000') as unknown as PDFElement;
    const out = await assembleWithRedaction([redaction]);

    // pdf.js agrees the secret is gone — and that is precisely the false negative that hid this leak.
    const pdf = await pdfjsLib.getDocument({ data: out }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const extracted = (content.items as unknown as { str?: string }[]).map(t => t.str ?? '').join('');
    expect(extracted).not.toContain(SECRET);
    void ExportService;

    // The real question, and the one the audit's own redaction pin structurally could not ask.
    expect(leaks(out), 'the un-redacted page must not survive as an orphan object').toBe(false);
  });

  it('the scan is non-vacuous — it DOES find the secret when the page is genuinely present', async () => {
    // Without this control, `leaks() === false` above could mean "the scanner is broken".
    const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
    page.drawText(SECRET, { x: 20, y: H - 60, size: 9, font });
    expect(leaks(await doc.save({ useObjectStreams: false }))).toBe(true);
  });
});

describe('AUDIT — a redaction on a BLANK page removes the overlay text under it (end-to-end)', () => {
  it('the covered text is not extractable from the exported blank page', async () => {
    const { ExportService } = await import('../../src/export/exportService');
    const { InkLayer } = await import('../../src/infra/inkLayer');
    const covered = new TextElement(20, 40, 'p1', { width: 300, height: 20, fontSize: 12 }) as unknown as PDFElement;
    (covered as unknown as { text: string }).text = SECRET;
    const redaction = new RedactionElement(15, 35, 320, 30, 'p1', '#000000') as unknown as PDFElement;
    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const ctx = {
      documentModel: {
        pageCount: 1,
        currentPageIndex: 0,
        // A BLANK page — no source PDF, so the assembler's `blank` branch runs and the redaction
        // never reaches the rasteriser. That branch precedes the `hasRedaction` one, which is how a
        // black box over live overlay text shipped as extractable text.
        pages: [{ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 1, rotation: 0, blankWidth: W, blankHeight: H }],
        sourcePdfs: new Map(),
        watermark: { enabled: false },
        bates: { enabled: false },
      },
      elements: [covered, redaction],
      formValues: {},
      currentFilename: 'case.pdf',
      exportPassword: null,
      inkLayer: new InkLayer(),
      reportError: {
        info() {},
        warn(k: string) { throw new Error(`export warned: ${k}`); },
        error(k: string) { throw new Error(`export errored: ${k}`); },
        silent() {},
      },
      progress: { begin: () => handle },
      cleanEmptyTextElements() {},
      renderCurrentPage: () => Promise.resolve(),
      rebuildElementLayer() {},
    };
    const out = await new ExportService(ctx as never).assemblePdfBytes();

    const pdf = await pdfjsLib.getDocument({ data: out }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const extracted = (content.items as unknown as { str?: string }[]).map(t => t.str ?? '').join('');
    expect(extracted, 'redacted overlay text must not survive on a blank page').not.toContain(SECRET);
    expect(leaks(out), 'nor anywhere in the raw bytes').toBe(false);
  });
});

describe('AUDIT — the blank-page filter itself', () => {
  it('covered elements are dropped, redactions kept', () => {
    const covered = new TextElement(20, 30, 'p1', { width: 200, height: 20 }) as unknown as PDFElement;
    (covered as unknown as { text: string }).text = SECRET;
    const clear = new TextElement(20, 200, 'p1', { width: 200, height: 20 }) as unknown as PDFElement;
    (clear as unknown as { text: string }).text = 'safe to keep';
    const redaction = new RedactionElement(15, 25, 220, 30, 'p1', '#000000') as unknown as PDFElement;

    const kept = dropElementsUnderRedactions([covered, clear, redaction]);

    expect(kept).toContain(redaction);          // the box itself must still be drawn
    expect(kept).toContain(clear);              // untouched content survives
    expect(kept).not.toContain(covered);        // the leak: this used to be drawn as live text
  });

  it('is a no-op when the page carries no redaction (byte-identical export path)', () => {
    const a = new TextElement(10, 10, 'p1', {}) as unknown as PDFElement;
    const b = new TextElement(50, 50, 'p1', {}) as unknown as PDFElement;
    const input = [a, b];
    expect(dropElementsUnderRedactions(input)).toBe(input);
  });

  it('drops an element only PARTLY under the box — partial cover still leaks part of it', () => {
    const straddling = new TextElement(0, 0, 'p1', { width: 100, height: 100 }) as unknown as PDFElement;
    const redaction = new RedactionElement(90, 90, 50, 50, 'p1', '#000000') as unknown as PDFElement;
    expect(dropElementsUnderRedactions([straddling, redaction])).not.toContain(straddling);
  });
});
