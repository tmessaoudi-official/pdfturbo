/**
 * Limits row 48 — true-edit hit-tested a Form XObject's text through the form's /Matrix only, never the page CTM
 * at its `Do`. A form placed with `q … cm /Fm Do Q` (how BERT, ResNet and Publication 17 draw their figures and
 * running heads — 1,358 runs measured) therefore missed every click, and the edit fell back to an overlay.
 *
 * Oracle: REAL pdf.js item origins. The shared fixture draws "InsideXObj" at form (50, 300) with /Matrix 0.5,
 * placed by `1 0 0 1 100 20 cm` — pdf.js must report it at (125, 170), and an edit there must change it.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';
import { makeXObjectTextPdf } from '../utils/_xobjectFixture';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const placed = { pageDo: '\nq 1 0 0 1 100 20 cm /Fx0 Do Q', matrix: [0.5, 0, 0, 0.5, 0, 0] };

async function items(bytes: Uint8Array): Promise<{ str: string; x: number; y: number }[]> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const out = (tc.items as { str?: string; transform?: number[] }[])
    .filter(i => i.str?.trim() && i.transform)
    .map(i => ({ str: i.str as string, x: (i.transform as number[])[4], y: (i.transform as number[])[5] }));
  await doc.loadingTask.destroy();
  return out;
}

describe('true-edit — Form XObject text placed by the page CTM (limits row 48)', () => {
  it('pdf.js draws the form text at (125, 170)', async () => {
    const list = await items(await makeXObjectTextPdf(placed));
    const t = list.find(i => i.str === 'InsideXObj');
    expect(t?.x).toBeCloseTo(125, 1);
    expect(t?.y).toBeCloseTo(170, 1);
  });

  it('an edit at pdf.js\'s own origin changes the form text', async () => {
    const bytes = await makeXObjectTextPdf(placed);
    const t = (await items(bytes)).find(i => i.str === 'InsideXObj');
    if (!t) throw new Error('fixture text not found');
    const doc = await PDFDocument.load(bytes);
    expect(await replaceTextAt(doc, 0, { x: t.x, y: t.y }, 'EditedForm', 3)).toBe(true);
    const after = await items(await doc.save());
    expect(after.map(i => i.str)).toContain('EditedForm');
    expect(after.map(i => i.str)).not.toContain('InsideXObj');
  });
});
