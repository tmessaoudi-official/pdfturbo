import type { AppDOMRefs } from '../ui/uiController';
import type { SignaturePad } from '../utils/signaturePad';
import type { IErrorReporter } from '../contracts/errorReporter';
import type { ToolMode } from '../types/tools';
import type { SetModeOptions } from './toolModeService';
import { trapFocus } from '../utils/focusTrap';

export interface ISignatureContext {
  readonly ui: AppDOMRefs;
  readonly signaturePad: SignaturePad;
  readonly reportError: IErrorReporter;
  getTrapCleanup(): (() => void) | null;
  setTrapCleanup(fn: (() => void) | null): void;
  setMode(mode: ToolMode, opts?: SetModeOptions): void;
}

export class SignatureManager {
  currentSignature: string | null = null;
  private _signatureNatural: { w: number; h: number } | null = null;

  constructor(private readonly _ctx: ISignatureContext) {}

  get signatureNatural(): { w: number; h: number } | null { return this._signatureNatural; }
  set signatureNatural(v: { w: number; h: number } | null) { this._signatureNatural = v; }

  openModal(): void {
    this._ctx.ui.signatureModal.classList.add('active');
    const w = this._ctx.ui.signatureCanvas.offsetWidth || 500;
    this._ctx.ui.signatureCanvas.width = w;
    this._ctx.ui.signatureCanvas.height = Math.round(w * 0.4);
    this._ctx.signaturePad.clear();
    this._ctx.getTrapCleanup()?.();
    this._ctx.setTrapCleanup(trapFocus(
      this._ctx.ui.signatureModal.querySelector('.signature-content') as HTMLElement,
      this._ctx.ui.addSignatureBtn,
    ));
  }

  closeModal(): void {
    this._ctx.ui.signatureModal.classList.remove('active');
    this._ctx.getTrapCleanup()?.();
    this._ctx.setTrapCleanup(null);
    this._ctx.setMode('select');
    this._ctx.ui.addSignatureBtn.classList.remove('active');
  }

  save(): void {
    if (this._ctx.signaturePad.isEmpty()) {
      this._ctx.reportError.warn('toast.drawSignatureFirst');
      return;
    }
    this.currentSignature = this._ctx.signaturePad.getDataURL();
    this._signatureNatural = { w: this._ctx.ui.signatureCanvas.width, h: this._ctx.ui.signatureCanvas.height };
    this._ctx.ui.signatureModal.classList.remove('active');
    this._ctx.getTrapCleanup()?.();
    this._ctx.setTrapCleanup(null);
    // Arm placement mode WITHOUT re-opening the modal — re-opening would clear the
    // just-captured pad and make the signature appear to "reset on Save" (QA 2026-06-17).
    this._ctx.setMode('addSignature', { suppressSignatureModal: true });
    this._ctx.ui.addSignatureBtn.classList.add('active');
  }
}
