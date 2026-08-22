import type { PDFTurboApp } from '../../core/pdfTurboApp';

/**
 * Did this click land on the PAGE SURFACE — the rendered page itself, rather than some
 * chrome floating above it?
 *
 * The page surface is the canvas plus pdf.js's text layer. The text layer is a sibling
 * overlay spanning the whole page, and `TextLayerManager.setPointerEvents` makes it
 * interactive in SELECT mode so PDF text can be selected and copied — which means that in
 * exactly the mode where clicking empty page area should DESELECT an annotation, the click
 * lands on `.textLayer` and never reaches the canvas. pdf.js emits one span per glyph, so
 * the real target is usually a descendant, hence `closest`.
 *
 * Everything else under `#canvasContainer` is deliberately excluded: `#exportPreviewOverlay`
 * and the annotation layer are children too, and routing their clicks into
 * `handleCanvasClick` would deselect — and in editText/fillBucket modes run canvas-relative
 * coordinate maths — for clicks that are not page clicks. Annotation elements stop
 * propagation themselves (ElementLayerRenderer), so they never arrive here; they are
 * excluded by construction anyway, since neither branch below matches them.
 */
export function isPageSurfaceClick(target: EventTarget | null, canvas: HTMLCanvasElement): boolean {
  if (!(target instanceof Element)) return false;
  if (target === canvas) return true;
  return target.closest('.textLayer') !== null;
}

/**
 * Did this click land on the grey area AROUND the page — the container's own background?
 *
 * That area is not the page surface, so it deliberately gets its own predicate instead of a
 * looser definition of the one above; but a click there is unambiguously "empty space" and
 * must deselect, exactly as a click on empty page area does. Measured on the running app:
 * at fit-to-width the gutter is only 20px, but it grows with every zoom-out step (a 909px
 * canvas in a 1200px container leaves a 146px gap after five, and it keeps growing), and a
 * click anywhere in it left the selection untouched while an identical click on the page
 * cleared it.
 *
 * `target === container` and NOT `closest('#canvasContainer')`: every overlay in that
 * container — `#exportPreviewOverlay`, the ink canvas, the annotation layer — is a
 * DESCENDANT of it, so `closest` would re-admit precisely what `isPageSurfaceClick` exists
 * to exclude. An overlay click always has that overlay (or a child) as its target, so a bare
 * container target can only be the background.
 */
export function isEmptyCanvasAreaClick(target: EventTarget | null, container: HTMLElement): boolean {
  return target === container;
}

/**
 * Route clicks on the page, or on the empty area around it, to the app's canvas-click router.
 *
 * Listening on the CONTAINER rather than the canvas is what lets a click on the text layer
 * through; the two gates are what stop every overlay in that container coming with them.
 *
 * The placement modes (`addText`, `addImage`, `addComment`, `addSignature`, `addCode`) and
 * the shape modes return early inside `CanvasClickRouter.handleCanvasClick`, so a margin
 * click can never drop an element out there. `editText` resolves the click to PDF content
 * coords and finds no text item within tolerance, so it re-shows its hint; `fillBucket`
 * bounds-tests shapes and ink and matches nothing. Only the `select` branch has an effect,
 * and that effect is the deselect this exists for.
 *
 * Exported for unit testing.
 */
export function installCanvasClickRouting(app: Pick<PDFTurboApp, 'ui' | 'handleCanvasClick'>): void {
  app.ui.container.addEventListener('click', (e) => {
    if (!isPageSurfaceClick(e.target, app.ui.canvas) &&
        !isEmptyCanvasAreaClick(e.target, app.ui.container)) return;
    app.handleCanvasClick(e as MouseEvent);
  });
}

/**
 * Re-fit the page to width on viewport WIDTH changes only (rotation, desktop↔mobile) — the
 * reason the QA-D F2 resize handler exists.
 *
 * Mobile keyboard fix: on Android the soft keyboard opening resizes the window, but only its
 * HEIGHT (the layout viewport shrinks; `innerWidth` is unchanged). The previous handler re-fit on
 * EVERY resize, and `fitToWidth → applyZoom → rebuildElementLayer` unconditionally tears down and
 * recreates the element DOM — destroying the focused `<textarea>`/`<input>`. That dismissed the
 * keyboard the instant it appeared, and looped (keyboard-hide grows the viewport → another resize
 * → another rebuild), so the user could not type at all. Gating on a genuine WIDTH change ignores
 * the keyboard entirely while preserving the orientation/desktop↔mobile re-fit. Verified via a
 * real-browser repro: a width-unchanged resize destroyed the focused textarea (focus + DOM node
 * both lost); with this guard it does not.
 *
 * Exported for unit testing; `win` is injectable so tests can drive a fake resize.
 */
export function installRefitOnResize(
  app: Pick<PDFTurboApp, '_isFitMode' | 'documentModel' | 'fitToWidth'>,
  guard: (p: unknown) => void,
  win: Window = window,
): void {
  let lastWidth = win.innerWidth;
  let timer: ReturnType<typeof setTimeout> | undefined;
  win.addEventListener('resize', () => {
    const width = win.innerWidth;
    const widthChanged = width !== lastWidth;
    lastWidth = width;
    if (!widthChanged) return; // height-only resize (soft keyboard) — never re-fit
    if (!app._isFitMode || !app.documentModel.pageCount) return;
    clearTimeout(timer);
    timer = setTimeout(() => guard(app.fitToWidth()), 150);
  });
}

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
  // QA-D F2 — re-fit on viewport resize/orientation change so the page doesn't keep a stale zoom
  // and overflow (e.g. desktop→mobile). See installRefitOnResize for the width-only guard.
  installRefitOnResize(app, guard);

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
  installCanvasClickRouting(app);
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
