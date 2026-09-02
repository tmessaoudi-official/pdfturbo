/**
 * OCR handler — renders the current source page to a canvas, runs OCR
 * (tesseract.js, dynamically imported by the core), and inserts the recognized
 * words as undoable, selectable, exportable text elements.
 *
 * Output decision (2026-06-15): recognized text becomes real TextElements added
 * through a single MacroCmd, so the whole OCR layer is one undo, and the text is
 * immediately searchable / selectable / DOCX-MD-exportable via existing seams —
 * rather than a bespoke transparent overlay layer.
 *
 * 100% client-side: the page never leaves the browser. ALL tesseract assets
 * (worker, WASM core, traineddata) are served from the app origin ('self') so
 * OCR works under the strict CSP (`connect-src 'self'`) and offline — the CDN
 * defaults are blocked by that CSP. Assets are vendored by
 * `scripts/prepare-ocr-assets.mjs`; paths are built by `ocrAssetPaths`.
 */
import type { DocumentModel, DocumentPage, SourcePdf } from '../core/documentModel';
import { recognizePage, resolveLanguage } from '../ocr';
import type { OcrResult } from '../ocr/ocrTypes';
import { TextElement } from '../elements/textElement';
import { AddElementCmd, MacroCmd, type HistoryManager } from '../core/historyManager';
import { applySearchableLayerToPdf, partitionWordsByFont } from '../ocr/searchableTextLayer';
import type { IErrorReporter } from '../contracts/errorReporter';
import type { PDFElement } from '../elements/annotationElement';
import { RedactionElement } from '../elements/redactionElement';
import { redactionRectToContent } from '../utils/geometry';

/**
 * Narrow role-interface the OCR handler requires from the app (M2 #18). Decouples
 * the handler from the concrete PDFTurboApp god-class — mirrors the per-component
 * context convention already used by SignatureManager (`ISignatureContext`).
 */
export interface IOcrContext {
  readonly reportError: IErrorReporter;
  readonly documentModel: DocumentModel;
  readonly historyManager: HistoryManager;
  /** Live element array for the current page — AddElementCmd mutates it in place. */
  readonly elements: PDFElement[];
  rebuildElementLayer(): void;
  autosave(): void;
  /** Swap a source PDF's bytes (undoable + persisted); resolves false if discarded. */
  _applySourcePdfEdit(src: SourcePdf, newBytes: Uint8Array, pageId: string): Promise<boolean>;
}

/**
 * OCR output mode:
 * - `'visible'`    — recognized words become editable, selectable TextElements (the
 *                    original behaviour; the default so existing callers are unchanged).
 * - `'searchable'` — recognized words become an INVISIBLE (`3 Tr`) text layer baked
 *                    into the source page, making a scan selectable/searchable with
 *                    no visible change (the canonical "OCR a scan" deliverable).
 */
export type OcrOutputMode = 'visible' | 'searchable';

export interface OcrRunProgress {
  /** 0..1 recognition progress. */
  progress: number;
  /** tesseract status string (e.g. 'recognizing text'). */
  status: string;
}

interface OcrWordLike {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Local 'self'-served tesseract asset locations (CSP-safe). */
export interface OcrAssetPaths {
  /** Directory of the WASM core variants (`tesseract-core*.wasm.js`). */
  corePath: string;
  /** URL of the worker script. */
  workerPath: string;
  /** Directory base for `<lang>.traineddata.gz`. */
  langPath: string;
}

/**
 * Build the local, same-origin tesseract asset paths from the app's base URL
 * (`import.meta.env.BASE_URL`, e.g. "/pdfturbo/"). These point at the assets
 * vendored under `public/tesseract/` so tesseract never falls back to its CDN
 * (which the app CSP blocks → broken OCR). Pure → unit-testable; the test
 * guards against any regression that reintroduces a CDN/remote path.
 */
export function ocrAssetPaths(base: string): OcrAssetPaths {
  // Normalize to a single trailing slash so concatenation is predictable
  // regardless of whether BASE_URL ends with "/".
  const b = base.endsWith('/') ? base : `${base}/`;
  const root = `${b}tesseract`;
  return {
    corePath: `${root}/core`,
    workerPath: `${root}/worker.min.js`,
    langPath: `${root}/lang`,
  };
}

/**
 * Map one OCR word (image-pixel bbox, top-left origin) to a TextElement in
 * element space (PDF points, top-left origin). Both spaces are top-left, so
 * only the render scale divides out — no Y-flip. Pure → jsdom-unit-testable.
 *
 * Rotation note: the visible path renders the OCR canvas at the page's intrinsic
 * `/Rotate` (no user rotation), and the element layer is composed in that SAME
 * displayed/rotated viewport space, so a plain scale-divide already lands visible
 * elements correctly when user rotation is 0 (the common case). The
 * UNROTATED-PDF-space remap is only needed by the searchable-layer path (which
 * writes into unrotated user space) — see `rotateBBoxToUnrotated` in
 * `searchableTextLayer.ts`. Aligning the visible path with a non-zero USER
 * rotation is a follow-up (G15b).
 */
export function ocrWordToTextElement(w: OcrWordLike, scale: number, pageId: string): TextElement {
  const x = w.bbox.x0 / scale;
  const y = w.bbox.y0 / scale;
  const width = Math.max(8, (w.bbox.x1 - w.bbox.x0) / scale);
  const height = Math.max(8, (w.bbox.y1 - w.bbox.y0) / scale);
  const el = new TextElement(x, y, pageId, {
    width,
    height,
    fontSize: Math.max(6, Math.round(height * 0.8)),
    multiline: false,
  });
  el.text = w.text;
  return el;
}

export class OcrHandler {
  // Higher render scale → more pixels for the recognizer → better accuracy.
  private static readonly RENDER_SCALE = 2;

