/**
 * A1 (limits walkthrough, 2026-09-25) — a redaction over VERTICAL-writing text.
 *
 * pdf.js reports a vertical run (`dir: 'ttb'`) with its size fields swapped — `width` is the glyph
 * size, `height` the advance — and the advance runs DOWNWARD from the origin while the glyphs sit
 * CENTRED on it. `isItemRedacted` used to read every run as horizontal, so it tested a box to the
 * right of the origin and ABOVE it: the wrong side on both axes. A redaction over the column missed
 * the text (a leak into DOCX / Markdown / TXT / CSV / XLSX) and one drawn above the column's first
 * glyph removed it (data loss).
 *
 * Two genuinely vertical fixtures, both checked to BE vertical to pdf.js before anything else runs
 * — a fixture that is not vertical to pdf.js tests nothing:
 *  - `pdfjs-vertical.pdf`: pdf.js's own `test/pdfs/vertical.pdf` (dvipdfmx, `Identity-V`, an
 *    embedded subset of AokinMincho). Needs the CMap files, like any `Identity-V` font without a
 *    usable ToUnicode.
 *  - a synthetic `Identity-V` run built from the bundled Noto Naskh digits with DEFAULT vertical
 *    metrics, which pdf.js places from −DW/2 across rather than centring it on the glyph.
 * Plus `libreoffice-tb-rl.pdf`: LibreOffice's vertical Japanese, which is NOT a vertical font —
 * LibreOffice emits one horizontal glyph per position — kept to pin that the common producer takes
 * the horizontal path and stays correct.
 *
 * The footprint is certified against INK, not against a reading of the source: every vertical run
 * is rendered, its dark-pixel box measured, and the tested footprint must reach every edge of that
 * box while overshooting it by no more than 0.7 em on any side.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fontkit from '@pdf-lib/fontkit';
import { adaptFontkit } from '../../src/utils/fontkitAdapter';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { isItemRedacted, type FlowDoc, type RawTextItem } from '../../src/utils/flowDoc';
import { contentRectToDisplay } from '../../src/utils/geometry';
import realUrl from '../fixtures/vertical/pdfjs-vertical.pdf?url';
import libreUrl from '../fixtures/vertical/libreoffice-tb-rl.pdf?url';
import fontUrl from '../../src/assets/fonts/NotoNaskhArabic-Regular.ttf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;
const CMAPS = '/node_modules/pdfjs-dist/cmaps/';

type Ext = {
  _extractFlowDoc(): Promise<FlowDoc>;
  _extractPageTableData(p: unknown): Promise<{ items: Array<{ text: string }> } | null>;
};
type Box = { x0: number; x1: number; yLo: number; yHi: number };

const SECRET = '0123456', PUBLIC = '789';

/** A synthetic `Identity-V` page: the secret column at x=150 and the public one at x=90, both from y=220 down. */
async function synthetic(opts: { rotate?: number; crop?: [number, number, number, number] } = {}): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFDict, degrees } = await import('@cantoo/pdf-lib');
  const ttf = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const doc = await PDFDocument.create();
  doc.registerFontkit(adaptFontkit(fontkit));
  const font = await doc.embedFont(ttf, { subset: true });
  const page = doc.addPage([300, 260]);
  page.drawText(SECRET, { x: 150, y: 220, size: 20, font });
  page.drawText(PUBLIC, { x: 90, y: 220, size: 20, font });
  if (opts.rotate) page.setRotation(degrees(opts.rotate));
  if (opts.crop) {
    const [x0, y0, x1, y1] = opts.crop;
    page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  }
  // pdf-lib writes `Identity-H`; the embedder builds the dict at save, so rewrite after a round trip.
  const again = await PDFDocument.load(await doc.save());
  let rewritten = 0;
  for (const [, obj] of again.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Subtype'))?.toString() === '/Type0') {
      obj.set(PDFName.of('Encoding'), PDFName.of('Identity-V'));
      rewritten++;
    }
  }
  if (rewritten !== 1) throw new Error(`expected one Type0 font, rewrote ${rewritten}`);
  return again.save();
}

