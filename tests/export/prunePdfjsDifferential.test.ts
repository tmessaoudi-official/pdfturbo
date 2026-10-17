/**
 * The SEC-1 prune's scan against pdf.js itself (review-remediation row 10, round 2, R2K-3): seeded random content
 * streams, built from the shapes that have diverged before, half of them split into two streams. On every stream the
 * scan reads (it refuses the rest, which fails closed), the forms it reports drawn must be exactly the forms pdf.js
 * PAINTS (its operator list) and exactly the forms its text layer reads — a form it adds is a removed page's form kept
 * in the export, a form it misses is a kept page's form dropped. The two readers part where pdf.js's evaluator stops on
 * the drawing path only (round 3, R3C-2: a bare `EI`), so the text alone was a proxy that read more than pdf.js draws.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scanNamedOps } from '../../src/utils/contentStreamEditor';

const FORMS = ['Fm1', 'Fm2', 'Fm3'];
const needle = (f: string) => `NEEDLE${f.toUpperCase()}X`;
const IMG = 'BI /W 1 /H 1 /BPC 8 /CS /G';

const PIECES = [
  '/Fm1 Do', '/Fm2 Do', '/Fm3 Do', '/Fm1', '/Fm2', '/Fm3', 'Do', 'q', 'Q', 'xyz', 'null', 'true', '1', '0', 'R', '1 0 R',
  '[', ']', '<<', '>>', '/A', '(s)', '(a)b)', '<41>', '% c\n', '% ]\n', '%', '\n', ' ', 'l', '0 0 m', '1 0 0 1 0 0 cm',
  'EI', 'ID', `${IMG} ID x EI`, '5 TJ', '[(a) 2] TJ', '(a) Tj', '/F1 << >> Tf', '/X TJ', '[/A] TJ', '0 1 0 rg', '/A w', `${IMG} /F /AHx ID 00>EI`, `${IMG} /F /A85 ID z~>EI`, `${IMG} /F /DCT ID \xFF\xD8 EI`,
  '\xFF\xD9 EI', 'DoQ', 'qBI', '\x01', '/F1 12 Tf', 'BT', 'ET',
];

/** One seeded content (`Math.imul`, as in scanNamedOps.test.ts): pieces joined by a separator, or by none. */
function generate(seed: number): string[] {
  let x = seed >>> 0;
  const next = (m: number) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return (x >>> 8) % m; };
  let text = '';
  for (let k = 0, len = 3 + next(12); k < len; k++) text += PIECES[next(PIECES.length)] + [' ', '\n', ''][next(3)];
  if (next(2) === 0) return [text];
  const cut = next(text.length + 1);
  return [text.slice(0, cut), text.slice(cut)];
}

/** The forms pdf.js reads on the page: by its text layer (the needles) and by its operator list (each form's BBox width). */
async function pdfjsDraws(contents: string[]): Promise<{ text: string[]; painted: string[] }> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const xobjects = Object.fromEntries(FORMS.map((f, k) => [f, ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${needle(f)}) Tj ET`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300 + k, 300], Resources: { Font: { F1: font } } }))]));
  const page = d.addPage([300, 300]);
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: xobjects, Font: { F1: font } }));
  const stream = (c: string) => ctx.register(ctx.stream(Uint8Array.from(c, ch => ch.charCodeAt(0))));
  page.node.set(PDFName.of('Contents'), contents.length === 1 ? stream(contents[0]) : ctx.obj(contents.map(stream)));
  const bytes = await d.save({ useObjectStreams: false });
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  try {
    const view = await doc.getPage(1);
    const text = (await view.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('|');
    const list = await view.getOperatorList();
    const painted = new Set<string>();
    list.fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.paintFormXObjectBegin) painted.add(FORMS[Math.round((list.argsArray[k][1] as number[])[2] - 300)] ?? '?');
    });
    return { text: FORMS.filter(f => text.includes(needle(f))), painted: [...painted].sort() };
  } finally { await doc.loadingTask.destroy(); }
}

describe('the prune reads a content stream the way pdf.js draws it (row 10, round 2)', () => {
  it('agrees with pdf.js on every one of 3000 seeded streams it reads', async () => {
    let compared = 0, refused = 0, drawing = 0;
    const disagree: string[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
      const contents = generate(seed);
      let scanned: string[];
      try {
        scanned = [...new Set(scanNamedOps(contents.join(''), new Set(['Do']), { pdfjs: true })
          .map(o => (o.last ?? '').slice(1)).filter(f => FORMS.includes(f)))].sort();
      } catch { refused++; continue; }
      const { text, painted } = await pdfjsDraws(contents);
      compared++;
      if (painted.length > 0) drawing++;
      const s = JSON.stringify(scanned);
      if (s !== JSON.stringify(painted) || s !== JSON.stringify(text)) {
        disagree.push(`${seed}: scan ${scanned} painted ${painted} text ${text} ${JSON.stringify(contents)}`);
      }
    }
    expect(disagree).toEqual([]);
    // Not vacuous, and pinned (the generator is seeded): 715 read and compared, 232 of them painting a form, 2285 refused
    // — a refusal fails closed, so it is counted, not compared. Round 3's operand-type refusals raised the refused share,
    // hence 3000 seeds where round 2 used 1000.
    expect({ compared, refused, drawing }).toEqual({ compared: 715, refused: 2285, drawing: 232 });
  }, 120_000);
});
