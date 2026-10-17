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

/**
 * Page 0 is the kept page under test; page 1, left out, draws /Fm2 from the same resources. `local` is the /Resources
 * of page 0's single content stream, which pdf.js merges over the page's (round 5).
 */
async function build(page0: Content, local?: Record<string, unknown>, annot = false): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  // The BBox width tells the two forms apart in pdf.js's operator list: 300 for Fm1, 301 for Fm2.
  const form = (t: string, w: number) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, 300], Resources: { Font: { F1: font } } }));
  // A tiling pattern, for the pattern-name cases (round 3, R3S-2).
  const tile = ctx.register(ctx.stream('0 0 5 5 re f', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1,
    BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} }));
  // Round 4 (R4S-1, R4C-4, R4K-1): a shading pattern written as a stream whose body draws Fm2 (pdf.js reads only its
  // /Shading), the same as a dictionary, a tiling pattern drawing Fm2, and a tiling pattern written as a dictionary.
  const shading = { ShadingType: 2, ColorSpace: 'DeviceGray', Coords: [0, 0, 10, 0],
    Function: { FunctionType: 2, Domain: [0, 1], C0: [0], C1: [1], N: 1 } };
  const shadingStream = ctx.register(ctx.stream('/Fm2 Do', { Type: 'Pattern', PatternType: 2, Shading: shading }));
  const shadingDict = ctx.register(ctx.obj({ Type: 'Pattern', PatternType: 2, Shading: shading }));
  const tileFm2 = ctx.register(ctx.stream('/Fm2 Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1,
    BBox: [0, 0, 400, 400], XStep: 400, YStep: 400 }));
  const tileDict = ctx.register(ctx.obj({ Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1,
    BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {} }));
  // Round 5 (R5S-1, R5K-1, R5C-1): streams whose own /Resources is the shared dictionary and whose body draws Fm2. pdf.js
  // reads none of these bodies — a shading pattern, a shading, an image's data, a Type3 glyph procedure (run with its
  // font's resources) — and reads a tiling pattern's.
  const resources = ctx.nextRef();
  const tiling = { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 400, 400], XStep: 400, YStep: 400 };
  const shadingOwn = ctx.register(ctx.stream('/Fm2 Do', { Type: 'Pattern', PatternType: 2, Shading: shading, Resources: resources }));
  const tileOwn = ctx.register(ctx.stream('/Fm2 Do', { ...tiling, Resources: resources }));
  const shadingBody = ctx.register(ctx.stream('/Fm2 Do', { ...shading, Resources: resources }));
  const image = ctx.register(ctx.stream('/Fm2 Do', { Type: 'XObject', Subtype: 'Image', Width: 7, Height: 1,
    BitsPerComponent: 8, ColorSpace: 'DeviceGray', Resources: resources }));
  const type3 = (proc: unknown, own?: unknown) => ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type3',
    FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: proc },
    Encoding: { Type: 'Encoding', Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1000],
    ...(own === undefined ? {} : { Resources: own }) } as never));
  const glyph = ctx.register(ctx.stream('1000 0 d0 /Fm2 Do'));
  const glyphOwn = ctx.register(ctx.stream('1000 0 d0 /Fm2 Do', { Resources: resources }));
  // R5C-2: a null entry is present to pdf.js, and hides the one it is merged over.
  const tileNull = ctx.register(ctx.stream('/Fm2 Do', { ...tiling, Resources: { XObject: null } }));
  // R5S-2 (ruled 2026-10-17: the spec, not pdf.js): a shading pattern's graphics state soft mask.
  const group = ctx.register(ctx.stream('/Fm2 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 400],
    Group: { S: 'Transparency' }, Resources: resources }));
  const shadingMasked = ctx.register(ctx.obj({ Type: 'Pattern', PatternType: 2, Shading: shading,
    ExtGState: { SMask: { S: 'Luminosity', G: group } } }));
  ctx.assign(resources, ctx.obj({ XObject: { Fm1: form(PUB, 300), Fm2: form(SEC, 301), Im1: image },
    Font: { F1: font, T3o: type3(glyphOwn, {}), T3i: type3(glyph), T3b: type3(glyph, 5), T3z: type3(glyph, 0) },
    Shading: { S1: shadingBody },
    Pattern: { P1: tile, P2s: shadingStream, P2d: shadingDict, P1f: tileFm2, P1d: tileDict, P2r: shadingOwn, P1r: tileOwn,
      P1n: tileNull, P2m: shadingMasked } }));
  const stream = (content: string, dict?: Record<string, unknown>) =>
    ctx.register(ctx.stream(Uint8Array.from(content, c => c.charCodeAt(0)), dict as never));
  // An appearance with neither /Subtype /Form nor a /DA, drawing Fm2: pdf.js paints it whatever its /Subtype (round 5).
  const appearance = ctx.register(ctx.stream('/Fm2 Do', { BBox: [0, 0, 400, 400], Resources: resources }));
  for (const [content, own] of [[page0, local], ['/Fm2 Do', undefined]] as const) {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Resources'), resources);
    p.node.set(PDFName.of('Contents'), Array.isArray(content) ? ctx.obj(content.map(c => stream(c)))
      : stream(content, own && { Resources: own }));
    if (annot && content === page0) {
      p.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 300, 300],
        AP: { N: appearance } }))]));
    }
  }
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

