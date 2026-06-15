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
import type { PDFTurboApp } from '../core/pdfTurboApp';
import { recognizePage, resolveLanguage } from '../ocr';
import { TextElement } from '../elements/textElement';
import { AddElementCmd, MacroCmd } from '../core/historyManager';

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

  constructor(private readonly app: PDFTurboApp) {}

  /**
   * Recognize text on the current page and add it as text elements.
   * @returns the number of words added (0 when the page is blank/has no source,
   *          or no text was found).
   */
  async run(language: string, onProgress?: (p: OcrRunProgress) => void): Promise<number> {
    const app = this.app;
    const page = app.documentModel.currentPage;
    if (!page) return 0;
    // Blank pages (sourcePageNum 0) carry no rasterizable source.
    const src = app.documentModel.sourcePdfs.get(page.sourcePdfId);
    if (!src?.doc || page.sourcePageNum < 1) return 0;

    const scale = OcrHandler.RENDER_SCALE;
    const pdfPage = await src.doc.getPage(page.sourcePageNum);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;

    const paths = ocrAssetPaths(import.meta.env.BASE_URL);
    const result = await recognizePage(canvas, {
      language: resolveLanguage(language),
      onProgress: ({ progress, status }) => onProgress?.({ progress, status }),
      corePath: paths.corePath,
      workerPath: paths.workerPath,
      langPath: paths.langPath,
    });

    const cmds = result.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => new AddElementCmd(app.elements, ocrWordToTextElement(w, scale, page.id)));

    if (cmds.length === 0) return 0;
    app.historyManager.execute(new MacroCmd(cmds));
    app.rebuildElementLayer();
    app.autosave();
    return cmds.length;
  }
}
