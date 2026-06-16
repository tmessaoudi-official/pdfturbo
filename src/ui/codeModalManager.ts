import type { ToolMode } from '../core/pdfTurboApp';
import type { CodeElement } from '../elements/codeElement';
import type { PDFElement } from '../elements/annotationElement';
import { generateCodeDataUrl, type QRStyleOptions, type BwipOptions } from '../utils/codeGenerator';
import type { AppDOMRefs } from './uiController';
import { trapFocus } from '../utils/focusTrap';
import { t } from '../utils/i18n';

export interface ICodeModalContext {
  readonly ui: AppDOMRefs;
  readonly elements: PDFElement[];
  readonly mode: ToolMode;
  setMode(mode: ToolMode): void;
  autosave(): void;
  rebuildElementLayer(): void;
  setPendingCode(
    dataUrl: string,
    options: { codeType: string; data: string; qrStyle: QRStyleOptions | null; bwipOpts: BwipOptions | null },
    natural: { w: number; h: number },
  ): void;
}

export class CodeModalManager {
  private _editingId: number | null = null;
  private _gen = 0;
  private _previewDebounce: ReturnType<typeof setTimeout> | null = null;
  private _qrLogoDataUrl: string | null = null;
  private _trapCleanup: (() => void) | null = null;

  constructor(private readonly _ctx: ICodeModalContext) {}

  setQrLogoDataUrl(val: string | null): void { this._qrLogoDataUrl = val; }

  open(el?: CodeElement): void {
    const ui = this._ctx.ui;
    this._editingId = el?.id ?? null;
    this._qrLogoDataUrl = null;
    ui.codeFormatSelect.value = el?.codeType ?? 'qrcode';
    ui.codeDataInput.value = el?.data ?? '';
    const qs = el?.qrStyle;
    ui.qrStyledChk.checked = qs?.styled ?? false;
    ui.qrEclevelSelect.value = qs?.eclevel ?? 'M';
    ui.qrDotStyle.value = qs?.dotType ?? 'square';
    ui.qrDotColor.value = qs?.dotColor ?? '#000000';
    ui.qrBgColor.value = qs?.bgColor ?? '#ffffff';
    ui.qrLogoInput.value = '';
    this._qrLogoDataUrl = qs?.logoSrc ?? null;
    ui.qrLogoName.textContent = qs?.logoSrc ? t('modal.code.logoExisting') : '';
    ui.qrLogoClearBtn.style.display = qs?.logoSrc ? '' : 'none';
    const bo = el?.bwipOpts;
    ui.barcodeShowTextChk.checked = bo?.includetext ?? true;
    this.syncVisibility();
    ui.codePreviewImg.style.display = 'none';
    ui.codePreviewImg.src = '';
    ui.codePreviewStatus.textContent = '';
    ui.saveCodeModal.disabled = true;
    const titleEl = ui.codeModal.querySelector('h2');
    if (titleEl) titleEl.textContent = el ? t('modal.code.titleEdit') : t('modal.code.title');
    ui.saveCodeModal.textContent = el ? t('modal.code.update') : t('modal.code.place');
    ui.codeModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(
      ui.codeModal.querySelector('.code-modal-content') as HTMLElement,
      ui.addCodeBtn,
    );
    if (ui.codeDataInput.value.trim()) this.triggerPreview(0);
  }

  close(): void {
    const ui = this._ctx.ui;
    ui.codeModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
    if (this._editingId === null && this._ctx.mode !== 'addCode') {
      this._ctx.setMode('select');
    }
    this._editingId = null;
  }

  async save(): Promise<void> {
    const ui = this._ctx.ui;
    const fmt = ui.codeFormatSelect.value;
    const data = ui.codeDataInput.value.trim();
    if (!data) return;
    const qrStyle = this._getQrStyleOptions();
    const bwipOpts = this._getCodeBwipOpts();
    ui.saveCodeModal.disabled = true;
    ui.codePreviewStatus.textContent = t('modal.code.generating');
    try {
      const dataUrl = await generateCodeDataUrl(fmt, data, qrStyle, bwipOpts);
      const nat = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        // M0 #11 — without this the await would hang forever on a bad dataURL,
        // leaving the Save button permanently disabled. The catch below re-enables it.
        img.onerror = () => reject(new Error('Failed to render the code image'));
        img.src = dataUrl;
      });
      const editingId = this._editingId;
      ui.codeModal.classList.remove('active');
      this._trapCleanup?.();
      this._trapCleanup = null;
      this._editingId = null;

