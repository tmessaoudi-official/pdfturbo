import { describe, it, expect, beforeEach } from 'vitest';
import { attachDisplayModalFocusTrap } from '../../src/utils/displayModalFocusTrap';

/** Flush the jsdom MutationObserver microtask queue. */
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

/** The content panel of a modal (always present in these tests). */
const panelOf = (modal: HTMLElement) => modal.querySelector(':scope > div') as HTMLElement;

/** Build a `style.display`-toggled modal: root > content > [input#a, button#b]. */
function buildModal(): { modal: HTMLElement; input: HTMLInputElement; button: HTMLButtonElement } {
  const modal = document.createElement('div');
  modal.style.display = 'none';
  const content = document.createElement('div');
  const input = document.createElement('input');
  input.id = 'a';
  const button = document.createElement('button');
  button.id = 'b';
  button.textContent = 'OK';
  content.append(input, button);
  modal.append(content);
  document.body.append(modal);
  return { modal, input, button };
}

describe('attachDisplayModalFocusTrap', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('traps Tab within the content panel while the modal is visible', async () => {
    const { modal, input, button } = buildModal();
    attachDisplayModalFocusTrap(modal, ':scope > div');

    modal.style.display = 'flex';
    await flush();

    // Forward Tab from the last focusable wraps to the first.
    button.focus();
    panelOf(modal).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(input);
  });

  it('focuses the first focusable on open when nothing inside is focused', async () => {
    const { modal, input } = buildModal();
    attachDisplayModalFocusTrap(modal, ':scope > div');

    modal.style.display = 'flex';
    await flush();

    expect(document.activeElement).toBe(input);
  });

  it('does NOT steal focus on open when a field inside is already focused', async () => {
    const { modal, button } = buildModal();
    attachDisplayModalFocusTrap(modal, ':scope > div');

    // Mirror the real open paths (pdfPassword / extractPages focus their input first).
    button.focus();
    modal.style.display = 'flex';
    await flush();

    expect(document.activeElement).toBe(button);
  });

  it('tears the trap down once the modal is hidden again', async () => {
    const { modal, button } = buildModal();
    attachDisplayModalFocusTrap(modal, ':scope > div');

    modal.style.display = 'flex';
    await flush();
    modal.style.display = 'none';
    await flush();

    // With the trap gone, Tab from the last focusable is NOT forced back to the first.
    button.focus();
    panelOf(modal).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(button);
  });

  it('returns focus to the trigger element on close', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { modal } = buildModal();
    attachDisplayModalFocusTrap(modal, ':scope > div', trigger);

    modal.style.display = 'flex';
    await flush();
    modal.style.display = 'none';
    await flush();

    expect(document.activeElement).toBe(trigger);
  });
});
