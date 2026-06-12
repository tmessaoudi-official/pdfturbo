import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressManager } from '../../src/ui/progressManager';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeElements(): { overlay: HTMLElement; label: HTMLElement } {
  const overlay = document.createElement('div');
  const label = document.createElement('span');
  return { overlay, label };
}

describe('ProgressManager', () => {
  let overlay: HTMLElement;
  let label: HTMLElement;
  let pm: ProgressManager;

  beforeEach(() => {
    ({ overlay, label } = makeElements());
    pm = new ProgressManager(overlay, label);
  });

  it('begin() adds .active class and sets label', () => {
    pm.begin('progress.loadingDocument');
    expect(overlay.classList.contains('active')).toBe(true);
    expect(label.textContent).toBeTruthy();
  });

  it('done() removes .active when single operation finishes', () => {
    const h = pm.begin('progress.loadingDocument');
    h.done();
    expect(overlay.classList.contains('active')).toBe(false);
    expect(label.textContent).toBe('');
  });

  it('failed() removes .active', () => {
    const h = pm.begin('progress.loadingDocument');
    h.failed();
    expect(overlay.classList.contains('active')).toBe(false);
  });

  it('done() is idempotent — second call is a no-op', () => {
    const h = pm.begin('progress.loadingDocument');
    h.done();
    h.done();
    expect(overlay.classList.contains('active')).toBe(false);
  });

  it('stacked begin() — overlay stays active until all handles resolve', () => {
    const h1 = pm.begin('progress.loadingDocument');
    const h2 = pm.begin('progress.generatingPdf');
    h1.done();
    expect(overlay.classList.contains('active')).toBe(true);
    h2.done();
    expect(overlay.classList.contains('active')).toBe(false);
  });

  it('update() changes the label text mid-operation', () => {
    const h = pm.begin('progress.loadingDocument');
    const initial = label.textContent;
    h.update('progress.generatingPdf');
    expect(label.textContent).not.toBe(initial);
  });

  it('update() after done() is ignored', () => {
    const h = pm.begin('progress.loadingDocument');
    h.done();
    const after = label.textContent;
    h.update('progress.generatingPdf');
    expect(label.textContent).toBe(after);
  });

  it('aria-label mirrors the label text', () => {
    pm.begin('progress.loadingDocument');
    expect(overlay.getAttribute('aria-label')).toBe(label.textContent);
  });

  it('aria-label cleared on hide', () => {
    const h = pm.begin('progress.loadingDocument');
    h.done();
    expect(overlay.getAttribute('aria-label')).toBe('');
  });
});
