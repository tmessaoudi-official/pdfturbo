// @vitest-environment node
/**
 * WS7 round 10, safety lens P1 — a `PDFInvalidObject` bypassed every sanitizer walk.
 *
 * pdf-lib keeps an object it cannot parse as opaque bytes and writes them back verbatim. Every walk
 * in `sanitizePdf`, and the backstop pass over every dictionary, test `instanceof PDFDict` — so a
 * JavaScript action inside a malformed Widget was never seen, the report came back all-false
 * ("nothing to strip"), and pdf.js, which parses the same bytes leniently, still found the action.
 *
 * The sanitizer cannot strip what it cannot parse, so it now REFUSES — after the unreachability
 * sweep, so a junk orphan nothing references is simply deleted and the file still sanitizes.
 */
import { describe, it, expect } from 'vitest';
import * as pdfLib from '@cantoo/pdf-lib';
import { sanitizePdf } from '../../src/utils/pdfSanitizer';
import { buildInvalidObjectPdf } from './_invalidObjectFixture';

async function pdfjsHasScript(bytes: Uint8Array): Promise<boolean> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  return doc.hasJSActions();
}

describe('sanitizePdf — an object it cannot parse', () => {
  it('the fixture is live: pdf-lib holds an opaque object AND pdf.js sees the script', async () => {
    const bytes = buildInvalidObjectPdf({ reachable: true });
    const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.context.lookup(pdfLib.PDFRef.of(5))).toBeInstanceOf(pdfLib.PDFInvalidObject);
    // pdf.js reads past the stray `}` and registers the field's script — so the object is live.
    expect(await pdfjsHasScript(bytes)).toBe(true);
    // …and the probe can say "no": the same bytes with nothing referencing the widget report none.
    expect(await pdfjsHasScript(buildInvalidObjectPdf({ reachable: false }))).toBe(false);
  });

  it('REFUSES when the unparseable object is reachable, naming the object', async () => {
    const err = await sanitizePdf(buildInvalidObjectPdf({ reachable: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('SanitizeRefusedError');
    expect((err as { refs?: string[] }).refs).toEqual(['5 0 R']);
  });

  it('sanitizes normally when the unparseable object is an unreachable orphan (control)', async () => {
    const { bytes, report } = await sanitizePdf(buildInvalidObjectPdf({ reachable: false }));
    expect(report.info).toBe(true);
    const latin1 = new TextDecoder('latin1').decode(bytes);
    expect(latin1).not.toContain('JavaScript');
  });
});