const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const open = (bytes: Uint8Array) =>
  pdfjsLib.getDocument({ data: bytes.slice(0), cMapUrl: CMAPS, cMapPacked: true }).promise;

/** Dark-pixel box of one item's ink, in PDF user space, rendered at rotation 0. */
async function inkOf(bytes: Uint8Array): Promise<Array<{ item: RawTextItem; ink: Box; vertical: boolean; top: number }>> {
  const doc = await open(bytes);
  const page = await doc.getPage(1);
  const S = 4;
  const vp = page.getViewport({ scale: S, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas } as never).promise;
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const tc = await page.getTextContent();
  const [vx0, , , vy1] = page.view;
  const out = [];
  for (const ti of tc.items as unknown as RawTextItem[]) {
    if (!ti.str) continue;
    const [, , , , e, f] = ti.transform;
    const w = ti.width, h = ti.height;
    const sx0 = e - 1.2 * w, sx1 = e + 1.2 * w, sy0 = f - h - w, sy1 = f + w;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (let y = Math.max(0, Math.floor((vy1 - sy1) * S)); y < Math.min(canvas.height, (vy1 - sy0) * S); y++) {
      for (let x = Math.max(0, Math.floor((sx0 - vx0) * S)); x < Math.min(canvas.width, (sx1 - vx0) * S); x++) {
        const i = (y * canvas.width + x) * 4;
        if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) {
          mnX = Math.min(mnX, x); mxX = Math.max(mxX, x); mnY = Math.min(mnY, y); mxY = Math.max(mxY, y);
        }
      }
    }
    out.push({
      item: ti,
      vertical: (tc.styles as Record<string, { vertical?: boolean }>)[ti.fontName]?.vertical === true,
      top: vy1,
      ink: { x0: vx0 + mnX / S, x1: vx0 + (mxX + 1) / S, yHi: vy1 - mnY / S, yLo: vy1 - (mxY + 1) / S },
    });
  }
  return out;
}

/** A PDF-space box as a redaction rect in `isItemRedacted`'s frame (x absolute, y down from the crop top). */
const asRed = (b: Box, top: number) => ({ x: b.x0, y: top - b.yHi, width: b.x1 - b.x0, height: b.yHi - b.yLo });

/** A PDF-space box as a DISPLAY-space redaction element for a page at `totalRot` with the given crop box. */
function displayRed(b: Box, vb: number[], totalRot: number) {
  const content = { x: b.x0 - vb[0], y: vb[3] - b.yHi, width: b.x1 - b.x0, height: b.yHi - b.yLo };
  return contentRectToDisplay(content, vb[2] - vb[0], vb[3] - vb[1], totalRot);
}

async function svc(bytes: Uint8Array, userRot: number, red: Box): Promise<Ext> {
  const doc = await open(bytes);
  const page = await doc.getPage(1);
  const totalRot = (((page.rotate + userRot) % 360) + 360) % 360;
  return new ExportService({
    documentModel: {
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot }],
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements: [{ pageId: 'p1', type: 'redaction', ...displayRed(red, page.view, totalRot) }],
  } as unknown as IExportContext) as unknown as Ext;
}

async function flowText(bytes: Uint8Array, userRot: number, red: Box): Promise<string> {
  const flow = await (await svc(bytes, userRot, red))._extractFlowDoc();
  return flow.pages.flatMap(p => p.paragraphs.flatMap(par => par.runs.map(r => r.text))).join('|');
}
async function tableText(bytes: Uint8Array, userRot: number, red: Box): Promise<string> {
  const data = await (await svc(bytes, userRot, red))._extractPageTableData(
    { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot },
  );
  return (data?.items ?? []).map(i => i.text).join('|');
}
/** Every character of `s` absent / present, whatever order or grouping the reconstruction used. */
const hasAll = (text: string, s: string) => [...s].every(ch => text.includes(ch));
const hasNone = (text: string, s: string) => [...s].every(ch => !text.includes(ch));

