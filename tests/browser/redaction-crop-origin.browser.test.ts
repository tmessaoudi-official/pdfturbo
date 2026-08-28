/**
 * REDACTION LEAK GUARD (real Chrome) — a non-zero CropBox ORIGIN must not defeat the
 * redaction filters on the text-extraction export paths.
 *
 * ── The defect this pins ──────────────────────────────────────────────────────────
 * pdf.js reports text items in ABSOLUTE PDF user space (`item.transform[4]/[5]`), while a
 * redaction element's rect lives in editor DISPLAY space, which is relative to the RENDERED
 * page box — i.e. the CropBox. The two origins differ by exactly `(viewBox[0], viewBox[1])`.
 * On the overwhelmingly common `/CropBox [0 0 w h]` page they coincide, so every existing
 * test passes either way; give the page a non-zero origin and the intersection test compares
 * coordinates from two different frames, matches nothing, and the redacted text is handed
 * straight back through "Export to Word" and the table CSV/XLSX exports.
 *
 * Measured before the fix (`viewBox [50,50,350,350]`, secret at absolute `100,300`):
 * the flow model returned the secret's paragraph verbatim, and `_extractPageTableData`
 * returned `SECRETWORD|PUBLICWORD`.
 *
 * This is the SAME class as the `/Rotate 90|270` leak already fixed on these two paths —
 * rect and items compared in different coordinate origins — and the repo already handles the
 * crop origin correctly in the two paths that BAKE pixels (`pdfElementRenderer`'s
 * `cropOriginX/Y`, and the OCR burn's `unrot.viewBox[0]/[1]`). It was missing in exactly the
 * paths that EXTRACT text. That asymmetry is the whole bug.
 *
 * ── Why a real browser ────────────────────────────────────────────────────────────
 * jsdom has no canvas and cannot run pdf.js `getViewport` / `render`, and the image channel
 * requires a real off-screen render to populate `page.objs`. A fixture that stubs pdf.js
 * would have to encode the very convention under test, which is how the previous rotation
 * guard came to pass against the code it replaced.
 *
 * ── The matrix, and why it is shaped this way ─────────────────────────────────────
 * Origin ∈ {(0,0), (30,70)} × totalRot ∈ {0, 90, 180, 270}. The origin is deliberately
 * ASYMMETRIC (30 ≠ 70): a square origin lets an x/y transposition pass green. The zero-origin
 * row is the CONTROL — it must pass both before and after the fix, proving the fix changes
 * nothing for ordinary pages. The rotation axis is not optional here: the audit's own recorded
 * lesson is that a rotation bug shipped INSIDE a rotation fix because every test ran at
 * rotation 0. This one must not ship an origin bug inside an origin fix.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { contentRectToDisplay } from '../../src/utils/geometry';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/** The two private extractors this file guards. Both are reached through the public exports. */
type Ext = {
  _extractFlowDoc(): Promise<FlowDoc>;
  _extractPageTableData(p: unknown): Promise<{ items: Array<{ text: string }> } | null>;
};

const SECRET = 'SECRETWORD';
const PUBLIC = 'PUBLICWORD';

/**
 * MediaBox is always 400×400; the CropBox is 300×240 placed at `origin`.
 *
 * The crop box is deliberately NON-SQUARE, and that is load-bearing rather than incidental. A
 * square box makes a width/height SWAP invisible, so every rotation row would pass against code
 * that mixes the two up — which is exactly how the earlier rotation guard came to pass against
 * the defect it was written for. Verified by sabotage: with a 300×300 box, re-shipping the
 * `/Rotate` leak on the pre-fix code changed nothing (14 failed either way); with 300×240 it is
 * detected. The ORIGIN is asymmetric (30 ≠ 70) for the same reason on the other axis.
 */
const MEDIA = 400;
const CROP_W = 300;
const CROP_H = 240;
const FONT_SIZE = 14;

/**
 * Content-space redaction rect, y-DOWN from the crop box's top-left, covering the secret
 * and nothing else. The secret's baseline sits 50pt below the crop top, so its glyph box spans
 * y-down 36..50, inside this rect's 20..70; the public word sits at y-down 196..210, far
 * outside it. Both words are at crop-relative x 70..~160, inside this rect's 50..250.
 */
const RED_CONTENT = { x: 50, y: 20, width: 200, height: 50 };

/**
 * Build a one-page PDF whose CropBox origin is `(ox, oy)` and whose intrinsic rotation is
 * `pageRot`. Both words are drawn in ABSOLUTE user space, inside the crop box.
 */
