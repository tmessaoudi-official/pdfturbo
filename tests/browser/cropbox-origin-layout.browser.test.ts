/**
 * C22 — the flow export's LAYOUT on a page whose CropBox origin is not (0,0).
 *
 * This file REPLACES `blockers-cropbox-layout.browser.test.ts`, which pinned the defect as a
 * confirming blocker (`it.fails`). The defect is fixed, so the pin becomes a regression guard and
 * loses the `blockers-` prefix — that prefix means "an `it.fails` stating behaviour we do NOT
 * have" (tests/blockers/README.md), and a green plain-`it` file under it would be a doc-vs-reality
 * drift of exactly the kind this repo keeps having to correct.
 *
 * ── The defect ────────────────────────────────────────────────────────────────────
 * pdf.js reports every CONTENT channel in ABSOLUTE user space — text items, operator-list CTMs
 * (rules, images, the colour keys) and Link annotation rects alike. `reconstructPage` is handed
 * the CROP dimensions as the page box. On the usual `/CropBox [0 0 w h]` page the two frames
 * coincide; give the page an origin and every position in the flow model is offset by it, so the
 * DOCX/Markdown/TXT export gets wrong margins, wrong image anchors and a reading order computed
 * against a box its coordinates do not belong to.
 *
 * Measured on `/CropBox [50 50 350 350]` before the fix: item `(100,300)`, rule `(100,296)`,
 * colour key `"100,300"`, image ctm e/f `(120,200)` — all absolute, and all mutually consistent.
 *
 * ── Why the LOCKSTEP cases below are the load-bearing half ────────────────────────
 * Colour, underline and hyperlink are matched BY POSITION: a word's colour is looked up at
 * `"${round(x)},${round(y)}"`, a rule is classified against the run's baseline, a link by
 * containment. Because every channel is absolute TODAY, those three work today — so normalising
 * the words alone (or the words and only some channels) would fix the y and silently break all
 * three, which is precisely why C22 was deferred rather than bundled into the 2026-08-28 leak fix.
 *
 * The three lockstep cases therefore pass both before AND after the fix. That is not redundancy:
 * they are the cases that go red for a PARTIAL normalisation, which is the failure mode with
 * teeth. The y / image-anchor / margin cases are the ones that were red before it.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Ext = { _extractFlowDoc(): Promise<FlowDoc> };

/** MediaBox 400×400, CropBox [50 50 350 350] → a 300×300 visible box at origin (50,50). */
const OX = 50, OY = 50, CROP_W = 300, CROP_H = 300;
const LINK_URL = 'https://example.com/c22';

/** A 1×1 red PNG — the smallest thing that exercises the image-anchor channel. */
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * One page carrying every channel at once, so a partial normalisation cannot hide behind a
 * fixture that exercises only the channel that was fixed.
 *
 * Absolute placements, and what they mean in the 300×300 crop frame:
 *   text   "WORD" baseline (100, 300)          → (50, 250)   — 50pt below the crop top
 *   rule           (100, 296) 40×1             → underline, 4pt under that baseline
 *   link           [95, 295, 145, 315]         → contains the word's mid-glyph centre
 *   image          (120, 200) 60×40            → x 70, y-down 110
 *   small image    (120, 100) 20×20            → x 70..90, y-down 230..250 (the redaction target)
 *
 * The small image is deliberately NARROWER than the 50pt origin: the only difference a wrong
 * frame makes to a redaction rect is an x-shift of exactly the origin (`redactionRectToPageSpace`
 * adds `viewBox[0]` to x and nothing to y, which is already measured down from the crop top), so
 * a 60pt-wide target would still overlap its own mis-placed test region and the case would pass
 * while the frame was wrong. `redaction-crop-origin.browser.test.ts`'s image row has exactly that
 * shape, which is why it does NOT catch this and the case below does.
 */
async function buildCroppedPdf(withCrop = true): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, PDFName, PDFArray, PDFString, rgb } =
    await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  // Without the crop the MediaBox IS the frame, so the same absolute numbers are already
  // crop-relative — that is the zero-origin control, and it must be unaffected by the fix.
  const page = doc.addPage(withCrop ? [400, 400] : [CROP_W, CROP_H]);
  if (withCrop) page.setCropBox(OX, OY, CROP_W, CROP_H);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const x = withCrop ? 100 : 50;
  const y = withCrop ? 300 : 250;
  page.drawText('WORD', { x, y, size: 14, font, color: rgb(0.9, 0, 0) });
  page.drawRectangle({ x, y: y - 4, width: 40, height: 1, color: rgb(0, 0, 0) });
  const png = await doc.embedPng(
    Uint8Array.from(atob(RED_PNG_B64), (c) => c.charCodeAt(0)),
  );
  page.drawImage(png, { x: withCrop ? 120 : 70, y: withCrop ? 200 : 150, width: 60, height: 40 });
  page.drawImage(png, { x: withCrop ? 120 : 70, y: withCrop ? 100 : 50, width: 20, height: 20 });

  const ctx = doc.context;
  const link = ctx.register(ctx.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
    Rect: ctx.obj([x - 5, y - 5, x + 45, y + 15]),
    Border: ctx.obj([0, 0, 0]),
    A: ctx.obj({ Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(LINK_URL) }),
  }));
  const annots = PDFArray.withContext(ctx);
  annots.push(link);
  page.node.set(PDFName.of('Annots'), annots);
  return doc.save();
}

