/**
 * B5 — running header/footer detection for PDF→DOCX.
 *
 * `detectRepeatedBands` finds a paragraph that recurs in the top (header) or
 * bottom (footer) y-band across most pages, so the DOCX writer can hoist it into
 * a Word Header/Footer instead of repeating it inline. Conservative by design
 * (≥3 pages, ≥60% recurrence, tight band, digit-normalized so page numbers still
 * match) so it never hoists genuine body text — the no-false-positive guard is
 * the regression safety.
 */
import { describe, it, expect } from 'vitest';
import { detectRepeatedBands, applyRepeatedBands, type FlowPage, type FlowDoc } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';

async function unpackDocx(b64: string): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(Buffer.from(b64, 'base64')));
  const out: Record<string, string> = {};
  for (const [p, d] of Object.entries(files)) out[p] = strFromU8(d as Uint8Array);
  return out;
}

// Minimal FlowPage with one band paragraph + one body paragraph. y is PDF y-up
// (top = high y). height 800: header band ≥704, footer band ≤96.
function page(headerText: string | null, footerText: string | null, bodyText = 'body'): FlowPage {
  const mk = (text: string, y: number) => ({
    runs: [{ text, bold: false, italic: false, fontSize: 10, fontFamily: 'serif' as const, rtl: false }],
    heading: 0 as const, alignment: 'left' as const, rtl: false, y,
  });
  const paras = [mk(bodyText, 400)];
  if (headerText) paras.unshift(mk(headerText, 770));
  if (footerText) paras.push(mk(footerText, 40));
  return { width: 600, height: 800, paragraphs: paras };
}

describe('detectRepeatedBands (B5)', () => {
  it('detects a header repeated across ≥60% of ≥3 pages', () => {
    const pages = [page('Annual Report', null), page('Annual Report', null), page('Annual Report', null), page('Annual Report', null)];
    expect(detectRepeatedBands(pages).header).toBe('Annual Report');
  });

  it('detects a footer, digit-normalized so page numbers still match', () => {
    const pages = [page(null, 'Page 1 of 4'), page(null, 'Page 2 of 4'), page(null, 'Page 3 of 4'), page(null, 'Page 4 of 4')];
    expect(detectRepeatedBands(pages).footer).toBeTruthy();
    expect(detectRepeatedBands(pages).header).toBeUndefined();
  });

  it('does NOT hoist (needs ≥3 pages)', () => {
    const pages = [page('Header', null), page('Header', null)];
    expect(detectRepeatedBands(pages)).toEqual({});
  });

  it('does NOT hoist unique top lines (no false positive on body)', () => {
    const pages = [page('Intro Section', null), page('Methods Section', null), page('Results Section', null), page('Discussion', null)];
    expect(detectRepeatedBands(pages).header).toBeUndefined();
  });

  it('does NOT hoist a band line present on only 1 of 4 pages', () => {
    const pages = [page('One-off', null), page(null, null), page(null, null), page(null, null)];
    expect(detectRepeatedBands(pages).header).toBeUndefined();
  });
});

describe('applyRepeatedBands (B5)', () => {
  it('sets doc.header/footer and removes the hoisted band paragraphs (no inline dup)', () => {
    const doc: FlowDoc = { pages: [page('Annual Report', 'Page 1'), page('Annual Report', 'Page 2'), page('Annual Report', 'Page 3')] };
    applyRepeatedBands(doc);
    expect(doc.header).toBe('Annual Report');
    expect(doc.footer).toBeTruthy();
    // every page keeps its body, drops the header+footer band paragraphs
    for (const p of doc.pages) {
      const texts = p.paragraphs.map(par => par.runs.map(r => r.text).join(''));
      expect(texts).toContain('body');
      expect(texts).not.toContain('Annual Report');
    }
  });

  it('is a no-op (byte-identical) when no band recurs (<3 pages)', () => {
    const doc: FlowDoc = { pages: [page('Header', null), page('Header', null)] };
    const before = JSON.stringify(doc);
    applyRepeatedBands(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.header).toBeUndefined();
  });
});

describe('flowDocToDocxBase64 — header/footer parts (B5)', () => {
  it('emits a word/header part when doc.header is set; none when unset', async () => {
    const withHdr: FlowDoc = { header: 'Annual Report', footer: 'Confidential', pages: [page('body', null)] };
    const partsWith = Object.keys(await unpackDocx(await flowDocToDocxBase64(withHdr)));
    expect(partsWith.some(p => /word\/header\d*\.xml/.test(p))).toBe(true);
    expect(partsWith.some(p => /word\/footer\d*\.xml/.test(p))).toBe(true);

    const without: FlowDoc = { pages: [page('body', null)] };
    const partsWithout = Object.keys(await unpackDocx(await flowDocToDocxBase64(without)));
    expect(partsWithout.some(p => /word\/header\d*\.xml/.test(p))).toBe(false);
  });
});
