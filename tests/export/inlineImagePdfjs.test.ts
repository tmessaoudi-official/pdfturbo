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

/** Page 0 is the kept page under test; page 1, left out, draws /Fm2 from the same resources. */
async function build(page0: string): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (t: string) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: { Font: { F1: font } } }));
  const resources = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB), Fm2: form(SEC) }, Font: { F1: font } }));
  for (const content of [page0, '/Fm2 Do']) {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Resources'), resources);
    p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(Uint8Array.from(content, c => c.charCodeAt(0)))));
  }
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

async function pdfjsDraws(page0: string): Promise<string[]> {
  const bytes = await (await build(page0)).save({ useObjectStreams: false });
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  const text = (await (await doc.getPage(1)).getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('|');
  await doc.loadingTask.destroy();
  return [text.includes(PUB) && 'Fm1', text.includes(SEC) && 'Fm2'].filter((x): x is string => !!x);
}

async function exported(page0: string): Promise<string> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages } = await copySourcePages(dest, await build(page0), [0], { pruneSharedResources: true });
  pages.forEach(p => dest.addPage(p));
  return Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1');
}

const scannedDraws = (page0: string): string[] =>
  [...new Set(scanNamedOps(page0, new Set(['Do']), { pdfjs: true }).map(o => (o.last ?? '').slice(1)))].sort();

/** [label, kept page content, the forms pdf.js draws on it]. */
const SHAPES: [string, string, string[]][] = [
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
];

/** [label, kept page content]: pdf.js stops reading the page at the image, so it draws /Fm1 alone. */
const STOPS: [string, string][] = [
  ['a key that is not a name', `/Fm1 Do BI 5 /H 1 ID x EI /Fm2 Do`],
  ['a number pdf.js cannot read after an EI', `/Fm1 Do ${IMG} ID x EI -x /Fm2 Do EI Q`],
  ['a filter array holding a number', `/Fm1 Do ${IMG} /F [/AHx 5] ID 00 > EI /Fm2 Do`],
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
  it.each(STOPS)('%s', async (_label, page0) => {
    expect(await pdfjsDraws(page0), 'what pdf.js draws on the kept page').toEqual(['Fm1']);
    expect(() => scanNamedOps(page0, new Set(['Do']), { pdfjs: true })).toThrow(/Content stream/);
    await expect(exported(page0)).rejects.toThrow(ExportResourcesUnreadableError);
  });
});
