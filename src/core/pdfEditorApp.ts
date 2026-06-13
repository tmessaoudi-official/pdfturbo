import * as pdfjsLib from 'pdfjs-dist';
import { PDFRenderer } from '../infra/pdfRenderer';
import { TextElement } from '../elements/textElement';
import { HighlightElement } from '../elements/highlightElement';
import { TextSearchHandler } from '../handlers/textSearchHandler';
import { SignaturePad } from '../utils/signaturePad';
import { InteractionHandler } from '../handlers/interactionHandler';
import { ShapeElement } from '../elements/shapeElement';
import { PDFElement, type ElementJSON } from '../elements/annotationElement';
import { UIController, type AppDOMRefs } from '../ui/uiController';
import { DrawingHandler } from '../handlers/drawingHandler';
import { EraserHandler } from '../handlers/eraserHandler';
import {
  HistoryManager, AddElementCmd, TextEditCmd,
  FillColorCmd, InkFillColorCmd,
  ReplaceSourcePdfBytesCmd,
} from './historyManager';
import { InkLayer } from '../infra/inkLayer';
import { InkLayerHandler } from '../handlers/inkLayerHandler';
import { DocumentModel, type SourcePdf } from './documentModel';
import { PageThumbnailPanel } from '../ui/pageThumbnailPanel';
import { FormFieldOverlay } from '../utils/formFieldOverlay';
import { TextLayerManager } from '../utils/textLayer';
import { trapFocus } from '../utils/focusTrap';
import { TextEditHandler } from '../handlers/textEditHandler';
import { CodeElement } from '../elements/codeElement';
import type { QRStyleOptions, BwipOptions } from '../utils/codeGenerator';

import { bindEvents } from '../ui/eventBinder';
import { ExportService } from '../export/exportService';
import type { IExportContext } from '../export/exportService';
import { PageService, type IPageContext } from './pageService';
import { AnnotationService, type IAnnotationContext } from './annotationService';
import { ToolModeManager, type IToolModeContext } from './toolModeManager';
import { SearchManager } from './searchManager';
import { SessionManager } from './sessionManager';
import { ToastQueue } from '../ui/toastQueue';
import { ErrorReporter } from './errorReporter';
import type { IErrorReporter } from './errorReporter';
import { ProgressManager } from '../ui/progressManager';
import type { IProgressManager } from '../ui/progressManager';
import { ToolbarCustomizer } from '../ui/toolbarCustomizer';
import { LocalLayoutStorage } from '../ui/layoutStorage';
import { CodeModalManager, type ICodeModalContext } from '../ui/codeModalManager';
import { WatermarkPanel, type IWatermarkContext } from '../ui/watermarkPanel';
import { FindBarController, type IFindBarContext } from '../ui/findBarController';
import { DocumentLoader, type IDocumentLoaderContext } from '../ui/documentLoader';
import { ElementLayerRenderer } from '../ui/elementLayerRenderer';
import { PageRenderPipeline } from './pageRenderPipeline';
import { PlacementManager } from '../ui/placementManager';
import { SignatureManager } from './signatureManager';
import { ExportPreviewPanel } from '../ui/exportPreviewPanel';
import type { ToolMode } from '../types/tools';

export type { ToolMode } from '../types/tools';

