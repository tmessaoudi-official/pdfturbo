import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { sanitizeWinAnsi, docModelToPdfBytes } from '../../src/docx/docxToPdf';
import type { DocModel } from '../../src/docx/docModel';

const para = (text: string, bold = false, italic = false): DocModel['paragraphs'][number] => ({
  runs: [{ text, bold, italic }],
});

describe('sanitizeWinAnsi', () => {
  it('passes ASCII and Latin-1/CP1252 through unchanged', () => {
    expect(sanitizeWinAnsi('Hello, café — €5 “quote”')).toEqual({
      text: 'Hello, café — €5 “quote”',
      replaced: false,
    });
  });

  it('replaces non-WinAnsi (CJK / emoji) with ? and flags it', () => {
    // for…of iterates by code point: 2 CJK → "??", emoji (surrogate pair) → one "?".
    const r = sanitizeWinAnsi('hi 世界 🚀');
    expect(r.text).toBe('hi ?? ?');
    expect(r.replaced).toBe(true);
  });

  it('keeps whitespace (tab/newline) intact and reports no replacement', () => {
    expect(sanitizeWinAnsi('a\tb\nc')).toEqual({ text: 'a\tb\nc', replaced: false });
  });
});

describe('docModelToPdfBytes', () => {
  it('produces a loadable 1-page PDF for a short document', async () => {
    const { bytes, hadUnsupportedChars } = await docModelToPdfBytes({
      paragraphs: [para('Hello world'), para('Second paragraph')],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(hadUnsupportedChars).toBe(false);
  });

  it('paginates a long document onto multiple pages', async () => {
    const paragraphs = Array.from({ length: 200 }, (_, i) => para(`Paragraph number ${i}`));
    const { bytes } = await docModelToPdfBytes({ paragraphs });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('flags unsupported characters from the document text', async () => {
    const { hadUnsupportedChars } = await docModelToPdfBytes({ paragraphs: [para('東京')] });
    expect(hadUnsupportedChars).toBe(true);
  });

  it('hard-breaks a single token wider than the content width without throwing', async () => {
    const long = 'x'.repeat(2000);
    const { bytes } = await docModelToPdfBytes({ paragraphs: [para(long)] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('preserves inter-run spaces and renders bold via Helvetica-Bold', async () => {
    const { bytes } = await docModelToPdfBytes({
      paragraphs: [{ runs: [{ text: 'The ' }, { text: 'bold', bold: true }, { text: ' word' }] }],
    });
    expect(new TextDecoder('latin1').decode(bytes)).toContain('Helvetica-Bold');
  });

  it('renders an empty document as a valid 1-page PDF', async () => {
    const { bytes } = await docModelToPdfBytes({ paragraphs: [] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
