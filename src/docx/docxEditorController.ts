/**
 * docxEditorController — the app entry point for the .docx editor (#1c).
 *
 * Self-contained on purpose: it creates its OWN hidden file input + modal overlay
 * (no coupling to the PDF documentModel / uiController), so opening a Word document
 * never disturbs the PDF editing pipeline. The heavy editor (ProseMirror + the docx
 * model) is lazy-loaded only when a document is actually opened, via the `loadEditor`
 * seam — so the prosemirror chunk stays out of the initial bundle.
 *
 * Both side effects that are awkward under test — the dynamic import and the
 * blob/anchor download — are injectable seams (`loadEditor`, `download`), letting the
 * jsdom suite drive the full open→edit→save→download flow deterministically.
 */
import type { DocxEditorHandle } from './docxProseMirror';
import type { DocModel, DocBlock } from './docModel';
import { trapFocus } from '../utils/focusTrap';
import { t } from '../utils/i18n';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Recursively count DocTable nodes (incl. nested tables inside cells). */
function countTables(model: DocModel): number {
  let n = 0;
  const walk = (blocks: DocBlock[]): void => {
    for (const b of blocks) {
      if (b.kind === 'table') {
        n++;
        for (const row of b.rows) for (const cell of row.cells) walk(cell.blocks);
      }
    }
  };
  walk(model.blocks);
  return n;
}

export interface DocxEditorControllerOptions {
  /** Lazy-load + mount the editor. Defaults to importing ./docxProseMirror. */
  loadEditor?: (container: HTMLElement, bytes: Uint8Array) => Promise<DocxEditorHandle>;
  /** Persist the edited bytes. Defaults to a blob/anchor download. */
  download?: (bytes: Uint8Array, filename: string) => void;
  /** User-facing notice seam (e.g. app.reportError.info / .warn / .error). Optional. */
  notify?: (key: string, kind: 'info' | 'warn' | 'error') => void;
}

export interface DocxEditorController {
  /** Open the OS file picker to choose a .docx to edit. */
  open(): void;
  /** Load bytes directly (file picker, drag-drop, or tests). */
  loadBytes(bytes: Uint8Array, filename: string): Promise<void>;
  /** Close the editor + hide the modal (keeps the controller reusable). */
  close(): void;
  /** Remove every DOM node the controller created. */
  destroy(): void;
}

function anchorDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: DOCX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function defaultLoadEditor(container: HTMLElement, bytes: Uint8Array): Promise<DocxEditorHandle> {
  const { mountDocxEditor } = await import('./docxProseMirror');
  return mountDocxEditor(container, bytes);
}

/** `foo.docx` → `foo-edited.docx`; anything else gets the suffix before any extension. */
function editedName(filename: string): string {
  return filename.replace(/(\.docx)?$/i, '') + '-edited.docx';
}

/** `foo.docx` → `foo.pdf`. */
function pdfName(filename: string): string {
  return filename.replace(/\.docx$/i, '') + '.pdf';
}

/**
 * Build the editor controller. Appends a hidden file input and a hidden modal to
 * `document.body`; nothing is shown until `open()`/`loadBytes()`.
 */
