/**
 * D1 (QA 2026-06-18) — DOCX export spot/Separation color is NOT a defect (verified).
 *
 * The DOCX run color comes from the walker `colorMap` (opStreamWalker.walkPageOps),
 * built from `page.getOperatorList()`. The walker tracks `setFillRGBColor` /
 * `setFillGray` / `setFillCMYKColor` and has no `setFillColorN` (`scn`) case — the
 * static gaps audit (D1) flagged this as a spot-color black-collapse risk. This
 * real-pdf.js test DISPROVES that at runtime: pdf.js v6's getOperatorList
 * PRE-RESOLVES every non-pattern fill colorspace (incl. Separation/spot) and emits a
 * single `setFillRGBColor(["#rrggbb"])` — measured here as `setFillRGBColor(["#ff8000"])`
 * for a Separation tint 1 → orange [1, 0.5, 0]. The existing `setFillRGBColor` branch
 * therefore already captures it (→ "FF8000" in colorMap), and the colorMap →
 * reconstructPage (`w.color`) → FlowRun.color → writer chain carries it to the DOCX
 * run. A bare `scn` is only emitted for PATTERN fills, whose per-glyph tint the op
 * list can't reduce to one run color anyway (structural ceiling, not D1).
 *
 * This test is kept as a regression GUARD: if a future pdf.js stops pre-resolving
 * Separation to a hex `setFillRGBColor`, spot text would silently go black and this
 * goes red. jsdom cannot run it (needs real getOperatorList colorspace eval).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, PDFName } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { walkPageOps } from '../../src/export/opStreamWalker';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 320;
const PAGE_H = 120;
const BASELINE = 45;

/** One-page PDF: Helvetica text filled via Separation /MySpot, tint 1 → orange. */
async function makeSpotColorPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const tintFn = pdf.context.obj({
    FunctionType: 2, Domain: [0, 1], C0: [1, 1, 1], C1: [1, 0.5, 0], N: 1,
  });
  const sepCS = pdf.context.obj([
    PDFName.of('Separation'), PDFName.of('MySpot'), PDFName.of('DeviceRGB'), tintFn,
  ]);
  const sepRef = pdf.context.register(sepCS);
  const resources = pdf.context.obj({
    Font: { Helv: helv.ref }, ColorSpace: { CS0: sepRef },
  });
  page.node.set(PDFName.of('Resources'), pdf.context.register(resources));

  const content = `/CS0 cs 1 scn BT /Helv 44 Tf 20 ${BASELINE} Td (Spot) Tj ET`;
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(bytes)));
  return pdf.save();
}

describe('DOCX export — spot/Separation (scn) text color reaches the colorMap (D1)', () => {
  it('resolves the Separation tint to a non-black orange in walkPageOps', async () => {
    const bytes = await makeSpotColorPdf();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const page = await doc.getPage(1);
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS as unknown as Record<string, number>;

    // Diagnostic: every fill-color / colorN op pdf.js actually emitted + its args.
    const nameOf = (fn: number) => Object.keys(OPS).find((k) => OPS[k] === fn) ?? String(fn);
    const fillOps: string[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const nm = nameOf(opList.fnArray[i]);
      if (/fill|color/i.test(nm)) fillOps.push(`${nm}(${JSON.stringify(opList.argsArray[i])})`);
    }

    const { colorMap } = walkPageOps(opList, OPS);
    const colors = [...colorMap.values()];
    expect(colors, `fill ops emitted by pdf.js: ${fillOps.join(' | ') || '(none)'}`).not.toHaveLength(0);

    const hex = colors[0];
    const r = parseInt(hex.slice(0, 2), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(r, `expected reddish-orange, got #${hex}`).toBeGreaterThan(200);
    expect(b, `expected low blue, got #${hex}`).toBeLessThan(90);
  });
});
