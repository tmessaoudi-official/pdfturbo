import type { PDFTurboApp } from '../../core/pdfTurboApp';

export function bindNavigationEvents(app: PDFTurboApp): void {
  // ── File loading ───────────────────────────────────────────────
  app.ui.fileInput.addEventListener('change', (e) => app._loadDocument(e));
  app.ui.addPdfInput.addEventListener('change', (e) => app._handleAddPdfUpload(e));

  // ── Page navigation ────────────────────────────────────────────
  app.ui.prevPageBtn.addEventListener('click', () => app.prevPage());
  app.ui.nextPageBtn.addEventListener('click', () => app.nextPage());
  app.ui.firstPage.addEventListener('click', () => app._goToPage(1));
  app.ui.lastPage.addEventListener('click',  () => app._goToPage(app.documentModel.pageCount));
  app.ui.pageInput.addEventListener('change', (e) => {
    app._goToPage(parseInt((e.target as HTMLInputElement).value) || 1);
  });
  app.ui.pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
      app._goToPage(parseInt((e.target as HTMLInputElement).value) || 1);
    }
  });

  // ── Zoom / fit ─────────────────────────────────────────────────
  app.ui.zoomInBtn.addEventListener('click',  () => { app._isFitMode = false; void app.applyZoom(app.zoomScale + 0.1); });
  app.ui.zoomOutBtn.addEventListener('click', () => { app._isFitMode = false; void app.applyZoom(app.zoomScale - 0.1); });
  app.ui.fitBtn.addEventListener('click', () => void app.fitToWidth());
  app.ui.container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    app._isFitMode = false;
    void app.applyZoom(app.zoomScale + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  // ── Download ───────────────────────────────────────────────────
  app.ui.downloadBtn.addEventListener('click', () => app.downloadPDF());

  // ── Undo / redo / copy / paste ────────────────────────────────
  app.ui.undoBtn.addEventListener('click', () => app.undo());
  app.ui.redoBtn.addEventListener('click', () => app.redo());
  app.ui.copyBtn.addEventListener('click', () => {
    const sel = window.getSelection()?.toString();
    if (sel) { navigator.clipboard.writeText(sel).catch(() => {}); return; }
    app._copySelectedElement();
  });
  app.ui.pasteBtn.addEventListener('click', () => app._pasteElement());
  document.addEventListener('selectionchange', () => app._updateCopyPasteBtns());

  // ── Find bar ───────────────────────────────────────────────────
  app.ui.findBtn.addEventListener('click', () => { if (app.documentModel.pageCount) app._openFindBar(); });
  app.ui.findInput.addEventListener('input', () => {
    clearTimeout(app._searchDebounceTimer ?? undefined);
    app._searchDebounceTimer = setTimeout(() => app._search(), 300);
  });
  app.ui.findNext.addEventListener('click', () => app._nextMatch());
  app.ui.findPrev.addEventListener('click', () => app._prevMatch());
  app.ui.findHighlight.addEventListener('click', () => app._highlightCurrentMatch());
  app.ui.findClose.addEventListener('click', () => app._closeFindBar());
  app.ui.findCaseSensitive.addEventListener('click', () => {
    app._searchManager.caseSensitive = !app._searchManager.caseSensitive;
    app.ui.findCaseSensitive.classList.toggle('active', app._searchManager.caseSensitive);
    if (app.ui.findInput.value) app._search();
  });
  app.ui.findRegex.addEventListener('click', () => {
    app._searchManager.regex = !app._searchManager.regex;
    app.ui.findRegex.classList.toggle('active', app._searchManager.regex);
    if (app.ui.findInput.value) app._search();
  });
  app.ui.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) app._prevMatch(); else app._nextMatch();
    }
    if (e.key === 'Escape') { e.preventDefault(); app._closeFindBar(); }
  });

  // ── Canvas click + pointer events ────────────────────────────
  app.ui.canvas.addEventListener('click', (e) => app.handleCanvasClick(e));
  app.ui.canvas.style.touchAction = 'pan-x pan-y';
  document.addEventListener('pointermove', (e) => {
    app.interactionHandler.handlePointerMove(e);
    app.drawingHandler.handlePointerMove(e);
    app.eraserHandler.handlePointerMove(e);
    app.inkLayerHandler.handlePointerMove(e);
    app._updatePlacementGhost(e);
  });
  document.addEventListener('pointerup', (e) => {
    app.interactionHandler.handlePointerUp(e);
    app.drawingHandler.handlePointerUp(e);
    app.eraserHandler.handlePointerUp(e);
    app.inkLayerHandler.handlePointerUp(e);
  });
  document.addEventListener('pointercancel', (e) => {
    app.interactionHandler.handlePointerCancel(e);
    app.drawingHandler.handlePointerCancel(e);
    app.eraserHandler.cancel();
    app.inkLayerHandler.handlePointerCancel(e);
  });

  // ── Element events ─────────────────────────────────────────────
  app.ui.container.addEventListener('element:delete', (e: Event) => {
    const { id } = (e as CustomEvent<{ id: number }>).detail;
    app.removeElement(id);
    app.selectElement(null);
    app._updateFormattingToolbar();
  });
  app.ui.container.addEventListener('element:autosave', () => {
    app._autosave();
  });
}