  // M0 #6 — single-flight gate. A second concurrent run() would spin up another
  // tesseract WASM worker (unbounded) and could double-commit the searchable
  // byte-swap. The run button is also disabled in the UI; this is the authoritative
  // backstop for any other / programmatic entry point.
  private _running = false;

  constructor(private readonly app: IOcrContext) {}

  /**
   * Recognize text on the current page and emit it in the requested {@link OcrOutputMode}.
   * @returns the number of words placed (0 when the page is blank/has no source,
   *          or no usable text was found).
   * @throws SearchableLayerError('ROTATED_PAGE') in `'searchable'` mode only on a
   *   NON-cardinal rotation (a `/Rotate` that is not a multiple of 90). Cardinal
   *   rotations (90/180/270) are remapped to unrotated PDF coords and supported.
   */
  async run(
    language: string,
    mode: OcrOutputMode = 'visible',
    onProgress?: (p: OcrRunProgress) => void,
  ): Promise<number> {
    const app = this.app;
    if (this._running) {
      // A recognition is already in flight — ignore the re-entry (no 2nd WASM worker,
      // no double commit). Reaching here requires bypassing the disabled run button.
      app.reportError.silent(undefined, 'OcrHandler.run: ignored — already running');
      return 0;
    }
    const page = app.documentModel.currentPage;
    if (!page) return 0;
    // Blank pages (sourcePageNum 0) carry no rasterizable source.
    const src = app.documentModel.sourcePdfs.get(page.sourcePdfId);
    if (!src?.doc || page.sourcePageNum < 1) return 0;

    this._running = true;
    try {
      return await this._run(app, page, src, language, mode, onProgress);
    } finally {
      this._running = false;
    }
  }

  private async _run(
    app: IOcrContext,
    page: DocumentPage,
    src: SourcePdf,
    language: string,
    mode: OcrOutputMode,
    onProgress?: (p: OcrRunProgress) => void,
  ): Promise<number> {
    const recd = await this._recognize(page, src, language, onProgress);
    if (!recd) return 0;
    const { result, scale } = recd;

    if (mode === 'searchable') {
      // Count what will actually be placed (Arabic + WinAnsi-safe Latin); non-Latin
      // non-Arabic and empties are dropped by the partition.
      const { latin, arabic } = partitionWordsByFont(result.words);
      const placed = latin.length + arabic.length;
      if (placed === 0) return 0;
      // Cardinal-rotated pages (90/180/270) are remapped to unrotated PDF coords
      // inside applySearchableLayerToPdf. It still throws SearchableLayerError(
      // 'ROTATED_PAGE') for a non-cardinal /Rotate — let that propagate so the
      // caller can show the specific "rotated unsupported" message.
      const newBytes = await applySearchableLayerToPdf(src.bytes, page.sourcePageNum, result.words, scale);
      if (!newBytes) return 0;
      // Reuse the true-edit byte-swap: undoable (ReplaceSourcePdfBytesCmd) + persisted.
      // If the swap was discarded (source superseded / error), report no words placed
      // so the caller doesn't falsely claim a searchable layer was added.
      const committed = await app._applySourcePdfEdit(src, newBytes, page.id);
      return committed ? placed : 0;
    }

    const cmds = result.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => new AddElementCmd(app.elements, ocrWordToTextElement(w, scale, page.id)));

    if (cmds.length === 0) return 0;
    app.historyManager.execute(new MacroCmd(cmds));
    app.rebuildElementLayer();
    app.autosave();
    return cmds.length;
  }