/**
 * The forms pdf.js reads on the kept page, by its text layer and by its operator list (what it paints). They part where
 * pdf.js's evaluator stops on one path only (round 3, R3C-2), so a case pins both.
 */
async function pdfjsReads(page0: Content, local?: Record<string, unknown>, annot = false): Promise<{ text: string[]; painted: string[] }> {
  const bytes = await (await build(page0, local, annot)).save({ useObjectStreams: false });
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('|');
    const painted = new Set<string>();
    // A tiling pattern carries its own operator list inside its colour arguments: a form it paints counts too
    // (round 4, R4C-5 — the top-level list alone cannot see one). So does a Type3 glyph, whose list sits on its font in
    // `commonObjs`, outside the page's list and the text layer (round 5, R5C-4).
    type OpList = { fnArray: number[]; argsArray: unknown[] };
    const fonts: string[] = [];
    const walk = (list: OpList): void => list.fnArray.forEach((fn, k) => {
      const args = list.argsArray[k];
      if (fn === pdfjs.OPS.paintFormXObjectBegin) painted.add(((args as unknown[])[1] as number[])[2] === 301 ? 'Fm2' : 'Fm1');
      if (fn === pdfjs.OPS.setFont) fonts.push((args as string[])[0]);
      if (Array.isArray(args)) {
        for (const a of args) if (a && typeof a === 'object' && 'fnArray' in a && 'argsArray' in a) walk(a as never);
      }
    });
    walk(await page.getOperatorList());
    for (const id of new Set(fonts)) {
      const glyphs = page.commonObjs.has(id) ? (page.commonObjs.get(id) as { charProcOperatorList?: Map<string, OpList> }).charProcOperatorList : undefined;
      for (const list of glyphs?.values() ?? []) walk(list);
    }
    return { text: [text.includes(PUB) && 'Fm1', text.includes(SEC) && 'Fm2'].filter((x): x is string => !!x), painted: [...painted].sort() };
  } finally { await doc.loadingTask.destroy(); }
}
const pdfjsDraws = async (page0: Content): Promise<string[]> => {
  const { text, painted } = await pdfjsReads(page0);
  expect(painted, 'pdf.js paints what its text layer reads').toEqual(text);
  return text;
};

async function exported(page0: Content, local?: Record<string, unknown>, annot = false): Promise<string> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  const { pages } = await copySourcePages(dest, await build(page0, local, annot), [0], { pruneSharedResources: true });
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

/**
 * A shading pattern draws no content of its own: pdf.js's `handleColorN` reads only its /Shading and /Matrix, even when
 * the pattern is written as a stream with a body (round 4, R4S-1/R4C-4 — the prune read that body as a tiling pattern's
 * and kept the removed page's form; pre-existing, measured at fffe15f). Both accepting branches of the round-3 check are
 * pinned (R4K-1), and the oracle is shown to see a form painted inside a tiling pattern (R4C-5).
 */
describe('a shading pattern draws nothing of its own (row 10, round 4)', () => {
  it('a shading pattern written as a stream whose body draws Fm2', async () => {
    const page0 = `/Fm1 Do /Pattern cs /P2s scn 0 0 10 10 re f`;
    expect(await pdfjsDraws(page0)).toEqual(['Fm1']);
    const bytes = await exported(page0);
    expect(bytes.includes(PUB)).toBe(true);
    expect(bytes.includes(SEC)).toBe(false);
  });
  it('control: a shading pattern written as a dictionary is accepted', async () => {
    const page0 = `/Fm1 Do /Pattern cs /P2d scn 0 0 10 10 re f`;
    expect(await pdfjsDraws(page0)).toEqual(['Fm1']);
    const bytes = await exported(page0);
    expect(bytes.includes(PUB)).toBe(true);
    expect(bytes.includes(SEC)).toBe(false);
  });
  it('control: a tiling pattern whose content draws Fm2 is painted, and the export keeps Fm2', async () => {
    const page0 = `/Fm1 Do /Pattern cs /P1f scn 0 0 300 300 re f`;
    expect(await pdfjsReads(page0)).toEqual({ text: ['Fm1'], painted: ['Fm1', 'Fm2'] });
    expect((await exported(page0)).includes(SEC)).toBe(true);
  });
  it('a tiling pattern written as a dictionary refuses the export', async () => {
    await expect(exported(`/Fm1 Do /Pattern cs /P1d scn 0 0 10 10 re f`)).rejects.toThrow(ExportResourcesUnreadableError);
  });
});