/** A redaction in editor DISPLAY space — i.e. relative to the rendered crop box, y-down. */
type Red = { x: number; y: number; width: number; height: number };

async function flowFor(withCrop: boolean, redaction?: Red): Promise<FlowDoc> {
  const doc = await pdfjsLib.getDocument({ data: (await buildCroppedPdf(withCrop)).slice(0) }).promise;
  const svc = new ExportService({
    documentModel: {
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements: redaction ? [{ pageId: 'p1', type: 'redaction', ...redaction }] : [],
  } as unknown as IExportContext) as unknown as Ext;
  return svc._extractFlowDoc();
}

describe('flow export vs a non-zero CropBox origin (C22)', () => {
  describe('positions are reported in the CROP frame', () => {
    it('the paragraph y is crop-relative, not absolute', async () => {
      const page = (await flowFor(true)).pages[0];
      expect(page.height).toBeCloseTo(CROP_H, 0);
      // The word sits 50pt below the crop top, so in that 300-high box its y-up coordinate is 250.
      // Before the fix it reported the ABSOLUTE 300 — a y equal to the full page height, i.e.
      // sitting exactly on the top edge of a box it is actually 50pt inside. The defect in one number.
      expect(page.paragraphs[0].y).toBeCloseTo(250, 0);
    }, 60_000);

    it('the image anchor is crop-relative on both axes', async () => {
      const img = (await flowFor(true)).pages[0].images?.[0];
      expect(img).toBeDefined();
      // x: absolute 120 − origin 50. y is measured DOWN from the crop top:
      // 300 − (200 − 50) − 40 = 110. Before the fix: x 120, y 60 (absolute ctm, crop height).
      expect(img?.x).toBeCloseTo(70, 0);
      expect(img?.y).toBeCloseTo(110, 0);
      expect(img?.width).toBeCloseTo(60, 0);
      expect(img?.height).toBeCloseTo(40, 0);
    }, 60_000);

    /**
     * A LEAK guard, not a layout one — and the only case that discriminates the frame the image
     * channel's redaction filter runs in.
     *
     * `pageSpaceRedactions` and the image CTMs must be expressed in the SAME frame or
     * `imagePlacementRedacted` compares a redaction against a picture that is not where it thinks
     * it is. On a scan the whole page is one image XObject, so this is the canonical redaction
     * case: getting it wrong hands the redacted picture back in the DOCX/MD/TXT export.
     */
    it('a source image under a redaction is still dropped — and only that one', async () => {
      const covered = { x: 70, y: 230, width: 20, height: 20 };
      const clean = (await flowFor(true)).pages[0];
      // CONTROL first: both images ARE extracted without a redaction, so a later count of 1
      // cannot be the trivial consequence of the small image never being picked up at all.
      expect(clean.images?.length).toBe(2);

      const page = (await flowFor(true, covered)).pages[0];
      expect(page.images?.length).toBe(1);
      // The survivor is the BIG one: a filter that drops every image is not a fix.
      expect(page.images?.[0].width).toBeCloseTo(60, 0);
      // And the word, which is nowhere near the redaction, is still exported.
      expect(JSON.stringify(page.paragraphs)).toContain('WORD');
    }, 60_000);

    it('the margins are measured against the box the words are in', async () => {
      const page = (await flowFor(true)).pages[0];
      // top = 300 − (250 + 14) = 36. Before the fix the glyph top computed to 314 on a 300-high
      // page, i.e. a NEGATIVE margin, clamped to 0 — a real DOCX with no top margin at all.
      expect(page.margins?.top).toBe(36);
      // left = 100 − 50. Before the fix: 100.
      expect(page.margins?.left).toBe(50);
      // `right` and `bottom` are not asserted: with a single short word both saturate
      // computeMargins' 40%-of-page clamp (120) before and after, so they cannot discriminate.
    }, 60_000);
  });

  describe('the position-matched channels still match — the LOCKSTEP guard', () => {
    // Each of these passes on the pre-fix code too. They fail when the words move and a channel
    // does not (or vice versa), which is the only way this fix can go wrong.
    it('colour still attaches to the word (colorMap keys moved with it)', async () => {
      const run = (await flowFor(true)).pages[0].paragraphs[0].runs[0];
      expect(run.text).toContain('WORD');
      expect(run.color).toMatch(/^e60000$/i);
    }, 60_000);

    it('the underline still matches (rules moved with it)', async () => {
      const run = (await flowFor(true)).pages[0].paragraphs[0].runs[0];
      expect(run.underline).toBe(true);
    }, 60_000);

    it('the hyperlink still matches (link rects moved with it)', async () => {
      const run = (await flowFor(true)).pages[0].paragraphs[0].runs[0];
      expect(run.linkUrl).toBe(LINK_URL);
    }, 60_000);
  });

  it('a zero-origin page is unaffected (the byte-identical control)', async () => {
    const page = (await flowFor(false)).pages[0];
    expect(page.height).toBeCloseTo(CROP_H, 0);
    expect(page.paragraphs[0].y).toBeCloseTo(250, 0);
    expect(page.margins?.top).toBe(36);
    expect(page.margins?.left).toBe(50);
    expect(page.images?.[0].x).toBeCloseTo(70, 0);
    expect(page.images?.[0].y).toBeCloseTo(110, 0);
    const run = page.paragraphs[0].runs[0];
    expect(run.color).toMatch(/^e60000$/i);
    expect(run.underline).toBe(true);
    expect(run.linkUrl).toBe(LINK_URL);
  }, 60_000);
});
