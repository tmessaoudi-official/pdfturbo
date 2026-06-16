/**
 * exportXfdf wiring (#57): ExportService walks pages, flips each supported
 * element to PDF user space, and downloads an XFDF doc. xfdf.test + xfdfMapping
 * .test cover the codec and the coordinate math; this covers the wired path
 * (page-height resolution, per-page filtering, the no-annotations warn). Uses a
 * blank page so the height comes from blankHeight (no pdf.js needed).
 */
import { describe, it, expect } from 'vitest';
import { HighlightElement } from '../../src/elements/highlightElement';
import { parseXfdf } from '../../src/utils/xfdf';
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
    expect(annots).toEqual([{ type: 'highlight', page: 0, rect: [50, 680, 250, 700], color: '#FFFF00', opacity: 0.4 }]);
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
