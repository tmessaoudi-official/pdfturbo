import type { ToolMode } from './pdfTurboApp';
import type { IErrorReporter } from './errorReporter';

export interface IToolModeContext {
  mode: ToolMode;
  readonly reportError: IErrorReporter;
  cancelHandlers(): void;
  setElementPointerEvents(pe: 'auto' | 'none'): void;
  updateModeButtons(mode: ToolMode): void;
  updateFormattingToolbar(): void;
  setOverlayPointerEvents(isSelect: boolean): void;
  openSignatureModal(): void;
  hidePlacementGhost(): void;
  clearToast(): void;
  /**
   * F-A (mobile): set the canvas `touch-action`. `'none'` lets the canvas own a
   * single-finger drag (draw/place); `'pan-x pan-y'` returns the gesture to the
   * browser for native scroll.
   */
  setCanvasTouchAction(value: 'none' | 'pan-x pan-y'): void;
}

const MODE_HINT_KEYS: Partial<Record<ToolMode, string>> = {
  addText:       'toast.modeHint.addText',
  addSignature:  'toast.modeHint.addSignature',
  addImage:      'toast.modeHint.addImage',
  drawArrow:     'toast.modeHint.drawArrow',
  drawRect:      'toast.modeHint.drawRect',
  drawEllipse:   'toast.modeHint.drawEllipse',
  drawFreehand:  'toast.modeHint.drawFreehand',
  drawHighlight: 'toast.modeHint.drawHighlight',
  addComment:    'toast.modeHint.addComment',
  addCode:       'toast.modeHint.addCode',
  drawRedaction: 'toast.modeHint.drawRedaction',
  drawErase:     'toast.modeHint.drawErase',
  editText:      'toast.modeHint.editText',
  fillBucket:    'toast.modeHint.fillBucket',
  crop:          'toast.modeHint.crop',
  signRect:      'toast.modeHint.signRect',
};

const PLACEMENT_MODES: ToolMode[] = ['addText', 'addComment', 'addImage', 'addSignature', 'addCode'];

/**
 * F-A (mobile drag/draw): true when the active tool needs the canvas to OWN a
 * single-finger drag gesture — every draw tool (shapes/highlight/redaction/ink/
 * eraser, all `draw*`), the drag-to-place tools (PLACEMENT_MODES), and crop. For
 * these the canvas sets `touch-action:none` so the browser does not steal the drag
 * for native scroll (the root cause of "PDF scroll takes over / can only place").
 * Tap-only tools (select/editText/fillBucket) keep native scroll. This set mirrors
 * the engagement guard in DrawingHandler.handlePointerDown.
 */
export function canvasCapturesGesture(mode: ToolMode): boolean {
  return mode.startsWith('draw') || PLACEMENT_MODES.includes(mode) || mode === 'crop' || mode === 'signRect';
}

export interface SetModeOptions {
  /**
   * When true, entering `addSignature` mode does NOT (re)open the signature modal.
   * The signature modal's own Save uses this to ARM placement mode after the pad has
   * already been captured — re-opening the modal would clear the just-drawn pad, which
   * was the "drawn signature resets on Save" bug (QA 2026-06-17).
   */
  suppressSignatureModal?: boolean;
}

export class ToolModeService {
  constructor(private readonly _ctx: IToolModeContext) {}

  setMode(mode: ToolMode, opts?: SetModeOptions): void {
    const ctx = this._ctx;
    ctx.cancelHandlers();
    ctx.mode = mode;
    ctx.setElementPointerEvents(mode === 'select' ? 'auto' : 'none');
    ctx.updateModeButtons(mode);
    ctx.updateFormattingToolbar();
    ctx.setOverlayPointerEvents(mode === 'select');
    ctx.setCanvasTouchAction(canvasCapturesGesture(mode) ? 'none' : 'pan-x pan-y');
    if (mode === 'addSignature' && !opts?.suppressSignatureModal) ctx.openSignatureModal();
    if (!PLACEMENT_MODES.includes(mode)) ctx.hidePlacementGhost();
    const hintKey = MODE_HINT_KEYS[mode];
    if (hintKey) ctx.reportError.info(hintKey);
    else ctx.clearToast();
  }

  isShapeMode(): boolean { return this._ctx.mode.startsWith('draw'); }
}
