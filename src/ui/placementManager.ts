import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { HistoryManager } from '../core/historyManager';
import type { AppDOMRefs } from './uiController';
import type { ToolMode } from '../types/tools';
import type { IErrorReporter } from '../contracts/errorReporter';
import type { QRStyleOptions, BwipOptions } from '../utils/codeGenerator';
import { TextElement } from '../elements/textElement';
import { ImageElement } from '../elements/imageElement';
import { CommentElement } from '../elements/commentElement';
import { SignatureElement } from '../elements/signatureElement';
import { CodeElement } from '../elements/codeElement';
import { AddElementCmd } from '../core/historyManager';
import { getCodeFormat } from '../utils/codeGenerator';

export interface IPlacementContext {
  readonly documentModel: DocumentModel;
  readonly elements: PDFElement[];
  readonly historyManager: HistoryManager;
  readonly ui: AppDOMRefs;
  readonly zoomScale: number;
  readonly mode: ToolMode;
  readonly reportError: IErrorReporter;
  // Signature state — owned by pdfEditorApp until Wave 3D
  currentSignature: string | null;
  signatureNatural: { w: number; h: number } | null;
  // Side effects
  autosave(): void;
  setMode(mode: ToolMode): void;
  selectElement(el: PDFElement | null): void;
  rebuildElementLayer(): void;
}

export class PlacementManager {
  private _pendingImageSrc: string | null = null;
  private _pendingImageNatural: { w: number; h: number } | null = null;
  private _pendingCodeDataUrl: string | null = null;
  private _pendingCodeOptions: { codeType: string; data: string; qrStyle: QRStyleOptions | null; bwipOpts: BwipOptions | null } | null = null;
  private _pendingCodeNatural: { w: number; h: number } | null = null;
  private _skipNextClick = false;
  private _placementGhost: HTMLDivElement | null = null;

  constructor(private readonly _ctx: IPlacementContext) {}

  consumeSkipNextClick(): boolean {
    if (this._skipNextClick) { this._skipNextClick = false; return true; }
    return false;
  }

  hasPendingImageSrc(): boolean { return this._pendingImageSrc !== null; }

  setPendingCode(
    dataUrl: string,
    options: { codeType: string; data: string; qrStyle: QRStyleOptions | null; bwipOpts: BwipOptions | null },
    natural: { w: number; h: number },
  ): void {
    this._pendingCodeDataUrl = dataUrl;
    this._pendingCodeOptions = options;
    this._pendingCodeNatural = natural;
  }

  hidePlacementGhost(): void {
    if (this._placementGhost) this._placementGhost.style.display = 'none';
  }

