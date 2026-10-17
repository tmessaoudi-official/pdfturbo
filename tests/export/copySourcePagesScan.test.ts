/**
 * Review-remediation row 10 (SEC-1 cost follow-up, ruled 2026-10-08): the prune reads what each kept page draws with
 * the name-only `scanNamedOps`, not the full tokenizer, which was half its time on a 142-page file (§ Fragile). The
 * full tokenizer is made to throw here: before row 10 the prune caught it, could not read the page and refused the
 * export (`ExportResourcesUnreadableError`). What the scan reports is pinned against the tokenizer in
 * `tests/utils/scanNamedOps.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';

vi.mock('../../src/utils/contentStreamEditor', async orig => ({
  ...await orig<Record<string, unknown>>(),
  tokenizeContentStream: () => { throw new Error('the prune called the full tokenizer'); },
}));
const { copySourcePages } = await import('../../src/export/copySourcePages');

const PUB = 'PUBLICKEPTNEEDLE';
const SEC = 'SECRETREMOVEDNEEDLE';
const txt = (t: string) => `BT /F1 12 Tf 20 200 Td (${t}) Tj ET`;

/** Two pages sharing ONE resource dictionary: page 0 draws /Fm1 (public), page 1 draws /Fm2 (secret). */
async function shared(): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (t: string) => ctx.register(ctx.stream(txt(t),
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 300], Resources: { Font: { F1: font } } }));
  const resources = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB), Fm2: form(SEC) }, Font: { F1: font } }));
  for (const name of ['Fm1', 'Fm2']) {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Resources'), resources);
    // A name inside a string and a comment is not drawn: only the `Do` operand counts.
    p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(`q (/Fm2 Do) Tj % /Fm2 Do\n/${name} Do Q`)));
  }
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

/** Page 0 marks content with ONE operand (`/MC0 BDC`, malformed: no property list is named); page 1 names /MC0. */
async function oneOperandBdc(): Promise<PDFDocument> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const resources = ctx.register(ctx.obj({ Properties: { MC0: { Type: 'OCG', Name: PDFString.of(SEC) } } }));
  for (const content of ['/MC0 BDC EMC', '/OC /MC0 BDC EMC']) {
    const p = d.addPage([300, 300]);
    p.node.set(PDFName.of('Resources'), resources);
    p.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(content)));
  }
  return PDFDocument.load(await d.save({ useObjectStreams: false }), { updateMetadata: false });
}

describe('the prune reads pages with the name-only scan (row 10)', () => {
  it('a BDC with one operand names no property list, so the removed page\'s stays out', async () => {
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages } = await copySourcePages(dest, await oneOperandBdc(), [0], { pruneSharedResources: true });
    pages.forEach(p => dest.addPage(p));
    const bytes = Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1');
    expect(bytes.includes(SEC)).toBe(false);
  });

  it('prunes a shared dictionary without the full tokenizer', async () => {
    const dest = await PDFDocument.create({ updateMetadata: false });
    const { pages } = await copySourcePages(dest, await shared(), [0], { pruneSharedResources: true });
    pages.forEach(p => dest.addPage(p));
    const bytes = Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1');
    expect(bytes.includes(PUB), 'the kept page still draws its form').toBe(true);
    expect(bytes.includes(SEC), 'the removed page\'s form rode along').toBe(false);
  });
});
