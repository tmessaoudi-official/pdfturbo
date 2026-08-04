import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFRenderer } from '../infra/pdfRenderer';
import { TextElement, type TextAlign, type TextDirection } from '../elements/textElement';
import type { CommentElement } from '../elements/commentElement';
import { HighlightElement } from '../elements/highlightElement';
import { TextSearchHandler } from '../handlers/textSearchHandler';
import { SignaturePad } from '../utils/signaturePad';
import { InteractionHandler } from '../handlers/interactionHandler';
import { PDFElement, type ElementJSON } from '../elements/annotationElement';
import { UIController, type AppDOMRefs } from '../ui/uiController';
import { DrawingHandler } from '../handlers/drawingHandler';
import { EraserHandler } from '../handlers/eraserHandler';
import {
  HistoryManager, AddElementCmd, MacroCmd, TextEditCmd,
  ReplaceSourcePdfBytesCmd,
  type Command,
} from './historyManager';
import { parseXfdf } from '../utils/xfdf';
import { xfdfAnnotToElement, pageHeightPt } from '../export/xfdfMapping';
import { InkLayer } from '../infra/inkLayer';
import { InkLayerHandler } from '../handlers/inkLayerHandler';
import { DocumentModel, type SourcePdf, type PageCrop, type DocumentPage } from './documentModel';
import { PageThumbnailPanel } from '../ui/pageThumbnailPanel';
import { FormFieldOverlay } from '../utils/formFieldOverlay';
import { TextLayerManager } from '../utils/textLayer';
import { TextEditHandler } from '../handlers/textEditHandler';
import { OcrHandler, type OcrOutputMode } from '../handlers/ocrHandler';
import { SearchableLayerError } from '../ocr/searchableTextLayer';
import { SigningHandler } from '../handlers/signingHandler';
import { CodeElement } from '../elements/codeElement';
import type { QRStyleOptions, BwipOptions } from '../utils/codeGenerator';

import { bindEvents } from '../ui/eventBinder';
import { ExportService, type IExportContext, type ImageExportOptions } from '../export/exportService';
import { PageService, type IPageContext } from './pageService';
import { AnnotationService, type IAnnotationContext } from './annotationService';
import { ToolModeService, type IToolModeContext, type SetModeOptions } from './toolModeService';
import { SearchManager } from './searchManager';
import { SessionManager } from './sessionManager';
import { ToastQueue } from '../ui/toastQueue';
import { ErrorReporter, type IErrorReporter } from './errorReporter';
import { LogBuffer, type ILogBuffer } from './logBuffer';
import { ProgressManager, type IProgressManager } from '../ui/progressManager';
import { isEnabled } from '../config/features';
import { ToolbarCustomizer } from '../ui/toolbarCustomizer';
import { LocalLayoutStorage } from '../ui/layoutStorage';
import { FormattingService } from './formattingService';
import { UndoRedoController } from './undoRedoController';
import { PageNavigationController } from './pageNavigationController';
import { CleanupService } from './cleanupService';
import { PanelFocusTrapService } from './panelFocusTrapService';
import { trapFocus } from '../utils/focusTrap';
import { displayRectToUserSpaceRect } from '../utils/geometry';
import { CodeModalManager, type ICodeModalContext } from '../ui/codeModalManager';
import { WatermarkPanel, type IWatermarkContext } from '../ui/watermarkPanel';
import { BatesPanel } from '../ui/batesPanel';
import { CompressPanel } from '../ui/compressPanel';
import { SignersPanel } from '../ui/signersPanel';
import type { SignatureCaption } from '../elements/signatureElement';
import type { CompressOptions } from '../export/compress';
import { TextOptionsPopover } from '../ui/textOptionsPopover';
import type { TextCaseMode } from '../utils/textCase';
import type { ListType } from '../utils/listMarkers';

import { FindBarController, type IFindBarContext } from '../ui/findBarController';
import { DocumentLoader, type IDocumentLoaderContext } from '../ui/documentLoader';
import { ElementLayerRenderer } from '../ui/elementLayerRenderer';
import { PageRenderPipeline } from './pageRenderPipeline';
import { PlacementManager } from '../ui/placementManager';
import { SignatureManager } from './signatureManager';
import { ExportPreviewPanel } from '../ui/exportPreviewPanel';
import { CanvasClickRouter } from './canvasClickRouter';
import type { ToolMode } from '../types/tools';

export type { ToolMode } from '../types/tools';

// Release a pdf.js document's worker transport. v6 PDFDocumentProxy has no destroy();
// teardown goes through loadingTask.destroy() (a Promise). Best-effort, never throws.
function _destroyDoc(doc: PDFDocumentProxy | undefined): void {
  const task = (doc as { loadingTask?: { destroy?: () => Promise<void> } } | undefined)?.loadingTask;
  if (task && typeof task.destroy === 'function') void task.destroy().catch(() => {});
}

export class PDFTurboApp implements IExportContext, IPageContext, IAnnotationContext, IToolModeContext, ICodeModalContext, IWatermarkContext, IFindBarContext, IDocumentLoaderContext {
  renderer: PDFRenderer;
  documentModel: DocumentModel;
  elements: PDFElement[] = [];
  interactionHandler: InteractionHandler;
  signaturePad: SignaturePad;
  mode: ToolMode = 'select';
  zoomScale = 1.0;
  selectedElement: PDFElement | null = null;
  historyManager: HistoryManager;
  currentFilename: string | null = null;
  uiController: UIController;
  drawingHandler: DrawingHandler;
  eraserHandler: EraserHandler;
  _thumbnailPanel: PageThumbnailPanel | null = null;
  private _sessionManager = new SessionManager();
  private _textSearch = new TextSearchHandler();
  _searchManager = new SearchManager();
  _searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _formFieldOverlay: FormFieldOverlay;
  private _textLayerManager: TextLayerManager;
  private _formValues: Record<string, Record<string, string>> = {};
  private _warnedUnsupportedFields = false;
  private _formFieldGen = 0;
  private _isLoading = false;
  _pendingPasswordResolve: ((password: string | null) => void) | null = null;
  _exportPassword: { user: string; owner: string } | null = null;
  inkLayer: InkLayer;
  inkLayerHandler: InkLayerHandler;
  private _inkCanvas: HTMLCanvasElement;
  _isFitMode = true;
  private _clipboard: ElementJSON | null = null;
  get _exportPreviewOpen(): boolean { return this._exportPreviewPanel.isOpen; }
  _pendingModeAfterBlankPage: string | null = null;
  private _textEditHandler = new TextEditHandler();
  private _toastQueue!: ToastQueue;
  private _errorReporter!: IErrorReporter;
  private readonly _logBuffer: ILogBuffer;
  private _progressManager!: IProgressManager;
  private _exportService!: ExportService;
  private _toolbarCustomizer!: ToolbarCustomizer;
  private _pageService!: PageService;
  private _annotationService!: AnnotationService;
  private _toolModeService!: ToolModeService;
  private _codeModalManager!: CodeModalManager;
  private _ocrHandler!: OcrHandler;
  private _signingHandler!: SigningHandler;
  private _watermarkPanel!: WatermarkPanel;
  private _batesPanel!: BatesPanel;
  private _compressPanel!: CompressPanel;
  private _signersPanel!: SignersPanel;
  private _findBarController!: FindBarController;
  private _documentLoader!: DocumentLoader;
  private _elementLayerRenderer!: ElementLayerRenderer;
  private _pageRenderPipeline!: PageRenderPipeline;
  private _placementManager!: PlacementManager;
  private _signatureManager!: SignatureManager;
  private _exportPreviewPanel!: ExportPreviewPanel;
  private _canvasClickRouter!: CanvasClickRouter;
  private _formattingService!: FormattingService;
  private _undoRedoController!: UndoRedoController;
  private _pageNavController!: PageNavigationController;
  private _cleanupService!: CleanupService;
  private _focusTrapService!: PanelFocusTrapService;
  private _textOptionsPopover!: TextOptionsPopover;

