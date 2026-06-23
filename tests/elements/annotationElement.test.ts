/**
 * AnnotationElement control a11y (#QA-2026-06-23 P3 #3). The shared delete button and the
 * resize/rotation handles must carry an accessible name so assistive tech can identify them.
 */
import { describe, it, expect, vi } from 'vitest';
import { PDFElement } from '../../src/elements/annotationElement';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

class TestElement extends PDFElement {
  constructor() { super('shape', 0, 0, 10, 10, 'p1'); }
  render(): HTMLDivElement { return document.createElement('div'); }
}

describe('AnnotationElement control a11y (#3)', () => {
  it('gives the delete button an explicit aria-label', () => {
    const controls = new TestElement().createControls();
    const del = controls.querySelector('.delete-btn');
    expect(del?.getAttribute('aria-label')).toBe('element.deleteTitle');
  });

  it('labels the rotation handle', () => {
    const h = new TestElement().createRotationHandle();
    expect(h.getAttribute('aria-label')).toBe('element.rotateTitle');
  });

  it('labels the resize handle', () => {
    const h = new TestElement().createResizeHandle();
    expect(h.getAttribute('aria-label')).toBe('element.resizeTitle');
  });
});
