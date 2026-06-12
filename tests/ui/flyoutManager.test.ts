import { describe, it, expect, beforeEach } from 'vitest';
import { FlyoutManager } from '../../src/ui/flyoutManager';

function makeSetup() {
  const wrap    = document.createElement('div');
  const trigger = document.createElement('button');
  const flyout  = document.createElement('div');
  document.body.appendChild(wrap);
  document.body.appendChild(flyout);
  return { wrap, trigger, flyout };
}

describe('FlyoutManager', () => {
  let manager: FlyoutManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    manager = new FlyoutManager();
  });

  it('register() adds open class on trigger click', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout });
    trigger.click();
    expect(wrap.classList.contains('open')).toBe(true);
  });

  it('register() toggles: second click removes open class', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout });
    trigger.click();
    trigger.click();
    expect(wrap.classList.contains('open')).toBe(false);
  });

  it('trigger gets aria-expanded=true when opened', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout });
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('trigger gets aria-expanded=false when closed', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout });
    trigger.click();
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closeWhen aria-pressed: closes on click on element with aria-pressed', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout, closeWhen: 'aria-pressed' });
    trigger.click(); // open

    const btn = document.createElement('button');
    btn.setAttribute('aria-pressed', 'true');
    flyout.appendChild(btn);
    btn.click();
    expect(wrap.classList.contains('open')).toBe(false);
  });

  it('closeWhen aria-pressed: does not close on click on element without aria-pressed', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout, closeWhen: 'aria-pressed' });
    trigger.click(); // open

    const span = document.createElement('span');
    flyout.appendChild(span);
    span.click();
    expect(wrap.classList.contains('open')).toBe(true);
  });

  it('closeWhen closest-aria-pressed: closes when ancestor has aria-pressed', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout, closeWhen: 'closest-aria-pressed' });
    trigger.click(); // open

    const parent = document.createElement('div');
    parent.setAttribute('aria-pressed', 'true');
    const child = document.createElement('span');
    parent.appendChild(child);
    flyout.appendChild(parent);
    child.click();
    expect(wrap.classList.contains('open')).toBe(false);
  });

  it('closeWhen any-click: closes on any click inside flyout', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout, closeWhen: 'any-click' });
    trigger.click(); // open

    const span = document.createElement('span');
    flyout.appendChild(span);
    span.click();
    expect(wrap.classList.contains('open')).toBe(false);
  });

  it('wireGlobalClose() closes flyout when clicking outside', () => {
    const { wrap, trigger, flyout } = makeSetup();
    manager.register({ wrap, trigger, flyout });
    manager.wireGlobalClose();
    trigger.click(); // open

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.click();
    expect(wrap.classList.contains('open')).toBe(false);
  });

  it('wireGlobalClose() does not close flyout when clicking inside wrap', () => {
    const { wrap, trigger, flyout } = makeSetup();
    wrap.appendChild(trigger);
    wrap.appendChild(flyout);
    manager.register({ wrap, trigger, flyout });
    manager.wireGlobalClose();
    trigger.click(); // open — also triggers global close, but wrap contains trigger

    expect(wrap.classList.contains('open')).toBe(true);
  });

  it('close() removes open class and sets aria-expanded false', () => {
    const { wrap, trigger, flyout } = makeSetup();
    const cfg = { wrap, trigger, flyout };
    manager.register(cfg);
    trigger.click(); // open
    manager.close(cfg);
    expect(wrap.classList.contains('open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closeAll() closes every registered flyout', () => {
    const s1 = makeSetup();
    const s2 = makeSetup();
    const cfg1 = { wrap: s1.wrap, trigger: s1.trigger, flyout: s1.flyout };
    const cfg2 = { wrap: s2.wrap, trigger: s2.trigger, flyout: s2.flyout };
    manager.register(cfg1);
    manager.register(cfg2);
    s1.trigger.click();
    s2.trigger.click();
    manager.closeAll();
    expect(s1.wrap.classList.contains('open')).toBe(false);
    expect(s2.wrap.classList.contains('open')).toBe(false);
  });
});
