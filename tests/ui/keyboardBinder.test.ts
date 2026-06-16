import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindKeyboardEvents } from '../../src/ui/binders/keyboardBinder';
import type { PDFTurboApp } from '../../src/core/pdfTurboApp';

function modal(active: boolean): HTMLElement {
  const d = document.createElement('div');
  if (active) d.classList.add('active');
  return d;
}

function makeApp(active: Partial<Record<'settings' | 'help' | 'signature' | 'watermark' | 'code' | 'bates', boolean>> = {}) {
  const findBar = document.createElement('div');
  findBar.style.display = 'none';
  const app = {
    ui: {
      settingsPanel: modal(!!active.settings),
      helpModal: modal(!!active.help),
      signatureModal: modal(!!active.signature),
      watermarkModal: modal(!!active.watermark),
      codeModal: modal(!!active.code),
      batesModal: modal(!!active.bates),
      findBar,
    },
    _toggleSettings: vi.fn(),
    _toggleHelp: vi.fn(),
    closeSignatureModal: vi.fn(),
    _closeWatermarkModal: vi.fn(),
    closeCodeModal: vi.fn(),
    _closeBatesModal: vi.fn(),
    _closeFindBar: vi.fn(),
    setMode: vi.fn(),
    selectElement: vi.fn(),
    documentModel: { pageCount: 0 },
    selectedElement: null,
  };
  return app as unknown as PDFTurboApp & { _closeBatesModal: ReturnType<typeof vi.fn>; _closeWatermarkModal: ReturnType<typeof vi.fn>; setMode: ReturnType<typeof vi.fn> };
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