export class PDFEditorApp implements IExportContext, IPageContext, IAnnotationContext, IToolModeContext, ICodeModalContext, IWatermarkContext, IFindBarContext, IDocumentLoaderContext {
  renderer: PDFRenderer;
  documentModel: DocumentModel;
  elements: PDFElement[] = [];
  interactionHandler: InteractionHandler;
  signaturePad: SignaturePad;
  mode: ToolMode = 'select';
  zoomScale = 1.0;
  selectedElement: PDFElement | null = null;
  historyManager: HistoryManager;
  _textChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingTextBefore: string | null = null;
  private _pendingTextElementId: number | null = null;
  currentFilename: string | null = null;
  uiController: UIController;
  drawingHandler: DrawingHandler;
  eraserHandler: EraserHandler;
  _thumbnailPanel: PageThumbnailPanel | null = null;
  _noFill = true;
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
  private _pageUpdatePending = false;
  _pendingPasswordResolve: ((password: string | null) => void) | null = null;
  _exportPassword: { user: string; owner: string } | null = null;
  inkLayer: InkLayer;
  inkLayerHandler: InkLayerHandler;
  private _inkCanvas: HTMLCanvasElement;
  _isFitMode = true;
  private _clipboard: ElementJSON | null = null;
  get _exportPreviewOpen(): boolean { return this._exportPreviewPanel.isOpen; }
  private _trapCleanup: (() => void) | null = null;
  _pendingModeAfterBlankPage: string | null = null;
  private _textEditHandler = new TextEditHandler();
  private _toastQueue!: ToastQueue;
  private _errorReporter!: IErrorReporter;
  private _progressManager!: IProgressManager;
  private _exportService!: ExportService;
  private _toolbarCustomizer!: ToolbarCustomizer;
  private _pageService!: PageService;
  private _annotationService!: AnnotationService;
  private _toolModeManager!: ToolModeManager;
  private _codeModalManager!: CodeModalManager;
  private _watermarkPanel!: WatermarkPanel;
  private _findBarController!: FindBarController;
  private _documentLoader!: DocumentLoader;
  private _elementLayerRenderer!: ElementLayerRenderer;
  private _pageRenderPipeline!: PageRenderPipeline;
  private _placementManager!: PlacementManager;
  private _signatureManager!: SignatureManager;
  private _exportPreviewPanel!: ExportPreviewPanel;

  // ── Signature accessors (IPlacementContext) ───────────────────────────────
  get currentSignature(): string | null { return this._signatureManager.currentSignature; }
  set currentSignature(v: string | null) { this._signatureManager.currentSignature = v; }
  get signatureNatural(): { w: number; h: number } | null { return this._signatureManager.signatureNatural; }
  set signatureNatural(v: { w: number; h: number } | null) { this._signatureManager.signatureNatural = v; }
  // ── ISignatureContext callbacks ────────────────────────────────────────────
  getTrapCleanup(): (() => void) | null { return this._trapCleanup; }
  setTrapCleanup(fn: (() => void) | null): void { this._trapCleanup = fn; }

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
  handleTextInput(element: TextElement, input: HTMLInputElement | HTMLTextAreaElement): void {
    if (this._pendingTextElementId !== element.id) {
      this._pendingTextBefore = element.text;
      this._pendingTextElementId = element.id;
    }
    element.text = input.value;
    clearTimeout(this._textChangeTimer ?? undefined);
    this._textChangeTimer = setTimeout(() => {
      const before = this._pendingTextBefore;
      const id = this._pendingTextElementId;
      this._pendingTextBefore = null;
      this._pendingTextElementId = null;
      this._textChangeTimer = null;
      if (id !== null && before !== null && before !== element.text) {
        this.historyManager.record(new TextEditCmd(this.elements, id, before, element.text));
      }
      this._autosave();
    }, 500);
  }

  // ── IExportContext accessors ───────────────────────────────────────────────
  get exportPassword(): { user: string; owner: string } | null { return this._exportPassword; }
  get formValues(): Record<string, Record<string, string>> { return this._formValues; }
  renderCurrentPage(): Promise<void> { return this._renderCurrentPage(); }
  cleanEmptyTextElements(): void { this._cleanEmptyTextElements(); }

  get ui(): AppDOMRefs { return this.uiController.refs; }
  get reportError(): IErrorReporter { return this._errorReporter; }
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
  autosave(): void { this._autosave(); }
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

