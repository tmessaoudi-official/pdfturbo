import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bindExtractPagesModal, type ExtractPagesHost } from '../../src/ui/binders/extractPagesBinder';

function mountModal() {
  document.body.innerHTML = `
    <button id="extractPagesBtn"></button>
    <div id="extractPagesModal" style="display:none">
      <input id="extractPagesInput" />
      <button id="extractPagesConfirmBtn"></button>
      <button id="extractPagesCancelBtn"></button>
    </div>`;
}

function host(pageCount: number): ExtractPagesHost & { downloadPageRange: ReturnType<typeof vi.fn> } {
  return {
    documentModel: { pageCount },
    downloadPageRange: vi.fn(() => Promise.resolve()),
    ui: { extractPagesBtn: document.getElementById('extractPagesBtn') as HTMLButtonElement },
  };
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const modal = () => $('extractPagesModal');
const input = () => $('extractPagesInput') as HTMLInputElement;

describe('bindExtractPagesModal', () => {
  beforeEach(mountModal);

  it('opens the modal (and clears the input) on the toolbar button', () => {
    input().value = 'stale';
    const app = host(10);
    bindExtractPagesModal(app);
    app.ui.extractPagesBtn.click();
    expect(modal().style.display).toBe('flex');
    expect(input().value).toBe('');
  });

  it('confirm parses the range and calls downloadPageRange, then closes', () => {
    const app = host(10);
    bindExtractPagesModal(app);
    app.ui.extractPagesBtn.click();
    input().value = '1-3, 5';
    $('extractPagesConfirmBtn').click();
    expect(app.downloadPageRange).toHaveBeenCalledWith([0, 1, 2, 4]);
    expect(modal().style.display).toBe('none');
  });

  it('Enter in the input triggers extraction', () => {
    const app = host(10);
    bindExtractPagesModal(app);
    input().value = '2';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(app.downloadPageRange).toHaveBeenCalledWith([1]);
  });

  it('cancel closes without extracting', () => {
    const app = host(10);
    bindExtractPagesModal(app);
    app.ui.extractPagesBtn.click();
    $('extractPagesCancelBtn').click();
    expect(modal().style.display).toBe('none');
    expect(app.downloadPageRange).not.toHaveBeenCalled();
  });

  it('clamps the range to the document page count', () => {
    const app = host(3);
    bindExtractPagesModal(app);
    input().value = '1-99';
    $('extractPagesConfirmBtn').click();
    expect(app.downloadPageRange).toHaveBeenCalledWith([0, 1, 2]);
  });
});
