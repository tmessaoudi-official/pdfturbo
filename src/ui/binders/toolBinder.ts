import type { PDFTurboApp } from '../../core/pdfTurboApp';

export function bindToolEvents(app: PDFTurboApp): void {
  app.ui.selectBtn.addEventListener('click', () => app.setMode('select'));
  app.ui.addTextBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
    app.setMode(app.mode === 'addText' ? 'select' : 'addText');
  });
  app.ui.addSignatureBtn.addEventListener('click', () => {
    if (!app.documentModel.pageCount) return;
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
