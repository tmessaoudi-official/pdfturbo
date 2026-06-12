import * as pdfjsLib from 'pdfjs-dist';
import { PDFRenderer } from '../infra/pdfRenderer';
import { TextElement } from '../elements/textElement';
import { SignatureElement } from '../elements/signatureElement';
import { ImageElement } from '../elements/imageElement';
import { HighlightElement } from '../elements/highlightElement';
import { TextSearchHandler } from '../handlers/textSearchHandler';
import { SignaturePad } from '../utils/signaturePad';
import { InteractionHandler } from '../handlers/interactionHandler';
import { ShapeElement } from '../elements/shapeElement';
import { PDFElement, type ElementJSON } from '../elements/annotationElement';
import { ElementFactory } from '../utils/elementFactory';
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
import { DocumentModel, type SourcePdf, type WatermarkSettings } from './documentModel';
import { PageThumbnailPanel } from '../ui/pageThumbnailPanel';
import { loadState, clearState } from '../infra/storage';
import { FormFieldOverlay } from '../utils/formFieldOverlay';
import { TextLayerManager } from '../utils/textLayer';
import { CommentElement } from '../elements/commentElement';
import { t } from '../utils/i18n';
import { trapFocus } from '../utils/focusTrap';
import { TextEditHandler } from '../handlers/textEditHandler';
import { CodeElement } from '../elements/codeElement';
import { generateCodeDataUrl, getCodeFormat, type QRStyleOptions, type BwipOptions } from '../utils/codeGenerator';
import { transformPoint, hexToRgbValues } from '../utils/geometry';
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

export type ToolMode = 'select' | 'addText' | 'addSignature' | 'addImage' | 'addCode' | 'drawArrow' | 'drawRect' | 'drawEllipse' | 'drawFreehand' | 'drawHighlight' | 'addComment' | 'drawRedaction' | 'drawErase' | 'editText' | 'fillBucket';

export class PDFEditorApp implements IExportContext, IPageContext, IAnnotationContext, IToolModeContext {
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
  currentSignature: string | null = null;
  uiController: UIController;
  drawingHandler: DrawingHandler;
  eraserHandler: EraserHandler;
  _thumbnailPanel: PageThumbnailPanel | null = null;
  private _pendingImageSrc: string | null = null;
  private _pendingImageNatural: { w: number; h: number } | null = null;
  private _signatureNatural: { w: number; h: number } | null = null;
  private _pendingCodeDataUrl: string | null = null;
  private _pendingCodeOptions: { codeType: string; data: string; qrStyle: QRStyleOptions | null; bwipOpts: BwipOptions | null } | null = null;
  private _pendingCodeNatural: { w: number; h: number } | null = null;
  private _codeModalEditingId: number | null = null;
  private _codeModalGen = 0;
  private _codePreviewDebounce: ReturnType<typeof setTimeout> | null = null;
  _qrLogoDataUrl: string | null = null;
  private _skipNextClick = false;
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
  _exportPreviewOpen = false;
  private _trapCleanup: (() => void) | null = null;
  _pendingModeAfterBlankPage: string | null = null;
  private _textEditHandler = new TextEditHandler();
  private _placementGhost: HTMLDivElement | null = null;
  private _toastQueue!: ToastQueue;
  private _errorReporter!: IErrorReporter;
  private _progressManager!: IProgressManager;
  private _exportService!: ExportService;
  private _toolbarCustomizer!: ToolbarCustomizer;
  private _pageService!: PageService;
  private _annotationService!: AnnotationService;
  private _toolModeManager!: ToolModeManager;

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
  imagesToPdf(files: File[]): Promise<{ bytes: Uint8Array; name: string }> { return this._imagesToPdf(files); }
  clearSearchMatches(): void { this._clearSearchMatches(); }
  clearSearchManagerState(): void { this._searchManager.clear(); }
  hasFindBarOpen(): boolean { return this.ui.findBar.style.display !== 'none'; }
  hasFindInput(): boolean { return Boolean(this.ui.findInput.value); }
  clearFindCount(): void { this.ui.findCount.textContent = ''; }
  searchIfActive(): void { this._search(); }
  refreshExportPreviewIfOpen(): void { if (this._exportPreviewOpen) this._showExportPreview(); }
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
  hidePlacementGhost(): void { if (this._placementGhost) this._placementGhost.style.display = 'none'; }
  clearToast(): void { this.uiController.clearToast(); }

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
    this.currentSignature = null;
    this._exportService = new ExportService(this);
    this._pageService = new PageService(this);
    this._annotationService = new AnnotationService(this);
    this._toolModeManager = new ToolModeManager(this);
    this._toolbarCustomizer = new ToolbarCustomizer(
      document.querySelector('.toolbar-row1') as HTMLElement,
      new LocalLayoutStorage(),
    );
    this._toolbarCustomizer.restore();
    this._toolbarCustomizer.enableDragDrop();
    this.setupEventListeners();
    this._initThumbnailPanel();
    this._restoreSession();
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

  // ── Watermark ────────────────────────────────────────────────
  _setupWatermarkPreviewListeners(): void {
    const update = () => this._updateWatermarkPreview();
    this.ui.wmText.addEventListener('input', update);
    this.ui.wmColor.addEventListener('input', update);
    this.ui.wmFontSize.addEventListener('input', () => {
      this.ui.wmFontSizeDisplay.textContent = this.ui.wmFontSize.value;
      update();
    });
    this.ui.wmOpacity.addEventListener('input', () => {
      this.ui.wmOpacityDisplay.textContent = this.ui.wmOpacity.value;
      update();
    });
    this.ui.wmAngle.addEventListener('input', () => {
      this.ui.wmAngleDisplay.textContent = this.ui.wmAngle.value;
      update();
    });
    this.ui.wmDensity.addEventListener('input', () => {
      this.ui.wmDensityDisplay.textContent = this.ui.wmDensity.value;
      update();
    });
  }

