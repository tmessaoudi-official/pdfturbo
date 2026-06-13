import { describe, it, expect, vi, afterEach } from 'vitest';
import { PanelFocusTrapService } from '../../src/core/panelFocusTrapService';

vi.mock('../../src/utils/focusTrap', () => ({ trapFocus: vi.fn() }));

import { trapFocus } from '../../src/utils/focusTrap';
const mockTrapFocus = vi.mocked(trapFocus);

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function makePanel(active = false): { panel: HTMLElement; content: HTMLElement; trigger: HTMLButtonElement } {
  const panel = document.createElement('div');
  if (active) panel.classList.add('active');
  const content = document.createElement('div');
  content.className = 'help-content';
  panel.appendChild(content);
  document.body.appendChild(panel);
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  return { panel, content, trigger };
}

describe('PanelFocusTrapService.togglePanel', () => {
  it('invokes the toggle function', () => {
    const { panel, trigger } = makePanel();
    const toggleFn = vi.fn();
    new PanelFocusTrapService().togglePanel(toggleFn, panel, '.help-content', trigger);
    expect(toggleFn).toHaveBeenCalledOnce();
  });

  it('calls trapFocus with content element and trigger when panel becomes active', () => {
    const cleanup = vi.fn();
    mockTrapFocus.mockReturnValue(cleanup);
    const { panel, content, trigger } = makePanel();
    const toggleFn = vi.fn(() => { panel.classList.add('active'); });
    new PanelFocusTrapService().togglePanel(toggleFn, panel, '.help-content', trigger);
    expect(mockTrapFocus).toHaveBeenCalledWith(content, trigger);
  });

  it('does not call trapFocus when panel becomes inactive', () => {
    const { panel, trigger } = makePanel(true);
    const toggleFn = vi.fn(() => { panel.classList.remove('active'); });
    new PanelFocusTrapService().togglePanel(toggleFn, panel, '.help-content', trigger);
    expect(mockTrapFocus).not.toHaveBeenCalled();
  });

  it('calls existing cleanup before installing a new trap', () => {
    const externalCleanup = vi.fn();
    const newCleanup = vi.fn();
    mockTrapFocus.mockReturnValue(newCleanup);
    const { panel, trigger } = makePanel();
    const svc = new PanelFocusTrapService();
    svc.setCleanup(externalCleanup);
    const toggleFn = vi.fn(() => { panel.classList.add('active'); });
    svc.togglePanel(toggleFn, panel, '.help-content', trigger);
    expect(externalCleanup).toHaveBeenCalledOnce();
    expect(mockTrapFocus).toHaveBeenCalled();
  });

  it('calls existing cleanup and nulls it when panel becomes inactive', () => {
    const existingCleanup = vi.fn();
    const { panel, trigger } = makePanel(true);
    const svc = new PanelFocusTrapService();
    svc.setCleanup(existingCleanup);
    const toggleFn = vi.fn(() => { panel.classList.remove('active'); });
    svc.togglePanel(toggleFn, panel, '.help-content', trigger);
    expect(existingCleanup).toHaveBeenCalledOnce();
    expect(svc.getCleanup()).toBeNull();
  });

  it('stores the cleanup returned by trapFocus', () => {
    const cleanup = vi.fn();
    mockTrapFocus.mockReturnValue(cleanup);
    const { panel, trigger } = makePanel();
    const svc = new PanelFocusTrapService();
    const toggleFn = vi.fn(() => { panel.classList.add('active'); });
    svc.togglePanel(toggleFn, panel, '.help-content', trigger);
    expect(svc.getCleanup()).toBe(cleanup);
  });
});

describe('PanelFocusTrapService.getCleanup / setCleanup', () => {
  it('returns null initially', () => {
    expect(new PanelFocusTrapService().getCleanup()).toBeNull();
  });

  it('round-trips get/set', () => {
    const fn = vi.fn();
    const svc = new PanelFocusTrapService();
    svc.setCleanup(fn);
    expect(svc.getCleanup()).toBe(fn);
  });
});