  handleImageFileSelect(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file || !this._ctx.documentModel.currentPage) return;
    if (!file.type.startsWith('image/')) {
      this._ctx.reportError.warn('toast.selectImageFile');
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
        this._ctx.setMode('addImage');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  addImageAtPosition(e: MouseEvent): void {
    const src = this._pendingImageSrc;
    const pageId = this._ctx.documentModel.currentPage?.id;
    if (!src || !pageId) return;
    this._pendingImageSrc = null;
    const rect = this._ctx.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this._ctx.zoomScale;
    const y = (e.clientY - rect.top) / this._ctx.zoomScale;
    const imgEl = new ImageElement(x - 100, y - 75, 200, 150, pageId, src);
    this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, imgEl));
    this._ctx.autosave();
    this._ctx.setMode('select');
    this._ctx.rebuildElementLayer();
    this._ctx.selectElement(imgEl);
  }

  commitPlacement(mode: 'addText' | 'addImage' | 'addComment' | 'addSignature' | 'addCode', x: number, y: number, w: number, h: number): void {
    const pageId = this._ctx.documentModel.currentPage?.id;
    if (!pageId) return;
    this._skipNextClick = true;

    if (mode === 'addText') {
      const fw = w < 10 ? 200 : w;
      const fh = h < 10 ? 40 : h;
      const options = {
        fontSize: parseInt(this._ctx.ui.fontSizeInput.value),
        color: this._ctx.ui.colorInput.value,
        width: fw,
        height: fh,
      };
      const textEl = new TextElement(x, y, pageId, options);
      this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, textEl));
      this._ctx.autosave();
      this._ctx.rebuildElementLayer();
      const inputEl = this._ctx.ui.container.querySelector(
        `[data-id='${textEl.id}'] input, [data-id='${textEl.id}'] textarea`
      ) as HTMLInputElement | null;
      if (inputEl) {
        (inputEl as HTMLElement).style.pointerEvents = 'auto';
        inputEl.focus();
      }
      this._ctx.setMode('select');
      this._ctx.selectElement(textEl);
      const freshInput = this._ctx.ui.container.querySelector(
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
      this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, imgEl));
      this._ctx.autosave();
      this._ctx.setMode('select');
      this._ctx.rebuildElementLayer();
      this._ctx.selectElement(imgEl);

    } else if (mode === 'addComment') {
      const fw = w < 10 ? 200 : w;
      const fh = h < 10 ? 120 : h;
      const commentEl = new CommentElement(x, y, pageId, { width: fw, height: fh });
      this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, commentEl));
      this._ctx.autosave();
      this._ctx.setMode('select');
      this._ctx.rebuildElementLayer();
      this._ctx.selectElement(commentEl);

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
      this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, codeEl));
      this._ctx.autosave();
      this._ctx.setMode('select');
      this._ctx.rebuildElementLayer();
      this._ctx.selectElement(codeEl);

    } else {
      const sig = this._ctx.currentSignature;
      if (!sig) return;
      this._ctx.currentSignature = null;
      this._ctx.ui.addSignatureBtn.classList.remove('active');
      const nat = this._ctx.signatureNatural;
      this._ctx.signatureNatural = null;
      const fw = w < 10 ? 200 : w;
      const fh = w < 10
        ? (nat ? Math.round(200 * nat.h / nat.w) : 80)
        : (nat ? Math.round(fw * nat.h / nat.w) : h);
      const sigEl = new SignatureElement(x, y, pageId, sig, { width: fw, height: fh });
      this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, sigEl));
      this._ctx.autosave();
      this._ctx.setMode('select');
      this._ctx.rebuildElementLayer();
      this._ctx.selectElement(sigEl);
    }
  }

  addTextAtPosition(e: MouseEvent): void {
    const pageId = this._ctx.documentModel.currentPage?.id;
    if (!pageId) return;
    const rect = this._ctx.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this._ctx.zoomScale;
    const y = (e.clientY - rect.top) / this._ctx.zoomScale;
    const options = { fontSize: parseInt(this._ctx.ui.fontSizeInput.value), color: this._ctx.ui.colorInput.value };
    const textElement = new TextElement(x, y, pageId, options);
    textElement.x -= textElement.width / 2;
    textElement.y -= textElement.height / 2;
    this._ctx.historyManager.execute(new AddElementCmd(this._ctx.elements, textElement));
    this._ctx.autosave();
    this._ctx.rebuildElementLayer();
    // Focus BEFORE selectElement so _cleanEmptyTextElements sees activeElement === input
    const inputEl = this._ctx.ui.container.querySelector(
      `[data-id='${textElement.id}'] input, [data-id='${textElement.id}'] textarea`
    ) as HTMLInputElement | null;
    if (inputEl) {
      (inputEl as HTMLElement).style.pointerEvents = 'auto';
      inputEl.focus();
    }
    this._ctx.selectElement(textElement);
    // selectElement calls rebuildElementLayer() which recreates DOM — re-query and re-focus
    const freshInput = this._ctx.ui.container.querySelector(
      `[data-id='${textElement.id}'] input, [data-id='${textElement.id}'] textarea`
    ) as HTMLInputElement | null;
    freshInput?.focus();
  }

  updatePlacementGhost(e: PointerEvent): void {
    const placementModes: ToolMode[] = ['addText', 'addComment', 'addImage', 'addSignature'];
    if (!placementModes.includes(this._ctx.mode)) {
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
      addText:      { icon: 'T', w: 80, h: 28 },
      addComment:   { icon: '🗒', w: 80, h: 60 },
      addImage:     { icon: '🖼', w: 60, h: 60 },
      addSignature: { icon: '✍', w: 80, h: 40 },
    };
    const c = cfg[this._ctx.mode] ?? { icon: '+', w: 40, h: 40 };
    ghost.textContent = c.icon;
    ghost.style.width  = c.w + 'px';
    ghost.style.height = c.h + 'px';
    ghost.style.left   = (e.clientX + 12) + 'px';
    ghost.style.top    = (e.clientY + 12) + 'px';
    ghost.style.display = 'flex';
  }
}
