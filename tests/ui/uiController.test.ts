import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIController } from '../../src/ui/uiController';
import { TextElement } from '../../src/elements/textElement';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function el(tag: string, id: string): HTMLElement {
  const node = document.createElement(tag);
  node.id = id;
  document.body.appendChild(node);
  return node;
}

/** Seed all DOM ids UIController's constructor calls getElementById() for. */
function seedDOM(): void {
  document.body.innerHTML = '';
  // These match the exact ids in UIController constructor (not the property names)
  const ids = [
    'fileInput', 'addTextBtn', 'addSignatureBtn', 'downloadBtn', 'prevPage', 'nextPage',
    'pageInfo', 'pdfCanvas', 'canvasContainer', 'signatureModal', 'signatureCanvas',
    'fontSize', 'color', 'colorEyedropperBtn', 'sigLineWidth', 'sigColor',
    'zoomOutBtn', 'zoomInBtn', 'zoomDisplay', 'fitBtn', 'undoBtn', 'redoBtn',
    'fontFamily', 'boldBtn', 'italicBtn', 'underlineBtn', 'strikeBtn', 'alignBtn', 'modeBadge',
    'fileMenuBtn', 'fileMenuWrap', 'fileMenuOpen', 'fileMenuClose',
    'fileMenuClearAnnotations', 'fileMenuResetSession',
    'firstPage', 'lastPage', 'pageInput', 'pageTotal', 'toast',
    'drawBtn', 'drawFlyoutWrap', 'annotateBtn', 'annotateFlyoutWrap',
    'arrowBtn', 'rectBtn', 'circleBtn', 'freehandBtn', 'fillBucketBtn',
    'redactColor', 'shapeWidth', 'fontSizeDownBtn', 'fontSizeUpBtn',
    'helpBtn', 'helpModal', 'addImageBtn', 'addImageInput', 'highlightBtn',
    'findBtn', 'findBar', 'findInput', 'findPrev', 'findNext', 'findHighlight',
    'findClose', 'findCount', 'findCaseSensitive', 'findRegex',
    'watermarkBtn', 'watermarkModal', 'wmEnabled', 'wmText', 'wmColor',
    'wmFontSize', 'wmFontSizeDisplay', 'wmOpacity', 'wmOpacityDisplay',
    'wmAngle', 'wmAngleDisplay', 'wmDensity', 'wmDensityDisplay',
    'wmPreviewCanvas', 'wmApply', 'wmCancel',
    'pageThumbnailContainer', 'addPdfInput', 'commentBtn', 'redactBtn', 'cropBtn',
    'copyBtn', 'pasteBtn', 'donePill', 'eraserBtn',
    'previewExportBtn', 'exportDocxBtn', 'exportMdBtn',
    'sanitizeBtn', 'extractPagesBtn', 'exportTableBtn', 'flattenBtn',
    'exportXfdfBtn', 'importXfdfBtn', 'xfdfInput',
    'exportPreviewOverlay', 'exportPreviewGhost', 'exportPreviewConfirm', 'exportPreviewClose',
    'selectBtn', 'restoreDialog', 'restoreYesBtn', 'restoreNoBtn',
    'editTextBtn', 'textModeBtn', 'textChevronBtn', 'textSplitWrap',
    'exportChevronBtn', 'exportSplitWrap', 'addCodeBtn', 'codeModal',
    'codeFormatSelect', 'codeDataInput', 'qrStyleSection', 'qrEclevelSelect',
    'qrStyledChk', 'qrStyleControls', 'qrDotStyle', 'qrDotColor',
    'qrBgColor', 'qrLogoInput', 'qrLogoName', 'qrLogoClearBtn',
    'barcodeShowTextRow', 'barcodeShowTextChk', 'codePreviewImg', 'codePreviewStatus',
    'cancelCodeModal', 'saveCodeModal', 'fillColor', 'fillColorLabel', 'fillNoneBtn',
    'settingsBtn', 'settingsPanel', 'resetToolbarBtn', 'closeSettingsBtn',
    // Bates panel
    'batesBtn', 'batesModal', 'batesEnabled', 'batesMode', 'batesNumberingGroup',
    'batesPrefix', 'batesStart', 'batesDigits', 'batesPosition', 'batesFontSize',
    'batesColor', 'batesApply', 'batesCancel',
    // Compress panel
    'compressBtn', 'compressModal', 'compressMode', 'compressModeHint', 'compressLossyGroup',
    'compressDpi', 'compressQuality', 'compressQualityVal', 'compressApply', 'compressCancel',
    // OCR
    'ocrBtn', 'ocrModal', 'ocrLangSelect', 'ocrModeSelect', 'ocrProgressRow',
    'ocrProgress', 'ocrProgressLabel', 'runOcrModal', 'cancelOcrModal',
    // Signing
    'signBtn', 'signModal', 'signCertInput', 'signPassword', 'signPage',
    'signX', 'signY', 'signW', 'signH', 'signReason', 'signLocation', 'signName',
    'signError', 'signProgressRow', 'runSignModal', 'cancelSignModal',
    'signSigRow', 'signSigImg', 'signSigRemove', 'signPickRect',
    // M2 #20 — generate-cert sign refs (formerly raw getElementById in signPdf)
    'signSourceUpload', 'signSourceGenerate', 'signUploadGroup', 'signGenGroup',
    'signGenPassword', 'signGenCN', 'signGenOrg', 'signGenEmail', 'signGenCountry',
    'signGenValidity',
    // Signers panel (F-D D2)
    'signersBtn', 'signersModal', 'signerName', 'signerMention', 'signerDate',
    'signersDrawBtn', 'signersCancel',
    // Task 8 — text options popover + inline align buttons
    'textOptionsBtn', 'textOptionsModal', 'textOptionsCloseBtn',
    'textLineHeight', 'textOpacity', 'textBgColor', 'textBgNoneBtn',
    'textCaseUpperBtn', 'textCaseLowerBtn', 'textCaseTitleBtn',
    'clearFmtBtn', 'formatPainterBtn',
    'alignLeftBtn', 'alignCenterBtn', 'alignRightBtn', 'alignJustifyBtn',
    // Slice 2 — popover controls
    'textStrokeWidth', 'charSpacingInput', 'horizontalScaleInput',
    'superscriptBtn', 'subscriptBtn',
    'colorSwatchRow',
  ];
  ids.forEach(id => el('div', id));
}

