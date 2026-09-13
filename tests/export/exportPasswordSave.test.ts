/**
 * WS7 round 10, safety lens P2 — "Lock PDF" left strings in PLAINTEXT, and broke them for the reader.
 *
 * pdf-lib's writer encrypts `PDFStream` objects only. Every other string — a link's /URI, a note's
 * /Contents, /Info — is written as-is, while the /Encrypt dictionary tells a compliant reader that
 * every string IS encrypted. So a locked export leaked those strings to anyone with a text editor,
 * AND a reader with the correct password "decrypted" the plaintext into garbage: measured, pdf.js
 * with the password read both annotations as "".
 *
 * Saving with object streams puts ordinary objects inside compressed, encrypted streams, which
 * fixes both halves. It is applied ONLY when a password is set: the signer consumes the assembled
 * bytes and refuses xref streams (`assertClassicXref`), so the password-less save must stay classic.
 * What stays uncompressed, and therefore plaintext, is bounded in SECURITY.md.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { ExportService, type IExportContext } from '../../src/export/exportService';

const URI_TOKEN = 'R10URITOKEN';
const NOTE_TOKEN = 'R10NOTETOKEN';

async function sourceBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;
  const link = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 60],
    A: { S: 'URI', URI: PDFString.of(`https://leak.example/${URI_TOKEN}`) },
  }));
  const note = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [100, 10, 130, 40], Contents: PDFString.of(NOTE_TOKEN),
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([link, note]));
  return doc.save({ useObjectStreams: false });
}

function buildService(src: Uint8Array, password: { user: string; owner: string } | null) {
  const downloads: Blob[] = [];
  const errors: string[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: src }]]),
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements: [],
    formValues: {},
    currentFilename: 'report.pdf',
    exportPassword: password,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error: (k: string) => errors.push(k) },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = blob => { downloads.push(blob); };
  return { svc, downloads, errors };
}

// The third field: does this path write pdf-lib's /Info (Producer "…Hopding/pdf-lib")? The three
// user-facing downloads build with `cleanMetadata` and write none; `downloadPage` keeps the stamp.
const ENTRY_POINTS: Array<[string, (svc: ExportService) => Promise<void>, boolean]> = [
  ['downloadPDF', svc => svc.downloadPDF(), false],
  ['downloadPageRange', svc => svc.downloadPageRange([0]), false],
  ['downloadFlattened', svc => svc.downloadFlattened(), false],
  ['downloadPage', svc => svc.downloadPage(0), true],
];

async function exported(run: (svc: ExportService) => Promise<void>, password: { user: string; owner: string } | null): Promise<Uint8Array> {
  const { svc, downloads, errors } = buildService(await sourceBytes(), password);
  await run(svc);
  expect(errors).toEqual([]);
  expect(downloads).toHaveLength(1);
  return new Uint8Array(await downloads[0].arrayBuffer());
}

const latin1 = (b: Uint8Array): string => new TextDecoder('latin1').decode(b);

describe.each(ENTRY_POINTS)('%s with an export password', (_name, run, stampsInfo) => {
  it('writes no annotation string in plaintext', async () => {
    const text = latin1(await exported(run, { user: 'u-pass', owner: 'o-pass' }));
    expect(text).toContain('/Encrypt');
    expect(text).not.toContain(URI_TOKEN);
    expect(text).not.toContain(NOTE_TOKEN);
  });

  it('and a reader with the password reads the strings back intact', async () => {
    const bytes = await exported(run, { user: 'u-pass', owner: 'o-pass' });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes.slice(0), password: 'u-pass' }).promise;
    const annots = await (await doc.getPage(1)).getAnnotations() as Array<{ url?: string; contentsObj?: { str: string } }>;
    expect(annots.some(a => a.url === `https://leak.example/${URI_TOKEN}`)).toBe(true);
    expect(annots.some(a => a.contentsObj?.str === NOTE_TOKEN)).toBe(true);
  });

  it('leaves no document-information string in plaintext (SECURITY.md § "Lock PDF")', async () => {
    const bytes = await exported(run, { user: 'u-pass', owner: 'o-pass' });
    expect(latin1(bytes)).not.toContain('Hopding');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes.slice(0), password: 'u-pass' }).promise;
    const { info } = await doc.getMetadata() as { info: { Producer?: string } };
    if (stampsInfo) {
      expect(info.Producer).toContain('Hopding'); // present, encrypted, and readable with the password
    } else {
      // Non-vacuity: this path writes no /Info at all, even unlocked — so there was nothing to leak.
      expect(info.Producer).toBeUndefined();
      expect(latin1(await exported(run, null))).not.toContain('Hopding');
    }
  });
});

describe.each(ENTRY_POINTS)('%s WITHOUT a password (control)', (_name, run) => {
  it('keeps the classic xref save the signer needs', async () => {
    const text = latin1(await exported(run, null));
    expect(text).toMatch(/\nxref\s/);
    expect(text).not.toContain('/ObjStm');
    expect(text).toContain(URI_TOKEN); // unencrypted, so plaintext is correct here
  });
});