  // ── Signature accessors (IPlacementContext) ───────────────────────────────
  get currentSignature(): string | null { return this._signatureManager.currentSignature; }
  set currentSignature(v: string | null) { this._signatureManager.currentSignature = v; }
  get signatureNatural(): { w: number; h: number } | null { return this._signatureManager.signatureNatural; }
  set signatureNatural(v: { w: number; h: number } | null) { this._signatureManager.signatureNatural = v; }
  // F-D D2 — approval caption armed by the Signers panel (IPlacementContext / ISignersContext).
  get pendingSignatureCaption(): SignatureCaption | null { return this._signatureManager.pendingCaption; }
  set pendingSignatureCaption(v: SignatureCaption | null) { this._signatureManager.pendingCaption = v; }
  setPendingSignatureCaption(v: SignatureCaption | null): void { this._signatureManager.pendingCaption = v; }
  /** Clear any armed caption — the plain ✍ / `S` leak guard (toolBinder/keyboardBinder). */
  clearPendingSignatureCaption(): void { this._signatureManager.pendingCaption = null; }
  now(): Date { return new Date(); }
  // ── ISignatureContext callbacks ────────────────────────────────────────────
  getTrapCleanup(): (() => void) | null { return this._focusTrapService.getCleanup(); }
  setTrapCleanup(fn: (() => void) | null): void { this._focusTrapService.setCleanup(fn); }

  // ── IPageRenderContext accessors ──────────────────────────────────────────
  advanceFormFieldGen(): number { return ++this._formFieldGen; }
  isCurrentFormFieldGen(gen: number): boolean { return gen === this._formFieldGen; }
  getFormValues(sourcePdfId: string): Record<string, string> { return this._formValues[sourcePdfId] ?? {}; }
  setFormValue(sourcePdfId: string, fieldName: string, value: string): void {
    if (!this._formValues[sourcePdfId]) this._formValues[sourcePdfId] = {};
    this._formValues[sourcePdfId][fieldName] = value;
  }
  getWarnedUnsupportedFields(): boolean { return this._warnedUnsupportedFields; }

  // ── IElementLayerContext accessors ────────────────────────────────────────
  get inkCanvas(): HTMLCanvasElement { return this._inkCanvas; }
  handleElementPointerDown(e: PointerEvent, el: PDFElement, div: HTMLDivElement): void {
    this.interactionHandler.handlePointerDown(e, el, div);
  }
  handleElementClick(el: PDFElement): void { this.selectElement(el); }
  handleCodeElementEdit(el: CodeElement): void { this.openCodeModal(el); }
  handleTextInput(element: TextElement | CommentElement, input: HTMLInputElement | HTMLTextAreaElement): void { this._undoRedoController.handleTextInput(element, input); }
  handleFormInput(sourcePdfId: string, fieldName: string, value: string): void { this._undoRedoController.handleFormInput(sourcePdfId, fieldName, value); }

  // ── IExportContext accessors ───────────────────────────────────────────────
  get exportPassword(): { user: string; owner: string } | null { return this._exportPassword; }
  get formValues(): Record<string, Record<string, string>> { return this._formValues; }
  renderCurrentPage(): Promise<void> { return this._renderCurrentPage(); }
  cleanEmptyTextElements(): void { this._cleanEmptyTextElements(); }

  get ui(): AppDOMRefs { return this.uiController.refs; }
  get reportError(): IErrorReporter { return this._errorReporter; }
  get logBuffer(): ILogBuffer { return this._logBuffer; }
  get progress(): IProgressManager { return this._progressManager; }

  // ── IPageContext accessors ────────────────────────────────────────────────
  get isFitMode(): boolean { return this._isFitMode; }
  set isFitMode(val: boolean) { this._isFitMode = val; }
  get pendingModeAfterBlankPage(): string | null { return this._pendingModeAfterBlankPage; }
  set pendingModeAfterBlankPage(val: string | null) { this._pendingModeAfterBlankPage = val; }
  get containerWidth(): number { return this.ui.container.clientWidth; }
  setZoomDisplay(text: string): void { this.ui.zoomDisplay.textContent = text; }
  clearTextSearchCache(): void { this._textSearch.clearCache(); }
  imagesToPdf(files: File[]): Promise<{ bytes: Uint8Array; name: string }> { return this._documentLoader.imagesToPdf(files); }
  clearSearchMatches(): void { this._findBarController.clearMatches(); }
  clearSearchManagerState(): void { this._searchManager.clear(); }
  hasFindBarOpen(): boolean { return this.ui.findBar.style.display !== 'none'; }
  hasFindInput(): boolean { return Boolean(this.ui.findInput.value); }
  clearFindCount(): void { this.ui.findCount.textContent = ''; }
  searchIfActive(): void { void this._findBarController.search(); }
  refreshExportPreviewIfOpen(): void { if (this._exportPreviewPanel.isOpen) this._exportPreviewPanel.show(); }
  hideEmptyState(): void { (document.getElementById('emptyState') as HTMLElement).style.display = 'none'; }
  enableFileMenuDocItems(): void { this._enableFileMenuDocItems(); }
  onPageStructureChange(): Promise<void> { return this._onPageStructureChange(); }
  invalidateThumbnail(pageId: string): void { this._thumbnailPanel?.invalidateThumb(pageId); }
  invalidateAllThumbnails(): void { this._thumbnailPanel?.invalidateAll(); }
  updateActiveThumbnail(): void { this._thumbnailPanel?.updateActive(); }
  renderThumbnails(): Promise<void> { return this._thumbnailPanel?.render() ?? Promise.resolve(); }
  showThumbnailContainer(): void { this.ui.pageThumbnailContainer.style.display = ''; }
  ensureThumbnailPanel(): void { if (!this._thumbnailPanel) this._initThumbnailPanel(); }

