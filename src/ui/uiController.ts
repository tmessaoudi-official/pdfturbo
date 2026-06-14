import type { PDFElement } from '../elements/annotationElement';
import type { TextElement } from '../elements/textElement';
import type { ShapeElement } from '../elements/shapeElement';
import type { RedactionElement } from '../elements/redactionElement';
import type { ToolMode } from '../core/pdfTurboApp';
import { t } from '../utils/i18n';

export interface AppDOMRefs {
  fileInput: HTMLInputElement;
  addTextBtn: HTMLButtonElement;
  addSignatureBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  prevPageBtn: HTMLButtonElement;
  nextPageBtn: HTMLButtonElement;
  pageInfo: HTMLElement;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  signatureModal: HTMLElement;
  signatureCanvas: HTMLCanvasElement;
  fontSizeInput: HTMLInputElement;
  colorInput: HTMLInputElement;
  colorEyedropperBtn: HTMLButtonElement;
  sigLineWidthInput: HTMLInputElement;
  sigColorInput: HTMLInputElement;
  zoomOutBtn: HTMLButtonElement;
  zoomInBtn: HTMLButtonElement;
  zoomDisplay: HTMLElement;
  fitBtn: HTMLButtonElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  fontFamily: HTMLSelectElement;
  boldBtn: HTMLButtonElement;
  italicBtn: HTMLButtonElement;
  modeBadge: HTMLElement;
  fileMenuBtn: HTMLButtonElement;
  fileMenuWrap: HTMLElement;
  fileMenuOpen: HTMLButtonElement;
  fileMenuClose: HTMLButtonElement;
  fileMenuClearAnnotations: HTMLButtonElement;
  fileMenuResetSession: HTMLButtonElement;
  firstPage: HTMLButtonElement;
  lastPage: HTMLButtonElement;
  pageInput: HTMLInputElement;
  pageTotal: HTMLElement;
  toast: HTMLElement;
  drawBtn:        HTMLButtonElement;
  drawFlyoutWrap: HTMLElement;
  annotateBtn:        HTMLButtonElement;
  annotateFlyoutWrap: HTMLElement;
  arrowBtn: HTMLButtonElement;
  rectBtn: HTMLButtonElement;
  circleBtn: HTMLButtonElement;
  freehandBtn: HTMLButtonElement;
  fillBucketBtn: HTMLButtonElement;
  redactColorInput: HTMLInputElement;
  shapeWidth: HTMLInputElement;
  fontSizeDownBtn: HTMLButtonElement;
  fontSizeUpBtn: HTMLButtonElement;
  helpBtn: HTMLButtonElement;
  helpModal: HTMLElement;
  addImageBtn: HTMLButtonElement;
  addImageInput: HTMLInputElement;
  highlightBtn: HTMLButtonElement;
  findBtn: HTMLButtonElement;
  findBar: HTMLElement;
  findInput: HTMLInputElement;
  findPrev: HTMLButtonElement;
  findNext: HTMLButtonElement;
  findHighlight: HTMLButtonElement;
  findClose: HTMLButtonElement;
  findCount: HTMLElement;
  findCaseSensitive: HTMLButtonElement;
  findRegex: HTMLButtonElement;
  watermarkBtn: HTMLButtonElement;
  watermarkModal: HTMLElement;
  wmEnabled: HTMLInputElement;
  wmText: HTMLInputElement;
  wmColor: HTMLInputElement;
  wmFontSize: HTMLInputElement;
  wmFontSizeDisplay: HTMLElement;
  wmOpacity: HTMLInputElement;
  wmOpacityDisplay: HTMLElement;
  wmAngle: HTMLInputElement;
  wmAngleDisplay: HTMLElement;
  wmDensity: HTMLInputElement;
  wmDensityDisplay: HTMLElement;
  wmPreviewCanvas: HTMLCanvasElement;
  wmApply: HTMLButtonElement;
  wmCancel: HTMLButtonElement;
  pageThumbnailContainer: HTMLElement;
  addPdfInput: HTMLInputElement;
  commentBtn: HTMLButtonElement;
  redactBtn: HTMLButtonElement;
  copyBtn: HTMLButtonElement;
  pasteBtn: HTMLButtonElement;
  donePill: HTMLButtonElement;
  eraserBtn: HTMLButtonElement;
  previewExportBtn:     HTMLButtonElement;
  exportDocxBtn:        HTMLButtonElement;
  exportMdBtn:          HTMLButtonElement;
  exportPreviewOverlay: HTMLElement;
  exportPreviewGhost:   HTMLElement;
  exportPreviewConfirm: HTMLButtonElement;
  exportPreviewClose:   HTMLButtonElement;
  selectBtn:       HTMLButtonElement;
  restoreDialog:   HTMLElement;
  restoreYesBtn:   HTMLButtonElement;
  restoreNoBtn:    HTMLButtonElement;
  editTextBtn:     HTMLButtonElement;
  textModeBtn:     HTMLButtonElement;
  textChevronBtn:  HTMLButtonElement;
  textSplitWrap:   HTMLElement;
  exportChevronBtn: HTMLButtonElement;
  exportSplitWrap:  HTMLElement;
  addCodeBtn:       HTMLButtonElement;
  ocrBtn:           HTMLButtonElement;
  ocrModal:         HTMLElement;
  ocrLangSelect:    HTMLSelectElement;
  ocrProgressRow:   HTMLElement;
  ocrProgress:      HTMLProgressElement;
  ocrProgressLabel: HTMLElement;
  runOcrModal:      HTMLButtonElement;
  cancelOcrModal:   HTMLButtonElement;
  signBtn:          HTMLButtonElement;
  signModal:        HTMLElement;
  signCertInput:    HTMLInputElement;
  signPassword:     HTMLInputElement;
  signPage:         HTMLInputElement;
  signX:            HTMLInputElement;
  signY:            HTMLInputElement;
  signW:            HTMLInputElement;
  signH:            HTMLInputElement;
  signReason:       HTMLInputElement;
  signLocation:     HTMLInputElement;
  signName:         HTMLInputElement;
  signError:        HTMLElement;
  signProgressRow:  HTMLElement;
  runSignModal:     HTMLButtonElement;
  cancelSignModal:  HTMLButtonElement;
  codeModal:        HTMLElement;
  codeFormatSelect: HTMLSelectElement;
  codeDataInput:    HTMLTextAreaElement;
  qrStyleSection:    HTMLElement;
  qrEclevelSelect:   HTMLSelectElement;
  qrStyledChk:       HTMLInputElement;
  qrStyleControls:   HTMLElement;
  qrDotStyle:        HTMLSelectElement;
  qrDotColor:        HTMLInputElement;
  qrBgColor:         HTMLInputElement;
  qrLogoInput:       HTMLInputElement;
  qrLogoName:        HTMLElement;
  qrLogoClearBtn:    HTMLButtonElement;
  barcodeShowTextRow: HTMLElement;
  barcodeShowTextChk: HTMLInputElement;
  codePreviewImg:   HTMLImageElement;
  codePreviewStatus: HTMLElement;
  cancelCodeModal:  HTMLButtonElement;
  saveCodeModal:    HTMLButtonElement;
  fillColorInput:   HTMLInputElement;
  fillColorLabel:   HTMLElement;
  fillNoneBtn:      HTMLButtonElement;
  settingsBtn:      HTMLButtonElement;
  settingsPanel:    HTMLElement;
  resetToolbarBtn:  HTMLButtonElement;
  closeSettingsBtn: HTMLButtonElement;
}

