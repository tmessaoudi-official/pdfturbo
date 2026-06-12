import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageThumbnailPanel } from '../../src/ui/pageThumbnailPanel';
import { DocumentModel } from '../../src/core/documentModel';
import type { PDFRenderer } from '../../src/infra/pdfRenderer';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeRenderer(): PDFRenderer {
  return {
    generateThumbnail: vi.fn().mockResolvedValue(null),
  } as unknown as PDFRenderer;
}

function makeModel(pageCount: number, currentIndex = 0): DocumentModel {
  const model = new DocumentModel();
  for (let i = 0; i < pageCount; i++) {
    model.pages.push({
      id: `page-${i}`,
      sourcePdfId: 'src',
      sourcePageNum: i + 1,
      rotation: 0,
      blankWidth: undefined,
      blankHeight: undefined,
    });
  }
  model.currentPageIndex = currentIndex;
  return model;
}

function makePanel(container: HTMLElement, model: DocumentModel): {
  panel: PageThumbnailPanel;
  onNavigate: ReturnType<typeof vi.fn>;
} {
  const onNavigate = vi.fn();
  const panel = new PageThumbnailPanel({
    container,
    renderer: makeRenderer(),
    model,
    onNavigate,
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onRotate: vi.fn(),
    onAddPdf: vi.fn(),
    onDownload: vi.fn(),
    onDownloadImage: vi.fn(),
  });
  return { panel, onNavigate };
}

describe('PageThumbnailPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders N thumbnails for N pages', async () => {
    const model = makeModel(3);
    const { panel } = makePanel(container, model);
    await panel.render();
    expect(container.querySelectorAll('.thumb-item')).toHaveLength(3);
  });

  it('marks the active page with thumb-active class', async () => {
    const model = makeModel(3, 1);
    const { panel } = makePanel(container, model);
    await panel.render();
    const items = container.querySelectorAll('.thumb-item');
    expect(items[0].classList.contains('thumb-active')).toBe(false);
    expect(items[1].classList.contains('thumb-active')).toBe(true);
    expect(items[2].classList.contains('thumb-active')).toBe(false);
  });

  it('click on thumbnail triggers onNavigate with correct index', async () => {
    const model = makeModel(3);
    const { panel, onNavigate } = makePanel(container, model);
    await panel.render();
    const second = container.querySelectorAll('.thumb-item')[1] as HTMLElement;
    second.click();
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});
