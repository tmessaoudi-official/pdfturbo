import { describe, it, expect, vi } from 'vitest';
import { ToolModeService, canvasCapturesGesture, type IToolModeContext } from '../../src/core/toolModeService';
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
    setCanvasTouchAction:    vi.fn(),
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

  it('does NOT open signature modal in addSignature when suppressSignatureModal is set', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('addSignature', { suppressSignatureModal: true });
    expect(ctx.mode).toBe('addSignature');                 // still enters the mode
    expect(ctx.openSignatureModal).not.toHaveBeenCalled();  // but the modal stays closed
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

  // F-A (mobile drag/draw): while a canvas-drag tool is active the canvas must own
  // the touch gesture (touch-action:none) so a single-finger drag draws instead of
  // the browser stealing it for native scroll. select/idle keeps native scroll.
  it('sets canvas touch-action to "none" for a canvas-drag tool', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('drawRect');
    expect(ctx.setCanvasTouchAction).toHaveBeenCalledWith('none');
  });

  it('restores canvas touch-action to "pan-x pan-y" in select mode', () => {
    const ctx = makeCtx('drawRect');
    const mgr = new ToolModeService(ctx);
    mgr.setMode('select');
    expect(ctx.setCanvasTouchAction).toHaveBeenCalledWith('pan-x pan-y');
  });

  it('keeps native scroll (pan-x pan-y) for tap-only tools (editText)', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('editText');
    expect(ctx.setCanvasTouchAction).toHaveBeenCalledWith('pan-x pan-y');
  });

  it('captures the gesture (none) for drag-to-place tools (addText)', () => {
    const ctx = makeCtx();
    const mgr = new ToolModeService(ctx);
    mgr.setMode('addText');
    expect(ctx.setCanvasTouchAction).toHaveBeenCalledWith('none');
  });
});

describe('canvasCapturesGesture', () => {
  const capture: ToolMode[] = [
    'drawArrow', 'drawRect', 'drawEllipse', 'drawFreehand', 'drawHighlight',
    'drawRedaction', 'drawErase', 'crop',
    'addText', 'addImage', 'addComment', 'addSignature', 'addCode',
  ];
  const passthrough: ToolMode[] = ['select', 'editText', 'fillBucket'];

  for (const mode of capture) {
    it(`captures the canvas gesture for "${mode}"`, () => {
      expect(canvasCapturesGesture(mode)).toBe(true);
    });
  }

  for (const mode of passthrough) {
    it(`lets native scroll through for "${mode}"`, () => {
      expect(canvasCapturesGesture(mode)).toBe(false);
    });
  }
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
