import type { PDFEditorApp } from '../core/pdfEditorApp';
import { bindToolEvents } from './binders/toolBinder';
import { bindFormattingEvents } from './binders/formattingBinder';
import { bindModalEvents } from './binders/modalBinder';
import { bindKeyboardEvents } from './binders/keyboardBinder';
import { bindNavigationEvents } from './binders/navigationBinder';

/** Wire all DOM events to app methods. Called once from the PDFEditorApp constructor. */
export function bindEvents(app: PDFEditorApp): void {
  bindToolEvents(app);
  bindFormattingEvents(app);
  bindModalEvents(app);
  bindKeyboardEvents(app);
  bindNavigationEvents(app);
}