export function createDocxEditorController(options: DocxEditorControllerOptions = {}): DocxEditorController {
  const loadEditor = options.loadEditor ?? defaultLoadEditor;
  const download = options.download ?? anchorDownload;
  const notify = options.notify ?? (() => {});

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.docx,' + DOCX_MIME;
  input.style.display = 'none';
  input.setAttribute('data-docx-editor-input', '');

  const modal = document.createElement('div');
  modal.className = 'docx-editor-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.style.display = 'none';

  const panel = document.createElement('div');
  panel.className = 'docx-editor-panel';

  const header = document.createElement('div');
  header.className = 'docx-editor-header';

  const title = document.createElement('span');
  title.className = 'docx-editor-title';
  title.textContent = t('docxEditor.title');

  const exportPdfBtn = document.createElement('button');
  exportPdfBtn.type = 'button';
  exportPdfBtn.className = 'docx-editor-export-pdf btn';
  exportPdfBtn.textContent = t('docxEditor.exportPdf');

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'docx-editor-save btn';
  saveBtn.textContent = t('docxEditor.save');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'docx-editor-close btn';
  closeBtn.setAttribute('aria-label', t('docxEditor.close'));
  closeBtn.textContent = '✕';

  const mount = document.createElement('div');
  mount.className = 'docx-editor-mount';

  header.append(title, exportPdfBtn, saveBtn, closeBtn);
  panel.append(header, mount);
  modal.append(panel);
  document.body.append(input, modal);

  let handle: DocxEditorHandle | null = null;
  let currentName = 'document.docx';
  let originalTableCount = 0;
  let releaseFocusTrap: (() => void) | null = null;

  const teardownHandle = (): void => {
    handle?.destroy();
    handle = null;
    mount.replaceChildren();
  };

  async function loadBytes(bytes: Uint8Array, filename: string): Promise<void> {
    const prevFocus = document.activeElement as HTMLElement | null;
    teardownHandle();
    currentName = filename || 'document.docx';
    try {
      handle = await loadEditor(mount, bytes);
      originalTableCount = countTables(handle.getModel()); // #QA-2026-06-23 P1-2 baseline
      if (handle.toolbarDom) panel.insertBefore(handle.toolbarDom, mount); // toolbar above the editor
      if (handle.findReplaceBar) panel.insertBefore(handle.findReplaceBar, mount); // bar below the toolbar
      modal.style.display = 'flex';
      releaseFocusTrap?.();
      releaseFocusTrap = trapFocus(panel, prevFocus ?? undefined); // #QA-2026-06-23 P1-3
    } catch (err) {
      notify('docxEditor.openFailed', 'error');
      throw err;
    }
  }

  const onInputChange = (): void => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    file.arrayBuffer().then(
      ab => loadBytes(new Uint8Array(ab), file.name),
      () => notify('docxEditor.openFailed', 'error'),
    );
  };

  const onSave = (): void => {
    if (!handle) return;
    try {
      download(handle.save(), editedName(currentName));
      // #QA-2026-06-23 P1-2: structural table edits are not persisted by the in-place save
      // (reconcile keeps the original tables when the count diverges). Surface that instead of
      // a misleading "saved" — otherwise the downloaded file silently differs from the editor.
      if (countTables(handle.getModel()) !== originalTableCount) {
        notify('docxEditor.tableStructureUnsupported', 'warn');
      } else {
        notify('docxEditor.saved', 'info');
      }
    } catch {
      notify('docxEditor.saveFailed', 'error');
    }
  };

  const onExportPdf = (): void => {
    if (!handle) return;
    const model = handle.getModel();
    import('./docxToPdf')
      .then(({ docModelToPdfBytes }) => docModelToPdfBytes(model))
      .then(({ bytes, hadUnsupportedChars }) => {
        download(bytes, pdfName(currentName));
        notify('docxEditor.pdfExported', 'info');
        if (hadUnsupportedChars) notify('docxEditor.pdfUnsupportedChars', 'warn');
      })
      .catch(() => notify('docxEditor.pdfFailed', 'error'));
  };

  const onClose = (): void => { close(); };
  // #QA-2026-06-23 P1-3 — Esc closes; clicking the backdrop (outside the panel) closes.
  const onModalKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && modal.style.display !== 'none') { e.stopPropagation(); close(); }
  };
  const onModalClick = (e: MouseEvent): void => { if (e.target === modal) close(); };

  input.addEventListener('change', onInputChange);
  exportPdfBtn.addEventListener('click', onExportPdf);
  saveBtn.addEventListener('click', onSave);
  closeBtn.addEventListener('click', onClose);
  modal.addEventListener('keydown', onModalKeydown);
  modal.addEventListener('click', onModalClick);

  function close(): void {
    releaseFocusTrap?.();
    releaseFocusTrap = null;
    teardownHandle();
    modal.style.display = 'none';
  }

  return {
    open(): void { input.click(); },
    loadBytes,
    close,
    destroy(): void {
      teardownHandle();
      input.removeEventListener('change', onInputChange);
      exportPdfBtn.removeEventListener('click', onExportPdf);
      saveBtn.removeEventListener('click', onSave);
      closeBtn.removeEventListener('click', onClose);
      modal.removeEventListener('keydown', onModalKeydown);
      modal.removeEventListener('click', onModalClick);
      releaseFocusTrap?.();
      releaseFocusTrap = null;
      input.remove();
      modal.remove();
    },
  };
}
