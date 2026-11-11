// @vitest-environment jsdom
// The phonePad flag gate (milestone panel round 1, 2026-11-11): the flag-OFF app must lose #sigSources entirely, and
// the flag-ON app must mount it with the ✍ modal's close forwarded — without that forward the camera keeps running
// after the modal closes. main.ts owns the flag read; it hands the VALUE to applyPhonePadFlag.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyPhonePadFlag } from '../../src/ui/phonePadGate';

function setup() {
  document.body.innerHTML = '<div id="sigSources"></div>';
  const pad = { drawImage: vi.fn(), replay: vi.fn() };
  const closers: Array<() => void> = [];
  const app = { signaturePad: pad, onSignatureModalClosed: vi.fn((fn: () => void) => { closers.push(fn); }) };
  const mount = vi.fn();
  return { pad, app, closers, mount };
}

describe('applyPhonePadFlag', () => {
  it('flag OFF: removes #sigSources and mounts nothing', () => {
    const { app, mount } = setup();
    applyPhonePadFlag({ enabled: false, doc: document, app, padUrl: () => 'u', mount });
    expect(document.getElementById('sigSources')).toBeNull();
    expect(mount).not.toHaveBeenCalled();
  });

  it('flag ON: mounts #sigSources on the app pad, keeps it in the DOM', () => {
    const { app, pad, mount } = setup();
    const root = document.getElementById('sigSources');
    applyPhonePadFlag({ enabled: true, doc: document, app, padUrl: () => 'u', mount });
    expect(document.getElementById('sigSources')).toBe(root);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0][0].root).toBe(root);
    expect(mount.mock.calls[0][0].pad).toBe(pad);
    expect(mount.mock.calls[0][0].padUrl()).toBe('u');
  });

  it('flag ON: a close listener registered by the mount reaches the app modal close', () => {
    const { app, closers, mount } = setup();
    applyPhonePadFlag({ enabled: true, doc: document, app, padUrl: () => 'u', mount });
    const stopCamera = vi.fn();
    mount.mock.calls[0][0].onModalClosed(stopCamera);
    expect(app.onSignatureModalClosed).toHaveBeenCalledTimes(1);
    closers.forEach((fn) => fn());
    expect(stopCamera).toHaveBeenCalledTimes(1);
  });

  it('flag ON without #sigSources in the page: mounts nothing, does not throw', () => {
    const { app, mount } = setup();
    document.body.innerHTML = '';
    applyPhonePadFlag({ enabled: true, doc: document, app, padUrl: () => 'u', mount });
    expect(mount).not.toHaveBeenCalled();
  });
});

describe('main.ts feeds the gate the phonePad flag', () => {
  // Comments blanked, so a commented-out call cannot satisfy it.
  const src = readFileSync('src/main.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it("calls applyPhonePadFlag with enabled: isEnabled('phonePad'), not its negation", () => {
    expect(src).toMatch(/applyPhonePadFlag\(\{[^}]*\benabled:\s*isEnabled\('phonePad'\)/);
    expect(src).not.toMatch(/enabled:\s*!\s*isEnabled\('phonePad'\)/);
  });
  it('has no other #sigSources handling of its own', () => {
    expect(src).not.toMatch(/sigSources/);
  });
});
