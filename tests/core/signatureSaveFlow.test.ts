// @vitest-environment jsdom
// Regression guard for the P0 "drawn signature resets on Save" bug (QA 2026-06-17).
//
// Root cause: SignatureManager.save() armed placement mode via setMode('addSignature'),
// but ToolModeService.setMode('addSignature') has the side effect openSignatureModal()
// -> signaturePad.clear(), so clicking the modal Save re-opened a BLANK pad and the
// just-drawn signature appeared to vanish. This test wires the REAL ToolModeService and
// REAL SignatureManager together so the actual save -> setMode -> openModal -> clear()
// chain is exercised (jsdom-reproducible without a browser).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignatureManager, type ISignatureContext } from '../../src/core/signatureManager';
import { ToolModeService, type IToolModeContext, type SetModeOptions } from '../../src/core/toolModeService';
import type { ToolMode } from '../../src/core/pdfTurboApp';

vi.mock('../../src/utils/i18n', () => ({ t: (k: string) => k }));
vi.mock('../../src/utils/focusTrap', () => ({ trapFocus: () => vi.fn() }));

function wire() {
  let trap: (() => void) | null = null;
  let padEmpty = true;

  const signatureModal = document.createElement('div');
  signatureModal.className = 'signature-modal';
  const content = document.createElement('div');
  content.className = 'signature-content';
  signatureModal.appendChild(content);
  const addSignatureBtn = document.createElement('button');
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 480;
  signatureCanvas.height = 192;

  const clear = vi.fn(() => { padEmpty = true; });
  const signaturePad = {
    isEmpty: () => padEmpty,
    getDataURL: vi.fn().mockReturnValue('data:image/png;base64,SIG'),
    clear,
  };

  // One shared context that satisfies BOTH service contracts, wired exactly as
  // PDFTurboApp wires them: setMode -> ToolModeService, openSignatureModal -> SignatureManager.
  // `signatureManager` is referenced lazily inside the arrow (TDZ-safe: never invoked
  // before its const initialiser below runs).
  const toolMode = {
    mode: 'select' as ToolMode,
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    cancelHandlers: vi.fn(),
    setElementPointerEvents: vi.fn(),
    updateModeButtons: vi.fn(),
    updateFormattingToolbar: vi.fn(),
    setOverlayPointerEvents: vi.fn(),
    openSignatureModal: () => signatureManager.openModal(),
    hidePlacementGhost: vi.fn(),
    clearToast: vi.fn(),
    setCanvasTouchAction: vi.fn(),
  } satisfies IToolModeContext;

  const toolModeService = new ToolModeService(toolMode);

  const sigCtx = {
    ui: { signatureModal, signatureCanvas, addSignatureBtn },
    signaturePad,
    reportError: toolMode.reportError,
    getTrapCleanup: () => trap,
    setTrapCleanup: (fn: (() => void) | null) => { trap = fn; },
    setMode: (mode: ToolMode, opts?: SetModeOptions) => toolModeService.setMode(mode, opts),
  } as unknown as ISignatureContext;

  const signatureManager = new SignatureManager(sigCtx);

  return {
    signatureManager,
    toolMode,
    signatureModal,
    addSignatureBtn,
    clear,
    draw: () => { padEmpty = false; },
  };
}

describe('drawn-signature save flow (P0 regression)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT re-open or re-clear the pad when the user clicks Save after drawing', () => {
    const w = wire();

    // 1. Toolbar arms addSignature mode -> modal opens, pad cleared once.
    w.toolMode.openSignatureModal();
    expect(w.signatureModal.classList.contains('active')).toBe(true);
    expect(w.clear).toHaveBeenCalledTimes(1);

    // 2. User draws something.
    w.draw();

    // 3. User clicks the modal Save.
    w.signatureManager.save();

    // The signature must be captured...
    expect(w.signatureManager.currentSignature).toBe('data:image/png;base64,SIG');
    // ...the mode must be armed for placement...
    expect(w.toolMode.mode).toBe('addSignature');
    expect(w.addSignatureBtn.classList.contains('active')).toBe(true);
    // ...but the modal must STAY CLOSED and the pad must NOT be cleared again.
    expect(w.signatureModal.classList.contains('active')).toBe(false);
    expect(w.clear).toHaveBeenCalledTimes(1);
  });
});
