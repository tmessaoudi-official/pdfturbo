// Reusable destructive-action confirmation dialog (master plan M0 #7 / forge [I]).
//
// Close-document and reset-session are the only two non-undoable actions in an
// otherwise everything-is-undoable app — an accidental click discards the user's
// work with no recovery. This gates them behind an explicit confirm. It reuses the
// `#confirmDialog` element in index.html (same `restore-dialog` styling as the
// session-restore prompt) and the shared focus trap, and resolves a boolean.

import { t } from '../utils/i18n';
import { trapFocus } from '../utils/focusTrap';

export interface ConfirmOptions {
  /** i18n key for the dialog message. */
  messageKey: string;
  /** i18n key for the confirm button label (default: modal.confirm.ok). */
  confirmKey?: string;
  /** i18n key for the cancel button label (default: modal.confirm.cancel). */
  cancelKey?: string;
}

/**
 * Shows the confirmation dialog and resolves true (confirmed) / false (cancelled
 * or dismissed). Resolves false immediately if the dialog element is absent so a
 * missing template never blocks the user.
 */
export function confirmDestructive(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const dialog = document.getElementById('confirmDialog');
    const msg = document.getElementById('confirmDialogMsg');
    const confirmBtn = document.getElementById('confirmDialogConfirm');
    const cancelBtn = document.getElementById('confirmDialogCancel');
    if (!dialog || !msg || !confirmBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    msg.textContent = t(opts.messageKey);
    confirmBtn.textContent = t(opts.confirmKey ?? 'modal.confirm.ok');
    cancelBtn.textContent = t(opts.cancelKey ?? 'modal.confirm.cancel');

    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog.style.display = '';
    const releaseTrap = trapFocus(dialog, previouslyFocused ?? undefined);

    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      dialog.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('keydown', onKeydown);
      releaseTrap();
      resolve(result);
    };
    const onConfirm = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('keydown', onKeydown);
  });
}