  /**
   * Render the current page to a canvas and run recognition. The expensive step
   * shared by {@link run} (which then bakes the result into the document) and
   * {@link recognizeCurrentPage} (which returns it untouched for text/DOCX export).
   * Returns null only when the 2D canvas context is unavailable (run() then yields
   * 0 words, preserving its original behaviour).
   */
  private async _recognize(
    page: DocumentPage,
    src: SourcePdf,
    language: string,
    onProgress?: (p: OcrRunProgress) => void,
  ): Promise<{ result: OcrResult; scale: number } | null> {
    const scale = OcrHandler.RENDER_SCALE;
    const pdfPage = await src.doc.getPage(page.sourcePageNum);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;

    // REDACTION LEAK FIX: burn the page's redactions onto the OCR canvas BEFORE recognition. This
    // renders the RAW source page, so without the burn tesseract reads the text under a redaction box
    // and hands it back through "Copy text" / "Export to Word" — defeating the whole point of the tool.
    // Painting rather than filtering recognised words is deliberate: the engine then cannot see the
    // glyphs at all, so there is no partial-overlap word to reason about.
    // A plain `el.x * scale` is WRONG here, which is not obvious: this canvas is rendered at the page's
    // INTRINSIC `/Rotate` with no user rotation (see the rotation note on `ocrWordToTextElement`), while
    // element rects live in display space at `page.rotate + docPage.rotation`. Measured on the naive
    // version: with a user rotation applied the fill lands off-target and, for some combinations,
    // ENTIRELY off-canvas — no burn at all. Rotating a sideways scan upright before OCR-ing it is the
    // normal thing to do, so that is the likely configuration rather than an exotic one.
    // Two proven mappings composed instead: display → unrotated content (`redactionRectToContent`,
    // which handles the user rotation), then content → canvas via the rendering viewport's own
    // `convertToViewportPoint` (which handles `/Rotate` and the scale) — the pattern `exportPipeline`
    // uses for the crop clip. `convertToViewportPoint` takes y-UP user space, hence the `Hu -` flips.
    const unrot = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const Hu = unrot.height;
    // The CropBox origin must be ADDED back: element coords are relative to the rendered page box, while
    // `convertToViewportPoint` consumes ABSOLUTE user space (its transform bakes in the viewBox centre).
    // On a `/CropBox [20 20 …]` page, omitting this burns 20pt off in both axes and clips the wrong strip,
    // leaving part of the secret legible. The vector path adds the same offset (`pdfElementRenderer`'s
    // `cropOriginX/Y`), which is the precedent this follows.
    const [ox, oy] = [unrot.viewBox[0] as number, unrot.viewBox[1] as number];
    const totalRot = ((((pdfPage.rotate as number) ?? 0) + (page.rotation ?? 0)) % 360 + 360) % 360;
    for (const el of this.app.elements) {
      // `el.type`, NOT `instanceof`: identity checks fail OPEN across duplicated module instances (this
      // build already warns about a statically+dynamically imported module), and a silently skipped burn
      // is a leak with no error and no visual sign. The sibling filter in `exportService` uses `type`
      // too — one predicate for one safety decision.
      if (el.pageId !== page.id || el.type !== 'redaction') continue;
      const c = redactionRectToContent(
        el, unrot.width, Hu, totalRot,
      );
      const [ax, ay] = viewport.convertToViewportPoint(ox + c.x, oy + Hu - c.y);
      const [bx, by] = viewport.convertToViewportPoint(ox + c.x + c.width, oy + Hu - (c.y + c.height));
      ctx.fillStyle = (el as RedactionElement).color ?? '#000000';
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    }

    const paths = ocrAssetPaths(import.meta.env.BASE_URL);
    const result = await recognizePage(canvas, {
      language: resolveLanguage(language),
      onProgress: ({ progress, status }) => onProgress?.({ progress, status }),
      corePath: paths.corePath,
      workerPath: paths.workerPath,
      langPath: paths.langPath,
    });
    return { result, scale };
  }

  /**
   * Recognize text on the current page and RETURN the result WITHOUT modifying the
   * document — the read-only basis for the "copy text" and "export to Word"
   * outputs. Applies the same guards + single-flight gate as {@link run}. Returns
   * null when there is no current page / rasterizable source / canvas context.
   */
  async recognizeCurrentPage(
    language: string,
    onProgress?: (p: OcrRunProgress) => void,
  ): Promise<OcrResult | null> {
    const app = this.app;
    if (this._running) {
      app.reportError.silent(undefined, 'OcrHandler.recognizeCurrentPage: ignored — already running');
      return null;
    }
    const page = app.documentModel.currentPage;
    if (!page) return null;
    const src = app.documentModel.sourcePdfs.get(page.sourcePdfId);
    if (!src?.doc || page.sourcePageNum < 1) return null;

    this._running = true;
    try {
      const recd = await this._recognize(page, src, language, onProgress);
      return recd ? recd.result : null;
    } finally {
      this._running = false;
    }
  }
}
