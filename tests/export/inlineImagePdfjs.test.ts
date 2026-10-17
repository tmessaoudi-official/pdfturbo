/**
 * Review-remediation row 10, S10-1 (panel round 1, 2026-10-17): the SEC-1 prune decides what a kept page draws by
 * scanning its content, and the scan ended an inline image at the first whitespace-delimited `EI`. pdf.js ends one by
 * its filter — a DCT image at the JPEG end marker, ASCII85 at `~>`, ASCIIHex at `>` — and otherwise at an `EI` whose
 * next bytes are printable and lex as a known operator with its operand count (`Parser.makeInlineImage`). Where the two
 * disagree, bytes pdf.js reads as image data were read as operators: a `/Fm2 Do` there kept the removed page's form in
 * the export although no viewer draws it. pdf.js also splits a run of letters into known operators (`qBI` is `q` `BI`).
 *
 * The oracle is pdf.js itself: each shape asserts what pdf.js draws on the source page, that the scan reports exactly
 * those forms, and that the export keeps the removed page's form only when the kept page draws it.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { copySourcePages, ExportResourcesUnreadableError } from '../../src/export/copySourcePages';
import { scanNamedOps } from '../../src/utils/contentStreamEditor';

const PUB = 'PUBLICKEPTNEEDLE';
const SEC = 'SECRETREMOVEDNEEDLE';
const IMG = 'BI /W 1 /H 1 /BPC 8 /CS /G';
/** Printable bytes that put a JPEG end marker past the 15 bytes the unfiltered rule checks after an `EI`. */
const PAD = '0 '.repeat(10);

/** A kept page's content: one stream, or several (`/Contents` an array, which pdf.js reads back to back). */
type Content = string | string[];

/** Page 0 is the kept page under test; page 1, left out, draws /Fm2 from the same resources. */
async function build(page0: Content): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  // The BBox width tells the two forms apart in pdf.js's operator list: 300 for Fm1, 301 for Fm2.
  const form = (t: string, w: number) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, 300], Resources: { Font: { F1: font } } }));
  // A tiling pattern, for the pattern-name cases (round 3, R3S-2).
  const tile = ctx.register(ctx.stream('0 0 5 5 re f', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1,
    BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} }));
  const resources = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB, 300), Fm2: form(SEC, 301) }, Font: { F1: font },
    Pattern: { P1: tile } }));
  const stream = (content: string) => ctx.register(ctx.stream(Uint8Array.from(content, c => c.charCodeAt(0))));
  for (const content of [page0, '/Fm2 Do']) {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Resources'), resources);
    p.node.set(PDFName.of('Contents'), Array.isArray(content) ? ctx.obj(content.map(stream)) : stream(content));
  }
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

/**
 * The forms pdf.js reads on the kept page, by its text layer and by its operator list (what it paints). They part where
 * pdf.js's evaluator stops on one path only (round 3, R3C-2), so a case pins both.
 */
async function pdfjsReads(page0: Content): Promise<{ text: string[]; painted: string[] }> {
  const bytes = await (await build(page0)).save({ useObjectStreams: false });
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('|');
    const list = await page.getOperatorList();
    const painted = new Set<string>();
    list.fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.paintFormXObjectBegin) painted.add((list.argsArray[k][1] as number[])[2] === 301 ? 'Fm2' : 'Fm1');
    });
    return { text: [text.includes(PUB) && 'Fm1', text.includes(SEC) && 'Fm2'].filter((x): x is string => !!x), painted: [...painted].sort() };
  } finally { await doc.loadingTask.destroy(); }
}
const pdfjsDraws = async (page0: Content): Promise<string[]> => {
  const { text, painted } = await pdfjsReads(page0);
  expect(painted, 'pdf.js paints what its text layer reads').toEqual(text);
  return text;
};

async function exported(page0: Content): Promise<string> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages } = await copySourcePages(dest, await build(page0), [0], { pruneSharedResources: true });
  pages.forEach(p => dest.addPage(p));
  return Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1');
}