async function buildPdf(ox: number, oy: number, pageRot: number): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([MEDIA, MEDIA]);
  page.setCropBox(ox, oy, CROP_W, CROP_H);
  if (pageRot) page.setRotation((await import('@cantoo/pdf-lib')).degrees(pageRot));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Absolute y: crop top is oy + CROP_H. Secret 50pt below it, public 30pt above the crop bottom.
  page.drawText(SECRET, { x: ox + 70, y: oy + CROP_H - 50, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  page.drawText(PUBLIC, { x: ox + 70, y: oy + 30, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  return doc.save();
}

/** A solid PNG, used as the source-image payload for the image-channel case. */
function pngBytes(w: number, h: number): Uint8Array {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(8, 8, w - 16, h - 16);
  return Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0));
}

/** Same page, plus an image XObject covering the same region the redaction will cover. */
async function buildPdfWithImage(ox: number, oy: number): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([MEDIA, MEDIA]);
  page.setCropBox(ox, oy, CROP_W, CROP_H);
  const img = await doc.embedPng(pngBytes(256, 256));
  // y-up: the redaction covers y-down 20..70 from the crop top → absolute y (oy+CROP_H-70)..(oy+CROP_H-20).
  page.drawImage(img, { x: ox + 60, y: oy + CROP_H - 68, width: 180, height: 46 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(PUBLIC, { x: ox + 70, y: oy + 30, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  return doc.save();
}

function makeSvc(doc: pdfjsLib.PDFDocumentProxy, elements: unknown[], userRot = 0): Ext {
  const ctx = {
    documentModel: {
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot }],
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements,
  } as unknown as IExportContext;
  return new ExportService(ctx) as unknown as Ext;
}

/**
 * The redaction element as the editor stores it: DISPLAY space, y-down, at the page's
 * CURRENT on-screen orientation. Derived from the content rect through the repo's own tested
 * inverse mapping, so the box lands over the secret wherever rotation puts it on screen.
 */
function redactionEl(totalRot: number) {
  const d = contentRectToDisplay(RED_CONTENT, CROP_W, CROP_H, totalRot);
  return { pageId: 'p1', type: 'redaction', x: d.x, y: d.y, width: d.width, height: d.height };
}

const ORIGINS: Array<{ label: string; ox: number; oy: number }> = [
  { label: 'origin (0,0) — CONTROL, must pass before and after the fix', ox: 0, oy: 0 },
  { label: 'origin (30,70) — asymmetric, the leak case', ox: 30, oy: 70 },
];
/** `pageRot` is the intrinsic `/Rotate`; `userRot` is the editor's own rotation. */
const ROTATIONS: Array<{ pageRot: number; userRot: number }> = [
  { pageRot: 0, userRot: 0 },
  { pageRot: 90, userRot: 0 },
  { pageRot: 0, userRot: 90 },
  { pageRot: 180, userRot: 0 },
  { pageRot: 270, userRot: 0 },
  { pageRot: 90, userRot: 180 },
];

describe('redaction filter vs a non-zero CropBox origin', () => {
  /**
   * Contract pin on pdf.js itself. Everything below depends on text items being reported in
   * ABSOLUTE user space rather than relative to the CropBox. If a pdf.js upgrade ever changes
   * that, the fix becomes a double-shift and this test says so directly instead of letting six
   * opaque redaction failures imply it.
   */
  it('pdf.js reports text items in ABSOLUTE user space, not CropBox-relative', async () => {
    const doc = await pdfjsLib.getDocument({ data: (await buildPdf(30, 70, 0)).slice(0) }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    expect(Array.from(vp.viewBox)).toEqual([30, 70, 330, 310]);
    const items = (await page.getTextContent()).items as Array<{ str: string; transform: number[] }>;
    const secret = items.find(i => i.str.includes(SECRET));
    expect(secret).toBeDefined();
    // Drawn at absolute x = 30 + 70 = 100. CropBox-relative would report 70.
    expect(secret?.transform[4]).toBeCloseTo(100, 1);
  });

  for (const { label, ox, oy } of ORIGINS) {
    describe(label, () => {
      for (const { pageRot, userRot } of ROTATIONS) {
        const rotLabel = `/Rotate ${pageRot} + user ${userRot}`;

        it(`flow export (DOCX/MD/TXT) drops the redacted word — ${rotLabel}`, async () => {
          const bytes = await buildPdf(ox, oy, pageRot);
          const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
          const totalRot = ((pageRot + userRot) % 360 + 360) % 360;
          const flow = await makeSvc(doc, [redactionEl(totalRot)], userRot)._extractFlowDoc();
          const text = JSON.stringify(flow.pages[0].paragraphs);
          // The positive half is the leak; the negative half proves the filter did not simply
          // drop everything, which a mis-mapped rect can also do (it dropped innocent cells
          // at some rotations before the /Rotate fix).
          expect(text).not.toContain(SECRET);
          expect(text).toContain(PUBLIC);
        });

        it(`table extraction (CSV/XLSX) drops the redacted word — ${rotLabel}`, async () => {
          const bytes = await buildPdf(ox, oy, pageRot);
          const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
          const totalRot = ((pageRot + userRot) % 360 + 360) % 360;
          const svc = makeSvc(doc, [redactionEl(totalRot)], userRot);
          const data = await svc._extractPageTableData(
            { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot },
          );
          const joined = (data?.items ?? []).map(i => i.text).join('|');
          expect(joined).not.toContain(SECRET);
          expect(joined).toContain(PUBLIC);
        });
      }

      it('flow export drops a source IMAGE sitting under a redaction', async () => {
        const bytes = await buildPdfWithImage(ox, oy);
        const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

        // CONTROL: with no redaction the image IS extracted, so a later `0` cannot be the
        // trivial consequence of the image channel simply not working on this fixture.
        const clean = await makeSvc(doc, [])._extractFlowDoc();
        expect(clean.pages[0].images?.length ?? 0).toBe(1);

        const doc2 = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        const flow = await makeSvc(doc2, [redactionEl(0)])._extractFlowDoc();
        expect(flow.pages[0].images?.length ?? 0).toBe(0);
        // The rest of the page must survive: a filter that drops every image is not a fix.
        expect(JSON.stringify(flow.pages[0].paragraphs)).toContain(PUBLIC);
      });
    });
  }
});