export class UIController {
  refs: AppDOMRefs;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.refs = {
      fileInput:        document.getElementById('fileInput')        as HTMLInputElement,
      addTextBtn:       document.getElementById('addTextBtn')       as HTMLButtonElement,
      addSignatureBtn:  document.getElementById('addSignatureBtn')  as HTMLButtonElement,
      downloadBtn:      document.getElementById('downloadBtn')      as HTMLButtonElement,
      prevPageBtn:      document.getElementById('prevPage')         as HTMLButtonElement,
      nextPageBtn:      document.getElementById('nextPage')         as HTMLButtonElement,
      pageInfo:         document.getElementById('pageInfo')         as HTMLElement,
      canvas:           document.getElementById('pdfCanvas')        as HTMLCanvasElement,
      container:        document.getElementById('canvasContainer')  as HTMLElement,
      signatureModal:   document.getElementById('signatureModal')   as HTMLElement,
      signatureCanvas:  document.getElementById('signatureCanvas')  as HTMLCanvasElement,
      fontSizeInput:    document.getElementById('fontSize')         as HTMLInputElement,
      colorInput:           document.getElementById('color')                as HTMLInputElement,
      colorEyedropperBtn:   document.getElementById('colorEyedropperBtn')   as HTMLButtonElement,
      sigLineWidthInput:document.getElementById('sigLineWidth')     as HTMLInputElement,
      sigColorInput:    document.getElementById('sigColor')         as HTMLInputElement,
      zoomOutBtn:       document.getElementById('zoomOutBtn')       as HTMLButtonElement,
      zoomInBtn:        document.getElementById('zoomInBtn')        as HTMLButtonElement,
      zoomDisplay:      document.getElementById('zoomDisplay')      as HTMLElement,
      fitBtn:           document.getElementById('fitBtn')           as HTMLButtonElement,
      undoBtn:          document.getElementById('undoBtn')          as HTMLButtonElement,
      redoBtn:          document.getElementById('redoBtn')          as HTMLButtonElement,
      fontFamily:       document.getElementById('fontFamily')       as HTMLSelectElement,
      boldBtn:          document.getElementById('boldBtn')          as HTMLButtonElement,
      italicBtn:        document.getElementById('italicBtn')        as HTMLButtonElement,
      modeBadge:        document.getElementById('modeBadge')        as HTMLElement,
      fileMenuBtn:              document.getElementById('fileMenuBtn')              as HTMLButtonElement,
      fileMenuWrap:             document.getElementById('fileMenuWrap')             as HTMLElement,
      fileMenuOpen:             document.getElementById('fileMenuOpen')             as HTMLButtonElement,
      fileMenuClose:            document.getElementById('fileMenuClose')            as HTMLButtonElement,
      fileMenuClearAnnotations: document.getElementById('fileMenuClearAnnotations') as HTMLButtonElement,
      fileMenuResetSession:     document.getElementById('fileMenuResetSession')     as HTMLButtonElement,
      firstPage:        document.getElementById('firstPage')        as HTMLButtonElement,
      lastPage:         document.getElementById('lastPage')         as HTMLButtonElement,
      pageInput:        document.getElementById('pageInput')        as HTMLInputElement,
      pageTotal:        document.getElementById('pageTotal')        as HTMLElement,
      toast:            document.getElementById('toast')            as HTMLElement,
      drawBtn:          document.getElementById('drawBtn')          as HTMLButtonElement,
      drawFlyoutWrap:   document.getElementById('drawFlyoutWrap')   as HTMLElement,
      annotateBtn:        document.getElementById('annotateBtn')        as HTMLButtonElement,
      annotateFlyoutWrap: document.getElementById('annotateFlyoutWrap') as HTMLElement,
      arrowBtn:         document.getElementById('arrowBtn')         as HTMLButtonElement,
      rectBtn:          document.getElementById('rectBtn')          as HTMLButtonElement,
      circleBtn:        document.getElementById('circleBtn')        as HTMLButtonElement,
      freehandBtn:      document.getElementById('freehandBtn')      as HTMLButtonElement,
fillBucketBtn:    document.getElementById('fillBucketBtn')    as HTMLButtonElement,
      redactColorInput: document.getElementById('redactColor')      as HTMLInputElement,
      shapeWidth:       document.getElementById('shapeWidth')       as HTMLInputElement,
      fontSizeDownBtn:  document.getElementById('fontSizeDownBtn')  as HTMLButtonElement,
      fontSizeUpBtn:    document.getElementById('fontSizeUpBtn')    as HTMLButtonElement,
      helpBtn:          document.getElementById('helpBtn')          as HTMLButtonElement,
      helpModal:        document.getElementById('helpModal')        as HTMLElement,
      addImageBtn:      document.getElementById('addImageBtn')      as HTMLButtonElement,
      addImageInput:    document.getElementById('addImageInput')    as HTMLInputElement,
      highlightBtn:     document.getElementById('highlightBtn')     as HTMLButtonElement,
      findBtn:          document.getElementById('findBtn')          as HTMLButtonElement,
      findBar:          document.getElementById('findBar')          as HTMLElement,
      findInput:        document.getElementById('findInput')        as HTMLInputElement,
      findPrev:         document.getElementById('findPrev')         as HTMLButtonElement,
      findNext:         document.getElementById('findNext')         as HTMLButtonElement,
      findHighlight:    document.getElementById('findHighlight')    as HTMLButtonElement,
      findClose:          document.getElementById('findClose')          as HTMLButtonElement,
      findCount:          document.getElementById('findCount')          as HTMLElement,
      findCaseSensitive:  document.getElementById('findCaseSensitive')  as HTMLButtonElement,
      findRegex:          document.getElementById('findRegex')          as HTMLButtonElement,
      watermarkBtn:     document.getElementById('watermarkBtn')     as HTMLButtonElement,
      watermarkModal:   document.getElementById('watermarkModal')   as HTMLElement,
      wmEnabled:        document.getElementById('wmEnabled')        as HTMLInputElement,
      wmText:           document.getElementById('wmText')           as HTMLInputElement,
      wmColor:          document.getElementById('wmColor')          as HTMLInputElement,
      wmFontSize:       document.getElementById('wmFontSize')       as HTMLInputElement,
      wmFontSizeDisplay:document.getElementById('wmFontSizeDisplay')as HTMLElement,
      wmOpacity:        document.getElementById('wmOpacity')        as HTMLInputElement,
      wmOpacityDisplay: document.getElementById('wmOpacityDisplay') as HTMLElement,
      wmAngle:          document.getElementById('wmAngle')          as HTMLInputElement,
      wmAngleDisplay:   document.getElementById('wmAngleDisplay')   as HTMLElement,
      wmDensity:        document.getElementById('wmDensity')        as HTMLInputElement,
      wmDensityDisplay: document.getElementById('wmDensityDisplay') as HTMLElement,
      wmPreviewCanvas:  document.getElementById('wmPreviewCanvas')  as HTMLCanvasElement,
      wmApply:          document.getElementById('wmApply')          as HTMLButtonElement,
      wmCancel:         document.getElementById('wmCancel')         as HTMLButtonElement,
      pageThumbnailContainer: document.getElementById('pageThumbnailContainer') as HTMLElement,
      addPdfInput:      document.getElementById('addPdfInput')      as HTMLInputElement,
      commentBtn:       document.getElementById('commentBtn')       as HTMLButtonElement,
      redactBtn:        document.getElementById('redactBtn')        as HTMLButtonElement,
      copyBtn:          document.getElementById('copyBtn')          as HTMLButtonElement,
      pasteBtn:         document.getElementById('pasteBtn')         as HTMLButtonElement,
      donePill:         document.getElementById('donePill')         as HTMLButtonElement,
      eraserBtn:        document.getElementById('eraserBtn')        as HTMLButtonElement,
      previewExportBtn:     document.getElementById('previewExportBtn')     as HTMLButtonElement,
      exportDocxBtn:        document.getElementById('exportDocxBtn')        as HTMLButtonElement,
      exportMdBtn:          document.getElementById('exportMdBtn')          as HTMLButtonElement,
      exportPreviewOverlay: document.getElementById('exportPreviewOverlay') as HTMLElement,
      exportPreviewGhost:   document.getElementById('exportPreviewGhost')   as HTMLElement,
      exportPreviewConfirm: document.getElementById('exportPreviewConfirm') as HTMLButtonElement,
      exportPreviewClose:   document.getElementById('exportPreviewClose')   as HTMLButtonElement,
      selectBtn:       document.getElementById('selectBtn')       as HTMLButtonElement,
      restoreDialog:   document.getElementById('restoreDialog')   as HTMLElement,
      restoreYesBtn:   document.getElementById('restoreYesBtn')   as HTMLButtonElement,
      restoreNoBtn:    document.getElementById('restoreNoBtn')    as HTMLButtonElement,
      editTextBtn:     document.getElementById('editTextBtn')     as HTMLButtonElement,
      textModeBtn:     document.getElementById('textModeBtn')     as HTMLButtonElement,
      textChevronBtn:  document.getElementById('textChevronBtn')  as HTMLButtonElement,
      textSplitWrap:   document.getElementById('textSplitWrap')   as HTMLElement,
      exportChevronBtn: document.getElementById('exportChevronBtn') as HTMLButtonElement,
      exportSplitWrap:  document.getElementById('exportSplitWrap')  as HTMLElement,
      addCodeBtn:       document.getElementById('addCodeBtn')       as HTMLButtonElement,
      ocrBtn:           document.getElementById('ocrBtn')           as HTMLButtonElement,
      ocrModal:         document.getElementById('ocrModal')         as HTMLElement,
      ocrLangSelect:    document.getElementById('ocrLangSelect')    as HTMLSelectElement,
      ocrProgressRow:   document.getElementById('ocrProgressRow')   as HTMLElement,
      ocrProgress:      document.getElementById('ocrProgress')      as HTMLProgressElement,
      ocrProgressLabel: document.getElementById('ocrProgressLabel') as HTMLElement,
      runOcrModal:      document.getElementById('runOcrModal')      as HTMLButtonElement,
      cancelOcrModal:   document.getElementById('cancelOcrModal')   as HTMLButtonElement,
      signBtn:          document.getElementById('signBtn')          as HTMLButtonElement,
      signModal:        document.getElementById('signModal')        as HTMLElement,
      signCertInput:    document.getElementById('signCertInput')    as HTMLInputElement,
      signPassword:     document.getElementById('signPassword')     as HTMLInputElement,
      signPage:         document.getElementById('signPage')         as HTMLInputElement,
      signX:            document.getElementById('signX')            as HTMLInputElement,
      signY:            document.getElementById('signY')            as HTMLInputElement,
      signW:            document.getElementById('signW')            as HTMLInputElement,
      signH:            document.getElementById('signH')            as HTMLInputElement,
      signReason:       document.getElementById('signReason')       as HTMLInputElement,
      signLocation:     document.getElementById('signLocation')     as HTMLInputElement,
      signName:         document.getElementById('signName')         as HTMLInputElement,
      signError:        document.getElementById('signError')        as HTMLElement,
      signProgressRow:  document.getElementById('signProgressRow')  as HTMLElement,
      runSignModal:     document.getElementById('runSignModal')     as HTMLButtonElement,
      cancelSignModal:  document.getElementById('cancelSignModal')  as HTMLButtonElement,
      codeModal:        document.getElementById('codeModal')        as HTMLElement,
      codeFormatSelect: document.getElementById('codeFormatSelect') as HTMLSelectElement,
      codeDataInput:    document.getElementById('codeDataInput')    as HTMLTextAreaElement,
      qrStyleSection:    document.getElementById('qrStyleSection')    as HTMLElement,
      qrEclevelSelect:   document.getElementById('qrEclevelSelect')   as HTMLSelectElement,
      qrStyledChk:       document.getElementById('qrStyledChk')       as HTMLInputElement,
      qrStyleControls:   document.getElementById('qrStyleControls')   as HTMLElement,
      qrDotStyle:        document.getElementById('qrDotStyle')        as HTMLSelectElement,
      qrDotColor:        document.getElementById('qrDotColor')        as HTMLInputElement,
      qrBgColor:         document.getElementById('qrBgColor')         as HTMLInputElement,
      qrLogoInput:       document.getElementById('qrLogoInput')       as HTMLInputElement,
      qrLogoName:        document.getElementById('qrLogoName')        as HTMLElement,
      qrLogoClearBtn:    document.getElementById('qrLogoClearBtn')    as HTMLButtonElement,
      barcodeShowTextRow: document.getElementById('barcodeShowTextRow') as HTMLElement,
      barcodeShowTextChk: document.getElementById('barcodeShowTextChk') as HTMLInputElement,
      codePreviewImg:   document.getElementById('codePreviewImg')   as HTMLImageElement,
      codePreviewStatus: document.getElementById('codePreviewStatus') as HTMLElement,
      cancelCodeModal:  document.getElementById('cancelCodeModal')  as HTMLButtonElement,
      saveCodeModal:    document.getElementById('saveCodeModal')    as HTMLButtonElement,
      fillColorInput:   document.getElementById('fillColor')        as HTMLInputElement,
      fillColorLabel:   document.getElementById('fillColorLabel')   as HTMLElement,
      fillNoneBtn:      document.getElementById('fillNoneBtn')      as HTMLButtonElement,
      settingsBtn:      document.getElementById('settingsBtn')      as HTMLButtonElement,
      settingsPanel:    document.getElementById('settingsPanel')    as HTMLElement,
      resetToolbarBtn:  document.getElementById('resetToolbarBtn')  as HTMLButtonElement,
      closeSettingsBtn: document.getElementById('closeSettingsBtn') as HTMLButtonElement,
    };
  }

  enableUI(): void {
    const r = this.refs;
    r.textModeBtn.disabled    = false;
    r.textChevronBtn.disabled = false;
    r.addTextBtn.disabled     = false;
    r.exportChevronBtn.disabled = false;
    r.addSignatureBtn.disabled = false;
    r.downloadBtn.disabled    = false;
    r.prevPageBtn.disabled    = false;
    r.nextPageBtn.disabled    = false;
    r.zoomInBtn.disabled      = false;
    r.zoomOutBtn.disabled     = false;
    r.fitBtn.disabled         = false;
    r.firstPage.disabled      = false;
    r.lastPage.disabled       = false;
    r.pageInput.disabled      = false;
    r.drawBtn.disabled        = false;
    r.annotateBtn.disabled    = false;
    r.arrowBtn.disabled       = false;
    r.rectBtn.disabled        = false;
    r.circleBtn.disabled      = false;
    r.freehandBtn.disabled    = false;
    r.fillBucketBtn.disabled  = false;
    r.fillNoneBtn.disabled    = false;
    r.addImageBtn.disabled    = false;
    r.highlightBtn.disabled   = false;
    r.findBtn.disabled        = false;
    r.watermarkBtn.disabled   = false;
    r.commentBtn.disabled     = false;
    r.redactBtn.disabled      = false;
    r.eraserBtn.disabled      = false;
    r.previewExportBtn.disabled = false;
    r.exportDocxBtn.disabled  = false;
    r.exportMdBtn.disabled    = false;
    r.editTextBtn.disabled    = false;
    r.ocrBtn.disabled         = false;
    r.signBtn.disabled        = false;
    const eyedropper = document.getElementById('redactEyedropperBtn') as HTMLButtonElement | null;
    if (eyedropper) eyedropper.disabled = false;
    r.colorEyedropperBtn.disabled = false;
    r.addCodeBtn.disabled = false;
  }

  updateModeButtons(mode: ToolMode): void {
    const r = this.refs;
    r.canvas.style.touchAction = mode.startsWith('draw') ? 'none' : 'pan-x pan-y';
    r.selectBtn.classList.toggle('active',       mode === 'select');
    r.addTextBtn.classList.toggle('active',      mode === 'addText');
    r.addSignatureBtn.classList.toggle('active', mode === 'addSignature');
    r.addImageBtn.classList.toggle('active',     mode === 'addImage');
    r.addCodeBtn.classList.toggle('active',      mode === 'addCode');
    r.highlightBtn.classList.toggle('active',    mode === 'drawHighlight');
    r.arrowBtn.classList.toggle('active',        mode === 'drawArrow');
    r.rectBtn.classList.toggle('active',         mode === 'drawRect');
    r.circleBtn.classList.toggle('active',       mode === 'drawEllipse');
    r.freehandBtn.classList.toggle('active',     mode === 'drawFreehand');
    r.commentBtn.classList.toggle('active',      mode === 'addComment');
    r.redactBtn.classList.toggle('active',       mode === 'drawRedaction');
    r.eraserBtn.classList.toggle('active',       mode === 'drawErase');
    r.editTextBtn.classList.toggle('active',     mode === 'editText');
    r.fillBucketBtn.classList.toggle('active',   mode === 'fillBucket');
    // drawBtn now covers only shape tools (freehand/erase are top-level standalone buttons)
    const drawIcons: Partial<Record<string, string>> = {
      drawArrow: '→', drawRect: '□', drawEllipse: '○',
    };
    const drawIcon = drawIcons[mode];
    r.drawBtn.textContent = (drawIcon ?? '◻') + ' ▾';
    r.drawBtn.classList.toggle('active', !!drawIcon);

    const textFaces: Partial<Record<string, string>> = {
      addText: t('toolbar.addText'), editText: '✎ ' + t('toolbar.editTextLabel'),
    };
    const textFace = textFaces[mode];
    if (textFace) {
      r.textModeBtn.textContent = textFace;
      r.textModeBtn.dataset['mode'] = mode;
    }
    r.textModeBtn.classList.toggle('active', mode === 'addText' || mode === 'editText');

    const toggles: [HTMLButtonElement, ToolMode][] = [
      [r.selectBtn, 'select'],
      [r.addTextBtn, 'addText'], [r.addSignatureBtn, 'addSignature'], [r.addImageBtn, 'addImage'],
      [r.addCodeBtn, 'addCode'],
      [r.highlightBtn, 'drawHighlight'], [r.arrowBtn, 'drawArrow'], [r.rectBtn, 'drawRect'],
      [r.circleBtn, 'drawEllipse'], [r.freehandBtn, 'drawFreehand'], [r.commentBtn, 'addComment'],
      [r.redactBtn, 'drawRedaction'], [r.eraserBtn, 'drawErase'], [r.editTextBtn, 'editText'],
      [r.fillBucketBtn, 'fillBucket'],
    ];
    toggles.forEach(([btn, m]) => btn.setAttribute('aria-pressed', String(mode === m)));
    r.textModeBtn.setAttribute('aria-pressed', String(mode === 'addText' || mode === 'editText'));

    const badgeKeys: Record<string, string> = {
      select: 'badge.select', addText: 'badge.addText', addSignature: 'badge.addSignature',
      addImage: 'badge.addImage', addCode: 'badge.addCode', drawArrow: 'badge.drawArrow', drawRect: 'badge.drawRect',
      drawEllipse: 'badge.drawEllipse', drawFreehand: 'badge.drawFreehand',
      drawHighlight: 'badge.drawHighlight', addComment: 'badge.addComment',
      drawRedaction: 'badge.drawRedaction', drawErase: 'badge.drawErase',
      editText: 'badge.editText', fillBucket: 'badge.fillBucket',
    };
    r.modeBadge.textContent = t(badgeKeys[mode] ?? 'badge.select');
    r.modeBadge.classList.toggle('active', mode !== 'select');
    r.canvas.className = mode === 'select' ? 'cursor-default' : mode === 'fillBucket' ? 'cursor-bucket' : 'cursor-crosshair';
    r.donePill.style.display = (mode === 'drawFreehand' || mode === 'drawErase') ? '' : 'none';

    const isShapeMode = mode.startsWith('draw') && mode !== 'drawRedaction' && mode !== 'drawErase' && mode !== 'drawHighlight';
    r.shapeWidth.disabled = !isShapeMode;

    // Redact color is now unified into the main color picker — keep legacy input hidden
    r.redactColorInput.style.display = 'none';
    const redactEyedropper = document.getElementById('redactEyedropperBtn') as HTMLButtonElement | null;
    if (redactEyedropper) redactEyedropper.style.display = 'none';
  }

  updateFormattingToolbar(el: PDFElement | null, mode: ToolMode): void {
    const r = this.refs;
    const isText      = el?.type === 'text';
    const isShape     = el?.type === 'shape';
    const isRedaction = el?.type === 'redaction';

    r.fontFamily.disabled      = !isText;
    r.boldBtn.disabled         = !isText;
    r.italicBtn.disabled       = !isText;
    r.fontSizeInput.disabled   = !isText;
    r.fontSizeDownBtn.disabled = !isText;
    r.fontSizeUpBtn.disabled   = !isText;
    if (isText) {
      r.fontFamily.value = (el as TextElement).fontFamily || 'Arial';
      r.boldBtn.classList.toggle('btn-active-fmt',   !!(el as TextElement).bold);
      r.italicBtn.classList.toggle('btn-active-fmt', !!(el as TextElement).italic);
      r.boldBtn.setAttribute('aria-pressed',   String(!!(el as TextElement).bold));
      r.italicBtn.setAttribute('aria-pressed', String(!!(el as TextElement).italic));
      r.fontSizeInput.value = String((el as TextElement).fontSize);
      r.colorInput.value    = (el as TextElement).color;
    } else {
      r.boldBtn.classList.remove('btn-active-fmt');
      r.italicBtn.classList.remove('btn-active-fmt');
      r.boldBtn.setAttribute('aria-pressed', 'false');
      r.italicBtn.setAttribute('aria-pressed', 'false');
    }

    // Unified color picker: always enabled, syncs value to context
    r.colorInput.disabled = false;
    r.colorEyedropperBtn.disabled = false;

    const shapeActive = isShape || (mode.startsWith('draw') && mode !== 'drawRedaction' && mode !== 'drawHighlight' && mode !== 'drawErase');
    r.shapeWidth.disabled = !shapeActive;
    const isFillableShape = isShape && ((el as ShapeElement).shapeType === 'rect' || (el as ShapeElement).shapeType === 'ellipse' || (el as ShapeElement).shapeType === 'freehand');
    const isDrawingFillable = mode === 'drawRect' || mode === 'drawEllipse' || mode === 'drawFreehand' || mode === 'fillBucket';
    // Show fill color when a fillable shape is selected OR when actively drawing a fillable shape OR in fill-bucket mode
    r.fillColorLabel.style.display = (isFillableShape || isDrawingFillable) ? 'inline-flex' : 'none';
    if (isShape) {
      r.colorInput.value = (el as ShapeElement).strokeColor;
      r.shapeWidth.value = String((el as ShapeElement).strokeWidth);
      if (isFillableShape) {
        const shapeFill = (el as ShapeElement).fillColor;
        if (shapeFill !== undefined) {
          r.fillColorInput.value = shapeFill;
        }
        // _noFill sync is handled in pdfTurboApp._updateFormattingToolbar after this call
      }
    }

    // Sync unified color picker with redaction element color
    if (isRedaction) {
      r.colorInput.value = (el as RedactionElement).color;
      r.redactColorInput.value = (el as RedactionElement).color;
    }
  }

  updateUndoRedoBtns(canUndo: boolean, canRedo: boolean): void {
    this.refs.undoBtn.disabled = !canUndo;
    this.refs.redoBtn.disabled = !canRedo;
  }

  updateCopyPasteBtns(canCopy: boolean, canPaste: boolean): void {
    this.refs.copyBtn.disabled  = !canCopy;
    this.refs.pasteBtn.disabled = !canPaste;
  }

  updatePageInfo(current: number, total: number): void {
    this.refs.pageInput.value = String(current);
    this.refs.pageInput.max   = String(total);
    this.refs.pageTotal.textContent = `/ ${total}`;
    this.refs.firstPage.disabled   = current <= 1;
    this.refs.prevPageBtn.disabled = current <= 1;
    this.refs.nextPageBtn.disabled = current >= total;
    this.refs.lastPage.disabled    = current >= total;
  }

  showToast(msg: string, duration = 3000): void {
    clearTimeout(this._toastTimer ?? undefined);
    this.refs.toast.textContent = msg;
    this.refs.toast.classList.add('show');
    this._toastTimer = setTimeout(() => {
      this.refs.toast.classList.remove('show');
      this.refs.toast.textContent = '';
    }, duration);
  }

  clearToast(): void {
    clearTimeout(this._toastTimer ?? undefined);
    this.refs.toast.classList.remove('show');
    this.refs.toast.textContent = '';
  }

  toggleHelp(show?: boolean): void {
    const active = this.refs.helpModal.classList.contains('active');
    const next = show !== undefined ? show : !active;
    this.refs.helpModal.classList.toggle('active', next);
    this.refs.helpBtn.classList.toggle('active', next);
  }

  toggleSettings(show?: boolean): void {
    const active = this.refs.settingsPanel.classList.contains('active');
    const next = show !== undefined ? show : !active;
    this.refs.settingsPanel.classList.toggle('active', next);
    this.refs.settingsBtn.setAttribute('aria-expanded', String(next));
    this.refs.settingsBtn.classList.toggle('active', next);
  }
}
