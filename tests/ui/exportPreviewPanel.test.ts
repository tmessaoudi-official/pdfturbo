// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportPreviewPanel, type IExportPreviewContext } from '../../src/ui/exportPreviewPanel';
import type { WatermarkSettings } from '../../src/core/documentModel';

function makeCtx(wmEnabled: boolean) {
  const container = document.createElement('div');
  container.id = 'canvasContainer';
  // a stale live watermark overlay left over from edit mode
  const live = document.createElement('canvas');
  live.id = 'watermarkOverlay';
  container.appendChild(live);

  const canvas = Object.assign(document.createElement('canvas'), { width: 200, height: 300 });
  const exportPreviewGhost = document.createElement('div');
  const exportPreviewOverlay = document.createElement('div');
  const previewExportBtn = document.createElement('button');

  const watermark: WatermarkSettings = { enabled: wmEnabled, text: 'WATERMARK', color: '#ff0000', fontSize: 60, opacity: 0.5, angle: -45, density: 3 };
  const renderCurrentPage = vi.fn();
  const drawWatermark = vi.fn();
  const ctx = {
    documentModel: { currentPage: { id: 'p1', rotation: 0 }, watermark },
    renderer: { canvas },
    ui: { container, canvas, exportPreviewGhost, exportPreviewOverlay, previewExportBtn },
    elements: [],
    zoomScale: 1,
    drawWatermark,
    renderCurrentPage,
  } as unknown as IExportPreviewContext;
  return { ctx, container, exportPreviewGhost, renderCurrentPage };
}

describe('ExportPreviewPanel watermark de-duplication', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes the live #watermarkOverlay on show so it does not stack with the ghost watermark', () => {
    const { ctx, container } = makeCtx(true);
    expect(container.querySelector('#watermarkOverlay')).not.toBeNull(); // stale overlay present
    new ExportPreviewPanel(ctx).show();
    expect(container.querySelector('#watermarkOverlay')).toBeNull(); // cleared by show()
  });

  it('re-renders the page on hide to restore the live watermark overlay', () => {
    const { ctx, renderCurrentPage } = makeCtx(true);
    const panel = new ExportPreviewPanel(ctx);
    panel.show();
    panel.hide();
    expect(renderCurrentPage).toHaveBeenCalled();
  });
});
