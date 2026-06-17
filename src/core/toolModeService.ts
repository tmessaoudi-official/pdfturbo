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
};

const PLACEMENT_MODES: ToolMode[] = ['addText', 'addComment', 'addImage', 'addSignature', 'addCode'];

export class ToolModeService {
  constructor(private readonly _ctx: IToolModeContext) {}

  setMode(mode: ToolMode): void {
    const ctx = this._ctx;
    ctx.cancelHandlers();
    ctx.mode = mode;
    ctx.setElementPointerEvents(mode === 'select' ? 'auto' : 'none');
    ctx.updateModeButtons(mode);
    ctx.updateFormattingToolbar();
    ctx.setOverlayPointerEvents(mode === 'select');
    if (mode === 'addSignature') ctx.openSignatureModal();
    if (!PLACEMENT_MODES.includes(mode)) ctx.hidePlacementGhost();
    const hintKey = MODE_HINT_KEYS[mode];
    if (hintKey) ctx.reportError.info(hintKey);
    else ctx.clearToast();
  }

  isShapeMode(): boolean { return this._ctx.mode.startsWith('draw'); }
}
