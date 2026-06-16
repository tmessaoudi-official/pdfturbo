import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressManager } from '../../src/ui/progressManager';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeElements(): { overlay: HTMLElement; label: HTMLElement } {
  const overlay = document.createElement('div');
  const label = document.createElement('span');
  return { overlay, label };
}

function makeBar(): HTMLProgressElement {
  const bar = document.createElement('progress');
  bar.max = 1;
  bar.value = 0;
  return bar;
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

  describe('determinate progress (setFraction)', () => {
    let bar: HTMLProgressElement;

    beforeEach(() => {
      bar = makeBar();
      pm = new ProgressManager(overlay, label, bar);
    });

    it('setFraction() sets the bar value and marks the overlay determinate', () => {
      const h = pm.begin('progress.generatingPdf');
      h.setFraction(0.5);
      expect(bar.value).toBeCloseTo(0.5);
      expect(overlay.classList.contains('determinate')).toBe(true);
    });

    it('setFraction() clamps to [0, 1]', () => {
      const h = pm.begin('progress.generatingPdf');
      h.setFraction(2);
      expect(bar.value).toBe(1);
      h.setFraction(-1);
      expect(bar.value).toBe(0);
    });

    it('setFraction(null) returns to indeterminate', () => {
      const h = pm.begin('progress.generatingPdf');
      h.setFraction(0.5);
      h.setFraction(null);
      expect(overlay.classList.contains('determinate')).toBe(false);
    });

    it('done() resets determinate state and bar value', () => {
      const h = pm.begin('progress.generatingPdf');
      h.setFraction(0.7);
      h.done();
      expect(overlay.classList.contains('determinate')).toBe(false);
      expect(bar.value).toBe(0);
    });

    it('setFraction() after done() is ignored', () => {
      const h = pm.begin('progress.generatingPdf');
      h.done();
      h.setFraction(0.5);
      expect(overlay.classList.contains('determinate')).toBe(false);
      expect(bar.value).toBe(0);
    });

    it('setFraction() is safe when no bar element is provided', () => {
      const pmNoBar = new ProgressManager(overlay, label);
      const h = pmNoBar.begin('progress.generatingPdf');
      expect(() => h.setFraction(0.5)).not.toThrow();
    });
  });
});
