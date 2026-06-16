/**
 * Bates / page-numbering stamp text (#61), pure. The number reflects the page's
 * position in the FULL document (so "page 5 of 10" / Bates id stay correct even
 * when exporting a single page or a range). drawBatesOnPage (geometry) and the
 * pipeline threading are covered by the export-path tests.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';
import { batesStampText, batesPosition, type BatesSettings } from '../../src/export/batesStamp';
import { buildPageOverlays } from '../../src/export/exportPipeline';

const base: BatesSettings = {
  enabled: true, mode: 'page', prefix: '', startNumber: 1, digits: 6, position: 'br', fontSize: 10, color: '#555555',
};

describe('batesStampText (#61)', () => {
  it('formats page mode as "N / total"', () => {
    expect(batesStampText({ ...base, mode: 'page' }, 5, 10)).toBe('5 / 10');
  });

  it('formats Bates mode as prefix + zero-padded sequential number from startNumber', () => {
    const s: BatesSettings = { ...base, mode: 'bates', prefix: 'ACME-', startNumber: 1, digits: 6 };
    expect(batesStampText(s, 1, 10)).toBe('ACME-000001');
    expect(batesStampText(s, 42, 100)).toBe('ACME-000042');
  });

  it('honours a non-1 startNumber and custom digit width', () => {
    const s: BatesSettings = { ...base, mode: 'bates', prefix: 'D', startNumber: 1000, digits: 4 };
    expect(batesStampText(s, 1, 5)).toBe('D1000');   // 1000 already 4 digits
    expect(batesStampText(s, 3, 5)).toBe('D1002');
  });
});

describe('batesPosition (#61)', () => {
  const W = 600, H = 800, M = 24, tw = 50, fs = 10;
  it('places bottom-right inside the margin', () => {
    const p = batesPosition('br', W, H, tw, fs, M);
    expect(p.x).toBeCloseTo(W - M - tw);
    expect(p.y).toBeCloseTo(M);
  });
  it('places top-left inside the margin', () => {
    const p = batesPosition('tl', W, H, tw, fs, M);
    expect(p.x).toBeCloseTo(M);
    expect(p.y).toBeCloseTo(H - M - fs);
  });
  it('centres horizontally for *-center positions', () => {
    expect(batesPosition('bc', W, H, tw, fs, M).x).toBeCloseTo((W - tw) / 2);
    expect(batesPosition('tc', W, H, tw, fs, M).x).toBeCloseTo((W - tw) / 2);
  });
});

describe('buildPageOverlays Bates integration (#61)', () => {
  const settings: BatesSettings = {
    enabled: true, mode: 'page', prefix: '', startNumber: 1, digits: 6, position: 'br', fontSize: 10, color: '#555555',
  };
  const stub = {
    inkLayer: { getStrokes: () => [] } as never,
    reportError: { warn() {}, silent() {} } as never,
    watermark: { enabled: false } as never,
    docPage: { id: 'p1', rotation: 0 } as never,
  };

  async function drawnTexts(ctxBates: BatesSettings | undefined, pageNumber?: number, pageCount?: number): Promise<string[]> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const texts: string[] = [];
    const orig = page.drawText.bind(page);
    page.drawText = (t: string, o?: Parameters<typeof orig>[1]) => { texts.push(String(t)); return orig(t, o); };
    await buildPageOverlays({
      pdfDoc: doc, page, docPage: stub.docPage, elements: [], pdfLib: { rgb, degrees, StandardFonts },
      userRot: 0, sourceRot: 0, watermark: stub.watermark, inkLayer: stub.inkLayer, reportError: stub.reportError,
      bates: ctxBates, pageNumber, pageCount,
    });
    return texts;
  }

  it('stamps the page-number text through the full overlay pipeline', async () => {
    expect(await drawnTexts(settings, 5, 10)).toContain('5 / 10');
  });

  it('stamps a Bates id in bates mode', async () => {
    expect(await drawnTexts({ ...settings, mode: 'bates', prefix: 'X-' }, 3, 10)).toContain('X-000003');
  });

  it('draws nothing when Bates is disabled or absent (export stays byte-identical)', async () => {
    expect(await drawnTexts({ ...settings, enabled: false }, 1, 10)).toEqual([]);
    expect(await drawnTexts(undefined, 1, 10)).toEqual([]);
  });
});