  private _updateWatermarkPreview(): void {
    const canvas = this.ui.wmPreviewCanvas;
    const w = canvas.offsetWidth || 300;
    const h = canvas.offsetHeight || 80;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const realFontSize = parseInt(this.ui.wmFontSize.value) || 60;
    // Scale as if the canvas represents an A4 page (842pt tall) for WYSIWYG density.
    const previewScale = h / 842;
    const liveWm: WatermarkSettings = {
      enabled: true,
      text: this.ui.wmText.value || 'WATERMARK',
      color: this.ui.wmColor.value,
      fontSize: realFontSize,
      opacity: parseInt(this.ui.wmOpacity.value) / 100,
      angle: parseInt(this.ui.wmAngle.value),
      density: parseInt(this.ui.wmDensity.value) || 3,
    };
    this._drawWatermarkOnCanvas(ctx, w, h, liveWm, previewScale);
  }

  _openWatermarkModal(): void {
    const wm = this.documentModel.watermark;
    this.ui.wmEnabled.checked = wm.enabled;
    this.ui.wmText.value = wm.text;
    this.ui.wmColor.value = wm.color;
    this.ui.wmFontSize.value = String(wm.fontSize);
    this.ui.wmFontSizeDisplay.textContent = String(wm.fontSize);
    const opPct = Math.round(wm.opacity * 100);
    this.ui.wmOpacity.value = String(opPct);
    this.ui.wmOpacityDisplay.textContent = String(opPct);
    this.ui.wmAngle.value = String(wm.angle);
    this.ui.wmAngleDisplay.textContent = String(wm.angle);
    const density = wm.density ?? 3;
    this.ui.wmDensity.value = String(density);
    this.ui.wmDensityDisplay.textContent = String(density);
    this.ui.watermarkModal.classList.add('active');
    this._updateWatermarkPreview();
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      this.ui.watermarkModal.querySelector('.watermark-content') as HTMLElement,
      this.ui.watermarkBtn,
    );
  }

  _closeWatermarkModal(): void {
    this.ui.watermarkModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }

  _applyWatermark(): void {
    this.documentModel.watermark = {
      enabled: this.ui.wmEnabled.checked,
      text: this.ui.wmText.value || 'WATERMARK',
      color: this.ui.wmColor.value,
      fontSize: parseInt(this.ui.wmFontSize.value) || 60,
      opacity: parseInt(this.ui.wmOpacity.value) / 100,
      angle: parseInt(this.ui.wmAngle.value),
      density: parseInt(this.ui.wmDensity.value) || 3,
    };
    this._closeWatermarkModal();
    this._syncWatermarkBtn();
    this._autosave();
    this._errorReporter.info(this.documentModel.watermark.enabled ? 'toast.watermarkEnabled' : 'toast.watermarkDisabled');
    if (this._exportPreviewOpen) this._showExportPreview();
  }

  private _syncWatermarkBtn(): void {
    this.ui.watermarkBtn.classList.toggle('active', this.documentModel.watermark.enabled);
  }

  // ── Find bar ─────────────────────────────────────────────────
  _openFindBar(): void {
    this.ui.findBar.style.display = '';
    this.ui.findInput.focus();
    this.ui.findInput.select();
    if (this.ui.findInput.value) this._search();
  }

  _closeFindBar(): void {
    this.ui.findBar.style.display = 'none';
    this._clearSearchMatches();
    this._searchManager.clear();
    this.ui.findCount.textContent = '';
  }

  async _search(): Promise<void> {
    this._clearSearchMatches();
    this._searchManager.clear();
    const query = this.ui.findInput.value;
    const settled = await this._searchManager.run(query, {
      documentModel: this.documentModel,
      elements: this.elements,
      textSearchHandler: this._textSearch,
      zoomScale: this.zoomScale,
    });
    if (!settled) return; // superseded by a newer call
    if (this._searchManager.count > 0) this._showSearchMatches();
    this._updateFindCount();
  }

  _nextMatch(): void {
    if (!this._searchManager.count) return;
    this._searchManager.next();
    this._showSearchMatches();
    this._updateFindCount();
  }

  _prevMatch(): void {
    if (!this._searchManager.count) return;
    this._searchManager.prev();
    this._showSearchMatches();
    this._updateFindCount();
  }

  _highlightCurrentMatch(): void {
    const match = this._searchManager.currentMatch;
    const pageId = this.documentModel.currentPage?.id;
    if (!match || !pageId) return;
    const hlEl = new HighlightElement(match.x, match.y, match.width, match.height, pageId);
    this.historyManager.execute(new AddElementCmd(this.elements, hlEl));
    this._autosave();
    this.rebuildElementLayer();
    this._showSearchMatches(); // re-render match overlays after rebuildElementLayer clears elements
    this._errorReporter.info('toast.highlightAdded');
  }

  private _showSearchMatches(): void {
    this._clearSearchMatches();
    const offset = { left: this.ui.canvas.offsetLeft, top: this.ui.canvas.offsetTop };
    let activeDiv: Element | null = null;
    this._searchManager.matches.forEach((match, i) => {
      const isActive = i === this._searchManager.currentIndex;
      const div = document.createElement('div');
      div.className = 'search-match' + (isActive ? ' search-match-active' : '');
      Object.assign(div.style, {
        position: 'absolute',
        left: `${offset.left + match.x * this.zoomScale}px`,
        top: `${offset.top + match.y * this.zoomScale}px`,
        width: `${match.width * this.zoomScale}px`,
        height: `${match.height * this.zoomScale}px`,
        pointerEvents: 'none',
        zIndex: '25',
      });
      this.ui.container.appendChild(div);
      if (isActive) activeDiv = div;
    });
    if (activeDiv) (activeDiv as Element).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private _clearSearchMatches(): void {
    this.ui.container.querySelectorAll('.search-match').forEach(el => el.remove());
  }

  private _updateFindCount(): void {
    if (!this._searchManager.count) {
      this.ui.findCount.textContent = this.ui.findInput.value ? '0 / 0' : '';
    } else {
      this.ui.findCount.textContent = `${this._searchManager.currentIndex + 1} / ${this._searchManager.count}`;
    }
  }

  // ── Image handling ───────────────────────────────────────────
  _handleImageFileSelect(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file || !this.documentModel.currentPage) return;
    if (!file.type.startsWith('image/')) {
      this._errorReporter.warn('toast.selectImageFile');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        this._pendingImageNatural = { w: img.naturalWidth, h: img.naturalHeight };
        this._pendingImageSrc = src;
        this.setMode('addImage');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  addImageAtPosition(e: MouseEvent): void {
    const src = this._pendingImageSrc;
    const pageId = this.documentModel.currentPage?.id;
    if (!src || !pageId) return;
    this._pendingImageSrc = null;

    const rect = this.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.zoomScale;
    const y = (e.clientY - rect.top) / this.zoomScale;
    const imgEl = new ImageElement(x - 100, y - 75, 200, 150, pageId, src);
    this.historyManager.execute(new AddElementCmd(this.elements, imgEl));
    this._autosave();
    this.setMode('select');
    this.rebuildElementLayer();
    this.selectElement(imgEl);
  }

  _commitPlacement(mode: 'addText' | 'addImage' | 'addComment' | 'addSignature' | 'addCode', x: number, y: number, w: number, h: number): void {
    const pageId = this.documentModel.currentPage?.id;
    if (!pageId) return;
    this._skipNextClick = true;

    if (mode === 'addText') {
      const fw = w < 10 ? 200 : w;
      const fh = h < 10 ? 40 : h;
      const options = {
        fontSize: parseInt(this.ui.fontSizeInput.value),
        color: this.ui.colorInput.value,
        width: fw,
        height: fh,
      };
      const textEl = new TextElement(x, y, pageId, options);
      this.historyManager.execute(new AddElementCmd(this.elements, textEl));
      this._autosave();
      this.rebuildElementLayer();
      const inputEl = this.ui.container.querySelector(
        `[data-id='${textEl.id}'] input, [data-id='${textEl.id}'] textarea`
      ) as HTMLInputElement | null;
      if (inputEl) {
        (inputEl as HTMLElement).style.pointerEvents = 'auto';
        inputEl.focus();
      }
      this.setMode('select');
      this.selectElement(textEl);
      const freshInput = this.ui.container.querySelector(
        `[data-id='${textEl.id}'] input, [data-id='${textEl.id}'] textarea`
      ) as HTMLInputElement | null;
      freshInput?.focus();

    } else if (mode === 'addImage') {
      const src = this._pendingImageSrc;
      if (!src) return;
      this._pendingImageSrc = null;
      const nat = this._pendingImageNatural;
      this._pendingImageNatural = null;

      const fw = w < 10 ? 200 : w;
      const fh = w < 10
        ? (nat ? Math.round(200 * nat.h / nat.w) : 150)
        : (nat ? Math.round(fw * nat.h / nat.w) : h);

      const imgEl = new ImageElement(x, y, fw, fh, pageId, src);
      this.historyManager.execute(new AddElementCmd(this.elements, imgEl));
      this._autosave();
      this.setMode('select');
      this.rebuildElementLayer();
      this.selectElement(imgEl);

    } else if (mode === 'addComment') {
      const fw = w < 10 ? 200 : w;
      const fh = h < 10 ? 120 : h;
      const commentEl = new CommentElement(x, y, pageId, { width: fw, height: fh });
      this.historyManager.execute(new AddElementCmd(this.elements, commentEl));
      this._autosave();
      this.setMode('select');
      this.rebuildElementLayer();
      this.selectElement(commentEl);

    } else if (mode === 'addCode') {
      const dataUrl = this._pendingCodeDataUrl;
      const opts = this._pendingCodeOptions;
      if (!dataUrl || !opts) return;
      this._pendingCodeDataUrl = null;
      this._pendingCodeOptions = null;
      const nat = this._pendingCodeNatural;
      this._pendingCodeNatural = null;

      const fw = w < 10 ? 200 : w;
      const fmt = getCodeFormat(opts.codeType);
      const fh = fmt?.squareOutput
        ? fw
        : nat ? Math.round(fw * nat.h / nat.w) : (h < 10 ? 80 : h);

      const codeEl = new CodeElement(x, y, pageId, { ...opts, bwipOpts: opts.bwipOpts ?? null }, dataUrl, { w: fw, h: fh });
      this.historyManager.execute(new AddElementCmd(this.elements, codeEl));
      this._autosave();
      this.setMode('select');
      this.rebuildElementLayer();
      this.selectElement(codeEl);

    } else {
      const sig = this.currentSignature;
      if (!sig) return;
      this.currentSignature = null;
      this.ui.addSignatureBtn.classList.remove('active');
      const nat = this._signatureNatural;
      this._signatureNatural = null;

      const fw = w < 10 ? 200 : w;
      const fh = w < 10
        ? (nat ? Math.round(200 * nat.h / nat.w) : 80)
        : (nat ? Math.round(fw * nat.h / nat.w) : h);

      const sigEl = new SignatureElement(x, y, pageId, sig, { width: fw, height: fh });
      this.historyManager.execute(new AddElementCmd(this.elements, sigEl));
      this._autosave();
      this.setMode('select');
      this.rebuildElementLayer();
      this.selectElement(sigEl);
    }
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

  private _askRestoreSession(): Promise<boolean> {
    return new Promise(resolve => {
      const dialog = this.ui.restoreDialog;
      dialog.style.display = '';
      const onYes = () => { cleanup(); resolve(true); };
      const onNo  = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        dialog.style.display = 'none';
        this.ui.restoreYesBtn.removeEventListener('click', onYes);
        this.ui.restoreNoBtn.removeEventListener('click', onNo);
      };
      this.ui.restoreYesBtn.addEventListener('click', onYes);
      this.ui.restoreNoBtn.addEventListener('click', onNo);
      this.ui.restoreYesBtn.focus();
    });
  }

  private async _restoreSession(): Promise<void> {
    const state = await loadState();
    if (!state?.pages?.length) return;
    if (this._isLoading) return;
    const shouldRestore = await this._askRestoreSession();
    if (!shouldRestore) { await clearState(); return; }
    this._isLoading = true;
    const restoreProg = this._progressManager.begin('progress.restoringSession');
    try {
      for (const sp of state.sourcePdfs) {
        const spBytes = sp.bytes instanceof Uint8Array ? sp.bytes : new Uint8Array(sp.bytes);
        const bytesToStore = spBytes.slice(0); // pdf.js transfers the ArrayBuffer; copy first
        const doc = await pdfjsLib.getDocument({ data: spBytes }).promise;
        const src = this.documentModel.addSourcePdf(doc, bytesToStore, sp.name);
        // Override auto-generated id with the saved one
        this.documentModel.sourcePdfs.delete(src.id);
        src.id = sp.id;
        this.documentModel.sourcePdfs.set(sp.id, src);
      }
      this.documentModel.pages = state.pages ?? [];
      this.documentModel.watermark = state.watermark ?? this.documentModel.watermark;
      this._syncWatermarkBtn();
      this.documentModel.currentPageIndex = Math.max(0, Math.min(
        state.currentPageIndex ?? 0, this.documentModel.pages.length - 1
      ));
      // Set renderer.pdfDoc to the current page's source (not necessarily the first source)
      const currentSrc = this.documentModel.sourcePdfs.get(
        this.documentModel.currentPage?.sourcePdfId ?? ''
      );
      if (currentSrc) this.renderer.pdfDoc = currentSrc.doc;

      const restored = (state.elements ?? [])
        .map(d => ElementFactory.fromJSON(d as Parameters<typeof ElementFactory.fromJSON>[0]))
        .filter(Boolean) as PDFElement[];
      this.elements.push(...restored);
      ElementFactory.syncIdCounter(this.elements);
      this._formValues = state.formValues ?? {};
      if (state.inkData) this.inkLayer.fromJSON(state.inkData);
      this.currentFilename = state.sourcePdfs[0]?.name ?? this.currentFilename;

      // Compute initial scale
      this._isFitMode = true;
      const fitScale = await this.renderer.computeFitScale(this.ui.container.clientWidth);
      const isMobile = window.innerWidth <= 640;
      this.zoomScale = isMobile ? Math.max(fitScale, 0.65) : fitScale;
      this.renderer.setScale(this.zoomScale);
      this.ui.zoomDisplay.textContent = Math.round(this.zoomScale * 100) + '%';

      // BUG-38: guard against empty pages after restore
      if (!this.documentModel.pages.length || !this.documentModel.currentPage) {
        throw new Error('No valid pages in saved session');
      }

      await this._renderCurrentPage();
      this.enableUI();
      this._enableFileMenuDocItems();

      (document.getElementById('emptyState') as HTMLElement).style.display = 'none';
      this.ui.pageThumbnailContainer.style.display = '';
      await this._thumbnailPanel?.render();
      this.updatePageInfo();
      this.rebuildElementLayer();
      this._errorReporter.info('toast.sessionRestored');
      restoreProg.done();
    } catch (err) {
      restoreProg.failed();
      // BUG-19: reset to clean state on partial restore failure
      this._errorReporter.silent(err, '_restoreSession');
      this.documentModel = new DocumentModel();
      this.renderer.setModel(this.documentModel);
      this.elements = [];
      this._thumbnailPanel = null;
      this._errorReporter.error('toast.sessionRestoreFailed', err);
    } finally {
      this._isLoading = false;
    }
  }

  _clearSave() {
    this._closeDocument();
    this._errorReporter.info('toast.sessionCleared');
  }

  private _promptPassword(isRetry = false): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const modal = document.getElementById('pdfPasswordModal') as HTMLElement;
      const input = document.getElementById('pdfPasswordInput') as HTMLInputElement;
      const error = document.getElementById('pdfPasswordError') as HTMLElement;
      input.value = '';
      error.style.display = isRetry ? 'block' : 'none';
      modal.style.display = 'flex';
      input.focus();
      this._pendingPasswordResolve = resolve;
    });
  }

  _openBlankPageModal(): void {
    const modal = document.getElementById('blankPageModal') as HTMLElement;
    if (!modal) return;
    modal.style.display = 'flex';
  }

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

  _closeDocument(): void {
    clearState().catch(() => {});
    this.documentModel = new DocumentModel();
    this.renderer.setModel(this.documentModel);
    this.elements = [];
    this.selectedElement = null;
    this._clipboard = null;
    this._updateCopyPasteBtns();
    this.historyManager.clear();
    this._textSearch.clearCache();
    this._thumbnailPanel = null;
    this._closeFindBar();
    this._searchManager.caseSensitive = false;
    this._searchManager.regex = false;
    this.ui.findCaseSensitive.classList.remove('active');
    this.ui.findRegex.classList.remove('active');
    this.currentFilename = null;

    this.inkLayer.clearAll();
    const ctx = this.renderer.canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.renderer.canvas.width, this.renderer.canvas.height);
    const ictx = this._inkCanvas.getContext('2d');
    if (ictx) ictx.clearRect(0, 0, this._inkCanvas.width, this._inkCanvas.height);

    this.ui.pageThumbnailContainer.style.display = 'none';
    this.ui.pageThumbnailContainer.innerHTML = '';
     
    (document.getElementById('emptyState') as HTMLElement).style.display = 'flex';
    this._disableFileMenuDocItems();
    this.rebuildElementLayer(); // clear annotation DOM nodes after model is reset
    this._errorReporter.info('toast.documentClosed');
  }

  // ── File upload ───────────────────────────────────────────────
  private async _imagesToPdf(imageFiles: File[]): Promise<{ bytes: Uint8Array; name: string }> {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const pdfDoc = await PDFDocument.create();
    for (const file of imageFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';
      const img = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(
        await (async () => {
          // convert non-PNG/JPEG to PNG via canvas
          if (file.type === 'image/png') return bytes;
          return new Promise<Uint8Array>((resolve, reject) => {
            const blob = URL.createObjectURL(file);
            const imgEl = new Image();
            imgEl.onerror = () => { URL.revokeObjectURL(blob); reject(new Error(`Failed to decode image: ${file.name}`)); };
            imgEl.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = imgEl.naturalWidth;
              canvas.height = imgEl.naturalHeight;
              canvas.getContext('2d')?.drawImage(imgEl, 0, 0);
              canvas.toBlob((b) => {
                if (!b) { reject(new Error('canvas.toBlob returned null')); return; }
                b.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
              }, 'image/png');
              URL.revokeObjectURL(blob);
            };
            imgEl.src = blob;
          });
        })()
      );
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const bytes = await pdfDoc.save();
    const baseName = imageFiles.length === 1
      ? imageFiles[0].name.replace(/\.[^.]+$/, '')
      : 'images';
    return { bytes, name: `${baseName}.pdf` };
  }

  async _loadDocument(e: Event) {
    if (this._isLoading) return;
    this._isLoading = true;
    const inputEl = e.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';

    // Route image files through image→PDF conversion
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const pdfFiles  = files.filter(f => f.type === 'application/pdf');
    let file: File;

    if (imageFiles.length > 0 && pdfFiles.length === 0) {
      const convProg = this._progressManager.begin('progress.convertingImages');
      try {
        const { bytes, name } = await this._imagesToPdf(imageFiles);
        file = new File([bytes.buffer as ArrayBuffer], name, { type: 'application/pdf' });
        convProg.done();
      } catch (err) {
        convProg.failed();
        this._errorReporter.error('toast.imageConversionFailed', err);
        this._isLoading = false;
        return;
      }
    } else if (pdfFiles.length === 1 && imageFiles.length === 0) {
      file = pdfFiles[0];
    } else {
      this._errorReporter.warn('toast.imageMixedError');
      this._isLoading = false;
      return;
    }

    const loadProg = this._progressManager.begin('progress.loadingDocument');
    try {
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const bytesToStore = rawBytes.slice(0); // pdf.js transfers the ArrayBuffer; copy first

      // Handle password-protected PDFs with retry loop
      let doc;
      let openPassword: string | undefined;
      let isRetry = false;
      for (;;) {
        try {
          const loadOpts: Record<string, unknown> = { data: rawBytes.slice(0) };
          if (openPassword) loadOpts['password'] = openPassword;
          doc = await pdfjsLib.getDocument(loadOpts).promise;
          break;
        } catch (err) {
          // pdfjs throws PasswordException (name: 'PasswordException') for encrypted PDFs
          const isPasswordError = err instanceof Error && (
            err.name === 'PasswordException' ||
            err.message.toLowerCase().includes('password')
          );
          if (!isPasswordError) throw err;
          const pw = await this._promptPassword(isRetry);
          if (!pw) { loadProg.failed(); this._isLoading = false; return; } // user cancelled
          openPassword = pw;
          isRetry = true;
        }
      }

      // Reset state for new document
      this.documentModel = new DocumentModel();
      this.renderer.setModel(this.documentModel);
      this.elements = [];
      this._formValues = {};
      this._warnedUnsupportedFields = false;
      this._formFieldOverlay.clear();
      this._textLayerManager.clear();
      this._textSearch.clearCache();
      this.historyManager.clear();
      this.selectedElement = null;
      this.currentFilename = file.name;

      // Re-init thumbnail panel with new model
      this.ui.pageThumbnailContainer.innerHTML = '';
      this._thumbnailPanel = new PageThumbnailPanel({
        container: this.ui.pageThumbnailContainer,
        renderer: this.renderer,
        model: this.documentModel,
        onNavigate: (index) => this._goToPageIndex(index),
        onDelete: (pageId) => this._deletePage(pageId),
        onReorder: (newOrder) => this._reorderPages(newOrder),
        onRotate: (pageId, delta) => this._rotatePage(pageId, delta),
        onAddPdf: () => this.ui.addPdfInput.click(),
        onDownload: (index) => this.downloadPage(index),
        onDownloadImage: (index) => this.downloadPageAsImage(index),
      });

      const src = this.documentModel.addSourcePdf(doc, bytesToStore, file.name);
      this.documentModel.addPagesFrom(src.id);
      this.renderer.pdfDoc = doc;

      (document.getElementById('emptyState') as HTMLElement).style.display = 'none';
      this._isFitMode = true;
      const fitScale = await this.renderer.computeFitScale(this.ui.container.clientWidth);
      const isMobile = window.innerWidth <= 640;
      await this.applyZoom(isMobile ? Math.max(fitScale, 0.65) : fitScale);
      this.enableUI();
      this._enableFileMenuDocItems();
      this.ui.pageThumbnailContainer.style.display = '';
      await this._thumbnailPanel.render();
      this.updatePageInfo();
      this.rebuildElementLayer();
      this._autosave();
      loadProg.done();
    } catch (err) {
      loadProg.failed();
      this._errorReporter.error('toast.pdfLoadFailed', err);
    } finally {
      this._isLoading = false;
    }
  }

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

  openSignatureModal() {
    this.ui.signatureModal.classList.add('active');
    const w = this.ui.signatureCanvas.offsetWidth || 500;
    this.ui.signatureCanvas.width = w;
    this.ui.signatureCanvas.height = Math.round(w * 0.4);
    this.signaturePad.clear();
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      this.ui.signatureModal.querySelector('.signature-content') as HTMLElement,
      this.ui.addSignatureBtn,
    );
  }

  closeSignatureModal() {
    this.ui.signatureModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
    this.setMode('select');
    this.ui.addSignatureBtn.classList.remove('active');
  }

  saveSignature() {
    if (this.signaturePad.isEmpty()) {
      this._errorReporter.warn('toast.drawSignatureFirst');
      return;
    }
    this.currentSignature = this.signaturePad.getDataURL();
    this._signatureNatural = { w: this.ui.signatureCanvas.width, h: this.ui.signatureCanvas.height };
    this.ui.signatureModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
    this.mode = 'addSignature';
    this.ui.addSignatureBtn.classList.add('active');
  }

  // ── Code modal ────────────────────────────────────────────────

  openCodeModal(el?: CodeElement): void {
    this._codeModalEditingId = el?.id ?? null;
    this._qrLogoDataUrl = null;
    // Pre-fill or reset form
    this.ui.codeFormatSelect.value = el?.codeType ?? 'qrcode';
    this.ui.codeDataInput.value = el?.data ?? '';
    const qs = el?.qrStyle;
    this.ui.qrStyledChk.checked = qs?.styled ?? false;
    this.ui.qrEclevelSelect.value = qs?.eclevel ?? 'M';
    this.ui.qrDotStyle.value = qs?.dotType ?? 'square';
    this.ui.qrDotColor.value = qs?.dotColor ?? '#000000';
    this.ui.qrBgColor.value = qs?.bgColor ?? '#ffffff';
    this.ui.qrLogoInput.value = '';
    this._qrLogoDataUrl = qs?.logoSrc ?? null;
    this.ui.qrLogoName.textContent = qs?.logoSrc ? t('modal.code.logoExisting') : '';
    this.ui.qrLogoClearBtn.style.display = qs?.logoSrc ? '' : 'none';
    const bo = (el as CodeElement | undefined)?.bwipOpts;
    this.ui.barcodeShowTextChk.checked = bo?.includetext ?? true;
    this._syncCodeOptionsVisibility();
    // Reset preview
    this.ui.codePreviewImg.style.display = 'none';
    this.ui.codePreviewImg.src = '';
    this.ui.codePreviewStatus.textContent = '';
    this.ui.saveCodeModal.disabled = true;
    const title = el ? t('modal.code.titleEdit') : t('modal.code.title');
    const titleEl = this.ui.codeModal.querySelector('h2');
    if (titleEl) titleEl.textContent = title;
    const saveLabel = el ? t('modal.code.update') : t('modal.code.place');
    this.ui.saveCodeModal.textContent = saveLabel;
    this.ui.codeModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      this.ui.codeModal.querySelector('.code-modal-content') as HTMLElement,
      this.ui.addCodeBtn,
    );
    // Trigger preview if data is pre-filled
    if (this.ui.codeDataInput.value.trim()) this._triggerCodePreview(0);
  }

  closeCodeModal(): void {
    this.ui.codeModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
    // Only switch to select if we were not editing an existing element
    if (this._codeModalEditingId === null && this.mode !== 'addCode') {
      this.setMode('select');
    }
    this._codeModalEditingId = null;
  }

  async saveCodeModal(): Promise<void> {
    const fmt = this.ui.codeFormatSelect.value;
    const data = this.ui.codeDataInput.value.trim();
    if (!data) return;
    const qrStyle = this._getQrStyleOptions();
    const bwipOpts = this._getCodeBwipOpts();
    this.ui.saveCodeModal.disabled = true;
    this.ui.codePreviewStatus.textContent = t('modal.code.generating');
    try {
      const dataUrl = await generateCodeDataUrl(fmt, data, qrStyle, bwipOpts);
      const nat = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = dataUrl;
      });
      const editingId = this._codeModalEditingId;
      this.ui.codeModal.classList.remove('active');
      this._trapCleanup?.();
      this._trapCleanup = null;
      this._codeModalEditingId = null;

      if (editingId !== null) {
        // Edit existing element in-place
        const el = this.elements.find(x => x.id === editingId) as CodeElement | undefined;
        if (el) {
          el.codeType = fmt;
          el.data = data;
          el.qrStyle = qrStyle ?? null;
          el.bwipOpts = bwipOpts;
          el.cachedDataUrl = dataUrl;
          this._autosave();
          this.rebuildElementLayer();
        }
      } else {
        // New placement — switch to addCode mode and wait for drag
        this._pendingCodeDataUrl = dataUrl;
        this._pendingCodeOptions = { codeType: fmt, data, qrStyle: qrStyle ?? null, bwipOpts };
        this._pendingCodeNatural = nat;
        this.setMode('addCode');
      }
    } catch (e) {
      this.ui.codePreviewStatus.textContent = String(e).replace(/^Error:\s*/, '');
      this.ui.saveCodeModal.disabled = false;
    }
  }

  private _getQrStyleOptions(): QRStyleOptions | null {
    if (this.ui.codeFormatSelect.value !== 'qrcode') return null;
    const eclevel = this.ui.qrEclevelSelect.value;
    if (!this.ui.qrStyledChk.checked) {
      return { styled: false, eclevel };
    }
    return {
      styled: true,
      eclevel,
      dotType: this.ui.qrDotStyle.value,
      dotColor: this.ui.qrDotColor.value,
      bgColor: this.ui.qrBgColor.value,
      ...(this._qrLogoDataUrl ? { logoSrc: this._qrLogoDataUrl } : {}),
    };
  }

  private _getCodeBwipOpts(): BwipOptions | null {
    const is2D = ['qrcode', 'datamatrix', 'pdf417', 'azteccode'].includes(this.ui.codeFormatSelect.value);
    if (is2D) return null;
    return { includetext: this.ui.barcodeShowTextChk.checked };
  }

  _syncCodeOptionsVisibility(): void {
    const fmt = this.ui.codeFormatSelect.value;
    const isQr = fmt === 'qrcode';
    const is2D = ['qrcode', 'datamatrix', 'pdf417', 'azteccode'].includes(fmt);
    this.ui.qrStyleSection.style.display = isQr ? '' : 'none';
    this.ui.qrStyleControls.style.display = (isQr && this.ui.qrStyledChk.checked) ? '' : 'none';
    this.ui.barcodeShowTextRow.style.display = is2D ? 'none' : '';
  }

  _triggerCodePreview(delay = 400): void {
    clearTimeout(this._codePreviewDebounce ?? undefined);
    this._codePreviewDebounce = setTimeout(() => void this._runCodePreview(), delay);
  }

  private async _runCodePreview(): Promise<void> {
    const gen = ++this._codeModalGen;
    const fmt = this.ui.codeFormatSelect.value;
    const data = this.ui.codeDataInput.value.trim();
    if (!data) {
      this.ui.codePreviewImg.style.display = 'none';
      this.ui.codePreviewStatus.textContent = '';
      this.ui.saveCodeModal.disabled = true;
      return;
    }
    this.ui.saveCodeModal.disabled = true;
    this.ui.codePreviewStatus.textContent = t('modal.code.generating');
    try {
      const qrStyle = this._getQrStyleOptions();
      const bwipOpts = this._getCodeBwipOpts();
      const dataUrl = await generateCodeDataUrl(fmt, data, qrStyle, bwipOpts);
      if (gen !== this._codeModalGen) return; // stale generation
      this.ui.codePreviewImg.src = dataUrl;
      this.ui.codePreviewImg.style.display = 'block';
      this.ui.codePreviewStatus.textContent = '';
      this.ui.saveCodeModal.disabled = false;
    } catch (e) {
      if (gen !== this._codeModalGen) return;
      this.ui.codePreviewImg.style.display = 'none';
      this.ui.codePreviewStatus.textContent = String(e).replace(/^Error:\s*/, '');
      this.ui.saveCodeModal.disabled = true;
    }
  }

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
    if (this._skipNextClick) { this._skipNextClick = false; return; }
    if (this._isShapeMode()) return;
    if (this.mode === 'addText' || (this.mode === 'addImage' && this._pendingImageSrc) || this.mode === 'addComment' || (this.mode === 'addSignature' && this.currentSignature) || this.mode === 'addCode') return;
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


  addTextAtPosition(e: MouseEvent) {
    const pageId = this.documentModel.currentPage?.id;
    if (!pageId) return;
    const rect = this.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.zoomScale;
    const y = (e.clientY - rect.top) / this.zoomScale;
    const options = { fontSize: parseInt(this.ui.fontSizeInput.value), color: this.ui.colorInput.value };
    const textElement = new TextElement(x, y, pageId, options);
    textElement.x -= textElement.width / 2;
    textElement.y -= textElement.height / 2;
    this.historyManager.execute(new AddElementCmd(this.elements, textElement));
    this._autosave();
    this.rebuildElementLayer();
    // Focus BEFORE selectElement so _cleanEmptyTextElements sees activeElement === input
    const inputEl = this.ui.container.querySelector(
      `[data-id='${textElement.id}'] input, [data-id='${textElement.id}'] textarea`
    ) as HTMLInputElement | null;
    if (inputEl) {
      (inputEl as HTMLElement).style.pointerEvents = 'auto';
      inputEl.focus();
    }
    this.selectElement(textElement);
    // selectElement calls rebuildElementLayer() which recreates DOM — re-query and re-focus
    const freshInput = this.ui.container.querySelector(
      `[data-id='${textElement.id}'] input, [data-id='${textElement.id}'] textarea`
    ) as HTMLInputElement | null;
    freshInput?.focus();
  }


  removeElement(id: number): void { this._annotationService.removeElement(id); }

  rebuildElementLayer() {
    this.ui.container.querySelectorAll('.pdf-element').forEach(el => el.remove());
    const currentPageId = this.documentModel.currentPage?.id;
    if (!currentPageId) return;
    const canvasOffset = { left: this.ui.canvas.offsetLeft, top: this.ui.canvas.offsetTop };
    const currentPageElements = this.elements.filter(el => el.pageId === currentPageId);
    const interactable = this.mode === 'select';
    currentPageElements.forEach(element => {
      const div = element.render(this.ui.container, canvasOffset, this.zoomScale);
      div.style.pointerEvents = interactable ? 'auto' : 'none';
      if (element.rotation) {
        div.style.transform = `rotate(${element.rotation}deg)`;
        div.style.transformOrigin = 'center center';
      }
      if (this.selectedElement && this.selectedElement.id === element.id) div.classList.add('selected');
      div.addEventListener('click', (e) => { e.stopPropagation(); this.selectElement(element); });
      div.addEventListener('pointerdown', (e) => { this.interactionHandler.handlePointerDown(e, element, div); });
      if (element.type === 'code') {
        div.addEventListener('code-element-edit', (e) => {
          const id = (e as CustomEvent<{ id: number }>).detail.id;
          const el = this.elements.find(x => x.id === id) as CodeElement | undefined;
          if (el) this.openCodeModal(el);
        });
      }
      if (element.type === 'text') {
        const input = div.querySelector('input, textarea');
        if (input) {
          const isSelected = this.selectedElement && this.selectedElement.id === element.id;
          if (!isSelected) (input as HTMLElement).style.pointerEvents = 'none';
          input.addEventListener('input', () => {
            const textEl = element as TextElement;
            if (this._pendingTextElementId !== element.id) {
              this._pendingTextBefore = textEl.text;
              this._pendingTextElementId = element.id;
            }
            textEl.text = (input as HTMLInputElement | HTMLTextAreaElement).value;
            clearTimeout(this._textChangeTimer ?? undefined);
            this._textChangeTimer = setTimeout(() => {
              const before = this._pendingTextBefore;
              const id = this._pendingTextElementId;
              this._pendingTextBefore = null;
              this._pendingTextElementId = null;
              this._textChangeTimer = null;
              if (id !== null && before !== null && before !== textEl.text) {
                this.historyManager.record(new TextEditCmd(this.elements, id, before, textEl.text));
              }
              this._autosave();
            }, 500);
          });
        }
      }
      this.ui.container.appendChild(div);
    });
  }

  // ── Ink layer ─────────────────────────────────────────────────
  renderInkLayer(): void {
    const canvas = this.ui.canvas;
    const ic = this._inkCanvas;
    ic.style.left   = canvas.offsetLeft + 'px';
    ic.style.top    = canvas.offsetTop  + 'px';
    ic.style.width  = canvas.offsetWidth  + 'px';
    ic.style.height = canvas.offsetHeight + 'px';
    if (ic.width !== canvas.width || ic.height !== canvas.height) {
      ic.width  = canvas.width;
      ic.height = canvas.height;
    }
    const pageId = this.documentModel.currentPage?.id ?? '';
    this.inkLayer.renderToCanvas(pageId, ic, this.zoomScale);
  }

  renderInkLayerWithLive(points: Array<{ x: number; y: number }>, type: 'ink' | 'erase'): void {
    this.renderInkLayer(); // composite committed strokes first
    if (points.length < 2) return;
    const ctx = this._inkCanvas.getContext('2d');
    if (!ctx) return;
    const sw = parseInt(this.ui.shapeWidth.value) || 3;
    ctx.save();
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (type === 'erase' ? Math.max(12, sw * 4) : sw) * this.zoomScale;
    if (type === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.ui.colorInput.value;
    }
    ctx.moveTo(points[0].x * this.zoomScale, points[0].y * this.zoomScale);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * this.zoomScale, points[i].y * this.zoomScale);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Navigation ────────────────────────────────────────────────
  private async _renderCurrentPage(): Promise<void> {
    await this.renderer.renderPageAtIndex(this.documentModel.currentPageIndex);
    await this._renderFormFields();
    await this._renderTextLayer();
    this.renderInkLayer();
  }

  private async _renderTextLayer(): Promise<void> {
    const docPage = this.documentModel.currentPage;
    if (!docPage) { this._textLayerManager.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._textLayerManager.clear(); return; }
    const src = this.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this.ui.canvas.offsetLeft, top: this.ui.canvas.offsetTop };
    await this._textLayerManager.render(page, viewport, canvasOffset);
    this._textLayerManager.setPointerEvents(this.mode === 'select');
  }

  private async _renderFormFields(): Promise<void> {
    const myGen = ++this._formFieldGen;
    const docPage = this.documentModel.currentPage;
    if (!docPage) { this._formFieldOverlay.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._formFieldOverlay.clear(); return; }
    const src = this.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    if (myGen !== this._formFieldGen) return;  // stale — newer navigation started
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this.ui.canvas.offsetLeft, top: this.ui.canvas.offsetTop };
    const values = this._formValues[docPage.sourcePdfId] ?? {};
    const { unsupportedCount } = await this._formFieldOverlay.render(
      page, viewport, canvasOffset, values,
      (fieldName, value) => {
        if (!this._formValues[docPage.sourcePdfId]) this._formValues[docPage.sourcePdfId] = {};
        this._formValues[docPage.sourcePdfId][fieldName] = value;
        this._autosave();
      }
    );
    if (myGen !== this._formFieldGen) return;  // stale after second await

    if (unsupportedCount > 0 && !this._warnedUnsupportedFields) {
      this._warnedUnsupportedFields = true;
      this._errorReporter.warn('toast.unsupportedFields', { count: unsupportedCount });
    }
    this._formFieldOverlay.setPointerEvents(this.mode === 'select');
  }

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

  _showExportPreview(): void {
    const docPage = this.documentModel.currentPage;
    if (!docPage) return;

    const canvas = this.renderer.canvas;
    const ghost = this.ui.exportPreviewGhost;
    ghost.innerHTML = '';
    ghost.style.width  = canvas.width  + 'px';
    ghost.style.height = canvas.height + 'px';
    ghost.style.left   = canvas.offsetLeft + 'px';
    ghost.style.top    = canvas.offsetTop  + 'px';

    if (this.documentModel.watermark.enabled) {
      const wmCanvas = document.createElement('canvas');
      wmCanvas.width  = canvas.width;
      wmCanvas.height = canvas.height;
      wmCanvas.style.position      = 'absolute';
      wmCanvas.style.left          = '0';
      wmCanvas.style.top           = '0';
      wmCanvas.style.pointerEvents = 'none';
      const ctx = wmCanvas.getContext('2d');
      if (ctx) this._drawWatermarkOnCanvas(ctx, canvas.width, canvas.height, this.documentModel.watermark);
      ghost.appendChild(wmCanvas);
    }

    const W = canvas.width / this.zoomScale;
    const H = canvas.height / this.zoomScale;
    const angle = docPage.rotation ?? 0;

    const pageElements = this.elements.filter(el => el.pageId === docPage.id);
    for (const el of pageElements) {
      const pdfPt = transformPoint(el.x, el.y, W, H, angle);
      const screenX = pdfPt.x * this.zoomScale;
      const screenY = (H - pdfPt.y) * this.zoomScale;
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.left   = screenX + 'px';
      div.style.top    = screenY + 'px';
      div.style.width  = el.width  * this.zoomScale + 'px';
      div.style.height = el.height * this.zoomScale + 'px';
      div.style.border = '3px dashed #e63946';
      div.style.background = 'rgba(230,57,70,0.15)';
      div.style.boxSizing = 'border-box';
      ghost.appendChild(div);
    }

    this._exportPreviewOpen = true;
    this.ui.previewExportBtn.classList.add('active');
    this.ui.previewExportBtn.setAttribute('aria-pressed', 'true');
    this.ui.exportPreviewOverlay.style.display = '';
  }

  private _drawWatermarkOnCanvas(ctx: CanvasRenderingContext2D, screenW: number, screenH: number, wm: WatermarkSettings, scale?: number): void {
    if (!wm.enabled || !wm.text) return;
    const effectiveScale = scale ?? this.zoomScale;
    const fontSize = wm.fontSize * effectiveScale;
    ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    const textWidth = ctx.measureText(wm.text).width;
    const count = Math.max(1, Math.min(5, wm.density ?? 3));
    const stepX = Math.max(textWidth * 1.2, screenW / (count + 0.5));
    const stepY = Math.max(fontSize * 2.5, screenH / (count + 0.5));
    const col = hexToRgbValues(wm.color);
    ctx.fillStyle = `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${wm.opacity})`;
    ctx.textBaseline = 'alphabetic';
    const angleRad = wm.angle * Math.PI / 180;
    for (let y = -(stepY / 2); y < screenH + stepY; y += stepY) {
      for (let x = -(stepX / 2); x < screenW + stepX; x += stepX) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angleRad);
        ctx.fillText(wm.text, -textWidth / 2, 0);
        ctx.restore();
      }
    }
  }

  _hideExportPreview(): void {
    this._exportPreviewOpen = false;
    this.ui.previewExportBtn.classList.remove('active');
    this.ui.previewExportBtn.setAttribute('aria-pressed', 'false');
    this.ui.exportPreviewOverlay.style.display = 'none';
    this.ui.exportPreviewGhost.innerHTML = '';
  }

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

  _updatePlacementGhost(e: PointerEvent): void {
    const placementModes: ToolMode[] = ['addText', 'addComment', 'addImage', 'addSignature'];
    if (!placementModes.includes(this.mode)) {
      if (this._placementGhost) this._placementGhost.style.display = 'none';
      return;
    }
    if (!this._placementGhost) {
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;border:2px dashed rgba(0,100,255,0.7);background:rgba(0,100,255,0.07);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:16px;color:rgba(0,100,255,0.8);box-sizing:border-box;';
      document.body.appendChild(ghost);
      this._placementGhost = ghost;
    }
    const ghost = this._placementGhost;
    const cfg: Record<string, { icon: string; w: number; h: number }> = {
      addText:    { icon: 'T', w: 80, h: 28 },
      addComment: { icon: '🗒', w: 80, h: 60 },
      addImage:   { icon: '🖼', w: 60, h: 60 },
      addSignature: { icon: '✍', w: 80, h: 40 },
    };
    const c = cfg[this.mode] ?? { icon: '+', w: 40, h: 40 };
    ghost.textContent = c.icon;
    ghost.style.width  = c.w + 'px';
    ghost.style.height = c.h + 'px';
    ghost.style.left   = (e.clientX + 12) + 'px';
    ghost.style.top    = (e.clientY + 12) + 'px';
    ghost.style.display = 'flex';
  }
}
