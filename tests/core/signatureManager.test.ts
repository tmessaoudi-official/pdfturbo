// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignatureManager, type ISignatureContext } from '../../src/core/signatureManager';

function makeCtx(padEmpty: boolean) {
  let trap: (() => void) | null = null;
  const trapCleanup = vi.fn();
  const signatureModal = document.createElement('div');
  signatureModal.className = 'signature-modal active';
  const addSignatureBtn = document.createElement('button');
  addSignatureBtn.classList.add('active');
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 480; signatureCanvas.height = 192;

  const ctx = {
    ui: { signatureModal, signatureCanvas, addSignatureBtn },
    signaturePad: {
      isEmpty: vi.fn().mockReturnValue(padEmpty),
      getDataURL: vi.fn().mockReturnValue('data:image/png;base64,SIG'),
      clear: vi.fn(),
    },
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    getTrapCleanup: () => trap,
    setTrapCleanup: (fn: (() => void) | null) => { trap = fn; },
    setMode: vi.fn(),
  } as unknown as ISignatureContext;
  return { ctx, trapCleanup, signatureModal, addSignatureBtn };
}

describe('SignatureManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('save() with an empty pad warns and does not capture a signature', () => {
    const { ctx } = makeCtx(true);
    const mgr = new SignatureManager(ctx);
    mgr.save();
    expect(ctx.reportError.warn).toHaveBeenCalledWith('toast.drawSignatureFirst');
    expect(mgr.currentSignature).toBeNull();
    expect(ctx.setMode).not.toHaveBeenCalled();
  });

  it('save() with content captures the dataURL + natural size and switches to addSignature mode', () => {
    const { ctx, addSignatureBtn } = makeCtx(false);
    const mgr = new SignatureManager(ctx);
    mgr.save();
    expect(mgr.currentSignature).toBe('data:image/png;base64,SIG');
    expect(mgr.signatureNatural).toEqual({ w: 480, h: 192 });
    expect(ctx.setMode).toHaveBeenCalledWith('addSignature', { suppressSignatureModal: true });
    expect(addSignatureBtn.classList.contains('active')).toBe(true);
  });

  it('closeModal() resets to select mode, clears the focus trap, and deactivates the button', () => {
    const { ctx, signatureModal, addSignatureBtn } = makeCtx(false);
    const cleanup = vi.fn();
    ctx.setTrapCleanup(cleanup);
    const mgr = new SignatureManager(ctx);
    mgr.closeModal();
    expect(signatureModal.classList.contains('active')).toBe(false);
    expect(cleanup).toHaveBeenCalled();
    expect(ctx.getTrapCleanup()).toBeNull();
    expect(ctx.setMode).toHaveBeenCalledWith('select');
    expect(addSignatureBtn.classList.contains('active')).toBe(false);
  });
});
