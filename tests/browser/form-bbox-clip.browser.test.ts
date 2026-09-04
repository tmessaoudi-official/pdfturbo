/**
 * WS4-F — a rule drawn PAST its Form XObject's `/BBox` deleted a paragraph from the export.
 *
 * pdf.js clips a form to its `/BBox` (`pdf.mjs:12350-12362`: `save()` → `transform(...matrix)` →
 * `ctx.clip(rect(bbox))`), so content outside the box is invisible on screen and in every
 * rasterised export. `walkPageOps` had ZERO `BBox` reads, so it reported that invisible content
 * as page geometry.
 *
 * Why that is a data-loss bug rather than a cosmetic one: `_detectLatticeRegions` derives a table
 * region from the clustered CENTRES of the rules, and `reconstructPage` then REMOVES every word
 * whose origin falls inside that region from the paragraph flow (`flowDoc.ts:1596`). A vertical
 * rule the reader never sees therefore widens the region across ordinary prose, and the paragraph
 * vanishes from DOCX / Markdown / TXT with no warning. This is the same harm CLAUDE.md grades as
 * the reason C9 stays unwired — reached here by a phantom rule instead of a phantom inference.
 *
 * The fixture is SYNTHETIC. No real-world file demonstrating this was found; the mechanism is
 * real and pinned, the field frequency is unmeasured. Said plainly because the plan's wording was
 * "real-file case".
 *
 * Real pdf.js throughout — the operator codes, the `paintFormXObjectBegin` argument shape and the
 * fact that pdf.js does NOT cull out-of-clip paths from the operator list are all properties of
 * the library, and a hand-built OPS table cannot prove any of them (the lesson recorded for the
 * form-XObject fix itself).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { walkPageOps } from '../../src/export/opStreamWalker';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 400;
const PAGE_H = 800;
/** The form sits here; its `/BBox` is 100x60, so it covers page x 50..150, y 600..660. */
const FORM_AT = { x: 50, y: 600 };
/**
 * Short on purpose, and it has to be: pdf.js's own `getTextContent` TRUNCATES an item at the page
 * edge — a 51-character version of this line at x=200 on a 400pt page came back as
 * "…restated after t" with width 201.75, which would have made the fixture look like a flow bug.
 * Measured, not assumed.
 */
const PROSE = 'Quarterly figures restated';
const CELL = 'Qty';

/**
 * A page with a small ruled table inside a Form XObject, plus ONE vertical rule the form draws at
 * form-local x=300 — far outside its `/BBox [0 0 100 60]`, so the reader never sees it.
 *
 * Visible grid:   page x 50..150   (form-local 0 and 99)
 * Phantom rule:   page x 350       (form-local 300, clipped away by pdf.js)
 *
 * `CELL` sits inside the real table; `PROSE` sits at x=200 — outside the visible grid, but inside
 * the region the phantom rule stretches the table to.
 */
async function buildPhantomRulePdf(): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFNumber, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;

  // Separate `f` per rect: pdf.js merges rects built into ONE path into a single constructPath,
  // which would collapse the phantom rule's bbox into the grid's and hide the defect.
  const form = ctx.stream(
    [
      '0 g',
      '0 0 100 1 re f', // bottom rule
      '0 59 100 1 re f', // top rule
      '0 0 1 60 re f', // left rule
      '99 0 1 60 re f', // right rule
      '300 0 1 60 re f', // PHANTOM — outside the /BBox, invisible when rendered
    ].join('\n'),
    {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      FormType: PDFNumber.of(1),
      Matrix: ctx.obj([1, 0, 0, 1, FORM_AT.x, FORM_AT.y]),
      BBox: ctx.obj([0, 0, 100, 60]),
      Resources: ctx.obj({}),
    },
  );
  const formRef = ctx.register(form);

  const content = ctx.stream([
    `BT /F1 11 Tf 1 0 0 1 60 620 Tm (${CELL}) Tj ET`,
    `BT /F1 11 Tf 1 0 0 1 200 620 Tm (${PROSE}) Tj ET`,
    '/Fm0 Do',
  ].join('\n'));
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  page.node.set(PDFName.of('Resources'), ctx.obj({
    XObject: ctx.obj({ Fm0: formRef }),
    Font: ctx.obj({ F1: helv.ref }),
  }));
  return doc.save({ useObjectStreams: false });
}

/** Walk the real operator list and rebuild the flow the DOCX/MD/TXT writers consume. */
async function flowFor(bytes: Uint8Array) {
  // `.slice(0)` — getDocument TRANSFERS its input buffer, leaving the caller's view zero-length.
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await pdf.getPage(1);
  const walk = walkPageOps(
    await page.getOperatorList(),
    pdfjsLib.OPS as unknown as Record<string, number>,
  );
  const items = (await page.getTextContent()).items as unknown as RawTextItem[];
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const flow = reconstructPage(
    items, {} as FontInfoMap, vp.width, vp.height,
    walk.colorMap, undefined, undefined, walk.rules, 0, walk.vRules,
  );
  return { walk, flow };
}

const flowText = (flow: { paragraphs: Array<{ runs: Array<{ text: string }> }> }): string =>
  flow.paragraphs.flatMap(p => p.runs.map(r => r.text)).join(' ');

describe('Form XObject /BBox clip (WS4-F)', () => {
  it('drops the rule the /BBox hides, so the table region stops at the visible grid', async () => {
    const { walk } = await flowFor(await buildPhantomRulePdf());
    // Non-vacuity, and the load-bearing property of pdf.js this whole fix depends on: the phantom
    // rect IS in the operator list (pdf.js clips at paint time, it does not cull the path), so
    // before the clip the walker reported THREE column boundaries reaching x≈350.
    expect(walk.vRules).toHaveLength(2);
    const centres = walk.vRules.map(r => r.x + r.width / 2).sort((a, b) => a - b);
    expect(centres[0]).toBeCloseTo(50.5, 1);
    expect(centres[1]).toBeCloseTo(149.5, 1);
  });

  it('keeps the prose the phantom rule used to swallow', async () => {
    const { flow } = await flowFor(await buildPhantomRulePdf());
    expect(flowText(flow)).toContain(PROSE);
  });

  it('still detects the real table — the clip does not over-reach', async () => {
    // The CONTROL, and the half that fails if the clip is made too aggressive: a fix that dropped
    // the form's own rules would rescue the prose while destroying the table, which reads as green
    // on the case above alone.
    const { flow } = await flowFor(await buildPhantomRulePdf());
    const cells = flow.tables?.[0]?.grid.cells.flat().join(' ') ?? '';
    expect(cells).toContain(CELL);
    // …and the table's text is excluded from the flow, as it was before this change.
    expect(flowText(flow)).not.toContain(CELL);
  });
});
