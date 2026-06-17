import type { PDFTurboApp } from '../../core/pdfTurboApp';
import { ShapeElement } from '../../elements/shapeElement';

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
        if (app.documentModel.pageCount) app.setMode(app.mode === 'addSignature' ? 'select' : 'addSignature');
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