      if (editingId !== null) {
        const el = this._ctx.elements.find(x => x.id === editingId) as CodeElement | undefined;
        if (el) {
          el.codeType = fmt;
          el.data = data;
          el.qrStyle = qrStyle ?? null;
          el.bwipOpts = bwipOpts;
          el.cachedDataUrl = dataUrl;
          this._ctx.autosave();
          this._ctx.rebuildElementLayer();
        }
      } else {
        this._ctx.setPendingCode(
          dataUrl,
          { codeType: fmt, data, qrStyle: qrStyle ?? null, bwipOpts },
          nat,
        );
        this._ctx.setMode('addCode');
      }
    } catch (e) {
      ui.codePreviewStatus.textContent = String(e).replace(/^Error:\s*/, '');
      ui.saveCodeModal.disabled = false;
    }
  }

  syncVisibility(): void {
    const ui = this._ctx.ui;
    const fmt = ui.codeFormatSelect.value;
    const isQr = fmt === 'qrcode';
    const is2D = ['qrcode', 'datamatrix', 'pdf417', 'azteccode'].includes(fmt);
    ui.qrStyleSection.style.display = isQr ? '' : 'none';
    ui.qrStyleControls.style.display = (isQr && ui.qrStyledChk.checked) ? '' : 'none';
    ui.barcodeShowTextRow.style.display = is2D ? 'none' : '';
  }

  triggerPreview(delay = 400): void {
    clearTimeout(this._previewDebounce ?? undefined);
    this._previewDebounce = setTimeout(() => void this._runPreview(), delay);
  }

  private _getQrStyleOptions(): QRStyleOptions | null {
    const ui = this._ctx.ui;
    if (ui.codeFormatSelect.value !== 'qrcode') return null;
    const eclevel = ui.qrEclevelSelect.value;
    if (!ui.qrStyledChk.checked) return { styled: false, eclevel };
    return {
      styled: true,
      eclevel,
      dotType: ui.qrDotStyle.value,
      dotColor: ui.qrDotColor.value,
      bgColor: ui.qrBgColor.value,
      ...(this._qrLogoDataUrl ? { logoSrc: this._qrLogoDataUrl } : {}),
    };
  }

  private _getCodeBwipOpts(): BwipOptions | null {
    const is2D = ['qrcode', 'datamatrix', 'pdf417', 'azteccode'].includes(this._ctx.ui.codeFormatSelect.value);
    if (is2D) return null;
    return { includetext: this._ctx.ui.barcodeShowTextChk.checked };
  }

  private async _runPreview(): Promise<void> {
    const ui = this._ctx.ui;
    const gen = ++this._gen;
    const fmt = ui.codeFormatSelect.value;
    const data = ui.codeDataInput.value.trim();
    if (!data) {
      ui.codePreviewImg.style.display = 'none';
      ui.codePreviewStatus.textContent = '';
      ui.saveCodeModal.disabled = true;
      return;
    }
    ui.saveCodeModal.disabled = true;
    ui.codePreviewStatus.textContent = t('modal.code.generating');
    try {
      const dataUrl = await generateCodeDataUrl(fmt, data, this._getQrStyleOptions(), this._getCodeBwipOpts());
      if (gen !== this._gen) return;
      ui.codePreviewImg.src = dataUrl;
      ui.codePreviewImg.style.display = 'block';
      ui.codePreviewStatus.textContent = '';
      ui.saveCodeModal.disabled = false;
    } catch (e) {
      if (gen !== this._gen) return;
      ui.codePreviewImg.style.display = 'none';
      ui.codePreviewStatus.textContent = String(e).replace(/^Error:\s*/, '');
      ui.saveCodeModal.disabled = true;
    }
  }
}
