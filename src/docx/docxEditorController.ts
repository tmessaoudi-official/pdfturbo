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
import { t } from '../utils/i18n';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface DocxEditorControllerOptions {
  /** Lazy-load + mount the editor. Defaults to importing ./docxProseMirror. */
  loadEditor?: (container: HTMLElement, bytes: Uint8Array) => Promise<DocxEditorHandle>;
  /** Persist the edited bytes. Defaults to a blob/anchor download. */
  download?: (bytes: Uint8Array, filename: string) => void;
  /** User-facing notice seam (e.g. app.reportError.info / .error). Optional. */
  notify?: (key: string, kind: 'info' | 'error') => void;
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

  header.append(title, saveBtn, closeBtn);
  panel.append(header, mount);
  modal.append(panel);
  document.body.append(input, modal);

  let handle: DocxEditorHandle | null = null;
  let currentName = 'document.docx';

  const teardownHandle = (): void => {
    handle?.destroy();
    handle = null;
    mount.replaceChildren();
  };

  async function loadBytes(bytes: Uint8Array, filename: string): Promise<void> {
    teardownHandle();
    currentName = filename || 'document.docx';
    try {
      handle = await loadEditor(mount, bytes);
      modal.style.display = 'flex';
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
      notify('docxEditor.saved', 'info');
    } catch {
      notify('docxEditor.saveFailed', 'error');
    }
  };

  const onClose = (): void => { close(); };

  input.addEventListener('change', onInputChange);
  saveBtn.addEventListener('click', onSave);
  closeBtn.addEventListener('click', onClose);

  function close(): void {
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
      saveBtn.removeEventListener('click', onSave);
      closeBtn.removeEventListener('click', onClose);
      input.remove();
      modal.remove();
    },
  };
}
