import type { PDFTurboApp } from '../../core/pdfTurboApp';

export function bindToolEvents(app: PDFTurboApp): void {
  app.ui.selectBtn.addEventListener('click', () => app.setMode('select'));
  app.ui.addTextBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'addText' ? 'select' : 'addText');
  });
  app.ui.addSignatureBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    // Leak guard (F-D D2): the plain ✍ path must never inherit a caption armed by
    // the Signers panel — clearing here makes that invariant hold by construction.
    app.clearPendingSignatureCaption();
    app.setMode(app.mode === 'addSignature' ? 'select' : 'addSignature');
  });
  app.ui.addImageBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    if (app.mode === 'addImage') { app.setMode('select'); return; }
    app.ui.addImageInput.click();
  });
  app.ui.addImageInput.addEventListener('change', (e) => app._handleImageFileSelect(e));
  app.ui.addCodeBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    if (app.mode === 'addCode') { app.setMode('select'); return; }
    app.openCodeModal();
  });
  app.ui.ocrBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.openOcrModal();
  });
  app.ui.signBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.openSignModal();
  });
  app.ui.highlightBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'drawHighlight' ? 'select' : 'drawHighlight');
  });
  app.ui.commentBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'addComment' ? 'select' : 'addComment');
  });
  app.ui.redactBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'drawRedaction' ? 'select' : 'drawRedaction');
  });
  app.ui.cropBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'crop' ? 'select' : 'crop');
  });
  document.getElementById('cropRemoveBtn')?.addEventListener('click', () => {
    const id = app.documentModel.currentPage?.id;
    if (id) void app.cropPage(id, null, false);
  });
  // #G23 v1b — typed margins, the numeric companion to drag-to-crop. Reads the same
  // #cropApplyAll checkbox the drag path uses, so one control means one thing.
  document.getElementById('cropMarginApplyBtn')?.addEventListener('click', () => {
    const id = app.documentModel.currentPage?.id;
    if (!id) return;
    // An EMPTY input must mean "no margin on this edge", not NaN — marginsToContentCrop is NaN-safe,
    // but parsing here keeps that contract visible at the call site.
    const num = (elId: string): number => {
      const el = document.getElementById(elId) as HTMLInputElement | null;
      const v = Number.parseFloat(el?.value ?? '');
      return Number.isFinite(v) ? v : 0;
    };
    const applyAll = (document.getElementById('cropApplyAll') as HTMLInputElement | null)?.checked ?? false;
    void app.cropPageByMargins(id, {
      top: num('cropMarginTop'),
      right: num('cropMarginRight'),
      bottom: num('cropMarginBottom'),
      left: num('cropMarginLeft'),
    }, applyAll);
  });
  app.ui.editTextBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'editText' ? 'select' : 'editText');
  });
  app.ui.arrowBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'drawArrow' ? 'select' : 'drawArrow');
  });
  app.ui.rectBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'drawRect' ? 'select' : 'drawRect');
  });
  app.ui.circleBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'drawEllipse' ? 'select' : 'drawEllipse');
  });
  app.ui.freehandBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) {
      app._pendingModeAfterBlankPage = 'drawFreehand';
      app._openBlankPageModal();
      return;
    }
    app.setMode(app.mode === 'drawFreehand' ? 'select' : 'drawFreehand');
  });
  app.ui.fillBucketBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'fillBucket' ? 'select' : 'fillBucket');
  });
  app.ui.donePill.addEventListener('click', () => app.setMode('select'));
  app.ui.eraserBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'drawErase' ? 'select' : 'drawErase');
  });
  app.ui.canvas.addEventListener('pointerdown', (e) => app.drawingHandler.handlePointerDown(e));
  app.ui.canvas.addEventListener('pointerdown', (e) => app.eraserHandler.handlePointerDown(e));
  app.ui.canvas.addEventListener('pointerdown', (e) => app.inkLayerHandler.handlePointerDown(e));
}
