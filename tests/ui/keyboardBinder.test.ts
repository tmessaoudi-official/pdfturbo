import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindKeyboardEvents } from '../../src/ui/binders/keyboardBinder';
import type { PDFTurboApp } from '../../src/core/pdfTurboApp';

function modal(active: boolean): HTMLElement {
  const d = document.createElement('div');
  if (active) d.classList.add('active');
  return d;
}

function makeApp(active: Partial<Record<'settings' | 'help' | 'signature' | 'watermark' | 'code' | 'bates' | 'sign' | 'ocr' | 'compress', boolean>> = {}) {
  const findBar = document.createElement('div');
  findBar.style.display = 'none';
  const app = {
    ui: {
      settingsPanel: modal(!!active.settings),
      helpModal: modal(!!active.help),
      signatureModal: modal(!!active.signature),
      watermarkModal: modal(!!active.watermark),
      compressModal: modal(!!active.compress),
      codeModal: modal(!!active.code),
      batesModal: modal(!!active.bates),
      signModal: modal(!!active.sign),
      ocrModal: modal(!!active.ocr),
      findBar,
    },
    _toggleSettings: vi.fn(),
    _toggleHelp: vi.fn(),
    closeSignatureModal: vi.fn(),
    _closeWatermarkModal: vi.fn(),
    _closeCompressModal: vi.fn(),
    closeCodeModal: vi.fn(),
    _closeBatesModal: vi.fn(),
    closeSignModal: vi.fn(),
    closeOcrModal: vi.fn(),
    _closeFindBar: vi.fn(),
    setMode: vi.fn(),
    selectElement: vi.fn(),
    documentModel: { pageCount: 0 },
    selectedElement: null,
  };
  return app as unknown as PDFTurboApp & Record<string, ReturnType<typeof vi.fn>>;
}

/** Build a display:flex modal with a cancel button wired to a spy + hide-on-click. */
function displayModal(id: string, cancelId: string, open: boolean): ReturnType<typeof vi.fn> {
  const m = document.createElement('div');
  m.id = id;
  m.style.display = open ? 'flex' : 'none';
  const cancel = document.createElement('button');
  cancel.id = cancelId;
  const spy = vi.fn(() => { m.style.display = 'none'; });
  cancel.addEventListener('click', spy);
  m.appendChild(cancel);
  document.body.appendChild(m);
  return spy;
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('keyboardBinder Escape-to-close (#61b a11y)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('closes the Bates modal on Escape when it is active', () => {
    const app = makeApp({ bates: true });
    bindKeyboardEvents(app);
    pressEscape();
    expect(app._closeBatesModal).toHaveBeenCalled();
    expect(app.setMode).not.toHaveBeenCalled(); // returned before the select-mode fallback
  });

  it('still closes the watermark modal on Escape (no regression)', () => {
    const app = makeApp({ watermark: true });
    bindKeyboardEvents(app);
    pressEscape();
    expect(app._closeWatermarkModal).toHaveBeenCalled();
    expect(app._closeBatesModal).not.toHaveBeenCalled();
  });
});

describe('keyboardBinder Escape-to-close — sign/ocr + display modals (QA 2026-06-17 a11y)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('closes the sign modal on Escape when active', () => {
    const app = makeApp({ sign: true });
    bindKeyboardEvents(app);
    pressEscape();
    expect(app.closeSignModal).toHaveBeenCalled();
    expect(app.setMode).not.toHaveBeenCalled();
  });

  it('closes the OCR modal on Escape when active', () => {
    const app = makeApp({ ocr: true });
    bindKeyboardEvents(app);
    pressEscape();
    expect(app.closeOcrModal).toHaveBeenCalled();
    expect(app.setMode).not.toHaveBeenCalled();
  });

  it('dismisses the blank-page modal via its Cancel button on Escape', () => {
    const cancel = displayModal('blankPageModal', 'blankPageCancelBtn', true);
    const app = makeApp();
    bindKeyboardEvents(app);
    pressEscape();
    expect(cancel).toHaveBeenCalled();
    expect(app.setMode).not.toHaveBeenCalled();
  });

  it('dismisses the password modal via Cancel on Escape (resolves the pending promise)', () => {
    const cancel = displayModal('pdfPasswordModal', 'pdfPasswordCancelBtn', true);
    const app = makeApp();
    bindKeyboardEvents(app);
    pressEscape();
    expect(cancel).toHaveBeenCalled();
  });

  it('dismisses the lock-PDF modal via Cancel on Escape', () => {
    const cancel = displayModal('lockPdfModal', 'lockPdfCancelBtn', true);
    const app = makeApp();
    bindKeyboardEvents(app);
    pressEscape();
    expect(cancel).toHaveBeenCalled();
  });

  it('dismisses the extract-pages modal via Cancel on Escape', () => {
    const cancel = displayModal('extractPagesModal', 'extractPagesCancelBtn', true);
    const app = makeApp();
    bindKeyboardEvents(app);
    pressEscape();
    expect(cancel).toHaveBeenCalled();
  });

  it('does NOT dismiss a display modal that is hidden', () => {
    const cancel = displayModal('lockPdfModal', 'lockPdfCancelBtn', false);
    const app = makeApp();
    bindKeyboardEvents(app);
    pressEscape();
    expect(cancel).not.toHaveBeenCalled();
    expect(app.setMode).toHaveBeenCalledWith('select'); // falls through to the default
  });
});

describe('keyboardBinder crop shortcut (P) — QA 2026-06-18 A2', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  /** Minimal host for the single-key branch (Escape path is untouched by 'p'). */
  function cropApp(pageCount: number, mode: string) {
    return {
      documentModel: { pageCount },
      mode,
      setMode: vi.fn(),
    } as unknown as PDFTurboApp & { setMode: ReturnType<typeof vi.fn> };
  }
  const pressKey = (key: string) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('enters crop mode on P when a page is loaded', () => {
    const app = cropApp(1, 'select');
    bindKeyboardEvents(app);
    pressKey('p');
    expect(app.setMode).toHaveBeenCalledWith('crop');
  });

  it('toggles back to select on P when already cropping', () => {
    const app = cropApp(1, 'crop');
    bindKeyboardEvents(app);
    pressKey('P');
    expect(app.setMode).toHaveBeenCalledWith('select');
  });

  it('does nothing on P when no page is loaded', () => {
    const app = cropApp(0, 'select');
    bindKeyboardEvents(app);
    pressKey('p');
    expect(app.setMode).not.toHaveBeenCalled();
  });
});