  constructor() {
    this.documentModel = new DocumentModel();
    this.renderer = new PDFRenderer(document.getElementById('pdfCanvas') as HTMLCanvasElement);
    this.renderer.setModel(this.documentModel);
    this.elements = [];
    this.uiController = new UIController();
    this._toastQueue = new ToastQueue(document.getElementById('toast') as HTMLElement);
    this._errorReporter = new ErrorReporter(this._toastQueue);
    this._progressManager = new ProgressManager(
      document.getElementById('progress-overlay') as HTMLElement,
      document.getElementById('progress-label') as HTMLElement,
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
    this._textChangeTimer = null;
    this.currentFilename = null;
    this._signatureManager = new SignatureManager(this);
    this._exportService = new ExportService(this);
    this._pageService = new PageService(this);
    this._annotationService = new AnnotationService(this);
    this._toolModeManager = new ToolModeManager(this);
    this._codeModalManager = new CodeModalManager(this);
    this._watermarkPanel = new WatermarkPanel(this);
    this._findBarController = new FindBarController(this);
    this._documentLoader = new DocumentLoader(this);
    this._elementLayerRenderer = new ElementLayerRenderer(this);
    this._pageRenderPipeline = new PageRenderPipeline(this);
    this._placementManager = new PlacementManager(this);
    this._exportPreviewPanel = new ExportPreviewPanel(this);
    this._toolbarCustomizer = new ToolbarCustomizer(
      document.querySelector('.toolbar-row1') as HTMLElement,
      new LocalLayoutStorage(),
    );
    this._toolbarCustomizer.restore();
    this._toolbarCustomizer.enableDragDrop();
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

  // ── Find bar (delegated to FindBarController) ───────────────────────────
  _openFindBar(): void { this._findBarController.open(); }
  _closeFindBar(): void { this.closeFindBar(); }
  async _search(): Promise<void> { return this._findBarController.search(); }
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
  async _handleAddPdfUpload(e: Event): Promise<void> { return this._pageService.addPages(e); }
  _deletePage(pageId: string): void { this._pageService.deletePage(pageId); }
  _reorderPages(newOrder: string[]): void { this._pageService.reorderPages(newOrder); }
  async _rotatePage(pageId: string, delta: number): Promise<void> { return this._pageService.rotatePage(pageId, delta); }


  async _onPageStructureChange(): Promise<void> {
    if (this._pageUpdatePending) return;
    this._pageUpdatePending = true;
    try {
      await this._renderCurrentPage();
      await this._thumbnailPanel?.render();
      this._thumbnailPanel?.updateActive();
      this.selectElement(null);
      this.updatePageInfo();
      this.rebuildElementLayer();
      this._autosave();
    } finally {
      this._pageUpdatePending = false;
    }
  }

  // ── Undo / Redo ───────────────────────────────────────────────
  private _cancelPendingTextEdit(): void {
    if (this._textChangeTimer !== null) {
      clearTimeout(this._textChangeTimer);
      this._textChangeTimer = null;
      this._pendingTextBefore = null;
      this._pendingTextElementId = null;
    }
  }

  undo() {
    this._cancelPendingTextEdit();
    if (this.historyManager.undo()) {
      this.selectedElement = null;
      this._renderCurrentPage().then(() => {
        this.rebuildElementLayer();
        this._thumbnailPanel?.updateActive();
        this.updatePageInfo();
      }).catch((err: unknown) => {
        this._errorReporter.error('toast.renderFailedUndo', err);
      });
      this._updateFormattingToolbar();
      this._autosave();
    }
  }

  redo() {
    this._cancelPendingTextEdit();
    if (this.historyManager.redo()) {
      this.selectedElement = null;
      this._renderCurrentPage().then(() => {
        this.rebuildElementLayer();
        this._thumbnailPanel?.updateActive();
        this.updatePageInfo();
      }).catch((err: unknown) => {
        this._errorReporter.error('toast.renderFailedRedo', err);
      });
      this._updateFormattingToolbar();
      this._autosave();
    }
  }

  // ── True text edit: swap a source PDF's bytes after content-stream surgery ──
  // Called by TextEditHandler. Loads the edited bytes into a fresh pdfjs doc,
  // commits an undoable command, then re-renders page + thumbnail.
  async _applySourcePdfEdit(src: SourcePdf, newBytes: Uint8Array, pageId: string): Promise<void> {
    // pdf.js transfers the ArrayBuffer — give it a copy, keep newBytes intact
    const newDoc = await pdfjsLib.getDocument({ data: newBytes.slice(0) }).promise;
    const before = { bytes: src.bytes, doc: src.doc };
    const after = { bytes: newBytes, doc: newDoc };
    const onUpdate = () => {
      this._thumbnailPanel?.invalidateThumb(pageId);
      void this._thumbnailPanel?.render();
      this._autosave();
    };
    this.historyManager.execute(new ReplaceSourcePdfBytesCmd(src, before, after, onUpdate));
    // Initial render (undo/redo paths re-render the page via their own wrappers)
    await this._renderCurrentPage();
    this.rebuildElementLayer();
  }

  // ── Autosave (IndexedDB) ──────────────────────────────────────
  _autosave() {
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
    this.uiController.toggleSettings(show);
    if (this.ui.settingsPanel.classList.contains('active')) {
      this._trapCleanup?.();
      this._trapCleanup = trapFocus(
        this.ui.settingsPanel.querySelector('.help-content') as HTMLElement,
        this.ui.settingsBtn,
      );
    } else {
      this._trapCleanup?.();
      this._trapCleanup = null;
    }
  }

  _resetToolbarLayout(): void {
    this._toolbarCustomizer.reset();
  }

  _toggleHelp(show?: boolean) {
    this.uiController.toggleHelp(show);
    if (this.ui.helpModal.classList.contains('active')) {
      this._trapCleanup?.();
      this._trapCleanup = trapFocus(
        this.ui.helpModal.querySelector('.help-content') as HTMLElement,
        this.ui.helpBtn,
      );
    } else {
      this._trapCleanup?.();
      this._trapCleanup = null;
    }
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

  async _loadDocument(e: Event): Promise<void> { return this._documentLoader.load(e); }

  enableUI() { this.uiController.enableUI(); }

  /** Re-render dynamic DOM strings after a language change. */
  onLanguageChanged(): void {
    this.uiController.updateModeButtons(this.mode);
    if (this.documentModel?.pageCount > 0) {
      this._thumbnailPanel?.render();
    }
  }

  _cleanEmptyTextElements() {
    const focused = document.activeElement;
    const before = this.elements.length;
    const keep = this.elements.filter(e => {
      if (!(e.type === 'text' && !(e as TextElement).text)) return true;
      const input = document.querySelector(`[data-id="${e.id}"] input, [data-id="${e.id}"] textarea`);
      return input ? input === focused : true;
    });
    if (keep.length < before) {
      this.elements.splice(0, this.elements.length, ...keep);
      this.rebuildElementLayer();
    }
  }

  setMode(mode: ToolMode): void { this._toolModeManager.setMode(mode); }
  _isShapeMode(): boolean { return this._toolModeManager.isShapeMode(); }

  openSignatureModal() { this._signatureManager.openModal(); }
  closeSignatureModal() { this._signatureManager.closeModal(); }
  saveSignature() { this._signatureManager.save(); }

  // ── Code modal (delegated to CodeModalManager) ──────────────────────────
  openCodeModal(el?: CodeElement): void { this._codeModalManager.open(el); }
  closeCodeModal(): void { this._codeModalManager.close(); }
  async saveCodeModal(): Promise<void> { return this._codeModalManager.save(); }
  _syncCodeOptionsVisibility(): void { this._codeModalManager.syncVisibility(); }
  _triggerCodePreview(delay?: number): void { this._codeModalManager.triggerPreview(delay); }

  selectElement(element: PDFElement | null) {
    if (this.selectedElement === element) { this._updateFormattingToolbar(); return; }
    this._cleanEmptyTextElements();
    this.selectedElement = element;
    this.rebuildElementLayer();
    this._updateFormattingToolbar();
    this._updateCopyPasteBtns();
  }

  get effectiveFillColor(): string | undefined {
    return this._noFill ? undefined : this.ui.fillColorInput.value;
  }

  _syncFillToggleUI(): void {
    const noFill = this._noFill;
    this.ui.fillNoneBtn.classList.toggle('active', noFill);
    this.ui.fillNoneBtn.setAttribute('aria-pressed', String(noFill));
    this.ui.fillColorInput.style.opacity = noFill ? '0.35' : '1';
  }

  _updateFormattingToolbar() {
    this.uiController.updateFormattingToolbar(this.selectedElement, this.mode);
    // Sync _noFill with selected shape's fill state
    if (this.selectedElement?.type === 'shape') {
      const she = this.selectedElement as ShapeElement;
      const isFillable = she.shapeType === 'rect' || she.shapeType === 'ellipse' || she.shapeType === 'freehand';
      if (isFillable) this._noFill = she.fillColor === undefined;
    }
    this._syncFillToggleUI();
  }

  handleCanvasClick(e: MouseEvent) {
    if (this._placementManager.consumeSkipNextClick()) return;
    if (this._isShapeMode()) return;
    if (this.mode === 'addText' || (this.mode === 'addImage' && this._placementManager.hasPendingImageSrc()) || this.mode === 'addComment' || (this.mode === 'addSignature' && this.currentSignature) || this.mode === 'addCode') return;
    if (this.mode === 'fillBucket') {
      this._handleFillBucketClick(e);
    } else if (this.mode === 'editText') {
      void this._textEditHandler.handleCanvasClick(e, this);
    } else {
      this.selectElement(null);
    }
  }

  private _handleFillBucketClick(e: MouseEvent): void {
    const pageId = this.documentModel.currentPage?.id;
    if (!pageId) return;
    const rect = this.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.zoomScale;
    const y = (e.clientY - rect.top) / this.zoomScale;
    const newColor = this.effectiveFillColor;

    // Check SVG shape elements first (rect/ellipse/arrow)
    const shapeTarget = [...this.elements]
      .reverse()
      .find(el => el.pageId === pageId && el.type === 'shape' &&
        this._hitTestShape(el as ShapeElement, x, y));
    if (shapeTarget) {
      this.historyManager.execute(new FillColorCmd(this.elements, shapeTarget.id, (shapeTarget as ShapeElement).fillColor, newColor));
      this._autosave();
      this.rebuildElementLayer();
      return;
    }

    // Check ink strokes (freehand pen) — fill inner area (fillColor), not stroke line (color)
    if (newColor === undefined) return;
    const strokes = this.inkLayer.getStrokes(pageId);
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.type !== 'ink') continue;
      // Match: click inside the enclosed polygon OR near the stroke line
      const insidePoly = this._ptInPolygon(x, y, s.points);
      let nearStroke = false;
      if (!insidePoly) {
        const threshold = s.width / 2 + 4;
        for (let j = 0; j < s.points.length - 1; j++) {
          if (this._ptSegDist(x, y, s.points[j].x, s.points[j].y, s.points[j + 1].x, s.points[j + 1].y) <= threshold) {
            nearStroke = true; break;
          }
        }
      }
      if (insidePoly || nearStroke) {
        this.historyManager.execute(new InkFillColorCmd(this.inkLayer, pageId, i, s.fillColor, newColor, () => this.renderInkLayer()));
        this._autosave();
        return;
      }
    }
  }

  private _hitTestShape(shape: ShapeElement, x: number, y: number): boolean {
    if (shape.shapeType === 'freehand') {
      const threshold = shape.strokeWidth / 2 + 4;
      const pts = shape.points;
      for (let i = 0; i < pts.length - 1; i++) {
        if (this._ptSegDist(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= threshold)
          return true;
      }
      return false;
    }
    return x >= shape.x && x <= shape.x + shape.width &&
           y >= shape.y && y <= shape.y + shape.height;
  }

  private _ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private _ptInPolygon(px: number, py: number, points: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }


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

    async _goToPageIndex(index: number): Promise<void> { return this._pageService.goToPageIndex(index); }

  async _goToPage(n: number): Promise<void> {
    await this._goToPageIndex(n - 1);
  }

  async prevPage() { await this._goToPageIndex(this.documentModel.currentPageIndex - 1); }
  async nextPage() { await this._goToPageIndex(this.documentModel.currentPageIndex + 1); }

  updatePageInfo() {
    this.uiController.updatePageInfo(this.documentModel.currentPageIndex + 1, this.documentModel.pageCount);
  }

    async applyZoom(newScale: number): Promise<void> { return this._pageService.applyZoom(newScale); }

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
  async downloadPDF(): Promise<void> { return this._exportService.downloadPDF(); }
  async downloadPage(pageIdx: number): Promise<void> { return this._exportService.downloadPage(pageIdx); }
  async downloadPageAsImage(pageIdx?: number): Promise<void> { return this._exportService.downloadPageAsImage(pageIdx); }
  async exportAsDocx(): Promise<void> { return this._exportService.exportAsDocx(); }
  async exportAsMarkdown(): Promise<void> { return this._exportService.exportAsMarkdown(); }

  _updatePlacementGhost(e: PointerEvent): void { this._placementManager.updatePlacementGhost(e); }
}
