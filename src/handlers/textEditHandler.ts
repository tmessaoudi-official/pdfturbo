import { PDFDocument } from '@cantoo/pdf-lib';
import { RedactionElement } from '../elements/redactionElement';
import { TextElement } from '../elements/textElement';
import { AddElementCmd, MacroCmd } from '../core/historyManager';
import { findTextOpAt, deleteTextAt, replaceTextAt, changeSizeAt, changeColorAt, fillColorToHex, getPageFontBaseName, type TextStyle } from '../utils/contentStreamEditor';
import { extractPsName } from '../utils/flowDoc';
import { t } from '../utils/i18n';
import type { IAppContext } from '../core/appContext';
import type { SourcePdf } from '../core/documentModel';

/** Max distance (PDF pts) between a pdf.js item origin and a content-stream show op. */
const TRUE_EDIT_TOLERANCE = 3;

/** Convert a #RRGGBB hex string to a [0,1]-range RGB object, or null on failure. */
function hexToRgb01(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

/** Map a PostScript font name to a CSS font-family stack for the inline editor. */
function psNameToCssFontFamily(psName: string): string {
  if (/(times|roman|garamond|palatino)/i.test(psName) && !/sans/i.test(psName)) {
    return '"Times New Roman", Times, serif';
  }
  if (/(courier|mono|typewriter)/i.test(psName)) {
    return '"Courier New", Courier, monospace';
  }
  return 'Arial, Helvetica, sans-serif';
}

export class TextEditHandler {
  private _activeEditor: HTMLInputElement | null = null;

  async handleCanvasClick(e: MouseEvent, app: IAppContext): Promise<void> {
    const docPage = app.documentModel.currentPage;
    if (!docPage) return;
    const src = app.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;

    const rect = app.ui.canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / app.zoomScale;
    const canvasY = (e.clientY - rect.top)  / app.zoomScale;

    const userRot = docPage.rotation ?? 0;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + userRot) % 360 });
    const pageH = viewport.height;

    // Convert canvas coords (top-left origin) → PDF coords (bottom-left origin)
    const pdfX = canvasX;
    const pdfY = pageH - canvasY;

    const content = await page.getTextContent();
    const items = content.items as { str: string; transform: number[]; width: number; height: number; fontName: string }[];
    const styles = content.styles as Record<string, { fontFamily: string }>;

    const TOLERANCE = 12;
    let best: (typeof items)[0] | null = null;
    let bestDist = Infinity;

    for (const it of items) {
      if (!it.str.trim()) continue;
      const tx = it.transform[4];
      const ty = it.transform[5];
      const w  = Math.max(Math.abs(it.width),  20);
      const h  = Math.max(Math.abs(it.height), 8);

      if (
        pdfX >= tx - TOLERANCE && pdfX <= tx + w + TOLERANCE &&
        pdfY >= ty - TOLERANCE && pdfY <= ty + h + TOLERANCE
      ) {
        const dist = Math.hypot(pdfX - (tx + w / 2), pdfY - (ty + h / 2));
        if (dist < bestDist) { bestDist = dist; best = it; }
      }
    }

    // Unified text mode: a click that lands on existing text true-edits it
    // (below); a click on an empty area drops a new editable text box instead of
    // doing nothing (ISSUE-5).
    if (!best) {
      app.addTextAtPosition(e);
      return;
    }

    // ── True edit first: content-stream surgery on the source PDF ──
    try {
      const libDoc = await PDFDocument.load(src.bytes.slice(0));

      // pdfjs splits a single Tj string at word boundaries, so the clicked item
      // may be a sub-word whose transform[4,5] doesn't match the Tm origin in the
      // content stream. Try the best (clicked) item first; if it misses, fall back
      // to other nearby items sorted by distance — one of them will typically have
      // a transform matching the actual Tm start position.
      const FALLBACK_RADIUS = 50;
      const fallbackCandidates = items.filter(it =>
        it !== best &&
        it.str.trim() &&
        Math.hypot(it.transform[4] - pdfX, it.transform[5] - pdfY) < FALLBACK_RADIUS,
      ).sort((a, b) =>
        Math.hypot(a.transform[4] - pdfX, a.transform[5] - pdfY) -
        Math.hypot(b.transform[4] - pdfX, b.transform[5] - pdfY),
      );

      let target = null;
      let matchedOrigin = { x: best.transform[4], y: best.transform[5] };
      for (const candidate of [best, ...fallbackCandidates]) {
        const o = { x: candidate.transform[4], y: candidate.transform[5] };
        target = await findTextOpAt(libDoc, docPage.sourcePageNum - 1, o, TRUE_EDIT_TOLERANCE);
        if (target) { matchedOrigin = o; break; }
      }

      if (target) {
        this._openTrueEditInput(e, app, {
          libDoc,
          src,
          pageId: docPage.id,
          pageIndex: docPage.sourcePageNum - 1,
          origin: matchedOrigin,
          fontName: best.fontName,
          fontKey: target.fontKey,
          pdfjsFontFamily: styles[best.fontName]?.fontFamily ?? '',
          originalText: best.str,
          fontSize: Math.hypot(best.transform[0], best.transform[1]) || target.fontSize || 12,
          itemHeight: Math.max(Math.abs(best.height), 10),
          pageH,
          rotated: (page.rotate + userRot) % 360 !== 0,
          fillColor: target.fillColor,
        });
        return;
      }
    } catch {
      // Encrypted or unparseable source PDF — overlay fallback below.
    }

    const tx = best.transform[4];
    const ty = best.transform[5];
    const w  = Math.max(Math.abs(best.width),  40);
    const h  = Math.max(Math.abs(best.height), 10);

    // Canvas-space position: top-left origin
    const annX = tx;
    const annY = pageH - ty - h;

    const pageId = docPage.id;

    // Sample background + foreground colors from the canvas in one pass.
    let bgColor = '#ffffff';
    let textColor = '#000000';
    const offscreen = document.createElement('canvas');
    offscreen.width = 1; offscreen.height = 1;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    if (offCtx) {
      const s = app.zoomScale;
      const INSET = 2;
      const corners = [
        { x: Math.round(annX * s) + INSET,       y: Math.round(annY * s) + INSET },
        { x: Math.round((annX + w) * s) - INSET,  y: Math.round(annY * s) + INSET },
        { x: Math.round(annX * s) + INSET,       y: Math.round((annY + h) * s) - INSET },
        { x: Math.round((annX + w) * s) - INSET,  y: Math.round((annY + h) * s) - INSET },
      ];
      let bgBrightness = -1;
      let bestRgb = { r: 255, g: 255, b: 255 };
      for (const pt of corners) {
        offCtx.drawImage(app.ui.canvas, pt.x, pt.y, 1, 1, 0, 0, 1, 1);
        const d = offCtx.getImageData(0, 0, 1, 1).data;
        const brightness = d[0] + d[1] + d[2];
        if (brightness > bgBrightness) { bgBrightness = brightness; bestRgb = { r: d[0], g: d[1], b: d[2] }; }
      }
      bgColor = `#${bestRgb.r.toString(16).padStart(2, '0')}${bestRgb.g.toString(16).padStart(2, '0')}${bestRgb.b.toString(16).padStart(2, '0')}`;
      const cx = Math.round((annX + w / 2) * s);
      const cy = Math.round((annY + h / 2) * s);
      const SAMPLE_R = 2;
      let darkestBrightness = 255 * 3 + 1;
      let darkestRgb = { r: 0, g: 0, b: 0 };
      for (let dx = -SAMPLE_R; dx <= SAMPLE_R; dx++) {
        for (let dy = -SAMPLE_R; dy <= SAMPLE_R; dy++) {
          offCtx.drawImage(app.ui.canvas, cx + dx, cy + dy, 1, 1, 0, 0, 1, 1);
          const d = offCtx.getImageData(0, 0, 1, 1).data;
          const brightness = d[0] + d[1] + d[2];
          if (brightness < darkestBrightness) { darkestBrightness = brightness; darkestRgb = { r: d[0], g: d[1], b: d[2] }; }
        }
      }
      if (bgBrightness - darkestBrightness > 80) {
        textColor = `#${darkestRgb.r.toString(16).padStart(2, '0')}${darkestRgb.g.toString(16).padStart(2, '0')}${darkestRgb.b.toString(16).padStart(2, '0')}`;
      }
    }

    // Detect font family from pdfjs styles and PS font name
    const pdfjsFontFamily = styles[best.fontName]?.fontFamily ?? '';
    const ff = pdfjsFontFamily.toLowerCase();
    // Use the extracted PS name for more reliable family/weight detection
    const psNameOverlay = extractPsName(best.fontName).toLowerCase();
    let fontFamily = 'Arial';
    if (/times|roman/i.test(ff) || /times|roman/i.test(psNameOverlay)) {
      fontFamily = 'Times New Roman';
    } else if (/courier|typewriter/i.test(ff) || /cour|mono/i.test(psNameOverlay)) {
      fontFamily = 'Courier New';
    } else if (/helvetica/i.test(ff) || /helv/i.test(psNameOverlay)) {
      fontFamily = 'Helvetica';
    } else if (/georgia/i.test(ff) || /georgia/i.test(psNameOverlay)) {
      fontFamily = 'Georgia';
    } else if (/\bmono\b/i.test(ff)) {
      fontFamily = 'Courier New';
    } else if (/\bserif\b/i.test(ff)) {
      fontFamily = 'Times New Roman';
    }

    const detectedFontSize = Math.round(Math.hypot(best.transform[0], best.transform[1]));
    const fontSize = detectedFontSize >= 6 && detectedFontSize <= 144
      ? detectedFontSize
      : Math.max(8, Math.round(h * 0.82));

    // Detect bold/italic: check both PS name and pdfjs CSS fontFamily string.
    // For PDFs with opaque font ids (e.g. "g_d0_f2"), the CSS fontFamily is the reliable source.
    const psNameOverlayFull = extractPsName(best.fontName);
    const overlayCheck = `${psNameOverlayFull} ${pdfjsFontFamily}`;
    const bold   = /bold|black|heavy|semibold|demibold/i.test(overlayCheck);
    const italic = /italic|oblique/i.test(overlayCheck);

    const cover = new RedactionElement(annX - 2, annY - 2, w + 4, h + 4, pageId, bgColor);
    const textEl = new TextElement(annX, annY, pageId, {
      width: w + 4,
      height: h + 4,
      fontSize,
      color: textColor,
      fontFamily,
      bold,
      italic,
    });
    textEl.text = best.str;

    app.historyManager.execute(new MacroCmd([
      new AddElementCmd(app.elements, cover),
      new AddElementCmd(app.elements, textEl),
    ]));
    app._autosave();
    app.setMode('select');
    app.selectElement(textEl);

    const freshInput = app.ui.container.querySelector(
      `[data-id='${textEl.id}'] input, [data-id='${textEl.id}'] textarea`
    ) as HTMLElement | null;
    freshInput?.focus();
  }

  /**
   * Floating inline editor for a true content-stream edit.
   * Enter / blur applies; emptying the text deletes it; Escape cancels.
   * Style changes (size, bold, italic, font family, color) are committed via
   * in-stream ops (changeSizeAt / changeColorAt) when possible, falling back
   * to a full text replacement with the new style.
   */
  private _openTrueEditInput(
    e: MouseEvent,
    app: IAppContext,
    opts: {
      libDoc: PDFDocument;
      src: SourcePdf;
      pageId: string;
      pageIndex: number;
      origin: { x: number; y: number };
      fontName: string;
      fontKey: string;
      pdfjsFontFamily: string;
      originalText: string;
      fontSize: number;
      itemHeight: number;
      pageH: number;
      rotated: boolean;
      fillColor?: string;
    }
  ): void {
    this._activeEditor?.remove();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'true-edit-input';
    input.value = opts.originalText;
    input.setAttribute('aria-label', t('canvas.trueEditInput'));
    input.spellcheck = false;

    const zoom = app.zoomScale;
    const fontPx = Math.max(10, Math.round(opts.fontSize * zoom));
    const psName     = extractPsName(opts.fontName);
    const baseFontName = getPageFontBaseName(opts.libDoc, opts.pageIndex, opts.fontKey);
    const combined = `${psName} ${opts.pdfjsFontFamily} ${baseFontName}`;
    const bold   = /bold|black|heavy|semibold|demibold/i.test(combined);
    const italic = /italic|oblique/i.test(combined);
    const fontFamily = psNameToCssFontFamily(combined);
    input.style.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontPx}px ${fontFamily}`;
    input.style.minWidth = `${Math.max(160, Math.round(opts.originalText.length * fontPx * 0.6))}px`;

    // Reflect detected font properties in the formatting toolbar while editing.
    const { ui } = app;
    const familyToSelect: Record<string, string> = {
      '"Times New Roman", Times, serif': 'Times New Roman',
      '"Courier New", Courier, monospace': 'Courier New',
      'Arial, Helvetica, sans-serif': 'Arial',
    };
    ui.boldBtn.classList.toggle('btn-active-fmt', bold);
    ui.boldBtn.setAttribute('aria-pressed', String(bold));
    ui.boldBtn.disabled = false;
    ui.italicBtn.classList.toggle('btn-active-fmt', italic);
    ui.italicBtn.setAttribute('aria-pressed', String(italic));
    ui.italicBtn.disabled = false;
    ui.fontSizeInput.value = String(Math.round(opts.fontSize));
    ui.fontSizeInput.disabled = false;
    ui.fontFamily.value = familyToSelect[fontFamily] ?? 'Arial';
    ui.fontFamily.disabled = false;

    // Snapshot originals for change-detection in commit().
    const originalBold       = bold;
    const originalItalic     = italic;
    const originalFontFamily = familyToSelect[fontFamily] ?? 'Arial';
    const originalFontSize   = Math.round(opts.fontSize);
    const detectedColorHex   = opts.fillColor ? (fillColorToHex(opts.fillColor) ?? '') : '';
    const originalColorHex   = detectedColorHex ? `#${detectedColorHex.toLowerCase()}` : '';
    if (originalColorHex) ui.colorInput.value = originalColorHex;

    const rect = app.ui.canvas.getBoundingClientRect();
    if (!opts.rotated) {
      input.style.left = `${rect.left + opts.origin.x * zoom}px`;
      input.style.top = `${rect.top + (opts.pageH - opts.origin.y - opts.itemHeight) * zoom - 4}px`;
    } else {
      input.style.left = `${e.clientX}px`;
      input.style.top = `${e.clientY - fontPx}px`;
    }

    const resetToolbar = () => {
      ui.boldBtn.disabled = true;
      ui.italicBtn.disabled = true;
      ui.fontSizeInput.disabled = true;
      ui.fontFamily.disabled = true;
      ui.boldBtn.classList.remove('btn-active-fmt');
      ui.italicBtn.classList.remove('btn-active-fmt');
      ui.boldBtn.setAttribute('aria-pressed', 'false');
      ui.italicBtn.setAttribute('aria-pressed', 'false');
    };

    let done = false;
    const close = () => {
      done = true;
      input.remove();
      if (this._activeEditor === input) this._activeEditor = null;
      resetToolbar();
    };

    const commit = async () => {
      if (done) return;
      const newText = input.value;

      // Snapshot toolbar state before close() resets the controls.
      const newBold       = ui.boldBtn.classList.contains('btn-active-fmt');
      const newItalic     = ui.italicBtn.classList.contains('btn-active-fmt');
      const newFontSize   = Math.round(parseFloat(ui.fontSizeInput.value) || opts.fontSize);
      const newFontFamily = ui.fontFamily.value || originalFontFamily;
      const newColorHex   = ui.colorInput.value;

      close();

      const textChanged    = newText !== opts.originalText;
      const sizeChanged    = newFontSize !== originalFontSize;
      const boldChanged    = newBold !== originalBold;
      const italicChanged  = newItalic !== originalItalic;
      const familyChanged  = newFontFamily !== originalFontFamily;
      const colorChanged   = originalColorHex !== '' && newColorHex !== originalColorHex;
      const styleChanged   = sizeChanged || boldChanged || italicChanged || familyChanged || colorChanged;

      if (!textChanged && !styleChanged) return;

      // Delete: user cleared the text field.
      if (newText.trim() === '' && textChanged) {
        const ok = await deleteTextAt(opts.libDoc, opts.pageIndex, opts.origin, TRUE_EDIT_TOLERANCE);
        if (!ok) return;
        const newBytes = await opts.libDoc.save();
        await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId);
        app.reportError.info('toast.trueTextDeleted');
        return;
      }

      // Style-only, no text change, no bold/italic/family change → try in-stream ops.
      if (!textChanged && !boldChanged && !italicChanged && !familyChanged) {
        let allHandled = true;
        if (sizeChanged) {
          if (!await changeSizeAt(opts.libDoc, opts.pageIndex, opts.origin, newFontSize, TRUE_EDIT_TOLERANCE)) {
            allHandled = false;
          }
        }
        if (colorChanged && allHandled) {
          const rgb = hexToRgb01(newColorHex);
          if (!rgb || !await changeColorAt(opts.libDoc, opts.pageIndex, opts.origin, rgb, TRUE_EDIT_TOLERANCE)) {
            allHandled = false;
          }
        }
        if (allHandled) {
          const newBytes = await opts.libDoc.save();
          await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId);
          app.reportError.info('toast.trueTextEdited');
          return;
        }
        // Fall through: at least one in-stream op failed; use full replacement.
      }

      // Full replacement — build style when anything changed.
      const style: TextStyle | undefined = styleChanged ? {
        ...(sizeChanged   ? { fontSize:   newFontSize }   : {}),
        ...(boldChanged   ? { bold:        newBold }       : {}),
        ...(italicChanged ? { italic:      newItalic }     : {}),
        ...(familyChanged ? { fontFamily:  newFontFamily } : {}),
        ...(colorChanged  ? { color: hexToRgb01(newColorHex) ?? undefined } : {}),
      } : undefined;

      const ok = await replaceTextAt(opts.libDoc, opts.pageIndex, opts.origin, newText, TRUE_EDIT_TOLERANCE, style);
      if (!ok) return;

      const newBytes = await opts.libDoc.save();
      await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId);
      app.reportError.info('toast.trueTextEdited');
    };

    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void commit();
      } else if (ev.key === 'Escape') {
        close();
      }
    });
    input.addEventListener('blur', () => void commit());

    document.body.appendChild(input);
    this._activeEditor = input;
    input.focus();
    input.select();
  }
}
