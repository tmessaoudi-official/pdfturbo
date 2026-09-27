/**
 * exportXfdf wiring (#57): ExportService walks pages, flips each supported
 * element to PDF user space, and downloads an XFDF doc. xfdf.test + xfdfMapping
 * .test cover the codec and the coordinate math; this covers the wired path
 * (page-height resolution, per-page filtering, the no-annotations warn). Uses a
 * blank page so the height comes from blankHeight (no pdf.js needed).
 */
import { describe, it, expect } from 'vitest';
import { HighlightElement } from '../../src/elements/highlightElement';
import { parseXfdf, parseXfdfDocument } from '../../src/utils/xfdf';
import { RedactionElement } from '../../src/elements/redactionElement';
import { ExportService, type IExportContext } from '../../src/export/exportService';

function buildProbe(elements: unknown[]) {
  const infos: { k: string; p?: Record<string, unknown> }[] = [];
  const warns: string[] = [];
  const downloads: { blob: Blob; filename: string }[] = [];
  const ctx = {
    documentModel: {
      pageCount: 1,
      pages: [{ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, blankHeight: 800, rotation: 0 }],
      sourcePdfs: new Map(),
    },
    elements,
    currentFilename: 'marked.pdf',
    reportError: {
      info: (k: string, p?: Record<string, unknown>) => infos.push({ k, p }),
      warn: (k: string) => warns.push(k),
      error: () => {},
    },
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, infos, warns, downloads };
}

describe('exportXfdf wiring (#57)', () => {
  it('exports a highlight to XFDF with PDF user-space coords', async () => {
    const hl = new HighlightElement(50, 100, 200, 20, 'p1', '#FFFF00', 0.4);
    const probe = buildProbe([hl]);
    await probe.svc.exportXfdf();

    expect(probe.downloads).toHaveLength(1);
    expect(probe.downloads[0].filename).toBe('marked.xfdf');
    const xml = await probe.downloads[0].blob.text();
    const annots = parseXfdf(xml);
    expect(annots).toEqual([{ type: 'highlight', page: 0, rect: [50, 680, 250, 700], color: '#FFFF00', opacity: 0.4,
      quads: [50, 700, 250, 700, 50, 680, 250, 680] }]);
    expect(probe.infos.map(i => i.k)).toContain('toast.xfdfExported');
    expect(probe.infos.find(i => i.k === 'toast.xfdfExported')?.p).toEqual({ count: 1 });
  });

  it('warns and emits nothing when there are no exportable annotations', async () => {
    const probe = buildProbe([]);
    await probe.svc.exportXfdf();
    expect(probe.downloads).toHaveLength(0);
    expect(probe.warns).toContain('toast.xfdfNoAnnots');
  });
});

/**
 * Limits row 26 (D21) — the export carries the form's field values, wired through the same redaction rule as
 * the annotations. A source page whose `getAnnotations` holds one text widget at user [100,700,300,720]
 * (display y 80..100 on this 600x800 page).
 */
describe('exportXfdf — form fields (row 26)', () => {
  function fieldProbe(elements: unknown[], formValues: Record<string, Record<string, string>>) {
    const page = {
      rotate: 0,
      getAnnotations: () => Promise.resolve([
        { subtype: 'Widget', fieldType: 'Tx', fieldName: 'ssn', fieldValue: 'PDF-FILLED', rect: [100, 700, 300, 720] },
      ]),
      getViewport: () => ({ viewBox: [0, 0, 600, 800], convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
        convertToViewportPoint: (u: number, v: number) => [u, 800 - v] }),
    };
    const downloads: Blob[] = [];
    const warns: string[] = [];
    const ctx = {
      documentModel: {
        pageCount: 1,
        pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
        sourcePdfs: new Map([['s1', { doc: { getPage: () => Promise.resolve(page) } }]]),
      },
      elements, formValues, currentFilename: 'f.pdf',
      reportError: { info: () => {}, warn: (k: string) => warns.push(k), error: (k: string, e: unknown) => { throw e ?? new Error(k); } },
    } as unknown as IExportContext;
    const svc = new ExportService(ctx);
    (svc as unknown as { _downloadBlob: (b: Blob) => void })._downloadBlob = b => downloads.push(b);
    return { svc, downloads, warns };
  }

  it('exports the user value of a field, with no annotation needed', async () => {
    const p = fieldProbe([], { s1: { ssn: '123-45' } });
    await p.svc.exportXfdf();
    expect(parseXfdfDocument(await p.downloads[0].text()).fields).toEqual([{ name: 'ssn', values: ['123-45'] }]);
  });

  it('LEAK: a redaction over the widget keeps both the typed and the PDF value out of the file', async () => {
    const red = new RedactionElement(90, 70, 220, 40, 'p1');
    const typed = fieldProbe([red], { s1: { ssn: '123-45' } });
    await typed.svc.exportXfdf();
    const sourceOnly = fieldProbe([red], {});
    await sourceOnly.svc.exportXfdf();
    for (const p of [typed, sourceOnly]) {
      // Nothing left to export — the warning fires and no file is written.
      expect(p.downloads).toHaveLength(0);
      expect(p.warns).toContain('toast.xfdfNoAnnots');
    }
  });

  it('CONTROL: the same redaction elsewhere on the page leaves the field in', async () => {
    const p = fieldProbe([new RedactionElement(400, 700, 50, 20, 'p1')], {});
    await p.svc.exportXfdf();
    expect(await p.downloads[0].text()).toContain('PDF-FILLED');
  });
});