/** What the prune's scan reports on the content as `collect` receives it: several streams joined back to back. */
const joined = (page0: Content): string => (Array.isArray(page0) ? page0.join('') : page0);
const scannedDraws = (page0: Content): string[] =>
  [...new Set(scanNamedOps(joined(page0), new Set(['Do']), { pdfjs: true }).map(o => (o.last ?? '').slice(1)))].sort();

/** [label, kept page content, the forms pdf.js draws on it]. */
const SHAPES: [string, Content, string[]][] = [
  ['DCT ends at the JPEG end marker, not at the EI inside the data',
    `q ${IMG} /F /DCT ID \xFF\xD8 EI /Fm2 Do ${PAD}\xFF\xD9 EI Q /Fm1 Do`, ['Fm1']],
  ['a DCT filter array, the long key',
    `q ${IMG} /Filter [/DCTDecode] ID \xFF\xD8 EI /Fm2 Do ${PAD}\xFF\xD9 EI Q /Fm1 Do`, ['Fm1']],
  ['DCT without an end marker falls back to the EI rules',
    `q ${IMG} /F /DCT ID x EI /Fm2 Do \x01\x02 EI Q /Fm1 Do`, ['Fm1']],
  ['ASCII85 ends at ~>',
    `q ${IMG} /F /A85 ID z EI /Fm2 Do <~> EI Q /Fm1 Do`, ['Fm1']],
  ['/F wins over /Filter',
    `q ${IMG} /F /AHx /Filter /DCT ID 00 EI /Fm2 Do > EI Q /Fm1 Do`, ['Fm1']],
  ['a filter array is read by its first filter',
    `q ${IMG} /Filter [/AHx /DCT] ID 00 EI /Fm2 Do > EI Q /Fm1 Do`, ['Fm1']],
  ['ASCIIHex ends at >',
    `q ${IMG} /F /AHx ID 00 EI /Fm2 Do > EI Q /Fm1 Do`, ['Fm1']],
  ['an EI followed by a control byte is data',
    `q ${IMG} ID x EI /Fm2 Do \x01\x02\x03 EI Q /Fm1 Do`, ['Fm1']],
  ['an EI followed by an unknown operator is data',
    `q ${IMG} ID x EI xyz /Fm2 Do EI Q /Fm1 Do`, ['Fm1']],
  ['BI glued to the operator before it',
    `qBI /W 1 /H 1 /BPC 8 /CS /G ID /Fm2 Do EI Q /Fm1 Do`, ['Fm1']],
  ['ASCII85 without ~> falls back to the EI rules',
    `q ${IMG} /F /A85 ID z EI /Fm2 Do \x01 EI Q /Fm1 Do`, ['Fm1']],
  ['ASCIIHex without > falls back to the EI rules',
    `q ${IMG} /F /AHx ID 00 EI /Fm2 Do \x01 EI Q /Fm1 Do`, ['Fm1']],
  ['an EI whose 75-byte look-ahead holds no operator is data',
    `q ${IMG} ID x EI ${'1 '.repeat(40)}/Fm2 Do EI Q /Fm1 Do`, ['Fm1']],
  // Controls: the kept page draws /Fm2 too, so it must stay.
  ['control: a well-formed image, then a draw',
    `q ${IMG} ID \xAB EI Q /Fm2 Do /Fm1 Do`, ['Fm1', 'Fm2']],
  // A second EI after it, so a NUL read as binary would end the image there and lose /Fm2.
  ['control: a lone NUL after EI is not binary',
    `q ${IMG} ID x EI \x00/Fm2 Do Q EI /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: Do glued to the operator after it',
    `/Fm2 DoQ /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: ASCII85 ends at ~, whitespace, EI',
    `q ${IMG} /F /A85 ID z~ EI /Fm2 Do EI Q /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: with no EI accepted, pdf.js reads on after the last one',
    `/Fm1 Do ${IMG} ID x EI \x01 /Fm2 Do`, ['Fm1', 'Fm2']],
  ['control: ASCIIHex glued to its EI, then a draw',
    `q ${IMG} /F /AHx ID 00>EI /Fm2 Do\nEI Q /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: ASCII85 glued to its EI, then a draw',
    `q ${IMG} /F /A85 ID z~>EI /Fm2 Do\nEI Q /Fm1 Do`, ['Fm1', 'Fm2']],
  // Round 2 (on af6ee1d): the rest of the stream, read as pdf.js's parser and preprocessor read it.
  ['a ] inside a comment does not close an array (R2S-1)', `/Fm1 Do [ % ] /Fm2 Do [\n] 0 d`, ['Fm1']],
  ['control: an array whose ] follows a comment (R2S-1)', `/Fm1 Do [ 3 % ]\n] 0 d /Fm2 Do`, ['Fm1', 'Fm2']],
  ['a >> where a dictionary value goes is the value (R2S-2)', `/Fm1 Do << /A >> /Fm2 Do << >> /Fm1 Do`, ['Fm1']],
  ['a << where a dictionary key goes is skipped (R2S-2)', `/Fm1 Do [ << /A (>) ] /Fm2 Do << << >> ] >> /Fm1 Do`, ['Fm1']],
  ['control: null is no operand (R2C-3)', `/Fm2 null Do /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: null run into Do (R2C-3)', `/Fm2 nullDo /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: an unknown operator keeps the operands', `/Fm2 xyz Do /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: an inline image between a name and its Do', `/Fm2 ${IMG} ID x EI Do /Fm1 Do`, ['Fm1', 'Fm2']],
  ['control: an operand set aside is taken back by a later Do', `/Fm2 /Fm1 Do Q Do`, ['Fm1', 'Fm2']],
  ['an inline image across two streams (R2C-1)', [`q ${IMG} ID x EI`, `/Fm2 Do EI Q /Fm1 Do`], ['Fm1']],
  ['a comment at the end of a stream runs into the next (R2C-1)', ['/Fm1 Do %c', '/Fm2 Do'], ['Fm1']],
  ['control: a name across two streams (R2C-1)', ['/Fm', '2 Do /Fm1 Do'], ['Fm1', 'Fm2']],
];

