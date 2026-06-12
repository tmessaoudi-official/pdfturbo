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
  HistoryManager, AddElementCmd, RemoveElementCmd, ClearAllCmd, TextEditCmd,
  DeletePageCmd, ReorderPagesCmd, AddPagesCmd, RotatePageCmd,
  MacroCmd, TransformAnnotationsCmd, ClearInkCmd, FillColorCmd, InkFillColorCmd,
  ReplaceSourcePdfBytesCmd,
  type Command, type ElementTransformSnapshot,
} from './historyManager';
import { InkLayer } from '../infra/inkLayer';
import { InkLayerHandler } from '../handlers/inkLayerHandler';
import { DocumentModel, PAGE_SIZES, type SourcePdf, type WatermarkSettings } from './documentModel';
import { PageThumbnailPanel } from '../ui/pageThumbnailPanel';
import { loadState, clearState } from '../infra/storage';
import { FormFieldOverlay } from '../utils/formFieldOverlay';
import { TextLayerManager } from '../utils/textLayer';
import { CommentElement } from '../elements/commentElement';
import { t } from '../utils/i18n';
import { reconstructPage, assignHeadings, type FlowDoc, type FontInfoMap, type RawTextItem } from '../utils/flowDoc';
import { flowDocToDocxBlob, flowDocToMarkdown } from '../utils/flowDocWriters';
import { trapFocus } from '../utils/focusTrap';
import { TextEditHandler } from '../handlers/textEditHandler';
import { CodeElement } from '../elements/codeElement';
import { generateCodeDataUrl, getCodeFormat, type QRStyleOptions, type BwipOptions } from '../utils/codeGenerator';
import { transformPoint, transformCanvasPoint, hexToRgbValues } from '../utils/geometry';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
import { bindEvents } from '../ui/eventBinder';
import { renderElementToPdfLib, type PdfRenderCtx } from '../export/pdfElementRenderer';
import { SearchManager } from './searchManager';
import { SessionManager } from './sessionManager';
import { ToastQueue } from '../ui/toastQueue';
import { ErrorReporter } from './errorReporter';
import type { IErrorReporter } from './errorReporter';
import { ProgressManager } from '../ui/progressManager';
import type { IProgressManager } from '../ui/progressManager';

export type ToolMode = 'select' | 'addText' | 'addSignature' | 'addImage' | 'addCode' | 'drawArrow' | 'drawRect' | 'drawEllipse' | 'drawFreehand' | 'drawHighlight' | 'addComment' | 'drawRedaction' | 'drawErase' | 'editText' | 'fillBucket';

export class PDFEditorApp {
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

  get ui(): AppDOMRefs { return this.uiController.refs; }

  get reportError(): IErrorReporter { return this._errorReporter; }
  get progress(): IProgressManager { return this._progressManager; }

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
      onNavigate: (index) => this._goToPageIndex(index),
      onDelete: (pageId) => this._deletePage(pageId),
      onReorder: (newOrder) => this._reorderPages(newOrder),
      onRotate: (pageId, delta) => this._rotatePage(pageId, delta),
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

  // ── PDF page management ───────────────────────────────────────
  async _handleAddPdfUpload(e: Event): Promise<void> {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    (e.target as HTMLInputElement).value = '';
    this._textSearch.clearCache();
    if (!files.length) return;

    const addProg = this._progressManager.begin('progress.loadingDocument');
    let addedCount = 0;
    try {
      for (const file of files) {
        const isPdf   = file.type === 'application/pdf';
        const isImage = file.type.startsWith('image/');
        if (!isPdf && !isImage) continue;
        try {
          let typedBytes: Uint8Array;
          let fileName: string;
          if (isImage) {
            const { bytes, name } = await this._imagesToPdf([file]);
            typedBytes = bytes;
            fileName = name;
          } else {
            typedBytes = new Uint8Array(await file.arrayBuffer());
            fileName = file.name;
          }
          const bytesToStore = typedBytes.slice(0); // pdf.js transfers the ArrayBuffer; copy first
          const doc = await pdfjsLib.getDocument({ data: typedBytes }).promise;
          const src = this.documentModel.addSourcePdf(doc, bytesToStore, fileName);
          const cmd = new AddPagesCmd(this.documentModel, src.id, undefined, () => this._onPageStructureChange());
          this.historyManager.execute(cmd);
          addedCount++;
        } catch (err) {
          this._errorReporter.error('toast.fileLoadFailed', err, { name: file.name });
        }
      }
      if (addedCount > 0) {
        this._errorReporter.info('toast.filesAdded', { count: addedCount });
      }
      addProg.done();
    } catch (err) {
      addProg.failed();
      this._errorReporter.error('toast.pdfLoadFailed', err);
    }
  }

  _deletePage(pageId: string): void {
    if (this.documentModel.pageCount <= 1) {
      this._errorReporter.warn('toast.cannotDeleteOnlyPage');
      return;
    }
    const src = this.documentModel.sourcePdfs.get(
      this.documentModel.pages.find(p => p.id === pageId)?.sourcePdfId ?? ''
    );
    const cmd = new DeletePageCmd(
      this.documentModel, this.elements, pageId,
      () => this._onPageStructureChange(),
      src,
    );
    this.historyManager.execute(cmd);
  }

  _reorderPages(newOrder: string[]): void {
    const before = this.documentModel.pages.map(p => p.id);
    const cmd = new ReorderPagesCmd(this.documentModel, before, newOrder, () => this._onPageStructureChange());
    this.historyManager.execute(cmd);
  }

