import { PDFDocument } from '@cantoo/pdf-lib';
import { RedactionElement } from '../elements/redactionElement';
import { TextElement } from '../elements/textElement';
import { AddElementCmd, MacroCmd } from '../core/historyManager';
import { findTextOpAt, deleteTextAt, replaceTextAt, changeSizeAt, changeColorAt, fillColorToHex, getPageFontBaseName, getEditableTextAt, type TextStyle } from '../utils/contentStreamEditor';
import { extractPsName, isArabicText } from '../utils/flowDoc';
import { t } from '../utils/i18n';
import { isEnabled } from '../config/features';
import type { IAppContext } from '../core/appContext';
import type { SourcePdf } from '../core/documentModel';

/** Max distance (PDF pts) between a pdf.js item origin and a content-stream show op. */
const TRUE_EDIT_TOLERANCE = 3;

/**
 * Fully-resolved inputs for an overlay fallback (redaction cover + text box):
 * canvas-space geometry, sampled colors, and detected font properties. Computed
 * once (at click time for the no-match path, or at inline-editor-open time for
 * the commit-time true-edit-failure fallback) so the overlay can be emitted
 * later without re-reading the canvas.
 */
interface OverlayContext {
  annX: number;
  annY: number;
  w: number;
  h: number;
  pageId: string;
  bgColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  text: string;
}

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

/** A pdf.js getTextContent item (the subset of fields the handler relies on). */
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

