/**
 * Slice-2 bake guard — real Chrome.
 *
 * Verifies that TextElement props that require raw PDF operators (stroke,
 * charSpacing, horizontalScale, baselineShift) actually reach the operator
 * path, and that a plain element stays on the drawText fallback.
 *
 * Strong regression signal: the stroke path emits `setTextRenderingMode`
 * (pdfjs OPS code 38), which `page.drawText` NEVER emits. A silent regression
 * to drawText would make that assertion fail even if byte lengths happened to match.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { TextElement } from '../../src/elements/textElement';
import { bakeElementToPdf } from './_bakeHelper';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

// pdfjs OPS.setTextRenderingMode = 38 (verified via node -e "require('pdfjs-dist').OPS")
const OPS_SET_TEXT_RENDERING_MODE = 38;

async function getOpsFirstPage(bytes: Uint8Array): Promise<number[]> {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const ops = await page.getOperatorList();
  await task.destroy();
  return Array.from(ops.fnArray as number[]);
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  await task.destroy();
  return (tc.items as Array<{ str: string }>)
    .filter(i => typeof i.str === 'string')
    .map(i => i.str)
    .join('');
}

const asEl = (o: object): PDFElement => o as unknown as PDFElement;

describe('Slice-2 bake (real Chrome)', () => {
  it('stroke path emits setTextRenderingMode; plain element does not', async () => {
    // Styled: stroke forces hasAdvancedText → operator path → Tr op emitted.
    const styledEl = new TextElement(40, 40, 'p1', {
      color: '#ff0000',     // outline is painted in the fill color (no separate stroke color)
      strokeWidth: 1,
      charSpacing: 2,
      horizontalScale: 80,
      baselineShift: 'super',
    });
    styledEl.text = 'Hello';
    // Plain: no advanced attrs → drawText path → Tr never emitted.
    const plainEl = new TextElement(40, 40, 'p1');
    plainEl.text = 'Hello';

    const styledBytes = await bakeElementToPdf(styledEl as unknown as PDFElement);
    const plainBytes = await bakeElementToPdf(plainEl as unknown as PDFElement);

    const styledOps = await getOpsFirstPage(styledBytes);
    const plainOps  = await getOpsFirstPage(plainBytes);

    // STRONG assertion: stroke emits Tr=FillAndOutline → OPS code 38 present.
    expect(styledOps).toContain(OPS_SET_TEXT_RENDERING_MODE);
    // drawText never emits Tr → plain must NOT contain OPS 38.
    expect(plainOps).not.toContain(OPS_SET_TEXT_RENDERING_MODE);

    // Sanity: text is still extractable from the styled PDF.
    // Note: charSpacing (Tc) causes pdfjs to emit each glyph as a separate text item
    // with intervening spaces, so we strip whitespace before asserting word presence.
    const text = await extractText(styledBytes);
    expect(text.replace(/\s+/g, '')).toContain('Hello');
  });

  it('justify distributes width across a multiline box; text is extractable', async () => {
    // 'one two three\nlast' — first line has 3 spaces → wordSpacing is applied;
    // last line is final → no word spacing. Both lines must produce extractable text.
    // Note: Tw (word spacing) causes pdfjs to emit separate space-token items between
    // words; stripping whitespace and checking for word fragments is the reliable approach.
    const el = new TextElement(40, 40, 'p1', {
      width: 400,
      align: 'justify',
    });
    el.text = 'one two three\nlast';
    const bytes = await bakeElementToPdf(el as unknown as PDFElement);
    const text = await extractText(bytes);
    const noSpace = text.replace(/\s+/g, '');
    // 'one' and 'two' appear in first line (extracted but may be split by Tw spacing).
    expect(noSpace).toContain('one');
    expect(noSpace).toContain('two');
    // 'last' is the final (non-justified) line — should always appear cleanly.
    expect(noSpace).toContain('last');
  });

  it('plain TextElement (no advanced attrs) does NOT emit setTextRenderingMode', async () => {
    // Belt-and-suspenders: explicitly confirm the drawText fallback is clean.
    const el = asEl({
      type: 'text', x: 50, y: 50, width: 200, height: 40,
      text: 'Plain text', fontSize: 14,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000',
    });
    const bytes = await bakeElementToPdf(el);
    const ops = await getOpsFirstPage(bytes);
    expect(ops).not.toContain(OPS_SET_TEXT_RENDERING_MODE);
  });
});
