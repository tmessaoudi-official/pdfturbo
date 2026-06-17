import { trapFocus } from './focusTrap';

/**
 * Focus-trap a `style.display`-toggled modal (blank-page / pdf-password / lock-pdf /
 * extract-pages). Unlike the `.active`-class modals — which call `trapFocus` explicitly
 * from their single open/close methods (see `openSignModal` / `openOcrModal`) — these
 * page-op modals have many disparate close paths (Cancel, submit, backdrop click, Esc).
 * Wrapping each one is error-prone and easy to miss, so instead a `MutationObserver`
 * watches the modal's inline `style` and sets the trap up when it becomes visible /
 * tears it down when it hides. Every close path is therefore covered by construction.
 *
 * The trap does NOT steal focus when a field inside the modal is already focused — the
 * real open paths (`pdfPassword` / `extractPages`) focus their input first, and that
 * choice is preserved. When nothing inside is focused on open, the first focusable
 * receives focus (standard dialog behaviour).
 *
 * @param modal       the modal root whose `style.display` toggles between a value and 'none'
 * @param contentSel  selector (relative to `modal`) for the inner content panel to trap within
 * @param trigger     optional element to return focus to when the modal closes
 */
export function attachDisplayModalFocusTrap(
  modal: HTMLElement,
  contentSel: string,
  trigger?: HTMLElement,
): void {
  let cleanup: (() => void) | null = null;

  const sync = (): void => {
    const visible = modal.style.display !== 'none' && modal.style.display !== '';
    if (visible && !cleanup) {
      const content = (modal.querySelector(contentSel) as HTMLElement | null) ?? modal;
      const focusFirst = !content.contains(document.activeElement);
      cleanup = trapFocus(content, trigger, focusFirst);
    } else if (!visible && cleanup) {
      cleanup();
      cleanup = null;
    }
  };

  new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['style'] });
  sync(); // handle a modal that is already visible at wire-up time
}