  async _rotatePage(pageId: string, delta: number): Promise<void> {
    const docPage = this.documentModel.pages.find(p => p.id === pageId);
    if (!docPage) return;
    const src = this.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;

    const pageElements = this.elements.filter(e => e.pageId === pageId);

    // Fetch original page dims + source rotation for transform math
    const pdfPage = await src.doc.getPage(docPage.sourcePageNum);
    const srcRot = (pdfPage.rotate as number) ?? 0;
    const vp0 = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const W = vp0.width, H = vp0.height;

    const oldUserRot = docPage.rotation ?? 0;
    const newUserRot = ((oldUserRot + delta) % 360 + 360) % 360;
    const fromRot = ((srcRot + oldUserRot) % 360 + 360) % 360;
    const toRot   = ((srcRot + newUserRot) % 360 + 360) % 360;

    const rotateCmd = new RotatePageCmd(this.documentModel, pageId, delta, () => {
      this._thumbnailPanel?.invalidateThumb(pageId);
      this._onPageStructureChange();
    });

    // Capture ink stroke state before the early-return so ink-only pages also rotate.
    const inkStrokes = this.inkLayer.getStrokes(pageId);
    const inkBefore  = inkStrokes.map(s => s.points.map(p => ({ ...p })));
    const inkAfter   = inkStrokes.map(s =>
      s.points.map(p => transformCanvasPoint(p.x, p.y, W, H, fromRot, toRot))
    );
    const hasInk = inkStrokes.length > 0;

    if (!pageElements.length && !hasInk) {
      this.historyManager.execute(rotateCmd);
      return;
    }

    // Build before/after snapshots for all annotations on this page
    const before = new Map<number, ElementTransformSnapshot>();
    const after  = new Map<number, ElementTransformSnapshot>();
    for (const el of pageElements) {
      before.set(el.id, { x: el.x, y: el.y, width: el.width, height: el.height,
        rotation: el.rotation,
        x1: (el as ShapeElement).x1, y1: (el as ShapeElement).y1,
        x2: (el as ShapeElement).x2, y2: (el as ShapeElement).y2,
        points: (el as ShapeElement).points?.map(p => ({ ...p })),
      });
      const snap = this._rotateElementSnapshot(el, W, H, fromRot, toRot);
      // Arrows and freehand encode rotation geometrically (x1/y1/x2/y2 or points).
      // Setting snap.rotation here would double-apply the rotation via CSS.
      const shapType = (el as ShapeElement).shapeType;
      const isGeometric = el.type === 'shape' && (shapType === 'arrow' || shapType === 'freehand');
      if (!isGeometric) snap.rotation = ((el.rotation + delta) % 360 + 360) % 360;
      after.set(el.id, snap);
    }

    // Build command list — TransformAnnotationsCmd and ink cmd run before rotateCmd so
    // elements/strokes are in correct positions when RotatePageCmd's onUpdate re-renders.
    const cmds: Command[] = [];
    if (pageElements.length) {
      cmds.push(new TransformAnnotationsCmd(this.elements, before, after));
    }
    if (hasInk) {
      cmds.push({
        execute: () => { inkStrokes.forEach((s, i) => { s.points = inkAfter[i].map(p => ({ ...p })); }); },
        undo:    () => { inkStrokes.forEach((s, i) => { s.points = inkBefore[i].map(p => ({ ...p })); }); this.renderInkLayer(); },
      });
    }
    cmds.push(rotateCmd);

    this.historyManager.execute(cmds.length === 1 ? cmds[0] : new MacroCmd(cmds));
    this._errorReporter.info('toast.annotationsAdjusted');
  }

  /** Compute the post-rotation ElementTransformSnapshot for a single element. */
  private _rotateElementSnapshot(el: PDFElement, W: number, H: number, fromRot: number, toRot: number): ElementTransformSnapshot {
    const tp = (cx: number, cy: number) => transformCanvasPoint(cx, cy, W, H, fromRot, toRot);
    const shape = el as ShapeElement;

    if (el.type === 'shape' && shape.shapeType === 'arrow') {
      const p1 = tp(shape.x1, shape.y1);
      const p2 = tp(shape.x2, shape.y2);
      return {
        x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
        width:  Math.abs(p2.x - p1.x) || el.width,
        height: Math.abs(p2.y - p1.y) || el.height,
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      };
    }

    if (el.type === 'shape' && shape.shapeType === 'freehand') {
      const pts = shape.points.map(p => tp(p.x, p.y));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      return {
        x: Math.min(...xs), y: Math.min(...ys),
        width:  Math.max(...xs) - Math.min(...xs) || el.width,
        height: Math.max(...ys) - Math.min(...ys) || el.height,
        points: pts,
      };
    }

    // Standard box elements: transform center, keep original dimensions.
    // el.rotation is already incremented by delta (in _rotatePage line 870) so CSS
    // transform: rotate(el.rotation deg) handles the visual reorientation — swapping
    // width/height here would cancel the visual rotation out instead of preserving it.
    const c = tp(el.x + el.width / 2, el.y + el.height / 2);
    return {
      x: c.x - el.width / 2,
      y: c.y - el.height / 2,
      width: el.width,
      height: el.height,
    };
  }

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