/** A contiguous same-baseline run, in pdf.js item space (x = transform[4], y = baseline transform[5]). */
export interface BaselineRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Re-assemble the contiguous, same-baseline, same-font run of text items that
 * contains the clicked item `best`, for use as the OVERLAY text + bounding box.
 *
 * Why: on glyph-positioned PDFs (all Arabic, kerned / justified Latin) pdf.js
 * emits ONE ITEM PER GLYPH, so a single clicked item carries ~one character while
 * the historic overlay floored its cover width to 40pt — the user saw a word-wide
 * redaction cover but a one-glyph editable box (G7, the #1 reported pain). This
 * returns the whole clicked word so the cover AND the text box span it.
 *
 * Scope: OVERLAY ONLY. The in-place content-stream edit path keeps receiving the
 * original single `best` item — re-clustering its target would corrupt the
 * position-matched content-stream surgery (its prefill is a separate gap, G8).
 *
 * Thresholds (relative to the clicked glyph's font size):
 *  - fontSize = hypot(transform[0], transform[1]); falls back to item height then
 *    12 when the text matrix has no scale (so geometry-free fixtures still work).
 *  - same baseline: |transform[5] − best.transform[5]| ≤ 0.3 × fontSize.
 *  - run break: an adjacent item is whitespace-only, OR the horizontal gap to it
 *    (next.x − (cur.x + cur.width)) ≥ 1.0 × fontSize — i.e. a real inter-word space.
 *
 * RTL note: items arrive in VISUAL order; we concatenate by ascending x and do
 * NOT reverse — the Arabic overlay renderer re-shapes RTL from logical-visual.
 */
export function clusterBaselineRun(items: PdfTextItem[], best: PdfTextItem): BaselineRun {
  const fontSize = Math.hypot(best.transform[0], best.transform[1]) || Math.abs(best.height) || 12;
  const baselineBand = 0.3 * fontSize;
  const gapBreak = 1.0 * fontSize;
  const baseY = best.transform[5];

  // Same baseline + same font, keeping whitespace markers so they can act as a
  // hard break. Sorted left → right (visual order).
  const sameLine = items
    .filter(it => it.fontName === best.fontName && Math.abs(it.transform[5] - baseY) <= baselineBand)
    .sort((a, b) => a.transform[4] - b.transform[4]);

  const bestIdx = sameLine.indexOf(best);
  // `best` always has content (callers guard `best.str.trim()`); if somehow
  // absent from the line set, fall back to the lone item.
  if (bestIdx === -1) {
    const w = Math.max(Math.abs(best.width), 0);
    return { text: best.str, x: best.transform[4], y: baseY, width: w, height: Math.abs(best.height) };
  }

  const adjacentGap = (left: PdfTextItem, right: PdfTextItem): number =>
    right.transform[4] - (left.transform[4] + Math.abs(left.width));

  // Extend left from best while the neighbour is non-blank and the gap is tight.
  let lo = bestIdx;
  while (lo > 0) {
    const prev = sameLine[lo - 1];
    if (!prev.str.trim() || adjacentGap(prev, sameLine[lo]) >= gapBreak) break;
    lo--;
  }
  // Extend right from best by the same rule.
  let hi = bestIdx;
  while (hi < sameLine.length - 1) {
    const next = sameLine[hi + 1];
    if (!next.str.trim() || adjacentGap(sameLine[hi], next) >= gapBreak) break;
    hi++;
  }

  const run = sameLine.slice(lo, hi + 1);
  const text = run.map(it => it.str).join('');
  const x = run[0].transform[4];
  const right = Math.max(...run.map(it => it.transform[4] + Math.abs(it.width)));
  const height = Math.max(...run.map(it => Math.abs(it.height)));
  return { text, x, y: baseY, width: right - x, height };
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

    // Map the click from displayed (viewport, top-left) space to PDF content
    // coords (bottom-left origin). viewport.convertToPdfPoint applies the page
    // rotation; the old `pdfY = pageH - canvasY` only held at rotation 0 and
    // left edit-text unable to find any text on a rotated page (R2) — the click
    // never matched the unrotated-content-space text-item transforms. canvasX/Y
    // are already at scale 1 (zoomScale divided out) and the viewport is built
    // at scale 1, so they are in viewport space.
    const [pdfX, pdfY] = viewport.convertToPdfPoint(canvasX, canvasY);

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

    // editText edits EXISTING source text ONLY: a click that lands on text
    // true-edits it (below). A blank-area click does NOT create a box — that was
    // the ISSUE-5 unification, which trapped the user in editText (elements are
    // pointer-events:none outside 'select'), leaving the dropped box unselectable
    // while every further click spawned another. New text is created with the
    // dedicated draw-to-place "Add Text" tool. Re-show the hint for feedback.
    if (!best) {
      app.reportError.info('toast.modeHint.editText');
      return;
    }

    // G7: re-assemble the contiguous same-baseline run around the clicked glyph.
    // pdf.js emits one item per glyph on glyph-positioned PDFs (all Arabic, kerned
    // Latin), so `best` alone is ~one character. The run drives the OVERLAY text +
    // cover only — the in-place true-edit path below still uses the single `best`
    // item (re-clustering it would corrupt the position-matched stream edit; G8).
    const run = clusterBaselineRun(items, best);

    // G7 Arabic pre-route (the user's exact #1 case): clicking Arabic source text
    // would open the inline editor pre-filled with ONE glyph, then refuse Arabic
    // at commit (replaceTextAt → overlay) and leave a one-glyph box under a 40pt
    // cover. Skip the editor: drop the clustered overlay (whole-word redaction
    // cover + editable text box) directly. The Arabic overlay renderer lays the
    // run out RTL correctly. Latin/in-place edits are unaffected.
    if (isArabicText(run.text)) {
      const arH = Math.max(run.height, 10);
      const arCtx = this._buildOverlayContext(app, {
        annX: run.x,
        annY: pageH - run.y - arH,
        w: run.width,
        h: arH,
        pageId: docPage.id,
        fontName: best.fontName,
        pdfjsFontFamily: styles[best.fontName]?.fontFamily ?? '',
        fontSize: Math.round(Math.hypot(best.transform[0], best.transform[1])) || Math.round(arH * 0.82),
        text: run.text,
      });
      this._emitOverlay(app, arCtx);
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
        const hit = await findTextOpAt(libDoc, docPage.sourcePageNum - 1, o, TRUE_EDIT_TOLERANCE);
        // A target inside a Form XObject cannot be truly edited (its own coord
        // space + subset font; replaceTextAt refuses without blanking to avoid
        // delete-without-replacement). Treat it as a MISS so we fall through to
        // the overlay path instead of opening an editor that would no-op (A1).
        if (hit && !hit.inXObject) { target = hit; matchedOrigin = o; break; }
      }

      // #28 kill-switch: with true-edit disabled, treat a hit as a miss → overlay.
      if (target && isEnabled('trueEdit')) {
        // G8: prefill the inline editor from the MATCHED content-stream op's own
        // decoded text — exactly what replaceTextAt(matchedOrigin, …) will replace
        // — NOT `best.str`. pdf.js splits a single Tj/TJ word into one item per
        // glyph, so `best.str` is often one character while the matched op holds
        // the whole word; prefilling `best.str` then in-place-editing the whole op
        // corrupted the word down to that glyph. On any uncertainty
        // getEditableTextAt returns null and we keep `best.str` (always safe).
        const editable = getEditableTextAt(libDoc, docPage.sourcePageNum - 1, matchedOrigin, TRUE_EDIT_TOLERANCE);
        this._openTrueEditInput(e, app, {
          libDoc,
          src,
          pageId: docPage.id,
          pageIndex: docPage.sourcePageNum - 1,
          origin: matchedOrigin,
          fontName: best.fontName,
          fontKey: target.fontKey,
          pdfjsFontFamily: styles[best.fontName]?.fontFamily ?? '',
          originalText: editable && editable.length > 0 ? editable : best.str,
          fontSize: Math.hypot(best.transform[0], best.transform[1]) || target.fontSize || 12,
          itemHeight: Math.max(Math.abs(best.height), 10),
          itemWidth: Math.max(Math.abs(best.width), 40),
          pageH,
          rotated: (page.rotate + userRot) % 360 !== 0,
          fillColor: target.fillColor,
        });
        return;
      }
    } catch {
      // Encrypted or unparseable source PDF — overlay fallback below.
    }

    // G7: cover + text from the clustered baseline RUN (not the single clicked
    // glyph). On glyph-positioned PDFs `best.width` was floored to 40pt → a
    // word-wide cover with a one-glyph box; the run gives the true word extent.
    const w  = Math.max(run.width, 40);
    const h  = Math.max(run.height, 10);
    // Canvas-space position: top-left origin, derived from the run bbox the same
    // way the single-item path did (annX = x, annY = pageH − baseline − height).
    const annX = run.x;
    const annY = pageH - run.y - h;

    const detectedFontSize = Math.round(Math.hypot(best.transform[0], best.transform[1]));
    const fontSize = detectedFontSize >= 6 && detectedFontSize <= 144
      ? detectedFontSize
      : Math.max(8, Math.round(h * 0.82));

    const overlayCtx = this._buildOverlayContext(app, {
      annX, annY, w, h,
      pageId: docPage.id,
      fontName: best.fontName,
      pdfjsFontFamily: styles[best.fontName]?.fontFamily ?? '',
      fontSize,
      text: run.text,
    });
    this._emitOverlay(app, overlayCtx);
  }

  /**
   * Sample the canvas background + foreground colors and resolve font family /
   * weight for an overlay covering the given canvas-space rectangle. Pure
   * computation + one canvas read pass — produces the full OverlayContext used by
   * both the click-time no-match path and the commit-time true-edit-failure
   * fallback (A1).
   */
  private _buildOverlayContext(
    app: IAppContext,
    o: {
      annX: number; annY: number; w: number; h: number;
      pageId: string; fontName: string; pdfjsFontFamily: string;
      fontSize: number; text: string;
    },
  ): OverlayContext {
    const { annX, annY, w, h } = o;

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

    // Detect font family from pdfjs styles and PS font name.
    const ff = o.pdfjsFontFamily.toLowerCase();
    const psNameOverlay = extractPsName(o.fontName).toLowerCase();
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

    // Detect bold/italic: check both PS name and pdfjs CSS fontFamily string.
    const overlayCheck = `${extractPsName(o.fontName)} ${o.pdfjsFontFamily}`;
    const bold   = /bold|black|heavy|semibold|demibold/i.test(overlayCheck);
    const italic = /italic|oblique/i.test(overlayCheck);

    return {
      annX, annY, w, h,
      pageId: o.pageId,
      bgColor, textColor, fontFamily,
      fontSize: o.fontSize,
      bold, italic,
      text: o.text,
    };
  }

  /**
   * Build the redaction cover + text overlay from a resolved context and execute
   * it as a single undoable MacroCmd, then select the new text element.
   */
  private _emitOverlay(app: IAppContext, ctx: OverlayContext): void {
    const cover = new RedactionElement(ctx.annX - 2, ctx.annY - 2, ctx.w + 4, ctx.h + 4, ctx.pageId, ctx.bgColor);
    const textEl = new TextElement(ctx.annX, ctx.annY, ctx.pageId, {
      width: ctx.w + 4,
      height: ctx.h + 4,
      fontSize: ctx.fontSize,
      color: ctx.textColor,
      fontFamily: ctx.fontFamily,
      bold: ctx.bold,
      italic: ctx.italic,
    });
    textEl.text = ctx.text;

    app.historyManager.execute(new MacroCmd([
      new AddElementCmd(app.elements, cover),
      new AddElementCmd(app.elements, textEl),
    ]));
    app.autosave();
    app.setMode('select');
    app.selectElement(textEl);
    // Honest UX (#1): this text couldn't be edited IN PLACE (Arabic / subset or
    // CID font lacking the new glyph / Form XObject / encrypted source). It's now
    // an editable overlay drawn on top — tell the user so the fallback is never a
    // silent surprise. (Arabic overlays render correctly via the #3/#3b bidi path.)
    app.reportError.info('toast.trueEditOverlay');

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
      itemWidth: number;
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

    // A1: capture the overlay context NOW (geometry from the matched origin +
    // colors sampled from the canvas), while the original is still on screen. If
    // the true edit fails at commit time (replaceTextAt/deleteTextAt return false
    // — e.g. Type3 / invisible / vertical fonts that only A5 detects after the
    // editor opened), commit() falls back to this overlay instead of silently
    // discarding the user's typed change.
    const overlayH = Math.max(opts.itemHeight, 10);
    const overlayContext = this._buildOverlayContext(app, {
      annX: opts.origin.x,
      annY: opts.pageH - opts.origin.y - overlayH,
      w: opts.itemWidth,
      h: overlayH,
      pageId: opts.pageId,
      fontName: opts.fontName,
      pdfjsFontFamily: opts.pdfjsFontFamily,
      fontSize: Math.round(opts.fontSize),
      text: opts.originalText,
    });

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
        const ok = await deleteTextAt(opts.libDoc, opts.pageIndex, opts.origin, TRUE_EDIT_TOLERANCE, {
          adjustDecorations: isEnabled('textDecor'),
        });
        if (!ok) return;
        const newBytes = await opts.libDoc.save();
        if (await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId)) {
          app.reportError.info('toast.trueTextDeleted');
        }
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
          if (await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId)) {
            app.reportError.info('toast.trueTextEdited');
          }
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

      // Canvas-sampled glyph color: only used by the Path-3 redraw when the
      // in-stream fill can't be resolved (scn/Separation/spot) and no style
      // color was set — keeps spot-colored text from being recolored black.
      const sampledFallback = hexToRgb01(overlayContext.textColor) ?? undefined;
      const result = await replaceTextAt(opts.libDoc, opts.pageIndex, opts.origin, newText, TRUE_EDIT_TOLERANCE, style, sampledFallback, {
        adjustDecorations: isEnabled('textDecor'),
      });
      if (!result) {
        // A1: the true edit refused (e.g. Type3 / invisible / vertical font, or a
        // subset-font XObject). Don't silently drop the user's change — cover the
        // original with a redaction and place an editable text box carrying the
        // typed text, using the context captured when the editor opened.
        this._emitOverlay(app, { ...overlayContext, text: newText });
        return;
      }

      const newBytes = await opts.libDoc.save();
      if (await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId)) {
        // Slice B: 'substituted' means a non-standard embedded font was redrawn in
        // a base-14 substitute — tell the user honestly. Path 1/2 (font kept) → the
        // plain edited toast.
        app.reportError.info(result === 'substituted' ? 'toast.trueEditFontSubstituted' : 'toast.trueTextEdited');
      }
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
