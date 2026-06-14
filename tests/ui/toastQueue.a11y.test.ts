import { describe, it, expect, beforeEach } from 'vitest';
import { ToastQueue } from '../../src/ui/toastQueue';

function makeEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'toast';
  document.body.appendChild(el);
  return el;
}

describe('ToastQueue a11y live region (E2)', () => {
  let el: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    el = makeEl();
  });

  it('marks the toast container as a status live region', () => {
    // eslint-disable-next-line no-new
    new ToastQueue(el);
    expect(el.getAttribute('role')).toBe('status');
  });

  it('sets aria-live=polite so screen readers announce non-disruptively', () => {
    // eslint-disable-next-line no-new
    new ToastQueue(el);
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('sets aria-atomic=true so the full message is read each time', () => {
    // eslint-disable-next-line no-new
    new ToastQueue(el);
    expect(el.getAttribute('aria-atomic')).toBe('true');
  });
});