  private _applyExportPassword(pdfDoc: { encrypt(opts: { userPassword: string; ownerPassword: string }): void }): void {
    if (!this._exportPassword) return;
    pdfDoc.encrypt({ userPassword: this._exportPassword.user, ownerPassword: this._exportPassword.owner });
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

  _insertBlankPage(): void {
    const sizeKey = (document.getElementById('blankPageSize') as HTMLSelectElement)?.value ?? 'a4';
    const position = (document.getElementById('blankPagePosition') as HTMLSelectElement)?.value ?? 'end';

    let w = 595, h = 842;
    if (sizeKey === 'custom') {
      const mmW = parseFloat((document.getElementById('blankPageW') as HTMLInputElement)?.value ?? '210');
      const mmH = parseFloat((document.getElementById('blankPageH') as HTMLInputElement)?.value ?? '297');
      w = Math.round(mmW * 2.8346); // mm → pt
      h = Math.round(mmH * 2.8346);
    } else if (sizeKey === 'match') {
      const cur = this.documentModel.currentPage;
      if (cur?.blankWidth) { w = cur.blankWidth; h = cur.blankHeight ?? 842; }
    } else {
      const s = PAGE_SIZES[sizeKey];
      if (s) { w = s.width; h = s.height; }
    }

    const wasEmpty = this.documentModel.pageCount === 0;

    let atIndex: number;
    const total = this.documentModel.pageCount;
    switch (position) {
      case 'beginning': atIndex = 0; break;
      case 'after':     atIndex = this.documentModel.currentPageIndex + 1; break;
      default:          atIndex = total;
    }

    const newPage = this.documentModel.addBlankPage(w, h, atIndex);
    this.documentModel.currentPageIndex = this.documentModel.pages.indexOf(newPage);

    if (wasEmpty) {
      // First page ever — run the full first-document initialization
      void (async () => {
        try {
          (document.getElementById('emptyState') as HTMLElement).style.display = 'none';
          this._isFitMode = true;
          const fitScale = await this.renderer.computeFitScale(this.ui.container.clientWidth);
          const isMobile = window.innerWidth <= 640;
          await this.applyZoom(isMobile ? Math.max(fitScale, 0.65) : fitScale);
          this.enableUI();
          this._enableFileMenuDocItems();
          this.ui.pageThumbnailContainer.style.display = '';
          if (!this._thumbnailPanel) {
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
          }
          await this._thumbnailPanel.render();
          this.updatePageInfo();
          this.rebuildElementLayer();
          this._autosave();
          this._errorReporter.info('toast.blankPageInserted');
          const pendingMode = this._pendingModeAfterBlankPage;
          this._pendingModeAfterBlankPage = null;
          if (pendingMode) this.setMode(pendingMode as ToolMode);
        } catch (err) {
          this._errorReporter.error('toast.blankPageInsertFailed', err);
        }
      })();
    } else {
      this._autosave();
      void this._thumbnailPanel?.render();
      this._thumbnailPanel?.updateActive();
      this.updatePageInfo();
      void this._renderCurrentPage().then(() => this.rebuildElementLayer());
      this._errorReporter.info('toast.blankPageInserted');
    }
  }

  clearAll() {
    const hasVector = this.elements.length > 0;
    const hasInk    = this.inkLayer.hasAnyContent();
    if (!hasVector && !hasInk) { this._errorReporter.warn('toast.noAnnotationsToClear'); return; }
    const cmds = [];
    if (hasVector) cmds.push(new ClearAllCmd(this.elements));
    if (hasInk)    cmds.push(new ClearInkCmd(this.inkLayer, () => this.renderInkLayer()));
    this.historyManager.execute(cmds.length === 1 ? cmds[0] : new MacroCmd(cmds));
    this.selectedElement = null;
    this._updateFormattingToolbar();
    this._autosave();
    this.rebuildElementLayer();
    this._errorReporter.info('toast.annotationsCleared');
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

  setMode(mode: ToolMode) {
    this.drawingHandler.cancel();
    this.eraserHandler.cancel();
    this.inkLayerHandler.cancel();
    this.mode = mode;
    const pe = mode === 'select' ? 'auto' : 'none';
    this.ui.container.querySelectorAll<HTMLElement>('.pdf-element').forEach(el => { el.style.pointerEvents = pe; });
    this.uiController.updateModeButtons(mode);
    this._updateFormattingToolbar();
    this._formFieldOverlay.setPointerEvents(mode === 'select');
    this._textLayerManager.setPointerEvents(mode === 'select');
    if (mode === 'addSignature') this.openSignatureModal();

    const modeHintKeys: Partial<Record<ToolMode, string>> = {
      addText: 'toast.modeHint.addText', addSignature: 'toast.modeHint.addSignature',
      addImage: 'toast.modeHint.addImage', drawArrow: 'toast.modeHint.drawArrow',
      drawRect: 'toast.modeHint.drawRect', drawEllipse: 'toast.modeHint.drawEllipse',
      drawFreehand: 'toast.modeHint.drawFreehand', drawHighlight: 'toast.modeHint.drawHighlight',
      addComment: 'toast.modeHint.addComment', addCode: 'toast.modeHint.addCode',
      drawRedaction: 'toast.modeHint.drawRedaction',
      drawErase: 'toast.modeHint.drawErase', editText: 'toast.modeHint.editText',
      fillBucket: 'toast.modeHint.fillBucket',
    };
    const placementModes: ToolMode[] = ['addText', 'addComment', 'addImage', 'addSignature', 'addCode'];
    if (!placementModes.includes(mode) && this._placementGhost) {
      this._placementGhost.style.display = 'none';
    }

    const hintKey = modeHintKeys[mode];
    if (hintKey) {
      this._errorReporter.info(hintKey);
    } else {
      this.uiController.clearToast();
    }
  }

  _isShapeMode() { return this.mode.startsWith('draw'); }

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


  removeElement(id: number) {
    const el = this.elements.find(e => e.id === id);
    if (!el) return;
    this.historyManager.execute(new RemoveElementCmd(this.elements, el));
    if (this.selectedElement && this.selectedElement.id === id) {
      this.selectedElement = null;
      this._updateFormattingToolbar();
    }
    this.rebuildElementLayer();
    this._autosave();
  }

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

  async _goToPageIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.documentModel.pageCount) return;
    if (index === this.documentModel.currentPageIndex) return;
    this.documentModel.currentPageIndex = index;
    this.selectElement(null);
    this._clearSearchMatches();
    this._searchManager.clear();
    if (this.ui.findBar.style.display !== 'none') this.ui.findCount.textContent = '';
    if (this._isFitMode) {
      const fitScale = await this.renderer.computeFitScale(this.ui.container.clientWidth);
      const isMobile = window.innerWidth <= 640;
      this.zoomScale = isMobile ? Math.max(fitScale, 0.65) : fitScale;
      this.renderer.setScale(this.zoomScale);
      this.ui.zoomDisplay.textContent = Math.round(this.zoomScale * 100) + '%';
    }
    await this._renderCurrentPage();
    this._thumbnailPanel?.updateActive();
    this.updatePageInfo();
    this.rebuildElementLayer();
    if (this.ui.findBar.style.display !== 'none' && this.ui.findInput.value) this._search();
    if (this._exportPreviewOpen) this._showExportPreview();
  }

