/**
 * OCR export outputs (Option 1 + 3, 2026-06-20): the read-only "copy/download
 * recognized text" and "OCR → editable Word (.docx)" paths. Neither mutates the
 * document; empty text warns instead of emitting an empty file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { ExportService, type IExportContext } from '../../src/export/exportService';

interface Toast { level: 'info' | 'warn' | 'error'; key: string }

function buildProbe(): {
  svc: ExportService;
  blobs: { blob: Blob; filename: string }[];
  toasts: Toast[];
} {
  const blobs: { blob: Blob; filename: string }[] = [];
  const toasts: Toast[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    currentFilename: 'scan.pdf',
    reportError: {
      info: (key: string) => { toasts.push({ level: 'info', key }); },
      warn: (key: string) => { toasts.push({ level: 'warn', key }); },
      error: (key: string) => { toasts.push({ level: 'error', key }); },
    },
    progress: { begin: () => handle },
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob =
    (blob, filename) => { blobs.push({ blob, filename }); };
  return { svc, blobs, toasts };
}

function setClipboard(writeText: ((s: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => { setClipboard(undefined); });

describe('exportOcrText', () => {
  it('copies to clipboard AND downloads a .txt named after the doc → ocrTextCopied', async () => {
    const written: string[] = [];
    setClipboard((s) => { written.push(s); return Promise.resolve(); });
    const { svc, blobs, toasts } = buildProbe();
    await svc.exportOcrText('Line one\nLine two');
    expect(written).toEqual(['Line one\nLine two']);
    expect(blobs).toHaveLength(1);
    const first = blobs[0];
    if (!first) throw new Error('no download');
    expect(first.filename).toBe('scan.txt');
    expect(await first.blob.text()).toBe('Line one\nLine two');
    expect(toasts).toContainEqual({ level: 'info', key: 'toast.ocrTextCopied' });
  });

  it('still downloads when clipboard.writeText rejects → ocrTextExported (download fallback)', async () => {
    setClipboard(() => Promise.reject(new Error('denied')));
    const { svc, blobs, toasts } = buildProbe();
    await svc.exportOcrText('hello');
    expect(blobs).toHaveLength(1);
    expect(toasts).toContainEqual({ level: 'info', key: 'toast.ocrTextExported' });
  });

  it('still downloads when the Clipboard API is absent → ocrTextExported', async () => {
    setClipboard(undefined);
    const { svc, blobs, toasts } = buildProbe();
    await svc.exportOcrText('hello');
    expect(blobs).toHaveLength(1);
    expect(toasts).toContainEqual({ level: 'info', key: 'toast.ocrTextExported' });
  });

  it('warns (no file) on blank/whitespace text', async () => {
    setClipboard(() => Promise.resolve());
    const { svc, blobs, toasts } = buildProbe();
    await svc.exportOcrText('   \n\t ');
    expect(blobs).toHaveLength(0);
    expect(toasts).toContainEqual({ level: 'warn', key: 'toast.exportNoText' });
  });
});

describe('exportOcrDocx', () => {
  it('builds a real .docx whose document.xml carries the recognized text', async () => {
    const { svc, blobs, toasts } = buildProbe();
    await svc.exportOcrDocx('Invoice total\nThank you');
    expect(blobs).toHaveLength(1);
    const first = blobs[0];
    if (!first) throw new Error('no download');
    expect(first.filename).toBe('scan.docx');
    const buf = new Uint8Array(await first.blob.arrayBuffer());
    const files = unzipSync(buf);
    const docXml = files['word/document.xml'];
    if (!docXml) throw new Error('document.xml missing from docx');
    const xml = strFromU8(docXml);
    expect(xml).toContain('Invoice total');
    expect(xml).toContain('Thank you');
    expect(toasts).toContainEqual({ level: 'info', key: 'toast.docxExported' });
  });

  it('warns (no file) on blank text', async () => {
    const { svc, blobs, toasts } = buildProbe();
    await svc.exportOcrDocx('  ');
    expect(blobs).toHaveLength(0);
    expect(toasts).toContainEqual({ level: 'warn', key: 'toast.exportNoText' });
  });
});
