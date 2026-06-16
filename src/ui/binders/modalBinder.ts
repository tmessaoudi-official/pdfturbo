import type { PDFTurboApp, ToolMode } from '../../core/pdfTurboApp';
import { FlyoutManager } from '../flyoutManager';
import { randomOwnerPassword } from '../../export/encryption';
import { confirmDestructive } from '../confirmDialog';

export function bindModalEvents(app: PDFTurboApp): void {
  // ── Signature modal ────────────────────────────────────────────
  document.getElementById('clearSignature')?.addEventListener('click', () => app.signaturePad.clear());
  document.getElementById('cancelSignature')?.addEventListener('click', () => app.closeSignatureModal());
  document.getElementById('saveSignature')?.addEventListener('click', () => app.saveSignature());
  app.ui.sigLineWidthInput.addEventListener('change', (e) => {
    app.signaturePad.setLineWidth(parseInt((e.target as HTMLInputElement).value, 10));
  });
  app.ui.sigColorInput.addEventListener('change', (e) => {
    app.signaturePad.setColor((e.target as HTMLInputElement).value);
  });

  // ── OCR modal ──────────────────────────────────────────────────
  app.ui.cancelOcrModal.addEventListener('click', () => app.closeOcrModal());
  app.ui.runOcrModal.addEventListener('click', () => void app.runOcr());

  // ── Sign modal ─────────────────────────────────────────────────
  app.ui.cancelSignModal.addEventListener('click', () => app.closeSignModal());
  app.ui.runSignModal.addEventListener('click', () => void app.signPdf());
  app.ui.signModal.addEventListener('click', (e) => {
    if (e.target === app.ui.signModal) app.closeSignModal();
  });
  // Certificate source toggle: show the upload fields or the generate fields.
  const syncSignSource = (): void => {
    const generate = (document.getElementById('signSourceGenerate') as HTMLInputElement | null)?.checked ?? false;
    const upload = document.getElementById('signUploadGroup');
    const gen = document.getElementById('signGenGroup');
    if (upload) upload.style.display = generate ? 'none' : '';
    if (gen) gen.style.display = generate ? '' : 'none';
  };
  document.getElementById('signSourceUpload')?.addEventListener('change', syncSignSource);
  document.getElementById('signSourceGenerate')?.addEventListener('change', syncSignSource);

  // ── Code modal ─────────────────────────────────────────────────
  app.ui.cancelCodeModal.addEventListener('click', () => app.closeCodeModal());
  app.ui.saveCodeModal.addEventListener('click', () => void app.saveCodeModal());
  app.ui.codeFormatSelect.addEventListener('change', () => { app._syncCodeOptionsVisibility(); app._triggerCodePreview(); });
  app.ui.codeDataInput.addEventListener('input', () => app._triggerCodePreview());
  app.ui.qrStyledChk.addEventListener('change', () => { app._syncCodeOptionsVisibility(); app._triggerCodePreview(); });
  app.ui.qrEclevelSelect.addEventListener('change', () => app._triggerCodePreview());
  app.ui.barcodeShowTextChk.addEventListener('change', () => app._triggerCodePreview());
  app.ui.qrDotStyle.addEventListener('change', () => app._triggerCodePreview());
  app.ui.qrDotColor.addEventListener('input', () => app._triggerCodePreview());
  app.ui.qrBgColor.addEventListener('input', () => app._triggerCodePreview());
  app.ui.qrLogoInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      app._setQrLogoDataUrl((ev.target?.result as string) ?? null);
      app.ui.qrLogoName.textContent = file.name;
      app.ui.qrLogoClearBtn.style.display = '';
      app._triggerCodePreview();
    };
    reader.readAsDataURL(file);
  });
  app.ui.qrLogoClearBtn.addEventListener('click', () => {
    app._setQrLogoDataUrl(null);
    app.ui.qrLogoInput.value = '';
    app.ui.qrLogoName.textContent = '';
    app.ui.qrLogoClearBtn.style.display = 'none';
    app._triggerCodePreview();
  });

  // ── File menu + flyouts ────────────────────────────────────────
  app.ui.fileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = app.ui.fileMenuWrap.classList.toggle('open');
    if (isOpen) {
      const rect = app.ui.fileMenuBtn.getBoundingClientRect();
      const drop = app.ui.fileMenuWrap.querySelector('.file-menu-dropdown') as HTMLElement;
      drop.style.top  = (rect.bottom + 4) + 'px';
      drop.style.left = rect.left + 'px';
    }
  });
  const flyoutManager = new FlyoutManager();
  flyoutManager.register({
    wrap: app.ui.drawFlyoutWrap,
    trigger: app.ui.drawBtn,
    flyout: document.getElementById('drawFlyout') as HTMLElement,
    closeWhen: 'aria-pressed',
  });
  flyoutManager.register({
    wrap: app.ui.annotateFlyoutWrap,
    trigger: app.ui.annotateBtn,
    flyout: document.getElementById('annotateFlyout') as HTMLElement,
    closeWhen: 'aria-pressed',
  });
  flyoutManager.register({
    wrap: app.ui.textSplitWrap,
    trigger: app.ui.textChevronBtn,
    flyout: document.getElementById('textFlyout') as HTMLElement,
    closeWhen: 'closest-aria-pressed',
  });
  flyoutManager.register({
    wrap: app.ui.exportSplitWrap,
    trigger: app.ui.exportChevronBtn,
    flyout: document.getElementById('exportFlyout') as HTMLElement,
    closeWhen: 'any-click',
  });
  flyoutManager.wireGlobalClose();
  app.ui.textModeBtn.addEventListener('click', () => {
    app.ui.textSplitWrap.classList.remove('open');
    app.ui.textChevronBtn.setAttribute('aria-expanded', 'false');
    if (!app.documentModel.pageCount) return;
    const m = (app.ui.textModeBtn.dataset['mode'] ?? 'addText') as ToolMode;
    app.setMode(app.mode === m ? 'select' : m);
  });
  document.addEventListener('click', (e) => {
    if (!app.ui.fileMenuWrap.contains(e.target as Node)) {
      app.ui.fileMenuWrap.classList.remove('open');
    }
  });
  app.ui.fileMenuOpen.addEventListener('click', () => {
    app.ui.fileMenuWrap.classList.remove('open');
    app.ui.fileInput.click();
  });
  app.ui.fileMenuClose.addEventListener('click', () => {
    app.ui.fileMenuWrap.classList.remove('open');
    // Non-undoable: confirm before discarding the open document (skip when none open).
    if (app.documentModel.pages.length === 0) { app._closeDocument(); return; }
    confirmDestructive({ messageKey: 'modal.confirmClose.message' })
      .then(ok => { if (ok) app._closeDocument(); })
      .catch(() => {});
  });
  app.ui.fileMenuClearAnnotations.addEventListener('click', () => {
    app.ui.fileMenuWrap.classList.remove('open');
    app.clearAll();
  });
  app.ui.fileMenuResetSession.addEventListener('click', () => {
    app.ui.fileMenuWrap.classList.remove('open');
    // Non-undoable: confirm before wiping the saved session (skip when none open).
    if (app.documentModel.pages.length === 0) { app._clearSave(); return; }
    confirmDestructive({ messageKey: 'modal.confirmReset.message' })
      .then(ok => { if (ok) app._clearSave(); })
      .catch(() => {});
  });
  document.getElementById('fileMenuBlankPage')?.addEventListener('click', () => {
    app.ui.fileMenuWrap.classList.remove('open');
    app._openBlankPageModal();
  });

  // ── Blank page modal ───────────────────────────────────────────
  const blankModal = document.getElementById('blankPageModal') as HTMLElement;
  const blankSizeSelect = document.getElementById('blankPageSize') as HTMLSelectElement;
  const blankCustomDiv = document.getElementById('blankPageCustomSize') as HTMLElement;
  blankSizeSelect?.addEventListener('change', () => {
    blankCustomDiv.style.display = blankSizeSelect.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('blankPageCancelBtn')?.addEventListener('click', () => {
    blankModal.style.display = 'none';
  });
  blankModal?.addEventListener('click', (e) => { if (e.target === blankModal) blankModal.style.display = 'none'; });
  document.getElementById('blankPageInsertBtn')?.addEventListener('click', () => {
    app._insertBlankPage();
    blankModal.style.display = 'none';
  });

  // ── Password modal ─────────────────────────────────────────────
  const pdfPwdModal = document.getElementById('pdfPasswordModal') as HTMLElement;
  const pdfPwdInput = document.getElementById('pdfPasswordInput') as HTMLInputElement;
  const pdfPwdError = document.getElementById('pdfPasswordError') as HTMLElement;
  const pdfPwdToggle = document.getElementById('pdfPasswordToggle') as HTMLButtonElement;
  pdfPwdToggle?.addEventListener('click', () => {
    pdfPwdInput.type = pdfPwdInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('pdfPasswordSubmitBtn')?.addEventListener('click', () => {
    const pw = pdfPwdInput.value;
    if (!pw) { pdfPwdError.style.display = 'block'; return; }
    pdfPwdError.style.display = 'none';
    pdfPwdModal.style.display = 'none';
    app._pendingPasswordResolve?.(pw);
    app._pendingPasswordResolve = null;
  });
  pdfPwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('pdfPasswordSubmitBtn')?.click();
  });
  document.getElementById('pdfPasswordCancelBtn')?.addEventListener('click', () => {
    pdfPwdModal.style.display = 'none';
    app._pendingPasswordResolve?.(null);
    app._pendingPasswordResolve = null;
  });
  pdfPwdModal?.addEventListener('click', (e) => {
    if (e.target === pdfPwdModal) {
      pdfPwdModal.style.display = 'none';
      app._pendingPasswordResolve?.(null);
      app._pendingPasswordResolve = null;
    }
  });

  // ── Lock PDF modal ─────────────────────────────────────────────
  const lockModal = document.getElementById('lockPdfModal') as HTMLElement;
  document.getElementById('fileMenuLockPdf')?.addEventListener('click', () => {
    app.ui.fileMenuWrap.classList.remove('open');
    lockModal.style.display = 'flex';
    const status = document.getElementById('lockPdfStatus') as HTMLElement;
    status.style.display = app._exportPassword ? 'block' : 'none';
    (document.getElementById('lockUserPassword') as HTMLInputElement).value = app._exportPassword?.user ?? '';
    (document.getElementById('lockOwnerPassword') as HTMLInputElement).value = app._exportPassword?.owner ?? '';
  });
  document.getElementById('lockPdfApplyBtn')?.addEventListener('click', () => {
    const user = (document.getElementById('lockUserPassword') as HTMLInputElement).value.trim();
    if (!user) { app.reportError.warn('toast.passwordRequired'); return; }
    // CORE-P0-2/CORE-7: when no owner password is given, generate a strong random
    // one instead of reusing the user password — owner==user makes the permission
    // flags trivially strippable (anyone with the open password gains owner rights).
    const owner = (document.getElementById('lockOwnerPassword') as HTMLInputElement).value.trim()
      || randomOwnerPassword();
    app._exportPassword = { user, owner };
    const status = document.getElementById('lockPdfStatus') as HTMLElement;
    status.style.display = 'block';
    lockModal.style.display = 'none';
    app.reportError.info('toast.pdfWillBeLocked');
  });
  document.getElementById('lockPdfRemoveBtn')?.addEventListener('click', () => {
    app._exportPassword = null;
    (document.getElementById('lockPdfStatus') as HTMLElement).style.display = 'none';
    lockModal.style.display = 'none';
    app.reportError.info('toast.pdfLockRemoved');
  });
  document.getElementById('lockPdfCancelBtn')?.addEventListener('click', () => { lockModal.style.display = 'none'; });
  lockModal?.addEventListener('click', (e) => { if (e.target === lockModal) lockModal.style.display = 'none'; });

  // ── Help / Settings ────────────────────────────────────────────
  app.ui.helpBtn.addEventListener('click', () => app._toggleHelp());
  document.getElementById('closeHelp')?.addEventListener('click', () => app._toggleHelp(false));
  app.ui.helpModal.addEventListener('click', (e) => { if (e.target === app.ui.helpModal) app._toggleHelp(false); });
  app.ui.settingsBtn.addEventListener('click', () => app._toggleSettings());
  app.ui.closeSettingsBtn.addEventListener('click', () => app._toggleSettings(false));
  app.ui.settingsPanel.addEventListener('click', (e) => { if (e.target === app.ui.settingsPanel) app._toggleSettings(false); });
  app.ui.resetToolbarBtn.addEventListener('click', () => {
    app._resetToolbarLayout();
    app._toggleSettings(false);
  });

  // ── Watermark modal ────────────────────────────────────────────
  app.ui.watermarkBtn.addEventListener('click', () => app._openWatermarkModal());
  app.ui.wmCancel.addEventListener('click', () => app._closeWatermarkModal());
  let _wmBackdropDown = false;
  app.ui.watermarkModal.addEventListener('mousedown', (e) => { _wmBackdropDown = e.target === app.ui.watermarkModal; });
  app.ui.watermarkModal.addEventListener('mouseup', (e) => {
    if (_wmBackdropDown && e.target === app.ui.watermarkModal) app._closeWatermarkModal();
    _wmBackdropDown = false;
  });
  app.ui.wmApply.addEventListener('click', () => app._applyWatermark());
  app._setupWatermarkPreviewListeners();

  // ── Export preview ─────────────────────────────────────────────
  app.ui.previewExportBtn.addEventListener('click', () => {
    if (app._exportPreviewOpen) app._hideExportPreview();
    else if (app.documentModel.currentPage) app._showExportPreview();
  });
  app.ui.exportDocxBtn.addEventListener('click', () => void app.exportAsDocx());
  app.ui.exportMdBtn.addEventListener('click', () => void app.exportAsMarkdown());
  app.ui.exportPreviewClose.addEventListener('click', () => app._hideExportPreview());
  app.ui.exportPreviewConfirm.addEventListener('click', () => {
    app._hideExportPreview();
    app.downloadPDF();
  });
}
