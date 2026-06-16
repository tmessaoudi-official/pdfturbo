import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFRenderer } from '../infra/pdfRenderer';
import { TextElement } from '../elements/textElement';
import { HighlightElement } from '../elements/highlightElement';
import { TextSearchHandler } from '../handlers/textSearchHandler';
import { SignaturePad } from '../utils/signaturePad';
import { InteractionHandler } from '../handlers/interactionHandler';
import { PDFElement, type ElementJSON } from '../elements/annotationElement';
import { UIController, type AppDOMRefs } from '../ui/uiController';
import { DrawingHandler } from '../handlers/drawingHandler';
import { EraserHandler } from '../handlers/eraserHandler';
import {
  HistoryManager, AddElementCmd, MacroCmd,
  ReplaceSourcePdfBytesCmd,
} from './historyManager';
import { parseXfdf } from '../utils/xfdf';
import { xfdfAnnotToElement, pageHeightPt } from '../export/xfdfMapping';
import { InkLayer } from '../infra/inkLayer';
import { InkLayerHandler } from '../handlers/inkLayerHandler';
import { DocumentModel, type SourcePdf } from './documentModel';
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
import { ExportService, type IExportContext } from '../export/exportService';
import { PageService, type IPageContext } from './pageService';
import { AnnotationService, type IAnnotationContext } from './annotationService';
import { ToolModeService, type IToolModeContext } from './toolModeService';
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
import { CodeModalManager, type ICodeModalContext } from '../ui/codeModalManager';
import { WatermarkPanel, type IWatermarkContext } from '../ui/watermarkPanel';
import { BatesPanel } from '../ui/batesPanel';
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

  // ── Signature accessors (IPlacementContext) ───────────────────────────────
  get currentSignature(): string | null { return this._signatureManager.currentSignature; }
  set currentSignature(v: string | null) { this._signatureManager.currentSignature = v; }
  get signatureNatural(): { w: number; h: number } | null { return this._signatureManager.signatureNatural; }
  set signatureNatural(v: { w: number; h: number } | null) { this._signatureManager.signatureNatural = v; }
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
  handleTextInput(element: TextElement, input: HTMLInputElement | HTMLTextAreaElement): void { this._undoRedoController.handleTextInput(element, input); }

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

  // ── IFindBarContext accessors ─────────────────────────────────────────────
  get searchManager() { return this._searchManager; }
  get textSearch() { return this._textSearch; }
  addHighlightForMatch(match: { x: number; y: number; width: number; height: number }, pageId: string): void {
    const hlEl = new HighlightElement(match.x, match.y, match.width, match.height, pageId);
    this.historyManager.execute(new AddElementCmd(this.elements, hlEl));
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
  resetDocumentModel(): void { this.documentModel = new DocumentModel(); this.renderer.setModel(this.documentModel); }
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
      onDownloadImage: (index) => this.downloadPageAsImage(index),
    });
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

  // ── Find bar (delegated to FindBarController) ───────────────────────────
  _openFindBar(): void { this._findBarController.open(); }
  _closeFindBar(): void { this.closeFindBar(); }
  _search(): Promise<void> { return this._findBarController.search(); }
  _nextMatch(): void { this._findBarController.nextMatch(); }
  _prevMatch(): void { this._findBarController.prevMatch(); }
  _highlightCurrentMatch(): void { this._findBarController.highlightCurrentMatch(); }

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

  setMode(mode: ToolMode): void { this._toolModeService.setMode(mode); }
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
  }
  closeOcrModal(): void { this.ui.ocrModal.classList.remove('active'); }
  async runOcr(): Promise<void> {
    const lang = this.ui.ocrLangSelect.value;
    const mode: OcrOutputMode = (this.ui.ocrModeSelect.value === 'visible' || !isEnabled('searchableOcr')) ? 'visible' : 'searchable';
    this.ui.ocrProgressRow.style.display = '';
    this.ui.runOcrModal.disabled = true;
    this.ui.ocrBtn.disabled = true; // M0 #6 — reflect the single-flight gate in the UI
    try {
      const n = await this._ocrHandler.run(lang, mode, ({ progress }) => {
        this.ui.ocrProgress.value = Math.round(progress * 100);
      });
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
    this.ui.signModal.classList.add('active');
  }
  closeSignModal(): void {
    this.ui.signModal.classList.remove('active');
    // Scrub credentials from the DOM when the modal closes.
    this.ui.signPassword.value = '';
    this.ui.signCertInput.value = '';
    this.ui.signGenPassword.value = '';
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
  }

  get effectiveFillColor(): string | undefined { return this._formattingService.effectiveFillColor; }

  _syncFillToggleUI(): void { this._formattingService._syncFillToggleUI(); }

  _updateFormattingToolbar(): void { this._formattingService.updateFormattingToolbar(); }

  handleCanvasClick(e: MouseEvent) { this._canvasClickRouter.handleCanvasClick(e); }

  // ── Formatting actions (layering fix — called by formattingBinder) ─────────
  setFontFamily(value: string): void { this._formattingService.setFontFamily(value); }
  toggleBold(): void { this._formattingService.toggleBold(); }
  toggleItalic(): void { this._formattingService.toggleItalic(); }
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
  downloadPageAsImage(pageIdx?: number): Promise<void> { return this._exportService.downloadPageAsImage(pageIdx); }
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
