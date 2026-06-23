/**
 * QA sweep 2026-06-23 — P3 Theme D (UX feedback & polish) pure-logic guards.
 * Covers the extractable units of #11/#19/#20/#23/#24/#25; the DOM/canvas-bound
 * wirings (#22 toast, #28 CSV BOM) are code-reviewed in their call sites.
 */
import { describe, it, expect, vi } from 'vitest';
import { editedName } from '../../src/docx/docxEditorController';
import { dataUrlToBytes } from '../../src/handlers/signingHandler';
import { isBlackColor } from '../../src/elements/redactionElement';
import { clampCommentText, COMMENT_TEXT_CAP } from '../../src/export/pdfElementRenderer';
import { appearanceImageBandHeight } from '../../src/signing/pdfSigner';
import { MoveResizeCmd, TextEditCmd } from '../../src/core/commands/moveCmds';
import type { PDFElement } from '../../src/elements/annotationElement';

describe('#19 editedName — strips any trailing extension', () => {
  it('handles .docx and non-.docx sources', () => {
    expect(editedName('foo.docx')).toBe('foo-edited.docx');
    expect(editedName('foo.txt')).toBe('foo-edited.docx');
    expect(editedName('report.final.docx')).toBe('report.final-edited.docx');
    expect(editedName('noext')).toBe('noext-edited.docx');
  });
});

describe('#25 dataUrlToBytes — robust PNG data-URL parsing', () => {
  const tiny = 'iVBORw0KGgo=';
  it('accepts plain, uppercase-mime, param-bearing and whitespaced PNG urls', () => {
    expect(dataUrlToBytes(`data:image/png;base64,${tiny}`)).toBeInstanceOf(Uint8Array);
    expect(dataUrlToBytes(`data:image/PNG;base64,${tiny}`)).toBeInstanceOf(Uint8Array);
    expect(dataUrlToBytes(`data:image/png;charset=utf-8;base64,${tiny}`)).toBeInstanceOf(Uint8Array);
    expect(dataUrlToBytes(`data:image/png;base64,iVBO Rw0K Ggo=`)).toBeInstanceOf(Uint8Array);
  });
  it('rejects null and non-PNG mimes (caller falls back to text-only)', () => {
    expect(dataUrlToBytes(null)).toBeUndefined();
    expect(dataUrlToBytes('data:image/jpeg;base64,/9j/4AAQ')).toBeUndefined();
    expect(dataUrlToBytes('not a data url')).toBeUndefined();
  });
});

describe('#23 isBlackColor — robust black detection', () => {
  it('matches black in any common notation', () => {
    expect(isBlackColor('#000000')).toBe(true);
    expect(isBlackColor('#000')).toBe(true);
    expect(isBlackColor('#000000'.toUpperCase())).toBe(true);
    expect(isBlackColor('rgb(0,0,0)')).toBe(true);
    expect(isBlackColor('rgb(0, 0, 0)')).toBe(true);
  });
  it('does not match non-black', () => {
    expect(isBlackColor('#010101')).toBe(false);
    expect(isBlackColor('#ffffff')).toBe(false);
    expect(isBlackColor('rgb(0,0,1)')).toBe(false);
  });
});

describe('#11 clampCommentText — non-silent truncation', () => {
  it('passes short text through unchanged', () => {
    expect(clampCommentText('hello')).toBe('hello');
  });
  it('truncates with an ellipsis past the cap', () => {
    const out = clampCommentText('x'.repeat(COMMENT_TEXT_CAP + 50));
    expect(out.length).toBe(COMMENT_TEXT_CAP);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('#24 appearanceImageBandHeight — keeps a legible text band', () => {
  it('uses 60% for the image on a tall rect', () => {
    expect(appearanceImageBandHeight(100, 4, 2)).toBeCloseTo(60, 5);
  });
  it('shrinks the image band so the text band fits every line on a short rect', () => {
    const rectH = 30, padding = 4, lines = 3;
    const imgBand = appearanceImageBandHeight(rectH, padding, lines);
    const textBand = rectH - imgBand;
    expect(textBand).toBeGreaterThanOrEqual(padding + lines * 6 * 1.25 - 0.001);
  });
  it('collapses the image band to 0 when the rect is too small for even minimal text', () => {
    expect(appearanceImageBandHeight(10, 4, 3)).toBe(0);
  });
});

describe('#20 element commands warn on a stale target (no silent no-op)', () => {
  function elem(id: number): PDFElement {
    return { id, x: 0, y: 0, width: 1, height: 1 } as unknown as PDFElement;
  }
  it('MoveResizeCmd warns when the id is gone from the live array', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cmd = new MoveResizeCmd([], elem(99), { x: 0 }, { x: 5 });
    cmd.execute();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('MoveResizeCmd'));
    spy.mockRestore();
  });
  it('TextEditCmd warns when the id is gone', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new TextEditCmd([], 99, 'a', 'b').execute();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('TextEditCmd'));
    spy.mockRestore();
  });
});