/**
 * [label, kept page content, the forms pdf.js's text layer reads, the forms it paints] where pdf.js stops reading the
 * page. pdf.js reads two objects ahead, so an error can also cost it the draw just before (round 2, R2S-4). The first
 * ten stop in the lexer, parser or preprocessor; the rest in the evaluator, on an operand of the wrong type, and some on
 * one of the two paths only (round 3, R3S-1, R3C-1).
 */
const STOPS: [string, Content, string[], string[]][] = [
  ['a key that is not a name', `/Fm1 Do BI 5 /H 1 ID x EI /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['a number pdf.js cannot read after an EI', `/Fm1 Do ${IMG} ID x EI -x /Fm2 Do EI Q`, ['Fm1'], ['Fm1']],
  ['a filter array holding a number', `/Fm1 Do ${IMG} /F [/AHx 5] ID 00 > EI /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['a number pdf.js cannot read', `/Fm1 Do -x /Fm2 Do`, [], []],
  ['a lone dot', `/Fm1 Do .x /Fm2 Do`, [], []],
  ['a ) inside an array', `/Fm1 Do [ ) ] /Fm2 Do`, [], []],
  ['a ) inside a dictionary', `/Fm1 Do << /A ) >> /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['eleven path operators short of operands', `/Fm1 Do l l l l l l l l l l l /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['the end of the stream inside an array', `/Fm1 Do [ % ]\n/Fm2 Do`, ['Fm1'], ['Fm1']],
  ['more than 33 operands', `/Fm1 Do ${'1 '.repeat(34)}/Fm2 Do`, ['Fm1'], ['Fm1']],
  ['a number for TJ', `/Fm1 Do BT /F1 12 Tf 5 TJ ET /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['a name for TJ', `/Fm1 Do BT /F1 12 Tf /X TJ ET /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['a reference for TJ', `/Fm1 Do BT /F1 12 Tf 1 0 R TJ ET /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['an array for Tj', `/Fm1 Do BT /F1 12 Tf [(qzqz)] Tj ET /Fm2 Do`, ['Fm1'], ['Fm1']],
  ['a number for TJ, across two streams', [`/Fm1 Do BT /F1 12 Tf 5 T`, `J ET /Fm2 Do`], ['Fm1'], ['Fm1']],
  ['a bare EI with an operand', `/Fm1 Do 5 EI /Fm2 Do`, ['Fm1', 'Fm2'], ['Fm1']],
  ['a dictionary for a Tf size', `/Fm1 Do /F1 << >> Tf Q /Fm2 Do`, ['Fm1', 'Fm2'], []],
];

describe('the prune ends an inline image where pdf.js does (row 10, S10-1)', () => {
  it.each(SHAPES)('%s', async (_label, page0, draws) => {
    expect(await pdfjsDraws(page0), 'what pdf.js draws on the kept page').toEqual(draws);
    expect(scannedDraws(page0), 'what the scan reports').toEqual(draws);
    const bytes = await exported(page0);
    expect(bytes.includes(PUB)).toBe(true);
    expect(bytes.includes(SEC), 'the removed page\'s form in the export').toBe(draws.includes('Fm2'));
  });
});

describe('where pdf.js stops reading the page, the export refuses rather than guess (row 10, S10-1)', () => {
  it.each(STOPS)('%s', async (_label, page0, text, painted) => {
    expect(await pdfjsReads(page0), 'what pdf.js reads on the kept page').toEqual({ text, painted });
    expect(() => scanNamedOps(joined(page0), new Set(['Do']), { pdfjs: true })).toThrow(/Content stream/);
    await expect(exported(page0)).rejects.toThrow(ExportResourcesUnreadableError);
  });

  // pdf.js loops for ever on this page, so it is not asked; the prune refuses it through `contentOf` (R2C-4, R3K-2).
  it('a DCT marker as the last byte of the page', async () => {
    await expect(exported(`/Fm1 Do ${IMG} /F /DCT ID \xFF\xC0`)).rejects.toThrow(ExportResourcesUnreadableError);
    await expect(exported([`/Fm1 Do ${IMG} /F /DCT `, `ID \xFF\xC0`])).rejects.toThrow(ExportResourcesUnreadableError);
  });
});

/**
 * A pattern name pdf.js cannot resolve under a Pattern colour space stops it on the drawing path (`handleColorN`
 * throws, round 3, R3S-2); the prune refuses such a name, under any colour space (the colour space is row 33).
 */
describe('a pattern name the prune cannot resolve refuses the export (row 10, round 3)', () => {
  it('an unknown name under a Pattern colour space', async () => {
    const page0 = `/Fm1 Do /Pattern cs /Nope scn /Fm2 Do`;
    expect(await pdfjsReads(page0)).toEqual({ text: ['Fm1', 'Fm2'], painted: ['Fm1'] });
    expect(scannedDraws(page0)).toEqual(['Fm1', 'Fm2']);
    await expect(exported(page0)).rejects.toThrow(ExportResourcesUnreadableError);
  });
  it('control: a known tiling pattern is drawn and the export goes through', async () => {
    const page0 = `/Pattern cs /P1 scn 0 0 10 10 re f /Fm1 Do`;
    expect(await pdfjsDraws(page0)).toEqual(['Fm1']);
    const bytes = await exported(page0);
    expect(bytes.includes(PUB)).toBe(true);
    expect(bytes.includes(SEC)).toBe(false);
  });
});
