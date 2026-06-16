/**
 * PDFTurboApp.importXfdf orchestration (#57): parse → per-page height resolve →
 * element construction → one undoable MacroCmd → element-layer rebuild + toast.
 * The codec and coordinate math are covered by xfdf/xfdfMapping tests; this
 * drives the glue against a minimal fake `this` (full-app construction is too
 * heavy for jsdom — file-input flows are otherwise browser-QA'd).
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';
import { buildXfdf } from '../../src/utils/xfdf';
import type { PDFElement } from '../../src/elements/annotationElement';

function fakeApp() {
  const elements: PDFElement[] = [];
  const infos: { k: string; p?: Record<string, unknown> }[] = [];
  const warns: string[] = [];
  return {
    self: {
      documentModel: {
        pages: [{ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, blankHeight: 800 }],
        sourcePdfs: new Map(),
      },
      elements,
      historyManager: { execute: (cmd: { execute(): void }) => cmd.execute() },
      rebuildElementLayer: vi.fn(),
      autosave: vi.fn(),
      reportError: {
        info: (k: string, p?: Record<string, unknown>) => infos.push({ k, p }),
        warn: (k: string) => warns.push(k),
        error: () => {},
      },
    },
    elements, infos, warns,
  };
}

const blob = (xml: string) => new Blob([xml], { type: 'application/vnd.adobe.xfdf' }) as unknown as File;

describe('importXfdf orchestration (#57)', () => {
  it('adds imported annotations as elements (flipped back to display space) and rebuilds', async () => {
    const xml = buildXfdf([
      { type: 'highlight', page: 0, rect: [50, 680, 250, 700], color: '#FFFF00', opacity: 0.4 },
      { type: 'text', page: 0, rect: [300, 726, 324, 750], color: '#FFFDE7', contents: 'note' },
    ]);
    const app = fakeApp();
    await PDFTurboApp.prototype.importXfdf.call(app.self, blob(xml));

    expect(app.elements).toHaveLength(2);
    expect(app.elements[0]).toMatchObject({ type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1' });
    expect(app.elements[1]).toMatchObject({ type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'p1', text: 'note' });
    expect(app.self.rebuildElementLayer).toHaveBeenCalledOnce();
    expect(app.self.autosave).toHaveBeenCalledOnce();
    expect(app.infos.find(i => i.k === 'toast.xfdfImported')?.p).toEqual({ count: 2 });
  });

  it('warns (no elements added) on an empty / unmappable XFDF', async () => {
    const app = fakeApp();
    await PDFTurboApp.prototype.importXfdf.call(app.self, blob('<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"/>'));
    expect(app.elements).toHaveLength(0);
    expect(app.warns).toContain('toast.xfdfImportEmpty');
    expect(app.self.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('skips annotations targeting a non-existent page', async () => {
    const xml = buildXfdf([{ type: 'highlight', page: 9, rect: [0, 0, 10, 10], color: '#FF0000' }]);
    const app = fakeApp();
    await PDFTurboApp.prototype.importXfdf.call(app.self, blob(xml));
    expect(app.elements).toHaveLength(0);
    expect(app.warns).toContain('toast.xfdfImportEmpty');
  });
});
