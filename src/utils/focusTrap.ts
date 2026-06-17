const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function trapFocus(
  container: HTMLElement,
  returnFocusTo?: HTMLElement,
  focusFirst = true,
): () => void {
  function focusables(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) { e.preventDefault(); last.focus(); }
    } else {
      if (active === last || !container.contains(active)) { e.preventDefault(); first.focus(); }
    }
  }

  container.addEventListener('keydown', onKeydown);
  if (focusFirst) {
    const first = focusables()[0];
    if (first) first.focus();
  }

  return () => {
    container.removeEventListener('keydown', onKeydown);
    returnFocusTo?.focus();
  };
}