  async _goToPage(n: number): Promise<void> {
    await this._goToPageIndex(n - 1);
  }

  async prevPage() { await this._goToPageIndex(this.documentModel.currentPageIndex - 1); }
  async nextPage() { await this._goToPageIndex(this.documentModel.currentPageIndex + 1); }

  updatePageInfo() {
    this.uiController.updatePageInfo(this.documentModel.currentPageIndex + 1, this.documentModel.pageCount);
  }

  async applyZoom(newScale: number): Promise<void> {
    if (!Number.isFinite(newScale) || newScale <= 0) return;
    this.zoomScale = Math.max(0.25, Math.min(3.0, newScale));
    this.renderer.setScale(this.zoomScale);
    this.ui.zoomDisplay.textContent = Math.round(this.zoomScale * 100) + '%';
    await this._renderCurrentPage();
    this._thumbnailPanel?.invalidateAll();
    this.rebuildElementLayer();
    // Re-run search at new scale so match overlays reposition correctly
    if (this.ui.findBar.style.display !== 'none' && this.ui.findInput.value) this._search();
    if (this._exportPreviewOpen) this._showExportPreview();
  }

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

  _copySelectedElement(): void {
    if (!this.selectedElement) return;
    this._clipboard = this.selectedElement.toJSON() as ElementJSON;
    this._updateCopyPasteBtns();
    this._errorReporter.info('toast.copied');
  }

  _pasteElement(): void {
    if (!this._clipboard || !this.documentModel.currentPage) return;
    const clone = ElementFactory.fromJSON({ ...this._clipboard } as Record<string, unknown>);
    if (!clone) return;
    clone.id = PDFElement._nextId++;
    clone.x += 10;
    clone.y += 10;
    clone.pageId = this.documentModel.currentPage.id;
    this.historyManager.execute(new AddElementCmd(this.elements, clone));
    this.selectElement(clone);
    this._autosave();
    this._errorReporter.info('toast.pastedUndo');
  }

  _updateCopyPasteBtns(): void {
    const hasPdfText = !!window.getSelection()?.toString();
    this.uiController.updateCopyPasteBtns(!!this.selectedElement || hasPdfText, !!this._clipboard);
  }

