// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { confirmDestructive } from '../../src/ui/confirmDialog';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

// Minimal #confirmDialog markup mirroring index.html's restore-dialog shape.
const MARKUP = `
<div id="confirmDialog" class="restore-dialog" role="dialog" aria-modal="true"
     aria-labelledby="confirmDialogMsg" style="display:none">
  <div class="restore-dialog-box">
    <p id="confirmDialogMsg"></p>
    <div class="restore-dialog-actions">
      <button id="confirmDialogConfirm" class="btn btn-danger"></button>
      <button id="confirmDialogCancel" class="btn btn-secondary"></button>
    </div>
  </div>
</div>`;

describe('confirmDestructive', () => {
  beforeEach(() => {
    document.body.innerHTML = MARKUP;
  });

  it('shows the dialog and resolves true when the confirm button is clicked', async () => {
    const p = confirmDestructive({ messageKey: 'modal.confirmClose.message', confirmKey: 'x', cancelKey: 'y' });
    const dialog = document.getElementById('confirmDialog') as HTMLElement;
    expect(dialog.style.display).not.toBe('none');
    (document.getElementById('confirmDialogConfirm') as HTMLElement).click();
    expect(await p).toBe(true);
    // Dialog hidden again after a decision.
    expect(dialog.style.display).toBe('none');
  });

  it('resolves false when the cancel button is clicked', async () => {
    const p = confirmDestructive({ messageKey: 'modal.confirmClose.message' });
    (document.getElementById('confirmDialogCancel') as HTMLElement).click();
    expect(await p).toBe(false);
  });

  it('resolves false when Escape is pressed', async () => {
    const p = confirmDestructive({ messageKey: 'modal.confirmClose.message' });
    const dialog = document.getElementById('confirmDialog') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p).toBe(false);
  });

  it('sets the message text from the provided key', async () => {
    const p = confirmDestructive({ messageKey: 'modal.confirmReset.message' });
    expect(document.getElementById('confirmDialogMsg')?.textContent).toBe('modal.confirmReset.message');
    (document.getElementById('confirmDialogCancel') as HTMLElement).click();
    await p;
  });

  it('does not leave listeners attached after resolving (second confirm click is a no-op)', async () => {
    const p = confirmDestructive({ messageKey: 'modal.confirmClose.message' });
    const confirmBtn = document.getElementById('confirmDialogConfirm') as HTMLElement;
    confirmBtn.click();
    expect(await p).toBe(true);
    // Clicking again must not throw or re-trigger anything.
    expect(() => confirmBtn.click()).not.toThrow();
  });
});