describe('UIController', () => {
  let ctrl: UIController;

  beforeEach(() => {
    seedDOM();
    ctrl = new UIController();
  });

  it('showToast() sets textContent and adds .show class', () => {
    const toast = document.getElementById('toast') as HTMLElement;
    ctrl.showToast('Hello world');
    expect(toast.textContent).toBe('Hello world');
    expect(toast.classList.contains('show')).toBe(true);
  });

  it('clearToast() removes .show class and clears textContent', () => {
    const toast = document.getElementById('toast') as HTMLElement;
    ctrl.showToast('Hello world');
    ctrl.clearToast();
    expect(toast.textContent).toBe('');
    expect(toast.classList.contains('show')).toBe(false);
  });

  it('toggleSettings() adds .active to settingsPanel and sets aria-expanded on settingsBtn', () => {
    ctrl.toggleSettings(true);
    expect(document.getElementById('settingsPanel')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('settingsBtn')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('toggleSettings() removes .active when called with false', () => {
    ctrl.toggleSettings(true);
    ctrl.toggleSettings(false);
    expect(document.getElementById('settingsPanel')?.classList.contains('active')).toBe(false);
    expect(document.getElementById('settingsBtn')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggleSettings() with no args toggles the current state', () => {
    ctrl.toggleSettings();
    expect(document.getElementById('settingsPanel')?.classList.contains('active')).toBe(true);
    ctrl.toggleSettings();
    expect(document.getElementById('settingsPanel')?.classList.contains('active')).toBe(false);
  });

  it('registers the generate-cert sign refs (M2 #20)', () => {
    const ids = [
      'signSourceUpload', 'signSourceGenerate', 'signUploadGroup', 'signGenGroup',
      'signGenPassword', 'signGenCN', 'signGenOrg', 'signGenEmail', 'signGenCountry',
      'signGenValidity',
    ] as const;
    for (const id of ids) {
      expect(ctrl.refs[id].id).toBe(id);
    }
  });

  it('updateModeButtons() sets aria-pressed=true only on the matching button', () => {
    ctrl.updateModeButtons('select');
    const selectBtn = document.getElementById('selectBtn') as HTMLElement;
    const addTextBtn = document.getElementById('addTextBtn') as HTMLElement;
    expect(selectBtn.getAttribute('aria-pressed')).toBe('true');
    expect(addTextBtn.getAttribute('aria-pressed')).toBe('false');
  });

  // FIX 1 — inline align buttons active-state
  describe('updateFormattingToolbar() align active-state (FIX 1)', () => {
    it('sets btn-active-fmt on alignCenterBtn only when selected TextElement has align=center', () => {
      const te = new TextElement(0, 0, 'p1', { align: 'center' });
      ctrl.updateFormattingToolbar(te, 'select');
      const alignLeft   = document.getElementById('alignLeftBtn')   as HTMLElement;
      const alignCenter = document.getElementById('alignCenterBtn') as HTMLElement;
      const alignRight  = document.getElementById('alignRightBtn')  as HTMLElement;
      expect(alignCenter.classList.contains('btn-active-fmt')).toBe(true);
      expect(alignLeft.classList.contains('btn-active-fmt')).toBe(false);
      expect(alignRight.classList.contains('btn-active-fmt')).toBe(false);
    });

    it('sets btn-active-fmt on alignLeftBtn only when selected TextElement has align=left', () => {
      const te = new TextElement(0, 0, 'p1', { align: 'left' });
      ctrl.updateFormattingToolbar(te, 'select');
      const alignLeft   = document.getElementById('alignLeftBtn')   as HTMLElement;
      const alignCenter = document.getElementById('alignCenterBtn') as HTMLElement;
      const alignRight  = document.getElementById('alignRightBtn')  as HTMLElement;
      expect(alignLeft.classList.contains('btn-active-fmt')).toBe(true);
      expect(alignCenter.classList.contains('btn-active-fmt')).toBe(false);
      expect(alignRight.classList.contains('btn-active-fmt')).toBe(false);
    });

    it('clears btn-active-fmt from all three align buttons when no text element is selected', () => {
      // Pre-arm: simulate a text element having been selected
      const te = new TextElement(0, 0, 'p1', { align: 'right' });
      ctrl.updateFormattingToolbar(te, 'select');
      // Now deselect (null → non-text context)
      ctrl.updateFormattingToolbar(null, 'select');
      const alignLeft   = document.getElementById('alignLeftBtn')   as HTMLElement;
      const alignCenter = document.getElementById('alignCenterBtn') as HTMLElement;
      const alignRight  = document.getElementById('alignRightBtn')  as HTMLElement;
      expect(alignLeft.classList.contains('btn-active-fmt')).toBe(false);
      expect(alignCenter.classList.contains('btn-active-fmt')).toBe(false);
      expect(alignRight.classList.contains('btn-active-fmt')).toBe(false);
    });
  });

  // Slice 2 — justify button active-state
  describe('updateFormattingToolbar() justify active-state (Slice 2)', () => {
    it('marks the justify button active when align is justify', () => {
      const te = new TextElement(0, 0, 'p1', { align: 'justify' });
      ctrl.updateFormattingToolbar(te, 'select');
      const alignJustify = document.getElementById('alignJustifyBtn') as HTMLElement;
      const alignLeft    = document.getElementById('alignLeftBtn')    as HTMLElement;
      expect(alignJustify.classList.contains('btn-active-fmt')).toBe(true);
      expect(alignLeft.classList.contains('btn-active-fmt')).toBe(false);
    });

    it('clears btn-active-fmt from alignJustifyBtn when no text element is selected', () => {
      const te = new TextElement(0, 0, 'p1', { align: 'justify' });
      ctrl.updateFormattingToolbar(te, 'select');
      ctrl.updateFormattingToolbar(null, 'select');
      const alignJustify = document.getElementById('alignJustifyBtn') as HTMLElement;
      expect(alignJustify.classList.contains('btn-active-fmt')).toBe(false);
    });
  });
});