  /**
   * Export a page as a rasterized PNG image embedded in a new pdf-lib page.
   * Called when the page has redaction elements — rasterization permanently
   * removes the text layer so redacted content cannot be extracted.
   */
  private async _rasterizePageWithRedactions(
    srcDoc: import('@cantoo/pdf-lib').PDFDocument,
    docPage: import('./documentModel').DocumentPage,
    elements: PDFElement[],
    pdfDoc: import('@cantoo/pdf-lib').PDFDocument,
    libs: import('../utils/pdfLibTypes').PdfLibOps,
  ): Promise<void> {
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    void rgb; void StandardFonts; // used via libs param below

    // 1. Build a temp single-page PDF with all NON-redaction elements drawn in
    const tempDoc = await PDFDocument.create();
    const [tempPage] = await tempDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
    tempDoc.addPage(tempPage);

    const userRot  = docPage.rotation ?? 0;
    const srcRot   = tempPage.getRotation().angle as number;
    const totalRot = ((srcRot + userRot) % 360 + 360) % 360;
    if (userRot) tempPage.setRotation(degrees(totalRot));

    const cropBoxR = this._getPageCropBox(tempPage);
    const W_orig = cropBoxR.width;
    const H_orig = cropBoxR.height;
    const cropOriginX = cropBoxR.x;
    const cropOriginY = cropBoxR.y;
    const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
    const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

    const nonRedactions = elements.filter(e => e.type !== 'redaction');
    const rasterErrors: string[] = [];
    for (const el of nonRedactions) {
      try {
        await renderElementToPdfLib(el, { pdfDoc: tempDoc, page: tempPage, libs, h: h_eff, w: w_eff, W_orig, H_orig, totalRot, cropOriginX, cropOriginY } satisfies PdfRenderCtx);
      } catch {
        rasterErrors.push(`${el.type} (id ${el.id})`);
      }
    }
    if (rasterErrors.length > 0) {
      this._errorReporter.warn('toast.elementRenderFailed', { count: rasterErrors.length });
      this._errorReporter.silent(undefined, `Redaction skipped: ${rasterErrors.join(', ')}`);
    }

    if (this.documentModel.watermark.enabled) {
      await this._drawWatermark(tempPage, W_orig, H_orig, cropOriginX, cropOriginY, {
        rgb: libs.rgb, degrees, pdfDoc: tempDoc, StandardFonts: libs.StandardFonts,
      });
    }
    const inkDataUrlRast = this._renderInkForExport(docPage.id, W_orig, H_orig, totalRot);
    if (inkDataUrlRast) {
      const inkImg = await tempDoc.embedPng(dataUrlToUint8Array(inkDataUrlRast));
      tempPage.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
    }

    // 2. Rasterize via pdf.js at 2× scale
    const tempBytes  = await tempDoc.save({ useObjectStreams: false });
    const renderDoc  = await pdfjsLib.getDocument({ data: tempBytes }).promise;
    const renderPage = await renderDoc.getPage(1);
    const SCALE = 2;
    // Rotation is already baked into the temp PDF via setRotation() above — do not re-apply.
    const vp = renderPage.getViewport({ scale: SCALE });

    const offscreen    = document.createElement('canvas');
    offscreen.width    = Math.round(vp.width);
    offscreen.height   = Math.round(vp.height);
     
    const ctx          = offscreen.getContext('2d') as CanvasRenderingContext2D;
    await renderPage.render({ canvas: offscreen, viewport: vp }).promise;

    // 3. Paint redaction boxes onto the canvas (permanently covers content)
    for (const el of elements.filter(e => e.type === 'redaction')) {
      ctx.fillStyle = (el as { color?: string }).color ?? '#000000';
      ctx.fillRect(
        Math.round(el.x * SCALE),
        Math.round(el.y * SCALE),
        Math.round(el.width  * SCALE),
        Math.round(el.height * SCALE),
      );
    }

    // 4. Embed rasterized PNG into the destination document as a new page
    const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
      offscreen.toBlob((blob) => {
        if (!blob) { reject(new Error('canvas toBlob failed')); return; }
        blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
      }, 'image/png');
    });

    const pngImg  = await pdfDoc.embedPng(pngBytes);
    const newPage = pdfDoc.addPage([w_eff, h_eff]);
    newPage.drawImage(pngImg, { x: 0, y: 0, width: w_eff, height: h_eff });
  }

  // ── Shared export page pipeline ───────────────────────────────
  /**
   * Apply rotation, cropbox, elements, watermark, and ink to a pdf-lib page.
   * Called by downloadPDF and downloadPage to eliminate duplicated rendering logic.
   */
  private async _applyPageOverlays(
    pdfDoc: import('@cantoo/pdf-lib').PDFDocument,
    page: import('@cantoo/pdf-lib').PDFPage,
    docPage: import('./documentModel').DocumentPage,
    pageElements: PDFElement[],
    pdfLib: import('../utils/pdfLibTypes').PdfLibOps,
    userRot: number,
    sourceRot: number
  ): Promise<void> {
    const { rgb, degrees, StandardFonts } = pdfLib;
    const totalRot = ((sourceRot + userRot) % 360 + 360) % 360;
    if (userRot) page.setRotation(degrees(totalRot));

    const cropBox = this._getPageCropBox(page);
    const W_orig = cropBox.width;
    const H_orig = cropBox.height;
    const cropOriginX = cropBox.x;
    const cropOriginY = cropBox.y;
    const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
    const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

    const exportErrors: string[] = [];
    for (const element of pageElements) {
      try {
        await renderElementToPdfLib(element, { pdfDoc, page, libs: { rgb, StandardFonts, degrees }, h: h_eff, w: w_eff, W_orig, H_orig, totalRot, cropOriginX, cropOriginY } satisfies PdfRenderCtx);
      } catch {
        exportErrors.push(`${element.type} (id ${element.id})`);
      }
    }
    if (exportErrors.length > 0) {
      this._errorReporter.warn('toast.elementRenderFailed', { count: exportErrors.length });
      this._errorReporter.silent(undefined, `Export render failed: ${exportErrors.join(', ')}`);
    }

    if (this.documentModel.watermark.enabled) {
      await this._drawWatermark(page, W_orig, H_orig, cropOriginX, cropOriginY, { rgb, degrees, pdfDoc, StandardFonts });
    }

    const inkDataUrl = this._renderInkForExport(docPage.id, W_orig, H_orig, totalRot);
    if (inkDataUrl) {
      const inkPng = dataUrlToUint8Array(inkDataUrl);
      const inkImg = await pdfDoc.embedPng(inkPng);
      page.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
    }
  }

  // ── Export (vector copyPages) ─────────────────────────────────
  async downloadPDF() {
    if (!this.documentModel.pageCount) return;
    this._cleanEmptyTextElements();
    const _prog = this._progressManager.begin('progress.generatingPdf');
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    try {
      const pdfDoc = await PDFDocument.create();

      // Load each source PDF once
      const srcDocs = new Map<string, import('@cantoo/pdf-lib').PDFDocument>();
      for (const [id, src] of this.documentModel.sourcePdfs) {
        srcDocs.set(id, await PDFDocument.load(src.bytes));
      }

      // Fill and flatten form fields for sources with user-entered values
      for (const [id, srcDoc] of srcDocs) {
        const vals = this._formValues[id];
        if (!vals || !Object.keys(vals).length) continue;
        try {
          const form = srcDoc.getForm();
          for (const [fieldName, value] of Object.entries(vals)) {
            try { form.getTextField(fieldName).setText(value); } catch { /* field missing */ }
          }
          form.flatten();
        } catch { /* no form fields in this source */ }
      }

      // Pre-copy all needed pages from each source (one copyPages call per source)
      const copiedPages = new Map<string, import('@cantoo/pdf-lib').PDFPage>();
      for (const [id, srcDoc] of srcDocs) {
        const indices = [...new Set(
          this.documentModel.pages.filter(p => p.sourcePdfId === id).map(p => p.sourcePageNum - 1)
        )].sort((a, b) => a - b);
        const pages = await pdfDoc.copyPages(srcDoc, indices);
        indices.forEach((idx: number, i: number) => copiedPages.set(`${id}:${idx}`, pages[i]));
      }

      // Add pages in document order and draw overlays
      for (const docPage of this.documentModel.pages) {
        const pageElements = this.elements.filter(el => el.pageId === docPage.id);
        const hasRedaction = pageElements.some(el => el.type === 'redaction');

        // Blank page: create fresh page at specified dimensions
        if (docPage.sourcePdfId === 'blank') {
          const W_orig = docPage.blankWidth ?? 595;
          const H_orig = docPage.blankHeight ?? 842;
          const blankPage = pdfDoc.addPage([W_orig, H_orig]);
          blankPage.drawRectangle({ x: 0, y: 0, width: W_orig, height: H_orig, color: rgb(1, 1, 1), borderWidth: 0 });
          const exportErrors: string[] = [];
          for (const element of pageElements) {
            try {
              await renderElementToPdfLib(element, { pdfDoc, page: blankPage, libs: { rgb, StandardFonts, degrees }, h: H_orig, w: W_orig, W_orig, H_orig, totalRot: 0, cropOriginX: 0, cropOriginY: 0 } satisfies PdfRenderCtx);
            } catch {
              exportErrors.push(`${element.type} (id ${element.id})`);
            }
          }
          if (exportErrors.length > 0) {
            this._errorReporter.warn('toast.elementRenderFailed', { count: exportErrors.length });
            this._errorReporter.silent(undefined, `Blank-page export failed: ${exportErrors.join(', ')}`);
          }
          const inkDataUrl = this._renderInkForExport(docPage.id, W_orig, H_orig, 0);
          if (inkDataUrl) {
            const inkImg = await pdfDoc.embedPng(dataUrlToUint8Array(inkDataUrl));
            blankPage.drawImage(inkImg, { x: 0, y: 0, width: W_orig, height: H_orig });
          }
          continue;
        }

        if (hasRedaction) {
          const srcDoc = srcDocs.get(docPage.sourcePdfId);
          if (srcDoc) {
            await this._rasterizePageWithRedactions(srcDoc, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees });
          }
          continue; // skip the normal vector export for this page
        }

        const key = `${docPage.sourcePdfId}:${docPage.sourcePageNum - 1}`;
        const page = copiedPages.get(key);
        if (!page) continue;
        pdfDoc.addPage(page);

        const userRot = docPage.rotation ?? 0;
        const sourceRot = page.getRotation().angle as number;
        await this._applyPageOverlays(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, userRot, sourceRot);
      }

      this._applyExportPassword(pdfDoc);
      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const baseName = (this.currentFilename || 'document').replace(/\.pdf$/i, '');
      link.download = baseName + '-edited.pdf';
      link.click();
      this._errorReporter.info('toast.pdfDownloaded');
      URL.revokeObjectURL(url);
      _prog.done();
    } catch (err) {
      this._errorReporter.error('toast.pdfExportFailed', err);
      _prog.failed();
    } finally {
      await this._renderCurrentPage();
      this.rebuildElementLayer();
    }
  }

  // ── Feature B: Split — export one page as PDF ────────────────
  async downloadPage(pageIdx: number): Promise<void> {
    const docPage = this.documentModel.pages[pageIdx];
    if (!docPage) return;
    const _prog = this._progressManager.begin('progress.exportingPage');
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    try {
      const srcEntry = this.documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!srcEntry) { _prog.failed(); return; }
      const srcDocLib = await PDFDocument.load(srcEntry.bytes);
      const pdfDoc    = await PDFDocument.create();
      const pageElements = this.elements.filter(el => el.pageId === docPage.id);
      const hasRedaction = pageElements.some(el => el.type === 'redaction');

      if (hasRedaction) {
        await this._rasterizePageWithRedactions(srcDocLib, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees });
      } else {
        const [page] = await pdfDoc.copyPages(srcDocLib, [docPage.sourcePageNum - 1]);
        pdfDoc.addPage(page);

        const userRot = docPage.rotation ?? 0;
        const srcRot  = page.getRotation().angle as number;
        await this._applyPageOverlays(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, userRot, srcRot);
      }

      this._applyExportPassword(pdfDoc);
      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const base = (this.currentFilename || 'document').replace(/\.pdf$/i, '');
      link.download = `${base}-page${pageIdx + 1}.pdf`;
      link.click();
      this._errorReporter.info('toast.pageDownloaded', { page: pageIdx + 1 });
      URL.revokeObjectURL(url);
      _prog.done();
    } catch (err) {
      this._errorReporter.error('toast.pageExportFailed', err);
      _prog.failed();
    }
  }

  // ── Feature D: Export current page as PNG image ───────────────
  async downloadPageAsImage(pageIdx?: number): Promise<void> {
    const idx = pageIdx ?? this.documentModel.currentPageIndex;
    const docPage = this.documentModel.pages[idx];
    if (!docPage) return;
    const _prog = this._progressManager.begin('progress.exportingImage');
    try {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const srcEntry = this.documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!srcEntry) {
        this._errorReporter.error('toast.exportSourceNotFound');
        _prog.failed();
        return;
      }
      const srcDoc = await PDFDocument.load(srcEntry.bytes);
      const pdfDoc = await PDFDocument.create();
      const [page] = await pdfDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
      pdfDoc.addPage(page);

      const userRot  = docPage.rotation ?? 0;
      const srcRot   = page.getRotation().angle as number;
      const pageElements = this.elements.filter(el => el.pageId === docPage.id);
      await this._applyPageOverlays(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, userRot, srcRot);

      // Rasterize via pdf.js at 2× scale
      const pdfBytes   = await pdfDoc.save({ useObjectStreams: false });
      const renderDoc  = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const renderPage = await renderDoc.getPage(1);
      const SCALE = 2;
      const vp = renderPage.getViewport({ scale: SCALE });
      const offscreen = document.createElement('canvas');
      offscreen.width  = Math.round(vp.width);
      offscreen.height = Math.round(vp.height);
      const ctx = offscreen.getContext('2d');
      if (!ctx) { this._errorReporter.error('toast.canvasUnavailable'); _prog.failed(); return; }
      await renderPage.render({ canvas: offscreen, viewport: vp }).promise;

      offscreen.toBlob((blob) => {
        if (!blob) { this._errorReporter.error('toast.imageExportFailed'); _prog.failed(); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const base = (this.currentFilename || 'document').replace(/\.pdf$/i, '');
        link.download = `${base}-page${idx + 1}.png`;
        link.click();
        this._errorReporter.info('toast.imageExported', { page: idx + 1 });
        URL.revokeObjectURL(url);
        _prog.done();
      }, 'image/png');
    } catch (err) {
      this._errorReporter.error('toast.imageExportFailed', err);
      _prog.failed();
    }
  }

  /**
   * Reconstruct a flow-document model (paragraphs/headings/styles/RTL) from the
   * source PDFs' text layers. Blank pages and pages whose source is missing are
   * skipped — only real PDF text is exported (overlay annotations are not).
   */
  async _extractFlowDoc(): Promise<FlowDoc> {
    const flowDoc: FlowDoc = { pages: [] };
    for (const docPage of this.documentModel.pages) {
      const src = this.documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src || !docPage.sourcePageNum) continue;
      const page = await src.doc.getPage(docPage.sourcePageNum);

      // Fetch text content and operator list concurrently.
      const [content, opList] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList().catch(() => null),
      ]);

      const items = content.items as RawTextItem[];
      const styles = content.styles as Record<string, { fontFamily?: string }>;

      // Build font info map, preferring the real PostScript name over the internal id.
      const fonts: FontInfoMap = {};
      for (const it of items) {
        if (fonts[it.fontName]) continue;
        let realName = it.fontName;
        // commonObjs.get() may throw for lazy-loaded fonts — fall back gracefully.
        try {
          const f = page.commonObjs.get(it.fontName) as { name?: string } | null;
          if (f?.name) realName = f.name;
        } catch {
          // Font object unavailable — id already contains the PS name after '+'.
          const psMatch = it.fontName.match(/\+(.+)$/);
          realName = psMatch ? psMatch[1] : it.fontName;
        }
        fonts[it.fontName] = { name: realName, family: styles[it.fontName]?.fontFamily };
      }

      // Build a position → hex color map from the operator list for DOCX color fidelity.
      const colorMap = new Map<string, string>();
      if (opList) {
        try {
          const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
          let fillR = 0, fillG = 0, fillB = 0;

          // Walk the operator list tracking fill color and text matrix.
          let textMatrix = [1, 0, 0, 1, 0, 0];
          for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            const args = opList.argsArray[i] as number[];
            if (fn === OPS['setFillRGBColor']) {
              [fillR, fillG, fillB] = args;
            } else if (fn === OPS['setFillGray']) {
              fillR = fillG = fillB = args[0];
            } else if (fn === OPS['setFillCMYKColor']) {
              const [c, m, y, k] = args;
              fillR = (1 - c) * (1 - k);
              fillG = (1 - m) * (1 - k);
              fillB = (1 - y) * (1 - k);
            } else if (fn === OPS['setTextMatrix']) {
              textMatrix = args.slice(0, 6);
            } else if (
              fn === OPS['showText'] ||
              fn === OPS['showSpacedText'] ||
              fn === OPS['nextLineShowText'] ||
              fn === OPS['nextLineSetSpacingShowText']
            ) {
              const px = Math.round(textMatrix[4]);
              const py = Math.round(textMatrix[5]);
              // Only store non-black colors (black is the default).
              if (fillR !== 0 || fillG !== 0 || fillB !== 0) {
                const toHex = (v: number) =>
                  Math.round(Math.max(0, Math.min(255, v * 255)))
                    .toString(16).padStart(2, '0').toUpperCase();
                colorMap.set(`${px},${py}`, toHex(fillR) + toHex(fillG) + toHex(fillB));
              }
            }
          }
        } catch {
          // getOperatorList unavailable (e.g. encrypted pages) — color stays empty.
        }
      }

      const vp = page.getViewport({ scale: 1 });
      flowDoc.pages.push(reconstructPage(items, fonts, vp.width, vp.height, colorMap));
    }
    assignHeadings(flowDoc);
    return flowDoc;
  }

  private _downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private _exportBaseName(): string {
    return (this.currentFilename || 'document').replace(/\.pdf$/i, '');
  }

  async exportAsDocx(): Promise<void> {
    const _prog = this._progressManager.begin('progress.generatingDocx');
    try {
      const flowDoc = await this._extractFlowDoc();
      if (!flowDoc.pages.some(p => p.paragraphs.length > 0)) {
        this._errorReporter.warn('toast.exportNoText');
        _prog.done();
        return;
      }
      const blob = await flowDocToDocxBlob(flowDoc);
      this._downloadBlob(blob, this._exportBaseName() + '.docx');
      this._errorReporter.info('toast.docxExported');
      _prog.done();
    } catch (err) {
      this._errorReporter.error('toast.exportFailed', err);
      _prog.failed();
    }
  }

  async exportAsMarkdown(): Promise<void> {
    const _prog = this._progressManager.begin('progress.generatingMarkdown');
    try {
      const flowDoc = await this._extractFlowDoc();
      const md = flowDocToMarkdown(flowDoc);
      if (!md.trim()) {
        this._errorReporter.warn('toast.exportNoText');
        _prog.done();
        return;
      }
      this._downloadBlob(new Blob([md], { type: 'text/markdown' }), this._exportBaseName() + '.md');
      this._errorReporter.info('toast.mdExported');
      _prog.done();
    } catch (err) {
      this._errorReporter.error('toast.exportFailed', err);
      _prog.failed();
    }
  }


  /**
   * Render ink strokes into unrotated PDF coordinate space (W_orig × H_orig) at 2× resolution.
   * Points are stored in rotated canvas space; _transformPoint converts them to PDF content space.
   * Returns a PNG data URL, or null if there is no visible ink on this page.
   */
  private _renderInkForExport(pageId: string, W_orig: number, H_orig: number, totalRot: number): string | null {
    const strokes = this.inkLayer.getStrokes(pageId);
    if (!strokes.length) return null;

    const SCALE = 2;
    const c = document.createElement('canvas');
    c.width  = Math.round(W_orig * SCALE);
    c.height = Math.round(H_orig * SCALE);
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.width * SCALE;
      if (stroke.type === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }
      // Transform each point: canvas space (rotated view, scale=1) → PDF content space (unrotated, y-up)
      // → export canvas space (unrotated, y-down, ×SCALE)
      const pts = stroke.points.map(p => {
        const pdf = transformPoint(p.x, p.y, W_orig, H_orig, totalRot);
        return { x: pdf.x * SCALE, y: (H_orig - pdf.y) * SCALE };
      });
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();
    }

    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return c.toDataURL('image/png');
    }
    return null;
  }

  private _getPageCropBox(page: import('@cantoo/pdf-lib').PDFPage): { x: number; y: number; width: number; height: number } {
    try {
      const cb = page.getCropBox?.();
      if (cb && typeof cb.width === 'number') return { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    } catch { /* no CropBox */ }
    const { width, height } = page.getSize();
    return { x: 0, y: 0, width, height };
  }

  // W_orig / H_orig are the CropBox dimensions; cropOriginX/Y shift tiling into MediaBox space.
  private async _drawWatermark(page: import('@cantoo/pdf-lib').PDFPage, W_orig: number, H_orig: number, cropOriginX: number, cropOriginY: number, libs: import('../utils/pdfLibTypes').PdfLibDrawOps): Promise<void> {
    const { rgb, degrees, pdfDoc, StandardFonts } = libs;
    const wm = this.documentModel.watermark;
    const col = hexToRgbValues(wm.color);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const textWidth = font.widthOfTextAtSize(wm.text, wm.fontSize);
    const densityFactors = [0, 2.0, 1.5, 1.0, 0.7, 0.5]; // index 1–5
    const spacingFactor = densityFactors[Math.max(1, Math.min(5, wm.density ?? 3))];
    const stepX = Math.max(textWidth + wm.fontSize * 0.8, W_orig / 5) * spacingFactor;
    const stepY = Math.max(wm.fontSize * 2, H_orig / 4) * spacingFactor;
    for (let y = cropOriginY - (stepY / 2); y < cropOriginY + H_orig + stepY; y += stepY) {
      for (let x = cropOriginX - (stepX / 2); x < cropOriginX + W_orig + stepX; x += stepX) {
        page.drawText(wm.text, {
          x: x - textWidth / 2,
          y,
          size: wm.fontSize,
          font,
          color: rgb(col.r, col.g, col.b),
          opacity: wm.opacity,
          rotate: degrees(wm.angle),
        });
      }
    }
  }

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