// Synthetic geometry, from the measured ink: the secret column's glyphs span x ≈ 140.5..151 and
// y ≈ 82..217; the public one x ≈ 80.5..91.
const SYN_UNDER: Box = { x0: 141, x1: 150, yLo: 100, yHi: 150 }; // over the secret's ink only
const SYN_ABOVE: Box = { x0: 141, x1: 150, yLo: 226, yHi: 250 }; // above the column's first glyph — the old box
const SYN_RIGHT: Box = { x0: 164, x1: 175, yLo: 150, yHi: 250 }; // right of the column, overlapping the old box

describe('A1 — the fixtures are vertical to pdf.js (non-vacuity)', () => {
  it('the real and synthetic runs report dir ttb from a vertical font; the LibreOffice one does not', async () => {
    const real = await inkOf(await fetchBytes(realUrl));
    const syn = await inkOf(await synthetic());
    const lo = await inkOf(await fetchBytes(libreUrl));
    expect(real.length).toBe(2);
    expect(syn.length).toBe(2);
    for (const r of [...real, ...syn]) {
      expect(r.vertical).toBe(true);
      expect(r.item.dir).toBe('ttb');
    }
    expect(lo.length).toBeGreaterThan(20);
    for (const r of lo) {
      expect(r.vertical).toBe(false);
      expect(r.item.dir).toBe('ltr');
    }
  }, 120_000);
});

describe('A1 — the tested footprint against the MEASURED ink', () => {
  for (const [label, get] of [
    ['real dvipdfmx', () => fetchBytes(realUrl)],
    ['synthetic default metrics', () => synthetic()],
  ] as const) {
    it(`${label}: reaches every edge of each run's ink`, async () => {
      for (const { item, ink, top } of await inkOf(await get())) {
        const s = 0.3;
        const strips: Box[] = [
          { ...ink, x1: ink.x0 + s },
          { ...ink, x0: ink.x1 - s },
          { ...ink, yLo: ink.yHi - s },
          { ...ink, yHi: ink.yLo + s },
        ];
        for (const b of strips) expect(isItemRedacted(item, asRed(b, top), top), `${item.str} ${JSON.stringify(b)}`).toBe(true);
      }
    }, 120_000);

    it(`${label}: overshoots the ink by no more than 0.7 em on any side`, async () => {
      for (const { item, ink, top } of await inkOf(await get())) {
        const em = item.width; // a vertical run's width IS the glyph size
        const g = 0.7 * em, band = 3 * em;
        const outside: Box[] = [
          { ...ink, x0: ink.x0 - g - band, x1: ink.x0 - g },
          { ...ink, x0: ink.x1 + g, x1: ink.x1 + g + band },
          { ...ink, yLo: ink.yHi + g, yHi: ink.yHi + g + band },
          { ...ink, yLo: ink.yLo - g - band, yHi: ink.yLo - g },
        ];
        for (const b of outside) expect(isItemRedacted(item, asRed(b, top), top), `${item.str} ${JSON.stringify(b)}`).toBe(false);
      }
    }, 120_000);
  }
});