/**
 * Round 5 (the cap, ruled 2026-10-17: fix all and stop). The copier pruned a copied stream's own /Resources by reading
 * its body as content, whatever the stream was (R5S-1 = R5K-1 = R5C-1, P0, pre-existing): pdf.js reads a body against
 * its own resources only for a form, a tiling pattern and a page's content. A null resource entry is present to pdf.js
 * and hides the entry it is merged over, while pdf-lib's `has` says absent (R5C-2, P0). A Type3 font whose own
 * /Resources is not a dictionary stops pdf.js inside every glyph (R5C-3, shape B). A shading pattern's soft mask
 * follows the spec, not pdf.js (R5S-2, ruled).
 */
describe('a stream draws through its own resources only where pdf.js reads its body (row 10, round 5)', () => {
  const keeps = async (page0: string, local?: Record<string, unknown>) => {
    const bytes = await exported(page0, local);
    expect(bytes.includes(PUB)).toBe(true);
    return bytes.includes(SEC);
  };
  it.each([
    ['a shading pattern written as a stream with /Resources', `/Fm1 Do /Pattern cs /P2r scn 0 0 10 10 re f`],
    ['a shading whose stream has /Resources', `/Fm1 Do /S1 sh`],
    ['an image with /Resources, its data reading /Fm2 Do', `/Fm1 Do q 7 0 0 1 0 0 cm /Im1 Do Q`],
  ])('%s: pdf.js never reads the body, the export drops Fm2', async (_label, page0) => {
    expect(await pdfjsReads(page0)).toEqual({ text: ['Fm1'], painted: ['Fm1'] });
    expect(await keeps(page0)).toBe(false);
  });
  it('control: a tiling pattern with /Resources is painted, and the export keeps Fm2', async () => {
    const page0 = `/Fm1 Do /Pattern cs /P1r scn 0 0 300 300 re f`;
    expect(await pdfjsReads(page0)).toEqual({ text: ['Fm1'], painted: ['Fm1', 'Fm2'] });
    expect(await keeps(page0)).toBe(true);
  });
  it('a Type3 glyph procedure with /Resources: pdf.js runs it with its font\'s, the export drops Fm2', async () => {
    const page0 = `/Fm1 Do BT /T3o 12 Tf 10 10 Td (a) Tj ET`;
    expect((await pdfjsReads(page0)).painted).toEqual(['Fm1']);
    expect(await keeps(page0)).toBe(false);
  });
  it('control: a Type3 glyph that inherits the page\'s resources is painted (the oracle sees inside glyphs)', async () => {
    const page0 = `/Fm1 Do BT /T3i 12 Tf 10 10 Td (a) Tj ET`;
    expect((await pdfjsReads(page0)).painted).toEqual(['Fm1', 'Fm2']);
    expect(await keeps(page0)).toBe(true);
  });
  it('a Type3 font whose own /Resources is not a dictionary refuses the export', async () => {
    const page0 = `/Fm1 Do BT /T3b 12 Tf 10 10 Td (a) Tj ET`;
    expect((await pdfjsReads(page0)).painted).toEqual(['Fm1']);
    await expect(exported(page0)).rejects.toThrow(ExportResourcesUnreadableError);
  });
  it('control: a Type3 font whose own /Resources is 0 inherits the page\'s, as pdf.js reads it falsy', async () => {
    const page0 = `/Fm1 Do BT /T3z 12 Tf 10 10 Td (a) Tj ET`;
    expect((await pdfjsReads(page0)).painted).toEqual(['Fm1', 'Fm2']);
    expect(await keeps(page0)).toBe(true);
  });
  it('a tiling pattern whose own /XObject is null: pdf.js resolves nothing, the export drops Fm2', async () => {
    const page0 = `/Fm1 Do /Pattern cs /P1n scn 0 0 300 300 re f`;
    expect(await pdfjsReads(page0)).toEqual({ text: ['Fm1'], painted: ['Fm1'] });
    expect(await keeps(page0)).toBe(false);
  });
  it('a content stream whose own /Fm2 is null: it hides the page\'s, the export drops Fm2', async () => {
    const page0 = `/Fm1 Do /Fm2 Do`;
    const local = { XObject: { Fm2: null } };
    expect(await pdfjsReads(page0, local)).toEqual({ text: ['Fm1'], painted: ['Fm1'] });
    expect(await keeps(page0, local)).toBe(false);
  });
  it('control: an appearance with no /Subtype /Form and no /DA is painted, and the export keeps Fm2', async () => {
    const page0 = `/Fm1 Do`;
    expect(await pdfjsReads(page0, undefined, true)).toEqual({ text: ['Fm1'], painted: ['Fm1', 'Fm2'] });
    const bytes = await exported(page0, undefined, true);
    expect(bytes.includes(PUB)).toBe(true);
    expect(bytes.includes(SEC)).toBe(true);
  });
  it('a shading pattern\'s soft-mask group is kept, as the spec draws it (ruled; pdf.js ignores it)', async () => {
    const page0 = `/Fm1 Do /Pattern cs /P2m scn 0 0 10 10 re f`;
    expect(await pdfjsReads(page0)).toEqual({ text: ['Fm1'], painted: ['Fm1'] });
    expect(await keeps(page0)).toBe(true);
  });
});
