import type { PDFTurboApp } from '../../core/pdfTurboApp';

export function bindNavigationEvents(app: PDFTurboApp): void {
  // M0 #9 — render/zoom/nav are fire-and-forget Promises. Route a rejection to a
  // specific render-failure toast (and the diagnostic ring buffer via reportError)
  // instead of letting it become an unhandled rejection caught only by the generic
  // global boundary (#1). A no-op for non-Promise returns.
  const guard = (p: unknown): void => {
    if (p instanceof Promise) void p.catch((e: unknown) => app.reportError.error('toast.renderFailed', e));
  };

  // ── File loading ───────────────────────────────────────────────
  // (_loadDocument / _handleAddPdfUpload self-handle their errors with specific toasts.)
  app.ui.fileInput.addEventListener('change', (e) => app._loadDocument(e));
  app.ui.addPdfInput.addEventListener('change', (e) => app._handleAddPdfUpload(e));

  // ── Page navigation ────────────────────────────────────────────
  app.ui.prevPageBtn.addEventListener('click', () => guard(app.prevPage()));
  app.ui.nextPageBtn.addEventListener('click', () => guard(app.nextPage()));
  app.ui.firstPage.addEventListener('click', () => guard(app._goToPage(1)));
  app.ui.lastPage.addEventListener('click',  () => guard(app._goToPage(app.documentModel.pageCount)));
  app.ui.pageInput.addEventListener('change', (e) => {
    guard(app._goToPage(parseInt((e.target as HTMLInputElement).value, 10) || 1));
  });
  app.ui.pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
      guard(app._goToPage(parseInt((e.target as HTMLInputElement).value, 10) || 1));
    }
  });

  // ── Zoom / fit ─────────────────────────────────────────────────
  app.ui.zoomInBtn.addEventListener('click',  () => { app._isFitMode = false; guard(app.applyZoom(app.zoomScale + 0.1)); });
  app.ui.zoomOutBtn.addEventListener('click', () => { app._isFitMode = false; guard(app.applyZoom(app.zoomScale - 0.1)); });
  app.ui.fitBtn.addEventListener('click', () => guard(app.fitToWidth()));
  app.ui.container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    app._isFitMode = false;
    guard(app.applyZoom(app.zoomScale + (e.deltaY < 0 ? 0.05 : -0.05)));
  }, { passive: false });
  // QA-D F2 — re-fit on viewport resize/orientation change so the page doesn't keep a stale zoom and
  // overflow (e.g. desktop→mobile). Only when fit-mode is active and a document is loaded. Debounced.
  let _fitResizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (!app._isFitMode || !app.documentModel.pageCount) return;
    clearTimeout(_fitResizeTimer);
    _fitResizeTimer = setTimeout(() => guard(app.fitToWidth()), 150);
  });

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
  app.ui.findNext.addEventListener('click', () => guard(app._nextMatch()));
  app.ui.findPrev.addEventListener('click', () => guard(app._prevMatch()));
  app.ui.findHighlight.addEventListener('click', () => app._highlightCurrentMatch());
  app.ui.replaceBtn.addEventListener('click', () => app._replaceCurrentMatch());
  app.ui.replaceAllBtn.addEventListener('click', () => app._replaceAllMatches());
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
      if (e.shiftKey) guard(app._prevMatch()); else guard(app._nextMatch());
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
    app.autosave();
  });
}
