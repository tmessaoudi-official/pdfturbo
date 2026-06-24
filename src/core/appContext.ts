/**
 * IAppContext — the narrow interface that handlers require from PDFTurboApp.
 *
 * Handlers should accept IAppContext instead of the concrete PDFTurboApp class
 * so that they remain decoupled from the full god-class implementation.
 * Phase 5 of the craftsmanship refactor.
 */

import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel, SourcePdf, PageCrop } from './documentModel';
import type { HistoryManager } from './historyManager';
import type { InkLayer } from '../infra/inkLayer';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { AppDOMRefs } from '../ui/uiController';
import type { ToolMode } from './pdfTurboApp';
import type { IErrorReporter } from './errorReporter';
import type { IProgressManager } from '../ui/progressManager';

export interface IAppContext {
  /** Current page elements across all pages. */
  elements: PDFElement[];
  /** Read-only DOM handle collection. */
  ui: AppDOMRefs;
  /** Document model: pages, sources, watermark. */
  documentModel: DocumentModel;
  /** Command history for undo/redo. */
  historyManager: HistoryManager;
  /** Ink layer (freehand draw & erase). */
  inkLayer: InkLayer;
  /** pdfjs renderer — used for hit-tests and coordinate resolution. */
  renderer: PDFRenderer;
  /** Current active tool mode. */
  mode: ToolMode;
  /** Current canvas zoom factor. */
  zoomScale: number;
  /** Currently selected element, or null. */
  selectedElement: PDFElement | null;
  /** Effective fill color from the toolbar (undefined = no fill). */
  effectiveFillColor: string | undefined;

  /** Structured error reporter — use instead of showToast() for new code. */
  reportError: IErrorReporter;
  /** Progress overlay — use for any operation that blocks the UI. */
  progress: IProgressManager;

  // ── Methods ──────────────────────────────────────────────────────
  showToast(msg: string, duration?: number): void;
  setMode(mode: ToolMode): void;
  selectElement(element: PDFElement | null): void;
  rebuildElementLayer(): void;
  /** Re-render only one element's node in place (used during an active drag/resize). */
  rerenderElement(element: PDFElement): HTMLDivElement | null;
  renderInkLayer(): void;
  renderInkLayerWithLive(points: Array<{ x: number; y: number }>, type: 'ink' | 'erase'): void;
  applyZoom(newScale: number): Promise<void>;
  autosave(): void;
  _commitPlacement(mode: 'addText' | 'addImage' | 'addComment' | 'addSignature' | 'addCode', x: number, y: number, w: number, h: number): void;
  /** Create a new editable text box centered at the click point (unified text mode). */
  addTextAtPosition(e: MouseEvent): void;
  _applySourcePdfEdit(src: SourcePdf, newBytes: Uint8Array, pageId: string): Promise<boolean>;
  /** Crop a page (or every page with applyToAll) from a drawn display-space rect; null clears. Undoable. */
  cropPage(pageId: string, displayRect: PageCrop | null, applyToAll: boolean): Promise<void>;
  /** F-C C2: "Pick on page" for the e-sign box — a drawn display rect (or null) → prefill + reopen the sign modal. */
  onSignRectPicked(displayRect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
}
