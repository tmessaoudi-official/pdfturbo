import { PDFDocument } from '@cantoo/pdf-lib';
import { RedactionElement } from '../elements/redactionElement';
import { TextElement } from '../elements/textElement';
import { AddElementCmd, MacroCmd } from '../core/historyManager';
import { findTextOpAt, deleteTextAt, replaceTextAt } from '../utils/contentStreamEditor';
import { extractPsName } from '../utils/flowDoc';
import { t } from '../utils/i18n';
import type { IAppContext } from '../core/appContext';
import type { SourcePdf } from '../core/documentModel';

/** Max distance (PDF pts) between a pdf.js item origin and a content-stream show op. */
const TRUE_EDIT_TOLERANCE = 3;

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

    if (!best) return;

    // ── True edit first: content-stream surgery on the source PDF ──
    try {
      const libDoc = await PDFDocument.load(src.bytes.slice(0));
      const origin = { x: best.transform[4], y: best.transform[5] };
      const target = await findTextOpAt(
        libDoc, docPage.sourcePageNum - 1, origin, TRUE_EDIT_TOLERANCE
      );
      if (target) {
        this._openTrueEditInput(e, app, {
          libDoc,
          src,
          pageId: docPage.id,
          pageIndex: docPage.sourcePageNum - 1,
          origin,
          fontName: best.fontName,
          originalText: best.str,
          fontSize: Math.hypot(best.transform[0], best.transform[1]) || target.fontSize || 12,
          itemHeight: Math.max(Math.abs(best.height), 10),
          pageH,
          rotated: (page.rotate + userRot) % 360 !== 0,
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

    // Detect font family from pdfjs styles and embedded font name heuristics
    const pdfjsFontFamily = styles[best.fontName]?.fontFamily ?? '';
    const ff = pdfjsFontFamily.toLowerCase();
    const fn = best.fontName.toLowerCase();
    let fontFamily = 'Arial';
    if (/times|roman/i.test(ff) || /times|roman/i.test(fn)) {
      fontFamily = 'Times New Roman';
    } else if (/courier|typewriter/i.test(ff) || /cour/i.test(fn)) {
      fontFamily = 'Courier New';
    } else if (/helvetica/i.test(ff) || /helv/i.test(fn)) {
      fontFamily = 'Helvetica';
    } else if (/georgia/i.test(ff) || /georgia/i.test(fn)) {
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

    const bold   = /bold/i.test(best.fontName);
    const italic = /italic|oblique/i.test(best.fontName);

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
      originalText: string;
      fontSize: number;
      itemHeight: number;
      pageH: number;
      rotated: boolean;
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
    const fontFamily = psNameToCssFontFamily(extractPsName(opts.fontName));
    input.style.font = `${fontPx}px ${fontFamily}`;
    input.style.minWidth = `${Math.max(160, Math.round(opts.originalText.length * fontPx * 0.6))}px`;

    const rect = app.ui.canvas.getBoundingClientRect();
    if (!opts.rotated) {
      input.style.left = `${rect.left + opts.origin.x * zoom}px`;
      input.style.top = `${rect.top + (opts.pageH - opts.origin.y - opts.itemHeight) * zoom - 4}px`;
    } else {
      input.style.left = `${e.clientX}px`;
      input.style.top = `${e.clientY - fontPx}px`;
    }

    let done = false;
    const close = () => {
      done = true;
      input.remove();
      if (this._activeEditor === input) this._activeEditor = null;
    };

    const commit = async () => {
      if (done) return;
      const newText = input.value;
      close();
      if (newText === opts.originalText) return;

      const isDelete = newText.trim() === '';
      const ok = isDelete
        ? await deleteTextAt(opts.libDoc, opts.pageIndex, opts.origin, TRUE_EDIT_TOLERANCE)
        : await replaceTextAt(opts.libDoc, opts.pageIndex, opts.origin, newText, TRUE_EDIT_TOLERANCE);
      if (!ok) return;

      const newBytes = await opts.libDoc.save();
      await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId);
      app.showToast(t(isDelete ? 'toast.trueTextDeleted' : 'toast.trueTextEdited'));
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
