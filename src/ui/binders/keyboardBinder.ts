import type { PDFTurboApp } from '../../core/pdfTurboApp';
import { ShapeElement } from '../../elements/shapeElement';
import { isEnabled } from '../../config/features';

/**
 * Esc-dismiss a `style.display`-toggled modal by clicking its Cancel button (so any
 * close-time side effects — e.g. resolving the pending-password promise — run exactly
 * as they do on a mouse click). Returns true when a visible modal was dismissed.
 */
function dismissDisplayModal(modalId: string, cancelBtnId: string): boolean {
  const m = document.getElementById(modalId);
  if (m && (m as HTMLElement).style.display !== 'none') {
    document.getElementById(cancelBtnId)?.click();
    return true;
  }
  return false;
}

export function bindKeyboardEvents(app: PDFTurboApp): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (app.ui.settingsPanel.classList.contains('active')) { app._toggleSettings(false); return; }
      if (app.ui.helpModal.classList.contains('active')) { app._toggleHelp(false); return; }
      if (app.ui.signatureModal.classList.contains('active')) { app.closeSignatureModal(); return; }
      if (app.ui.watermarkModal.classList.contains('active')) { app._closeWatermarkModal(); return; }
      if (app.ui.batesModal.classList.contains('active')) { app._closeBatesModal(); return; }
      if (app.ui.compressModal.classList.contains('active')) { app._closeCompressModal(); return; }
      if (app.ui.codeModal.classList.contains('active')) { app.closeCodeModal(); return; }
      if (app.ui.signModal.classList.contains('active')) { app.closeSignModal(); return; }
      if (app.ui.signersModal.classList.contains('active')) { app.closeSignersPanel(); return; }
      // F-C C2: Esc while picking the sign rect cancels the pick and reopens the modal
      // (it was hidden, not closed) so the user is never stranded in signRect mode.
      if (app.mode === 'signRect') { void app.onSignRectPicked(null); return; }
      if (app.ui.ocrModal.classList.contains('active')) { app.closeOcrModal(); return; }
      // The page-op modals toggle `style.display` (not `.active`) and some carry close-time
      // side effects (pdfPasswordModal resolves a pending-load promise with null). Reuse their
      // existing Cancel-button logic rather than duplicating it, so Esc == clicking Cancel.
      if (dismissDisplayModal('blankPageModal', 'blankPageCancelBtn')) return;
      if (dismissDisplayModal('pdfPasswordModal', 'pdfPasswordCancelBtn')) return;
      if (dismissDisplayModal('lockPdfModal', 'lockPdfCancelBtn')) return;
      if (dismissDisplayModal('extractPagesModal', 'extractPagesCancelBtn')) return;
      if (app.ui.findBar.style.display !== 'none') { app._closeFindBar(); return; }
      app.setMode('select');
      app.selectElement(null);
      (document.activeElement as HTMLElement)?.blur();
      return;
    }
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); break;
        case 'y': e.preventDefault(); app.redo(); break;
        case 'f': e.preventDefault(); if (app.documentModel.pageCount) app._openFindBar(); break;
        case 'c': if (!window.getSelection()?.toString()) { e.preventDefault(); app._copySelectedElement(); } break;
        case 'v': e.preventDefault(); app._pasteElement(); break;
        case 'arrowright': e.preventDefault(); app.nextPage(); break;
        case 'arrowleft':  e.preventDefault(); app.prevPage(); break;
      }
      return;
    }
    switch (e.key) {
      case 'Delete': case 'Backspace':
        if (app.selectedElement) {
          e.preventDefault();
          app.removeElement(app.selectedElement.id);
          app.selectedElement = null;
          app._updateFormattingToolbar();
        }
        break;
      case 't': case 'T':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'addText' ? 'select' : 'addText');
        break;
      case 's': case 'S':
        // Leak guard (F-D D2): mirror the ✍ button — the plain shortcut path
        // never carries a Signers-panel caption.
        if (app.documentModel.pageCount) {
          app.clearPendingSignatureCaption();
          app.setMode(app.mode === 'addSignature' ? 'select' : 'addSignature');
        }
        break;
      case 'i': case 'I': if (app.documentModel.pageCount) app.ui.addImageInput.click(); break;
      case 'a': case 'A':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawArrow' ? 'select' : 'drawArrow');
        break;
      case 'r': case 'R':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawRect' ? 'select' : 'drawRect');
        break;
      case 'c': case 'C':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawEllipse' ? 'select' : 'drawEllipse');
        break;
      case 'b': case 'B':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'fillBucket' ? 'select' : 'fillBucket');
        break;
      case 'd': case 'D':
      case 'f': case 'F':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawFreehand' ? 'select' : 'drawFreehand');
        break;
      case 'h': case 'H':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawHighlight' ? 'select' : 'drawHighlight');
        break;
      case 'n': case 'N':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'addComment' ? 'select' : 'addComment');
        break;
      case 'e': case 'E':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawErase' ? 'select' : 'drawErase');
        break;
      case 'x': case 'X':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'editText' ? 'select' : 'editText');
        break;
      case 'k': case 'K':
        if (app.documentModel.pageCount) app.setMode(app.mode === 'drawRedaction' ? 'select' : 'drawRedaction');
        break;
      case 'q': case 'Q':
        if (app.documentModel.pageCount) app.openCodeModal();
        break;
      case 'w': case 'W':
        if (app.documentModel.pageCount) app._openWatermarkModal();
        break;
      case 'p': case 'P':
        // Mirror the crop toolbar button (toolBinder); inert when the feature is off
        // (main.ts removes the button) so the advertised `title="Crop page (P)"` works.
        if (app.documentModel.pageCount && isEnabled('crop')) {
          app.setMode(app.mode === 'crop' ? 'select' : 'crop');
        }
        break;
      case '?': app._toggleHelp(); break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
        if (app.selectedElement) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
          app.selectedElement.x += dx;
          app.selectedElement.y += dy;
          const el = app.selectedElement as ShapeElement;
          if (el.x1 !== undefined) { el.x1 += dx; el.x2 += dx; el.y1 += dy; el.y2 += dy; }
          if (Array.isArray(el.points) && el.points.length) {
            el.points = el.points.map((p: {x: number; y: number}) => ({ x: p.x + dx, y: p.y + dy }));
          }
          app.rebuildElementLayer();
        }
        break;
    }
  });
}
