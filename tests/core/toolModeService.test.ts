import { describe, it, expect, vi } from 'vitest';
import { ToolModeService, type IToolModeContext } from '../../src/core/toolModeService';
import type { ToolMode } from '../../src/core/pdfTurboApp';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeCtx(initialMode: ToolMode = 'select'): IToolModeContext {
  const ctx: IToolModeContext = {
    mode: initialMode,
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    cancelHandlers:          vi.fn(),
    setElementPointerEvents: vi.fn(),
    updateModeButtons:       vi.fn(),
    updateFormattingToolbar: vi.fn(),
    setOverlayPointerEvents: vi.fn(),
    openSignatureModal:      vi.fn(),
    hidePlacementGhost:      vi.fn(),
    clearToast:              vi.fn(),
  };
  return ctx;
}

describe('ToolModeService.setMode', () => {
  it('updates ctx.mode to the new mode', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('addText');
    expect(ctx.mode).toBe('addText');
  });

  it('cancels handlers before switching mode', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('drawArrow');
    expect(ctx.cancelHandlers).toHaveBeenCalled();
  });

  it('sets pointer-events to "auto" in select mode', () => {
    const ctx = makeCtx('addText');
    const mgr = new ToolModeService(ctx);
    mgr.setMode('select');
    expect(ctx.setElementPointerEvents).toHaveBeenCalledWith('auto');
  });

  it('sets pointer-events to "none" in non-select modes', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('drawRect');
    expect(ctx.setElementPointerEvents).toHaveBeenCalledWith('none');
  });

  it('calls updateModeButtons with the new mode', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('highlight' as ToolMode);
    expect(ctx.updateModeButtons).toHaveBeenCalledWith('highlight');
  });

  it('calls updateFormattingToolbar on every mode change', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('select');
    expect(ctx.updateFormattingToolbar).toHaveBeenCalled();
  });

  it('passes isSelect=true to setOverlayPointerEvents in select mode', () => {
    const ctx = makeCtx('addText');
    const mgr = new ToolModeService(ctx);
    mgr.setMode('select');
    expect(ctx.setOverlayPointerEvents).toHaveBeenCalledWith(true);
  });

  it('passes isSelect=false in non-select modes', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('drawFreehand');
    expect(ctx.setOverlayPointerEvents).toHaveBeenCalledWith(false);
  });

  it('opens signature modal when mode is addSignature', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('addSignature');
    expect(ctx.openSignatureModal).toHaveBeenCalled();
  });

  it('does NOT open signature modal for other modes', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('addText');
    expect(ctx.openSignatureModal).not.toHaveBeenCalled();
  });

  it('hides placement ghost for non-placement modes', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('drawArrow');
    expect(ctx.hidePlacementGhost).toHaveBeenCalled();
  });

  it('does NOT hide placement ghost for placement modes', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('addText');
    expect(ctx.hidePlacementGhost).not.toHaveBeenCalled();
  });

  it('shows toast hint for modes that have one', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('drawRect');
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.modeHint.drawRect');
    expect(ctx.clearToast).not.toHaveBeenCalled();
  });

  it('clears toast for select mode (no hint key)', () => {
    const ctx = makeCtx('addText');
    const mgr = new ToolModeService(ctx);
    mgr.setMode('select');
    expect(ctx.clearToast).toHaveBeenCalled();
    expect(ctx.reportError.info).not.toHaveBeenCalled();
  });
});

describe('ToolModeService.isShapeMode', () => {
  it('returns true for draw* modes', () => {
    const ctx = makeCtx('drawArrow');
    const mgr = new ToolModeService(ctx);
    expect(mgr.isShapeMode()).toBe(true);
  });

  it('returns false for non-draw modes', () => {
    const ctx = makeCtx('select');
    const mgr = new ToolModeService(ctx);
    expect(mgr.isShapeMode()).toBe(false);
  });

  it('reflects the current ctx.mode (not the mode at construction time)', () => {
    const ctx = makeCtx('select');
    const mgr = new ToolModeService(ctx);
    ctx.mode = 'drawFreehand';
    expect(mgr.isShapeMode()).toBe(true);
  });
});