describe('A1 — end to end through the flow (DOCX/MD/TXT) and table (CSV/XLSX) extractors', () => {
  for (const userRot of [0, 90, 180, 270]) {
    it(`a redaction over the secret column removes it — user rotation ${userRot}`, async () => {
      const bytes = await synthetic();
      const flow = await flowText(bytes, userRot, SYN_UNDER);
      const table = await tableText(bytes, userRot, SYN_UNDER);
      expect(hasNone(flow, SECRET), flow).toBe(true);
      expect(hasNone(table, SECRET), table).toBe(true);
      expect(hasAll(flow, PUBLIC), flow).toBe(true);
      expect(hasAll(table, PUBLIC), table).toBe(true);
    }, 120_000);
  }

  it('a /Rotate 90 page, with and without a user rotation', async () => {
    const bytes = await synthetic({ rotate: 90 });
    for (const userRot of [0, 90]) {
      const flow = await flowText(bytes, userRot, SYN_UNDER);
      const table = await tableText(bytes, userRot, SYN_UNDER);
      expect(hasNone(flow, SECRET) && hasNone(table, SECRET), `${userRot}: ${flow} / ${table}`).toBe(true);
      expect(hasAll(flow, PUBLIC) && hasAll(table, PUBLIC), `${userRot}: ${flow} / ${table}`).toBe(true);
    }
  }, 120_000);

  it('a non-zero CropBox origin (the C22 lockstep)', async () => {
    const bytes = await synthetic({ crop: [30, 40, 290, 250] });
    const flow = await flowText(bytes, 0, SYN_UNDER);
    const table = await tableText(bytes, 0, SYN_UNDER);
    expect(hasNone(flow, SECRET) && hasNone(table, SECRET), `${flow} / ${table}`).toBe(true);
    expect(hasAll(flow, PUBLIC) && hasAll(table, PUBLIC), `${flow} / ${table}`).toBe(true);
  }, 120_000);

  it('a redaction ABOVE the column (where the old box sat) keeps the text — the data-loss mirror', async () => {
    const bytes = await synthetic();
    for (const red of [SYN_ABOVE, SYN_RIGHT]) {
      const flow = await flowText(bytes, 0, red);
      const table = await tableText(bytes, 0, red);
      expect(hasAll(flow, SECRET) && hasAll(table, SECRET), `${JSON.stringify(red)}: ${flow} / ${table}`).toBe(true);
    }
  }, 120_000);

  it('the real dvipdfmx file: the lower half of あいうえお removes it, 日本語 stays; above the column keeps both', async () => {
    const bytes = await fetchBytes(realUrl);
    // Measured ink: あいうえお x 230..237.75, y 254..298.5; 日本語 x 214..222.75.
    const under: Box = { x0: 230, x1: 237, yLo: 256, yHi: 275 };
    const above: Box = { x0: 230, x1: 237, yLo: 302, yHi: 318 };
    const flowU = await flowText(bytes, 0, under);
    const tableU = await tableText(bytes, 0, under);
    expect(hasNone(flowU, 'あいうえお') && hasNone(tableU, 'あいうえお'), `${flowU} / ${tableU}`).toBe(true);
    expect(hasAll(flowU, '日本語') && hasAll(tableU, '日本語'), `${flowU} / ${tableU}`).toBe(true);
    const flowA = await flowText(bytes, 0, above);
    expect(hasAll(flowA, 'あいうえお') && hasAll(flowA, '日本語'), flowA).toBe(true);
  }, 120_000);

  it('LibreOffice tb-rl (one horizontal glyph per position): the covered column goes, both neighbours stay', async () => {
    const bytes = await fetchBytes(libreUrl);
    // Items at x 334.55 (秘密情報機密事項), 357.55 (公開文書の本文です) and 311.55 (第三段落の公開文), glyphs 16pt wide.
    const red: Box = { x0: 337, x1: 348, yLo: 100, yHi: 255 };
    const flow = await flowText(bytes, 0, red);
    const table = await tableText(bytes, 0, red);
    expect(hasNone(flow, '秘情報機事項') && hasNone(table, '秘情報機事項'), `${flow} / ${table}`).toBe(true);
    expect(hasAll(flow, '公開文書本') && hasAll(flow, '第三段落'), flow).toBe(true);
    expect(hasAll(table, '公開文書本') && hasAll(table, '第三段落'), table).toBe(true);
  }, 120_000);
});