  // ── IAnnotationContext accessors ──────────────────────────────────────────
  get clipboard(): ElementJSON | null { return this._clipboard; }
  set clipboard(val: ElementJSON | null) { this._clipboard = val; }
  updateFormattingToolbar(): void { this._updateFormattingToolbar(); }
  updateCopyPasteBtns(): void { this._updateCopyPasteBtns(); }

  // ── IToolModeContext accessors ────────────────────────────────────────────
  cancelHandlers(): void { this.drawingHandler.cancel(); this.eraserHandler.cancel(); this.inkLayerHandler.cancel(); }
  setElementPointerEvents(pe: 'auto' | 'none'): void { this.ui.container.querySelectorAll<HTMLElement>('.pdf-element').forEach(el => { el.style.pointerEvents = pe; }); }
  updateModeButtons(mode: ToolMode): void { this.uiController.updateModeButtons(mode); }
  setOverlayPointerEvents(isSelect: boolean): void { this._formFieldOverlay.setPointerEvents(isSelect); this._textLayerManager.setPointerEvents(isSelect); }
  hidePlacementGhost(): void { this._placementManager.hidePlacementGhost(); }
  clearToast(): void { this.uiController.clearToast(); }
  setCanvasTouchAction(value: 'none' | 'pan-x pan-y'): void { this.ui.canvas.style.touchAction = value; }

  // ── IFindBarContext accessors ─────────────────────────────────────────────
  get searchManager() { return this._searchManager; }
  get textSearch() { return this._textSearch; }
  addHighlightForMatch(match: { x: number; y: number; width: number; height: number }, pageId: string): void {
    const hlEl = new HighlightElement(match.x, match.y, match.width, match.height, pageId);
    this.historyManager.execute(new AddElementCmd(this.elements, hlEl));
  }

  /**
   * Apply find & replace edits to overlay text/comment elements (PDF overlay find & replace,
   * Option 3 #1). Each edit replaces the element's whole `text` with the pre-computed `newText`
   * via an undoable `TextEditCmd` (a `MacroCmd` when more than one → one undo step for Replace All).
   * Returns the number of elements actually changed. Re-renders the overlay layer + autosaves.
   */
  replaceOverlayText(edits: { elementId: number; newText: string }[]): number {
    const cmds: Command[] = [];
    for (const { elementId, newText } of edits) {
      const el = this.elements.find(e => e.id === elementId) as (TextElement | CommentElement) | undefined;
      const before = el && typeof (el as { text?: unknown }).text === 'string' ? (el as { text: string }).text : null;
      if (before === null || before === newText) continue;
      cmds.push(new TextEditCmd(this.elements, elementId, before, newText));
    }
    if (cmds.length === 0) return 0;
    this.historyManager.execute(cmds.length === 1 ? cmds[0] : new MacroCmd(cmds));
    this.autosave();
    this.rebuildElementLayer();
    return cmds.length;
  }

  // ── IWatermarkContext accessors ──────────────────────────────────────────
  get watermark() { return this.documentModel.watermark; }
  setWatermark(wm: import('./documentModel').WatermarkSettings): void { this.documentModel.watermark = wm; }

  // ── IBatesContext accessors (#61b) ────────────────────────────────────────
  get bates() { return this.documentModel.bates; }
  setBates(b: import('../export/batesStamp').BatesSettings): void { this.documentModel.bates = b; }
  get exportPreviewOpen(): boolean { return this._exportPreviewPanel.isOpen; }
  showExportPreview(): void { this._exportPreviewPanel.show(); }

  // ── ICodeModalContext accessors ──────────────────────────────────────────
  setPendingCode(
    dataUrl: string,
    options: { codeType: string; data: string; qrStyle: QRStyleOptions | null; bwipOpts: BwipOptions | null },
    natural: { w: number; h: number },
  ): void { this._placementManager.setPendingCode(dataUrl, options, natural); }
  _setQrLogoDataUrl(val: string | null): void { this._codeModalManager.setQrLogoDataUrl(val); }

