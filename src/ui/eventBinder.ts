import type { PDFTurboApp } from '../core/pdfTurboApp';
import { bindToolEvents } from './binders/toolBinder';
import { bindFormattingEvents } from './binders/formattingBinder';
import { bindModalEvents } from './binders/modalBinder';
import { bindKeyboardEvents } from './binders/keyboardBinder';
import { bindNavigationEvents } from './binders/navigationBinder';

/** Wire all DOM events to app methods. Called once from the PDFTurboApp constructor. */
export function bindEvents(app: PDFTurboApp): void {
  bindToolEvents(app);
  bindFormattingEvents(app);
  bindModalEvents(app);
  bindKeyboardEvents(app);
  bindNavigationEvents(app);
}
