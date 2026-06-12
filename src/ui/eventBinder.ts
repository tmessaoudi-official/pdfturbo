import type { PDFEditorApp, ToolMode } from '../core/pdfEditorApp';
import { TextElement } from '../elements/textElement';
import { ShapeElement } from '../elements/shapeElement';
import { RedactionElement } from '../elements/redactionElement';
import { MoveResizeCmd } from '../core/historyManager';


/** Wire all DOM events to app methods. Called once from the PDFEditorApp constructor. */
export function bindEvents(app: PDFEditorApp): void {
    app.ui.fileInput.addEventListener('change', (e) => app._loadDocument(e));
    app.ui.addPdfInput.addEventListener('change', (e) => app._handleAddPdfUpload(e));
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
    app.ui.downloadBtn.addEventListener('click', () => app.downloadPDF());
    app.ui.editTextBtn.addEventListener('click', () => {
      if (!app.documentModel.pageCount) return;
      app.setMode(app.mode === 'editText' ? 'select' : 'editText');
    });
    app.ui.prevPageBtn.addEventListener('click', () => app.prevPage());
    app.ui.nextPageBtn.addEventListener('click', () => app.nextPage());
    app.ui.canvas.addEventListener('click', (e) => app.handleCanvasClick(e));

    // Handle element delete via bubbled CustomEvent from PDFElement.createControls()
    app.ui.container.addEventListener('element:delete', (e: Event) => {
      const { id } = (e as CustomEvent<{ id: number }>).detail;
      app.removeElement(id);
      app.selectElement(null);
      app._updateFormattingToolbar();
    });

    // Handle autosave requests bubbled from CommentElement
    app.ui.container.addEventListener('element:autosave', () => {
      app._autosave();
    });

     
    document.getElementById('clearSignature')?.addEventListener('click', () => app.signaturePad.clear());
    document.getElementById('cancelSignature')?.addEventListener('click', () => app.closeSignatureModal());
    document.getElementById('saveSignature')?.addEventListener('click', () => app.saveSignature());

    // Code modal
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
        app._qrLogoDataUrl = (ev.target?.result as string) ?? null;
        app.ui.qrLogoName.textContent = file.name;
        app.ui.qrLogoClearBtn.style.display = '';
        app._triggerCodePreview();
      };
      reader.readAsDataURL(file);
    });
    app.ui.qrLogoClearBtn.addEventListener('click', () => {
      app._qrLogoDataUrl = null;
      app.ui.qrLogoInput.value = '';
      app.ui.qrLogoName.textContent = '';
      app.ui.qrLogoClearBtn.style.display = 'none';
      app._triggerCodePreview();
    });
     

    app.ui.sigLineWidthInput.addEventListener('change', (e) => {
      app.signaturePad.setLineWidth(parseInt((e.target as HTMLInputElement).value));
    });
    app.ui.sigColorInput.addEventListener('change', (e) => {
      app.signaturePad.setColor((e.target as HTMLInputElement).value);
    });

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

    app.ui.zoomInBtn.addEventListener('click',  () => { app._isFitMode = false; app.applyZoom(app.zoomScale + 0.1); });
    app.ui.zoomOutBtn.addEventListener('click', () => { app._isFitMode = false; app.applyZoom(app.zoomScale - 0.1); });
    app.ui.fitBtn.addEventListener('click', () => app.fitToWidth());
    app.ui.undoBtn.addEventListener('click', () => app.undo());
    app.ui.redoBtn.addEventListener('click', () => app.redo());
    app.ui.copyBtn.addEventListener('click', () => {
      const sel = window.getSelection()?.toString();
      if (sel) { navigator.clipboard.writeText(sel).catch(() => {}); return; }
      app._copySelectedElement();
    });
    app.ui.pasteBtn.addEventListener('click', () => app._pasteElement());

    app.ui.arrowBtn.addEventListener('click',    () => {
      if (!app.documentModel.pageCount) return;
      app.setMode(app.mode === 'drawArrow' ? 'select' : 'drawArrow');
    });
    app.ui.rectBtn.addEventListener('click',     () => {
      if (!app.documentModel.pageCount) return;
      app.setMode(app.mode === 'drawRect' ? 'select' : 'drawRect');
    });
    app.ui.circleBtn.addEventListener('click',   () => {
      if (!app.documentModel.pageCount) return;
      app.setMode(app.mode === 'drawEllipse' ? 'select' : 'drawEllipse');
    });
    app.ui.freehandBtn.addEventListener('click', () => {
      if (!app.documentModel.pageCount) {
        // Auto-create blank A4 page then activate freehand
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

    // File menu — use position:fixed so the dropdown escapes toolbar overflow clipping
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
    // Draw flyout — same position:fixed pattern; satellite controls keep flyout open
    app.ui.drawBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = app.ui.drawFlyoutWrap.classList.toggle('open');
      app.ui.drawBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        const rect = app.ui.drawBtn.getBoundingClientRect();
        const flyout = document.getElementById('drawFlyout') as HTMLElement;
        flyout.style.top  = (rect.bottom + 4) + 'px';
        flyout.style.left = rect.left + 'px';
      }
    });
    // Close flyout when a tool button (aria-pressed) is picked; satellite controls don't close it
    document.getElementById('drawFlyout')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).hasAttribute('aria-pressed')) {
        app.ui.drawFlyoutWrap.classList.remove('open');
        app.ui.drawBtn.setAttribute('aria-expanded', 'false');
      }
    });
    // Annotate flyout — same position:fixed pattern; no satellite controls
    app.ui.annotateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = app.ui.annotateFlyoutWrap.classList.toggle('open');
      app.ui.annotateBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        const rect = app.ui.annotateBtn.getBoundingClientRect();
        const flyout = document.getElementById('annotateFlyout') as HTMLElement;
        flyout.style.top  = (rect.bottom + 4) + 'px';
        flyout.style.left = rect.left + 'px';
      }
    });
    document.getElementById('annotateFlyout')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).hasAttribute('aria-pressed')) {
        app.ui.annotateFlyoutWrap.classList.remove('open');
        app.ui.annotateBtn.setAttribute('aria-expanded', 'false');
      }
    });
    // Text split-button — chevron opens chooser flyout
    app.ui.textChevronBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = app.ui.textSplitWrap.classList.toggle('open');
      app.ui.textChevronBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        const rect = app.ui.textChevronBtn.getBoundingClientRect();
        const flyout = document.getElementById('textFlyout') as HTMLElement;
        flyout.style.top  = (rect.bottom + 4) + 'px';
        flyout.style.left = rect.left + 'px';
      }
    });
    // Left part activates last-used text mode; also closes flyout if open
    app.ui.textModeBtn.addEventListener('click', () => {
      app.ui.textSplitWrap.classList.remove('open');
      app.ui.textChevronBtn.setAttribute('aria-expanded', 'false');
      if (!app.documentModel.pageCount) return;
      const m = (app.ui.textModeBtn.dataset['mode'] ?? 'addText') as ToolMode;
      app.setMode(app.mode === m ? 'select' : m);
    });
    document.getElementById('textFlyout')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[aria-pressed]')) {
        app.ui.textSplitWrap.classList.remove('open');
        app.ui.textChevronBtn.setAttribute('aria-expanded', 'false');
      }
    });
    // Export ▾ split-button — chevron opens Preview + Watermark flyout
    app.ui.exportChevronBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = app.ui.exportSplitWrap.classList.toggle('open');
      app.ui.exportChevronBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        const rect = app.ui.exportChevronBtn.getBoundingClientRect();
        const flyout = document.getElementById('exportFlyout') as HTMLElement;
        flyout.style.top  = (rect.bottom + 4) + 'px';
        flyout.style.left = rect.left + 'px';
      }
    });
    document.getElementById('exportFlyout')?.addEventListener('click', () => {
      app.ui.exportSplitWrap.classList.remove('open');
      app.ui.exportChevronBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', (e) => {
      app.ui.fileMenuWrap.classList.remove('open');
      if (!app.ui.drawFlyoutWrap.contains(e.target as Node)) {
        app.ui.drawFlyoutWrap.classList.remove('open');
        app.ui.drawBtn.setAttribute('aria-expanded', 'false');
      }
      if (!app.ui.annotateFlyoutWrap.contains(e.target as Node)) {
        app.ui.annotateFlyoutWrap.classList.remove('open');
        app.ui.annotateBtn.setAttribute('aria-expanded', 'false');
      }
      if (!app.ui.textSplitWrap.contains(e.target as Node)) {
        app.ui.textSplitWrap.classList.remove('open');
        app.ui.textChevronBtn.setAttribute('aria-expanded', 'false');
      }
      if (!app.ui.exportSplitWrap.contains(e.target as Node)) {
        app.ui.exportSplitWrap.classList.remove('open');
        app.ui.exportChevronBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('selectionchange', () => app._updateCopyPasteBtns());
    app.ui.fileMenuOpen.addEventListener('click', () => {
      app.ui.fileMenuWrap.classList.remove('open');
      app.ui.fileInput.click();
    });
    app.ui.fileMenuClose.addEventListener('click', () => {
      app.ui.fileMenuWrap.classList.remove('open');
      app._closeDocument();
    });
    app.ui.fileMenuClearAnnotations.addEventListener('click', () => {
      app.ui.fileMenuWrap.classList.remove('open');
      app.clearAll();
    });
    app.ui.fileMenuResetSession.addEventListener('click', () => {
      app.ui.fileMenuWrap.classList.remove('open');
      app._clearSave();
    });

    document.getElementById('fileMenuBlankPage')?.addEventListener('click', () => {
      app.ui.fileMenuWrap.classList.remove('open');
      app._openBlankPageModal();
    });

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

    // ── Password entry modal (decrypt on open) ──────────────────────────────
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

    // ── Lock PDF modal (encrypt on export) ──────────────────────────────────
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
      const owner = (document.getElementById('lockOwnerPassword') as HTMLInputElement).value.trim() || user;
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

    app.ui.helpBtn.addEventListener('click', () => app._toggleHelp());
     
    document.getElementById('closeHelp')?.addEventListener('click', () => app._toggleHelp(false));
    app.ui.helpModal.addEventListener('click', (e) => { if (e.target === app.ui.helpModal) app._toggleHelp(false); });


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

    app.ui.container.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      app._isFitMode = false;
      app.applyZoom(app.zoomScale + (e.deltaY < 0 ? 0.05 : -0.05));
    }, { passive: false });

    app.ui.fontFamily.addEventListener('change', (e) => {
      if (!app.selectedElement || app.selectedElement.type !== 'text') return;
      const te = app.selectedElement as TextElement;
      const before = { fontFamily: te.fontFamily };
      te.fontFamily = (e.target as HTMLInputElement).value;
      app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { fontFamily: te.fontFamily }));
      app.rebuildElementLayer(); app._autosave();
    });
    app.ui.boldBtn.addEventListener('click', () => {
      if (!app.selectedElement || app.selectedElement.type !== 'text') return;
      const te = app.selectedElement as TextElement;
      const before = { bold: te.bold };
      te.bold = !te.bold;
      app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { bold: te.bold }));
      app.ui.boldBtn.classList.toggle('btn-active-fmt', te.bold);
      app.rebuildElementLayer(); app._autosave();
    });
    app.ui.italicBtn.addEventListener('click', () => {
      if (!app.selectedElement || app.selectedElement.type !== 'text') return;
      const te = app.selectedElement as TextElement;
      const before = { italic: te.italic };
      te.italic = !te.italic;
      app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { italic: te.italic }));
      app.ui.italicBtn.classList.toggle('btn-active-fmt', te.italic);
      app.rebuildElementLayer(); app._autosave();
    });
    app.ui.fontSizeInput.addEventListener('change', (e) => {
      const size = Math.max(8, Math.min(72, parseInt((e.target as HTMLInputElement).value) || 14));
      if (app.selectedElement && app.selectedElement.type === 'text') {
        const te = app.selectedElement as TextElement;
        const before = { fontSize: te.fontSize };
        te.fontSize = size;
        app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { fontSize: size }));
        app.rebuildElementLayer(); app._autosave();
      }
    });
    app.ui.colorInput.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (app.selectedElement?.type === 'text') {
        const te = app.selectedElement as TextElement;
        const before = { color: te.color };
        te.color = val;
        app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { color: val }));
        app.rebuildElementLayer(); app._autosave();
      } else if (app.selectedElement?.type === 'shape') {
        (app.selectedElement as ShapeElement).strokeColor = val;
        app.rebuildElementLayer(); app._autosave();
      } else if (app.selectedElement?.type === 'redaction') {
        const re = app.selectedElement as RedactionElement;
        const before = { color: re.color };
        re.color = val;
        app.ui.redactColorInput.value = val;
        app.historyManager.record(new MoveResizeCmd(app.elements, re, before, { color: val }));
        app.rebuildElementLayer(); app._autosave();
      }
    });
    app.ui.fillNoneBtn.addEventListener('click', () => {
      app._noFill = true;
      app._syncFillToggleUI();
      if (app.selectedElement?.type === 'shape') {
        const she = app.selectedElement as ShapeElement;
        const before = { fillColor: she.fillColor };
        she.fillColor = undefined;
        app.historyManager.record(new MoveResizeCmd(app.elements, she, before, { fillColor: undefined }));
        app.rebuildElementLayer(); app._autosave();
      }
    });
    app.ui.fillColorInput.addEventListener('mousedown', () => {
      app._noFill = false;
      app._syncFillToggleUI();
    });
    app.ui.fillColorInput.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      app._noFill = false;
      app._syncFillToggleUI();
      if (app.selectedElement?.type === 'shape') {
        const she = app.selectedElement as ShapeElement;
        const before = { fillColor: she.fillColor };
        she.fillColor = val;
        app.historyManager.record(new MoveResizeCmd(app.elements, she, before, { fillColor: val }));
        app.rebuildElementLayer(); app._autosave();
      }
    });
    app.ui.redactColorInput.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (app.selectedElement?.type === 'redaction') {
        const re = app.selectedElement as RedactionElement;
        const before = { color: re.color };
        re.color = val;
        app.historyManager.record(new MoveResizeCmd(app.elements, re, before, { color: val }));
        app.rebuildElementLayer(); app._autosave();
      }
    });
    document.getElementById('redactEyedropperBtn')?.addEventListener('click', async () => {
      if (!('EyeDropper' in window)) { app.reportError.warn('toast.eyedropperUnsupported'); return; }
      try {
        const dropper = new (window as { EyeDropper: new() => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
        const result = await dropper.open();
        app.ui.redactColorInput.value = result.sRGBHex;
        app.ui.redactColorInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch { /* user cancelled */ }
    });
    app.ui.colorEyedropperBtn.addEventListener('click', async () => {
      if (!('EyeDropper' in window)) { app.reportError.warn('toast.eyedropperUnsupported'); return; }
      try {
        const dropper = new (window as { EyeDropper: new() => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
        const result = await dropper.open();
        app.ui.colorInput.value = result.sRGBHex;
        app.ui.colorInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch { /* user cancelled */ }
    });
    app.ui.fontSizeDownBtn.addEventListener('click', () => {
      if (!app.selectedElement || app.selectedElement.type !== 'text') return;
      const te = app.selectedElement as TextElement;
      const before = { fontSize: te.fontSize };
      const newSize = Math.max(8, te.fontSize - 2);
      te.fontSize = newSize;
      app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { fontSize: newSize }));
      app.ui.fontSizeInput.value = String(newSize);
      app.rebuildElementLayer(); app._autosave();
    });
    app.ui.fontSizeUpBtn.addEventListener('click', () => {
      if (!app.selectedElement || app.selectedElement.type !== 'text') return;
      const te = app.selectedElement as TextElement;
      const before = { fontSize: te.fontSize };
      const newSize = Math.min(72, te.fontSize + 2);
      te.fontSize = newSize;
      app.historyManager.record(new MoveResizeCmd(app.elements, te, before, { fontSize: newSize }));
      app.ui.fontSizeInput.value = String(newSize);
      app.rebuildElementLayer(); app._autosave();
    });
    app.ui.shapeWidth.addEventListener('change', (e) => {
      if (app.selectedElement?.type === 'shape') {
        (app.selectedElement as ShapeElement).strokeWidth = parseInt((e.target as HTMLInputElement).value) || 2;
        app.rebuildElementLayer(); app._autosave();
      }
    });

    // Watermark modal
    app.ui.watermarkBtn.addEventListener('click', () => app._openWatermarkModal());
    app.ui.wmCancel.addEventListener('click', () => app._closeWatermarkModal());
    let _wmBackdropDown = false;
    app.ui.watermarkModal.addEventListener('mousedown', (e) => { _wmBackdropDown = e.target === app.ui.watermarkModal; });
    app.ui.watermarkModal.addEventListener('mouseup',   (e) => { if (_wmBackdropDown && e.target === app.ui.watermarkModal) app._closeWatermarkModal(); _wmBackdropDown = false; });
    app.ui.wmApply.addEventListener('click', () => app._applyWatermark());
    app._setupWatermarkPreviewListeners();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (app.ui.helpModal.classList.contains('active')) { app._toggleHelp(false); return; }
        if (app.ui.signatureModal.classList.contains('active')) { app.closeSignatureModal(); return; }
        if (app.ui.watermarkModal.classList.contains('active')) { app._closeWatermarkModal(); return; }
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
            // Arrow: translate endpoint geometry
            const el = app.selectedElement as ShapeElement;
            if (el.x1 !== undefined) { el.x1 += dx; el.x2 += dx; el.y1 += dy; el.y2 += dy; }
            // Freehand: translate all path points
            if (Array.isArray(el.points) && el.points.length) {
              el.points = el.points.map((p: {x: number, y: number}) => ({ x: p.x + dx, y: p.y + dy }));
            }
            app.rebuildElementLayer();
          }
          break;
      }
    });
    app.ui.canvas.style.touchAction = 'pan-x pan-y';
}
