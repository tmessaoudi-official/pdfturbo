import { parsePageRange } from '../../utils/pageRange';

/** Minimal host surface the Extract-pages modal needs (PDFTurboApp satisfies it). */
export interface ExtractPagesHost {
  documentModel: { pageCount: number };
  downloadPageRange(indices: number[]): Promise<void>;
  ui: { extractPagesBtn: HTMLButtonElement };
}

/**
 * Wire the Extract-pages modal (#59): the toolbar button opens it; Confirm/Enter
 * parses the range input against the current page count and calls
 * downloadPageRange; Cancel / backdrop / out-of-range all close cleanly
 * (downloadPageRange itself warns on an empty selection).
 */
export function bindExtractPagesModal(app: ExtractPagesHost): void {
  const modal = document.getElementById('extractPagesModal') as HTMLElement | null;
  const input = document.getElementById('extractPagesInput') as HTMLInputElement | null;
  if (!modal || !input) return;

  const close = () => { modal.style.display = 'none'; };
  const run = () => {
    const indices = parsePageRange(input.value, app.documentModel.pageCount);
    close();
    void app.downloadPageRange(indices);
  };

  app.ui.extractPagesBtn?.addEventListener('click', () => {
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
  });
  document.getElementById('extractPagesConfirmBtn')?.addEventListener('click', run);
  document.getElementById('extractPagesCancelBtn')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}
