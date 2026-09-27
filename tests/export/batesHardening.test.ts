/**
 * Limits row 28 (D22) — Bates hardening: every settings object that reaches the stamp goes through
 * `normalizeBatesSettings` (a restored session blob can hold anything), the start number is capped so the
 * number stays an exact integer written in digits, and a stamp wider than the page shrinks to fit rather than
 * running off it.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';
import {
  normalizeBatesSettings, batesStampText, BATES_MAX_START, type BatesSettings,
} from '../../src/export/batesStamp';
import { drawBatesOnPage } from '../../src/export/exportPipeline';

const DEF: BatesSettings = {
  enabled: false, mode: 'page', prefix: '', startNumber: 1, digits: 6, position: 'br', fontSize: 10, color: '#555555',
};

describe('normalizeBatesSettings (row 28)', () => {
  it('passes a valid object through unchanged, as a copy', () => {
    const ok: BatesSettings = {
      enabled: true, mode: 'bates', prefix: 'ACME-', startNumber: 0, digits: 12, position: 'tl', fontSize: 72, color: '#AbCdEf',
    };
    const out = normalizeBatesSettings(ok, DEF);
    expect(out).toEqual(ok);
    expect(out).not.toBe(ok);
  });

  it('falls back whole for a non-object', () => {
    for (const raw of [null, undefined, 3, 'x', [1, 2]]) expect(normalizeBatesSettings(raw, DEF)).toEqual(DEF);
  });

  it('replaces each wrong-typed or out-of-set field with the fallback, field by field', () => {
    const out = normalizeBatesSettings({
      enabled: 'yes', mode: 'roman', prefix: 42, startNumber: 'NaN', digits: {}, position: 'middle',
      fontSize: null, color: 'red',
    }, DEF);
    expect(out).toEqual(DEF);
  });

  it('keeps the valid fields of a partly broken object', () => {
    const out = normalizeBatesSettings({ enabled: true, mode: 'bates', prefix: 'X-', color: 'nope' }, DEF);
    expect(out).toEqual({ ...DEF, enabled: true, mode: 'bates', prefix: 'X-' });
  });

  it('clamps numbers into range and truncates fractions', () => {
    const out = normalizeBatesSettings({ ...DEF, startNumber: -5, digits: 99, fontSize: 1000 }, DEF);
    expect([out.startNumber, out.digits, out.fontSize]).toEqual([0, 12, 72]);
    const low = normalizeBatesSettings({ ...DEF, startNumber: 7.9, digits: 0, fontSize: 2 }, DEF);
    expect([low.startNumber, low.digits, low.fontSize]).toEqual([7, 1, 6]);
  });

  it('caps an oversized start number, including Infinity and values past 2^53', () => {
    for (const n of [1e13, 2 ** 60, Number.MAX_VALUE, Infinity]) {
      expect(normalizeBatesSettings({ ...DEF, startNumber: n }, DEF).startNumber).toBe(n === Infinity ? DEF.startNumber : BATES_MAX_START);
    }
  });

  it('at the cap the stamp is still written in plain digits, never exponent form', () => {
    const s = normalizeBatesSettings({ ...DEF, mode: 'bates', startNumber: 1e30 }, DEF);
    const text = batesStampText(s, 5000, 5000);
    expect(text).toMatch(/^\d+$/);
    expect(text).toBe(String(BATES_MAX_START + 4999));
  });
});

async function drawnStamp(s: BatesSettings, size: [number, number], rot = 0) {
  const pdfDoc = await PDFDocument.create();
  const calls: { text: string; x: number; y: number; size: number }[] = [];
  const page = { drawText: (text: string, o: { x: number; y: number; size: number }) => calls.push({ text, x: o.x, y: o.y, size: o.size }) };
  await drawBatesOnPage(page as never, size[0], size[1], 0, 0, s, 3, 10, { rgb, degrees, pdfDoc, StandardFonts } as never, rot);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  return { ...calls[0], width: font.widthOfTextAtSize(calls[0].text, calls[0].size) };
}

describe('drawBatesOnPage — a stamp wider than the page shrinks to fit (row 28)', () => {
  const long: BatesSettings = { ...DEF, enabled: true, mode: 'bates', prefix: 'CONFIDENTIAL-MATTER-2026-ACME-', digits: 12, fontSize: 72, position: 'bl' };

  it('keeps a stamp that fits at the chosen size (unchanged draw)', async () => {
    const d = await drawnStamp({ ...DEF, enabled: true, fontSize: 10 }, [612, 792]);
    expect(d.size).toBe(10);
  });

  it('shrinks an over-wide stamp so it lies inside the side margins', async () => {
    const d = await drawnStamp(long, [612, 792]);
    expect(d.size).toBeLessThan(72);
    expect(d.x).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(d.x + d.width).toBeLessThanOrEqual(612 - 24 + 1e-6);
  });

  it('measures the width against the VISIBLE page on a turned page', async () => {
    // 792 × 300 page turned 90°: the visible width is 300, so a stamp that would fit 792 must still shrink.
    const s: BatesSettings = { ...long, prefix: 'ACME-', digits: 12, fontSize: 40 };
    const upright = await drawnStamp(s, [792, 300], 0);
    const turned = await drawnStamp(s, [792, 300], 90);
    expect(upright.size).toBe(40);
    expect(turned.size).toBeLessThan(40);
    expect(turned.width).toBeLessThanOrEqual(300 - 48 + 1e-6);
  });
});