  // ── IDocumentLoaderContext accessors ──────────────────────────────────────
  get isLoading(): boolean { return this._isLoading; }
  setIsLoading(v: boolean): void { this._isLoading = v; }
  resetDocumentModel(): void {
    this.documentModel = new DocumentModel();
    this.renderer.setModel(this.documentModel);
    this._formattingService.cancelPainter();
    this.ui.formatPainterBtn.classList.remove('btn-active-fmt');
  }
  setFormValues(v: Record<string, Record<string, string>>): void { this._formValues = v; }
  setWarnedUnsupportedFields(v: boolean): void { this._warnedUnsupportedFields = v; }
  setSelectedElement(el: PDFElement | null): void { this.selectedElement = el; }
  setCurrentFilename(name: string | null): void { this.currentFilename = name; }
  setClipboard(val: null): void { this._clipboard = val; }
  setPendingPasswordResolve(fn: ((pw: string | null) => void) | null): void { this._pendingPasswordResolve = fn; }
  get formFieldOverlay(): FormFieldOverlay { return this._formFieldOverlay; }
  get textLayerManager(): TextLayerManager { return this._textLayerManager; }
  reinitThumbnailPanel(): void { this._initThumbnailPanel(); }
  clearThumbnailPanel(): void { this._thumbnailPanel = null; }
  setZoom(scale: number): void {
    this.zoomScale = scale;
    this.renderer.setScale(scale);
    this.ui.zoomDisplay.textContent = Math.round(scale * 100) + '%';
  }
  syncWatermarkBtn(): void { this._syncWatermarkBtn(); }
  syncBatesBtn(): void { this._batesPanel.syncBtn(); }
  disableFileMenuDocItems(): void { this._disableFileMenuDocItems(); }
  closeFindBar(): void { this._findBarController.close(); }
  clearCanvases(): void {
    const ctx = this.renderer.canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.renderer.canvas.width, this.renderer.canvas.height);
    const ictx = this._inkCanvas.getContext('2d');
    if (ictx) ictx.clearRect(0, 0, this._inkCanvas.width, this._inkCanvas.height);
  }
  resetSearchOptions(): void {
    this._searchManager.caseSensitive = false;
    this._searchManager.regex = false;
    this.ui.findCaseSensitive.classList.remove('active');
    this.ui.findRegex.classList.remove('active');
  }

  // ── IFormattingContext callback ───────────────────────────────────────────
  syncFormattingUIDisplay(el: PDFElement | null, mode: ToolMode): void {
    this.uiController.updateFormattingToolbar(el, mode);
  }

  constructor(logBuffer?: ILogBuffer) {
    this._logBuffer = logBuffer ?? new LogBuffer();
    this.documentModel = new DocumentModel();
    this.renderer = new PDFRenderer(document.getElementById('pdfCanvas') as HTMLCanvasElement);
    this.renderer.setModel(this.documentModel);
    this.elements = [];
    this.uiController = new UIController();
    this._toastQueue = new ToastQueue(document.getElementById('toast') as HTMLElement);
    this._errorReporter = new ErrorReporter(this._toastQueue, this._logBuffer);
    this._progressManager = new ProgressManager(
      document.getElementById('progress-overlay') as HTMLElement,
      document.getElementById('progress-label') as HTMLElement,
      document.getElementById('progress-bar') as HTMLProgressElement,
    );
    this.interactionHandler = new InteractionHandler(this);
    this.drawingHandler = new DrawingHandler(this);
    this.eraserHandler = new EraserHandler(this);
    this.inkLayer = new InkLayer();
    this.inkLayerHandler = new InkLayerHandler(this);
    this._inkCanvas = document.createElement('canvas');
    this._inkCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this.uiController.refs.container.appendChild(this._inkCanvas);
    this.signaturePad = new SignaturePad(this.uiController.refs.signatureCanvas);
    this._formFieldOverlay = new FormFieldOverlay(this.uiController.refs.container);
    this._textLayerManager = new TextLayerManager(this.uiController.refs.container);
    this.mode = 'select';
    this.zoomScale = 1.0;
    this.selectedElement = null;
    this.historyManager = new HistoryManager(50, (canUndo, canRedo) => {
      this.uiController.updateUndoRedoBtns(canUndo, canRedo);
    });
    this.currentFilename = null;
    this._signatureManager = new SignatureManager(this);
    this._exportService = new ExportService(this);
    this._pageService = new PageService(this);
    this._annotationService = new AnnotationService(this);
    this._toolModeService = new ToolModeService(this);
    this._codeModalManager = new CodeModalManager(this);
    this._ocrHandler = new OcrHandler(this);
    this._signingHandler = new SigningHandler(this);
    this._watermarkPanel = new WatermarkPanel(this);
    this._batesPanel = new BatesPanel(this);
    this._compressPanel = new CompressPanel(this);
    this._signersPanel = new SignersPanel(this);
    this._findBarController = new FindBarController(this);
    this._documentLoader = new DocumentLoader(this);
    this._elementLayerRenderer = new ElementLayerRenderer(this);
    this._pageRenderPipeline = new PageRenderPipeline(this);
    this._placementManager = new PlacementManager(this);
    this._canvasClickRouter = new CanvasClickRouter(this);
    this._exportPreviewPanel = new ExportPreviewPanel(this);
    this._toolbarCustomizer = new ToolbarCustomizer(
      document.querySelector('.toolbar-row1') as HTMLElement,
      new LocalLayoutStorage(),
    );
    this._toolbarCustomizer.restore();
    this._toolbarCustomizer.enableDragDrop();
    this._formattingService = new FormattingService(this);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const _self = this;
    this._textOptionsPopover = new TextOptionsPopover({
      ui: this.ui,
      svc: this._formattingService,
      get selectedText() {
        const el = _self.selectedElement;
        return el?.type === 'text' ? (el as TextElement) : null;
      },
    });
    this._textOptionsPopover.setupListeners();
    this._undoRedoController = new UndoRedoController(this);
    this._pageNavController = new PageNavigationController(this);
    this._cleanupService = new CleanupService(this);
    this._focusTrapService = new PanelFocusTrapService();
    this.setupEventListeners();
    this._initThumbnailPanel();
    void this._documentLoader.restoreSession();
    this._showPrivacyToastOnce();
  }

  private _initThumbnailPanel(): void {
    this._thumbnailPanel = new PageThumbnailPanel({
      container: this.ui.pageThumbnailContainer,
      renderer: this.renderer,
      model: this.documentModel,
      onNavigate: (index) => void this._pageService.goToPageIndex(index),
      onDelete: (pageId) => this._pageService.deletePage(pageId),
      onReorder: (newOrder) => this._pageService.reorderPages(newOrder),
      onRotate: (pageId, delta) => void this._pageService.rotatePage(pageId, delta),
      onAddPdf: () => this.ui.addPdfInput.click(),
      onDownload: (index) => this.downloadPage(index),
      onDownloadImage: (index, opts) => this.downloadPageAsImage(index, opts),
    });
    // G17: composite overlay annotations + ink into thumbnails (returns null for
    // pages with no elements/ink → panel falls back to the source-only raster).
    this._thumbnailPanel.setOverlayCompositor((i) => this._exportService.renderThumbnailWithOverlays(i));
  }

  private _showPrivacyToastOnce(): void {
    const KEY = 'pdfturbo_privacy_toast_shown';
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
    this._errorReporter.info('toast.privacyBadge');
  }

  setupEventListeners() {
    bindEvents(this);
  }

  // ── Watermark (delegated to WatermarkPanel) ──────────────────────────────
  _setupWatermarkPreviewListeners(): void { this._watermarkPanel.setupListeners(); }
  drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this._watermarkPanel.drawOnCanvas(ctx, w, h, this.documentModel.watermark);
  }
  _openWatermarkModal(): void { this._watermarkPanel.open(); }
  _closeWatermarkModal(): void { this._watermarkPanel.close(); }
  _applyWatermark(): void { this._watermarkPanel.apply(); }
  private _syncWatermarkBtn(): void { this._watermarkPanel.syncBtn(); }

  // ── Bates / page numbering (delegated to BatesPanel, #61b) ────────────────
  _setupBatesListeners(): void { this._batesPanel.setupListeners(); }
  _openBatesModal(): void { this._batesPanel.open(); }
  _closeBatesModal(): void { this._batesPanel.close(); }
  _applyBates(): void { this._batesPanel.apply(); }

  // ── Compress (delegated to CompressPanel, #60) ────────────────────────────
  _setupCompressListeners(): void { this._compressPanel.setupListeners(); }
  _openCompressModal(): void { this._compressPanel.open(); }
  _closeCompressModal(): void { this._compressPanel.close(); }
  _applyCompress(): void { this._compressPanel.apply(); }

  // ── Signers panel (guided approval signatures, F-D D2) ────────────────────
  openSignersPanel(): void { this._signersPanel.open(); }
  closeSignersPanel(): void { this._signersPanel.close(); }
  _signersDraw(): void { this._signersPanel.draw(); }
  /** ICompressContext: run the compress + download with the chosen options. */
  compress(opts: CompressOptions): void { void this._exportService.compressAndDownload(opts); }

  // ── Text options popover ─────────────────────────────────────────────────
  closeTextOptions(): void {
    this._textOptionsPopover.close();
    this._formattingService.cancelPainter();
    this.ui.formatPainterBtn.classList.remove('btn-active-fmt');
  }

  // ── Find bar (delegated to FindBarController) ───────────────────────────
  _openFindBar(): void { this._findBarController.open(); }
  _closeFindBar(): void { this.closeFindBar(); }
  _search(): Promise<void> { return this._findBarController.search(); }
  _nextMatch(): Promise<void> { return this._findBarController.nextMatch(); }
  _prevMatch(): Promise<void> { return this._findBarController.prevMatch(); }
  _highlightCurrentMatch(): void { this._findBarController.highlightCurrentMatch(); }
  _replaceCurrentMatch(): void { this._findBarController.replaceCurrent(); }
  _replaceAllMatches(): void { this._findBarController.replaceAll(); }

  // G13 — switch the displayed page to a cross-page search match WITHOUT touching
  // the active search results/index (unlike goToPageIndex, which clears + re-runs
  // the search). Mirrors only the render half of page navigation.
  async navigateToMatchPage(pageId: string): Promise<void> {
    const idx = this.documentModel.pages.findIndex(p => p.id === pageId);
    if (idx < 0 || idx === this.documentModel.currentPageIndex) return;
    this.documentModel.currentPageIndex = idx;
    this.selectElement(null);
    if (this._isFitMode) {
      const fitScale = await this.renderer.computeFitScale(this.containerWidth);
      const isMobile = window.innerWidth <= 640;
      this.zoomScale = isMobile ? Math.max(fitScale, 0.65) : fitScale;
      this.renderer.setScale(this.zoomScale);
      this.setZoomDisplay(Math.round(this.zoomScale * 100) + '%');
    }
    await this.renderCurrentPage();
    this.updateActiveThumbnail();
    this.updatePageInfo();
    this.rebuildElementLayer();
    this.refreshExportPreviewIfOpen();
  }

  // ── Image handling ───────────────────────────────────────────
  _handleImageFileSelect(e: Event): void { this._placementManager.handleImageFileSelect(e); }
  addImageAtPosition(e: MouseEvent): void { this._placementManager.addImageAtPosition(e); }

  _commitPlacement(mode: 'addText' | 'addImage' | 'addComment' | 'addSignature' | 'addCode', x: number, y: number, w: number, h: number): void {
    this._placementManager.commitPlacement(mode, x, y, w, h);
  }

   // ── PDF page management — delegate to PageService ──────────────────────
  _handleAddPdfUpload(e: Event): Promise<void> { return this._pageService.addPages(e); }
  _deletePage(pageId: string): void { this._pageService.deletePage(pageId); }
  _reorderPages(newOrder: string[]): void { this._pageService.reorderPages(newOrder); }
  _rotatePage(pageId: string, delta: number): Promise<void> { return this._pageService.rotatePage(pageId, delta); }
  cropPage(pageId: string, displayRect: PageCrop | null, applyToAll: boolean): Promise<void> { return this._pageService.cropPage(pageId, displayRect, applyToAll); }


  _onPageStructureChange(): Promise<void> { return this._pageNavController.onPageStructureChange(); }

  // ── Undo / Redo ───────────────────────────────────────────────
  undo(): void { this._undoRedoController.undo(); }
  redo(): void { this._undoRedoController.redo(); }

  // ── True text edit: swap a source PDF's bytes after content-stream surgery ──
  // Called by TextEditHandler. Loads the edited bytes into a fresh pdfjs doc,
  // commits an undoable command, then re-renders page + thumbnail.
  // Returns true when the edit was committed; false when it was discarded (parse
  // failure, superseded source, or rolled back after a render error). Callers gate
  // their success toast on the result so a discarded edit never reports success.
  async _applySourcePdfEdit(src: SourcePdf, newBytes: Uint8Array, pageId: string): Promise<boolean> {
    // M0 #5 — snapshot the pre-edit state BEFORE the async parse, so undo restores the
    // exact bytes the edit was computed against rather than whatever the source mutated
    // to while pdf.js parsed (the await gap is a TOCTOU window → silent undo-stack
    // corruption / mismatched before/after bytes).
    const before = { bytes: src.bytes, doc: src.doc };
    let newDoc: PDFDocumentProxy;
    try {
      // pdf.js transfers the ArrayBuffer — give it a copy, keep newBytes intact
      newDoc = await pdfjsLib.getDocument({ data: newBytes.slice(0) }).promise;
    } catch (err) {
      this.reportError.error('toast.trueEditFailed', err);
      return false;
    }
    // Identity recheck: the source must still be the same live instance, unchanged,
    // after the await. If a newer edit/removal superseded it, discard the parsed doc
    // (release the worker) instead of committing a stale before/after snapshot.
    if (this.documentModel.sourcePdfs.get(src.id) !== src || src.bytes !== before.bytes) {
      _destroyDoc(newDoc);
      this.reportError.silent(undefined, '_applySourcePdfEdit: source superseded mid-parse');
      return false;
    }
    const after = { bytes: newBytes, doc: newDoc };
    const onUpdate = () => {
      this._thumbnailPanel?.invalidateThumb(pageId);
      void this._thumbnailPanel?.render();
      this.autosave();
    };
    const cmd = new ReplaceSourcePdfBytesCmd(src, before, after, onUpdate);
    let committed = false;
    try {
      this.historyManager.execute(cmd); // execute() then push — throws here = not pushed
      committed = true;
      // Initial render (undo/redo paths re-render the page via their own wrappers)
      await this._renderCurrentPage();
      this.rebuildElementLayer();
      return true;
    } catch (err) {
      // Keep the undo stack and document consistent: revert the just-applied edit.
      if (committed) {
        this.historyManager.undo(); // cmd is the top of the stack — safe
      } else {
        try { cmd.undo(); } catch { /* execute() partially applied — best-effort revert */ }
        _destroyDoc(newDoc);
      }
      this.reportError.error('toast.trueEditFailed', err);
      return false;
    }
  }

  // ── Autosave (IndexedDB) ──────────────────────────────────────
  autosave() {
    this._sessionManager.schedule(() => ({
      documentModel: this.documentModel,
      elements: this.elements,
      inkLayer: this.inkLayer,
      formValues: this._formValues,
      errors: this._errorReporter,
    }));
  }

  _clearSave(): void { this._documentLoader.clearSave(); }

  _openBlankPageModal(): void { this._documentLoader.openBlankPageModal(); }

    _insertBlankPage(): void { this._pageService.insertBlankPage(); }

  clearAll(): void { this._annotationService.clearAll(); }

  _toggleSettings(show?: boolean): void {
    this._focusTrapService.togglePanel(
      () => this.uiController.toggleSettings(show),
      this.ui.settingsPanel,
      '.help-content',
      this.ui.settingsBtn,
    );
  }

  _resetToolbarLayout(): void {
    this._toolbarCustomizer.reset();
  }

  _toggleHelp(show?: boolean): void {
    this._focusTrapService.togglePanel(
      () => this.uiController.toggleHelp(show),
      this.ui.helpModal,
      '.help-content',
      this.ui.helpBtn,
    );
  }
  showToast(msg: string, duration = 3000) { this.uiController.showToast(msg, duration); }

  private _enableFileMenuDocItems(): void {
    this.ui.fileMenuClose.disabled = false;
    this.ui.fileMenuClearAnnotations.disabled = false;
    this.ui.fileMenuResetSession.disabled = false;
  }

  private _disableFileMenuDocItems(): void {
    this.ui.fileMenuClose.disabled = true;
    this.ui.fileMenuClearAnnotations.disabled = true;
    this.ui.fileMenuResetSession.disabled = true;
  }

  _closeDocument(): void { this._documentLoader.closeDocument(); }

  _loadDocument(e: Event): Promise<void> { return this._documentLoader.load(e); }

  enableUI() { this.uiController.enableUI(); }

  /** Re-render dynamic DOM strings after a language change. */
  onLanguageChanged(): void {
    this.uiController.updateModeButtons(this.mode);
    if (this.documentModel?.pageCount > 0) {
      this._thumbnailPanel?.render();
    }
  }

  _cleanEmptyTextElements(): void { this._cleanupService.cleanEmptyTextElements(); }

  setMode(mode: ToolMode, opts?: SetModeOptions): void { this._toolModeService.setMode(mode, opts); }
  _isShapeMode(): boolean { return this._toolModeService.isShapeMode(); }
  isShapeMode(): boolean { return this._toolModeService.isShapeMode(); }
  handleTextEditClick(e: MouseEvent): void { void this._textEditHandler.handleCanvasClick(e, this); }
  consumeSkipNextClick(): boolean { return this._placementManager.consumeSkipNextClick(); }
  hasPendingImageSrc(): boolean { return this._placementManager.hasPendingImageSrc(); }

  openSignatureModal() { this._signatureManager.openModal(); }
  closeSignatureModal() { this._signatureManager.closeModal(); }
  saveSignature() { this._signatureManager.save(); }

  // ── Code modal (delegated to CodeModalManager) ──────────────────────────
  openCodeModal(el?: CodeElement): void { this._codeModalManager.open(el); }
  closeCodeModal(): void { this._codeModalManager.close(); }
  saveCodeModal(): Promise<void> { return this._codeModalManager.save(); }
  _syncCodeOptionsVisibility(): void { this._codeModalManager.syncVisibility(); }
  _triggerCodePreview(delay?: number): void { this._codeModalManager.triggerPreview(delay); }

  // ── OCR modal ───────────────────────────────────────────────────────────
  openOcrModal(): void {
    if (!this.documentModel.pageCount) return;
    this.ui.ocrProgressRow.style.display = 'none';
    this.ui.ocrProgress.value = 0;
    this.ui.runOcrModal.disabled = false;
    this.ui.ocrModal.classList.add('active');
    this._focusTrapService.getCleanup()?.();
    this._focusTrapService.setCleanup(trapFocus(
      this.ui.ocrModal.querySelector('.code-modal-content') as HTMLElement,
      this.ui.ocrBtn,
    ));
  }
  closeOcrModal(): void {
    this._focusTrapService.getCleanup()?.();
    this._focusTrapService.setCleanup(null);
    this.ui.ocrModal.classList.remove('active');
  }
  async runOcr(): Promise<void> {
    const lang = this.ui.ocrLangSelect.value;
    const sel = this.ui.ocrModeSelect.value;
    const progressCb = (p: { progress: number }): void => {
      this.ui.ocrProgress.value = Math.round(p.progress * 100);
    };
    this.ui.ocrProgressRow.style.display = '';
    this.ui.runOcrModal.disabled = true;
    this.ui.ocrBtn.disabled = true; // M0 #6 — reflect the single-flight gate in the UI
    try {
      if (sel === 'text' || sel === 'docx') {
        // Read-only outputs: recognize WITHOUT modifying the document, then export
        // the recognized text (copy + .txt) or build an editable Word file.
        const result = await this._ocrHandler.recognizeCurrentPage(lang, progressCb);
        this.closeOcrModal();
        if (!result || !result.text.trim()) { this.reportError.warn('toast.ocrNoText'); return; }
        if (sel === 'text') await this._exportService.exportOcrText(result.text);
        else await this._exportService.exportOcrDocx(result.text);
        return;
      }
      const mode: OcrOutputMode = (sel === 'visible' || !isEnabled('searchableOcr')) ? 'visible' : 'searchable';
      const n = await this._ocrHandler.run(lang, mode, progressCb);
      this.closeOcrModal();
      if (n > 0) {
        this.reportError.info(mode === 'searchable' ? 'toast.ocrSearchableDone' : 'toast.ocrDone', { count: n });
      } else {
        this.reportError.warn('toast.ocrNoText');
      }
    } catch (err) {
      // Rotated pages can't yet be mapped into the unrotated source-page space.
      if (err instanceof SearchableLayerError && err.code === 'ROTATED_PAGE') {
        this.reportError.warn('toast.ocrRotatedUnsupported');
      } else {
        this.reportError.error('toast.ocrFailed');
      }
    } finally {
      this.ui.runOcrModal.disabled = false;
      this.ui.ocrBtn.disabled = false;
      this.ui.ocrProgressRow.style.display = 'none';
    }
  }

  // ── Sign modal ────────────────────────────────────────────────────────────
  openSignModal(): void {
    if (!this.documentModel.pageCount) return;
    this.ui.signError.style.display = 'none';
    this.ui.signError.textContent = '';
    this.ui.signProgressRow.style.display = 'none';
    this.ui.signPage.max = String(this.documentModel.pageCount);
    this.ui.runSignModal.disabled = false;
    // Reset the certificate source to "upload" and reveal the matching fields.
    this.ui.signSourceUpload.checked = true;
    this.ui.signUploadGroup.style.display = '';
    this.ui.signGenGroup.style.display = 'none';
    this._refreshSignSignaturePreview();
    this.ui.signModal.classList.add('active');
    this._focusTrapService.getCleanup()?.();
    this._focusTrapService.setCleanup(trapFocus(
      this.ui.signModal.querySelector('.code-modal-content') as HTMLElement,
      this.ui.signBtn,
    ));
  }
  /**
   * F-C: show the drawn-signature preview + a Remove control inside the sign
   * modal. The image is auto-embedded into the appearance; Remove clears the
   * shared drawn signature (`currentSignature`) so the box reverts to text-only.
   */
  private _refreshSignSignaturePreview(): void {
    const sig = this.currentSignature;
    if (sig) {
      this.ui.signSigImg.src = sig;
      this.ui.signSigRow.style.display = '';
    } else {
      this.ui.signSigImg.removeAttribute('src');
      this.ui.signSigRow.style.display = 'none';
    }
    // onclick (not addEventListener) is idempotent across repeated modal opens.
    this.ui.signSigRemove.onclick = (): void => {
      this.currentSignature = null;
      this._refreshSignSignaturePreview();
    };
  }
  closeSignModal(): void {
    this._focusTrapService.getCleanup()?.();
    this._focusTrapService.setCleanup(null);
    this.ui.signModal.classList.remove('active');
    // Scrub credentials from the DOM when the modal closes.
    this.ui.signPassword.value = '';
    this.ui.signCertInput.value = '';
    this.ui.signGenPassword.value = '';
  }
  /**
   * F-C C2 — "Pick on page": hide the sign modal (preserving its field/credential
   * state — NOT closeSignModal) and enter `signRect` so the user can drag the
   * appearance box on the current page.
   */
  beginSignRectPick(): void {
    this._focusTrapService.getCleanup()?.();
    this._focusTrapService.setCleanup(null);
    this.ui.signModal.classList.remove('active');
    this.setMode('signRect');
  }

  /**
   * F-C C2 — receive the drawn display-space rect: map it to PDF user space, prefill
   * the sign-modal X/Y/W/H + page, then reopen the modal. A degenerate/cancelled pick
   * (null) reopens the modal unchanged so the user is never stranded in `signRect`.
   */
  async onSignRectPicked(displayRect: { x: number; y: number; width: number; height: number } | null): Promise<void> {
    this.setMode('select');
    const page = this.documentModel.currentPage;
    if (displayRect && page) {
      const geom = await this._pageGeomForSign(page);
      if (geom) {
        const totalRot = (((geom.srcRot + (page.rotation ?? 0)) % 360) + 360) % 360;
        const us = displayRectToUserSpaceRect(displayRect, geom.W, geom.H, totalRot);
        if (us.width >= 1 && us.height >= 1) {
          this.ui.signX.value = String(Math.round(us.x));
          this.ui.signY.value = String(Math.round(us.y));
          this.ui.signW.value = String(Math.round(us.width));
          this.ui.signH.value = String(Math.round(us.height));
          this.ui.signPage.value = String(this.documentModel.currentPageIndex + 1);
        }
      }
    }
    this._reopenSignModal();
  }

  /** Re-show the sign modal after a pick without resetting fields (unlike openSignModal). */
  private _reopenSignModal(): void {
    this._refreshSignSignaturePreview();
    this.ui.signModal.classList.add('active');
    this._focusTrapService.getCleanup()?.();
    this._focusTrapService.setCleanup(trapFocus(
      this.ui.signModal.querySelector('.code-modal-content') as HTMLElement,
      this.ui.signBtn,
    ));
  }

  /** Unrotated point dimensions + source rotation of a page (for the sign-rect transform). */
  private async _pageGeomForSign(p: DocumentPage): Promise<{ W: number; H: number; srcRot: number } | null> {
    if (p.sourcePdfId === 'blank') return { W: p.blankWidth ?? 595, H: p.blankHeight ?? 842, srcRot: 0 };
    const src = this.documentModel.sourcePdfs.get(p.sourcePdfId);
    if (!src) return null;
    const pg = await src.doc.getPage(p.sourcePageNum);
    const vp = pg.getViewport({ scale: 1, rotation: 0 });
    return { W: vp.width, H: vp.height, srcRot: (pg.rotate as number) ?? 0 };
  }

  /** Delegates the entire sign-modal flow to the handler (M2 #19). */
  signPdf(): Promise<void> { return this._signingHandler.runSignFlow(); }

  selectElement(element: PDFElement | null) {
    if (this.selectedElement === element) { this._updateFormattingToolbar(); return; }
    this._cleanEmptyTextElements();
    this.selectedElement = element;
    this.rebuildElementLayer();
    this._updateFormattingToolbar();
    this._updateCopyPasteBtns();
    // Format painter: paste style onto a newly selected text element, then disarm.
    if (this._formattingService.painterArmed && element?.type === 'text') {
      this._formattingService.pasteTextStyle();
      this.ui.formatPainterBtn.classList.remove('btn-active-fmt');
    }
  }

  get effectiveFillColor(): string | undefined { return this._formattingService.effectiveFillColor; }

  _syncFillToggleUI(): void { this._formattingService._syncFillToggleUI(); }

  _updateFormattingToolbar(): void { this._formattingService.updateFormattingToolbar(); }

  handleCanvasClick(e: MouseEvent) { this._canvasClickRouter.handleCanvasClick(e); }

  // ── Formatting actions (layering fix — called by formattingBinder) ─────────
  setFontFamily(value: string): void { this._formattingService.setFontFamily(value); }
  toggleBold(): void { this._formattingService.toggleBold(); }
  toggleItalic(): void { this._formattingService.toggleItalic(); }
  toggleUnderline(): void { this._formattingService.toggleUnderline(); }
  toggleStrikethrough(): void { this._formattingService.toggleStrikethrough(); }
  cycleAlign(): void { this._formattingService.cycleAlign(); }
  setAlign(value: TextAlign): void { this._formattingService.setAlign(value); this._formattingService.updateFormattingToolbar(); }
  setDirection(dir: TextDirection): void { this._formattingService.setDirection(dir); this._formattingService.updateFormattingToolbar(); }
  toggleDirection(): void { this._formattingService.toggleDirection(); this._formattingService.updateFormattingToolbar(); }
  toggleListType(kind: ListType): void { this._formattingService.toggleList(kind); this._formattingService.updateFormattingToolbar(); }
  setLinkUrl(raw: string | null): void { this._formattingService.setLinkUrl(raw); this._formattingService.updateFormattingToolbar(); }
  transformCase(mode: TextCaseMode): void { this._formattingService.transformCase(mode); }
  clearFormatting(): void { this._formattingService.clearFormatting(); }
  setFontSize(size: number): void { this._formattingService.setFontSize(size); }
  adjustFontSize(delta: number): void { this._formattingService.adjustFontSize(delta); }
  setElementColor(value: string): void { this._formattingService.setElementColor(value); }
  setFillNone(): void { this._formattingService.setFillNone(); }
  startFillColor(): void { this._formattingService.startFillColor(); }
  setFillColor(value: string): void { this._formattingService.setFillColor(value); }
  setRedactColor(value: string): void { this._formattingService.setRedactColor(value); }
  setShapeStrokeWidth(value: number): void { this._formattingService.setShapeStrokeWidth(value); }

  addTextAtPosition(e: MouseEvent) { this._placementManager.addTextAtPosition(e); }


  removeElement(id: number): void { this._annotationService.removeElement(id); }

  rebuildElementLayer(): void { this._elementLayerRenderer.rebuildElementLayer(); }
  rerenderElement(element: PDFElement): HTMLDivElement | null { return this._elementLayerRenderer.rerenderElement(element); }

  // ── Ink layer ─────────────────────────────────────────────────
  renderInkLayer(): void { this._elementLayerRenderer.renderInkLayer(); }
  renderInkLayerWithLive(points: Array<{ x: number; y: number }>, type: 'ink' | 'erase'): void {
    this._elementLayerRenderer.renderInkLayerWithLive(points, type);
  }

  // ── Navigation ────────────────────────────────────────────────
  private _renderCurrentPage(): Promise<void> { return this._pageRenderPipeline.renderCurrentPage(); }

    _goToPageIndex(index: number): Promise<void> { return this._pageService.goToPageIndex(index); }

  async _goToPage(n: number): Promise<void> {
    await this._goToPageIndex(n - 1);
  }

  async prevPage() { await this._goToPageIndex(this.documentModel.currentPageIndex - 1); }
  async nextPage() { await this._goToPageIndex(this.documentModel.currentPageIndex + 1); }

  updatePageInfo() {
    this.uiController.updatePageInfo(this.documentModel.currentPageIndex + 1, this.documentModel.pageCount);
  }

    applyZoom(newScale: number): Promise<void> { return this._pageService.applyZoom(newScale); }

  _showExportPreview(): void { this._exportPreviewPanel.show(); }
  _hideExportPreview(): void { this._exportPreviewPanel.hide(); }

  async fitToWidth() {
    this._isFitMode = true;
    const scale = await this.renderer.computeFitScale(this.ui.container.clientWidth);
    await this.applyZoom(scale);
  }

  _copySelectedElement(): void { this._annotationService.copySelectedElement(); }
  _pasteElement(): void { this._annotationService.pasteElement(); }

  _updateCopyPasteBtns(): void {
    const hasPdfText = !!window.getSelection()?.toString();
    this.uiController.updateCopyPasteBtns(!!this.selectedElement || hasPdfText, !!this._clipboard);
  }

  // ── Export — delegate to ExportService ──────────────────────────────
  downloadPDF(): Promise<void> { return this._exportService.downloadPDF(); }
  downloadPage(pageIdx: number): Promise<void> { return this._exportService.downloadPage(pageIdx); }
  downloadPageRange(indices: number[]): Promise<void> { return this._exportService.downloadPageRange(indices); }
  exportTableCsv(pageIdx?: number): Promise<void> { return this._exportService.exportTableCsv(pageIdx); }
  exportTableXlsx(pageIdx?: number): Promise<void> { return this._exportService.exportTableXlsx(pageIdx); }
  downloadPageAsImage(pageIdx?: number, opts?: ImageExportOptions): Promise<void> { return this._exportService.downloadPageAsImage(pageIdx, opts); }
  exportAsDocx(): Promise<void> { return this._exportService.exportAsDocx(); }
  exportAsMarkdown(): Promise<void> { return this._exportService.exportAsMarkdown(); }
  sanitizeAndDownload(): Promise<void> { return this._exportService.sanitizeAndDownload(); }
  downloadFlattened(): Promise<void> { return this._exportService.downloadFlattened(); }
  exportXfdf(): Promise<void> { return this._exportService.exportXfdf(); }

  /**
   * Import annotations from an Adobe XFDF file (#57): parse it, convert each
   * supported markup (highlight / text-note / freetext) from PDF user space back
   * to editor display space (per-page y-flip), and add them as real annotation
   * elements in one undoable MacroCmd. Unknown subtypes are ignored; an empty or
   * unmappable file warns rather than failing silently.
   */
  async importXfdf(file: File): Promise<void> {
    try {
      const annots = parseXfdf(await file.text());
      if (!annots.length) { this.reportError.warn('toast.xfdfImportEmpty'); return; }
      const cmds: AddElementCmd[] = [];
      for (const a of annots) {
        const docPage = this.documentModel.pages[a.page];
        if (!docPage) continue;
        const h = await pageHeightPt(docPage, this.documentModel.sourcePdfs);
        const el = xfdfAnnotToElement(a, docPage.id, h);
        if (el) cmds.push(new AddElementCmd(this.elements, el));
      }
      if (!cmds.length) { this.reportError.warn('toast.xfdfImportEmpty'); return; }
      this.historyManager.execute(new MacroCmd(cmds));
      this.rebuildElementLayer();
      this.autosave();
      this.reportError.info('toast.xfdfImported', { count: cmds.length });
    } catch (err) {
      this.reportError.error('toast.xfdfImportFailed', err);
    }
  }
  /** Assembled (edited) document bytes — used by the e-signing flow. */
  assemblePdfBytes(): Promise<Uint8Array> { return this._exportService.assemblePdfBytes(); }

  _updatePlacementGhost(e: PointerEvent): void { this._placementManager.updatePlacementGhost(e); }
}
