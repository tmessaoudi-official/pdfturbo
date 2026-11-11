// @vitest-environment jsdom
// The phonePad flag gate (milestone panel round 1, 2026-11-11): the flag-OFF app must lose #sigSources entirely, and
// the flag-ON app must mount it with the ✍ modal's close forwarded — without that forward the camera keeps running
// after the modal closes. main.ts owns the flag read; it hands the VALUE to applyPhonePadFlag.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { applyPhonePadFlag } from '../../src/ui/phonePadGate';

vi.mock('../../src/utils/qrCanvas', () => ({ drawQr: vi.fn(() => ({ modules: 33, modulePx: 4 })) }));

// The app's method reads `this`, as PDFTurboApp's does: a gate that passes it UNBOUND fails here (round 2).
class FakeApp {
  closers: Array<() => void> = [];
  constructor(readonly signaturePad: { drawImage: () => void; replay: () => void }) {}
  onSignatureModalClosed(fn: () => void): void { this.closers.push(fn); }
}

function setup() {
  document.body.innerHTML = '<div id="sigSources"></div>';
  const pad = { drawImage: vi.fn(), replay: vi.fn() };
  const app = new FakeApp(pad);
  vi.spyOn(app, 'onSignatureModalClosed');
  const mount = vi.fn();
  return { pad, app, closers: app.closers, mount };
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

  it('flag ON with no mount injected: the real block is mounted and wired to the app modal close', () => {
    const { app } = setup();
    const doc = new DOMParser().parseFromString(readFileSync(resolve(__dirname, '../../index.html'), 'utf8'), 'text/html');
    const markup = doc.getElementById('sigSources');
    if (!markup) throw new Error('#sigSources missing from index.html');
    document.body.innerHTML = '';
    document.body.append(document.importNode(markup, true));
    applyPhonePadFlag({ enabled: true, doc: document, app, padUrl: () => 'https://x.example/pdfturbo/pad.html' });
    expect(app.onSignatureModalClosed).toHaveBeenCalled();
    const panel = document.getElementById('sigPhonePanel') as HTMLElement;
    (document.getElementById('sigPhoneBtn') as HTMLButtonElement).click();
    expect(panel.hidden).toBe(false);
    app.closers.forEach((fn) => fn());
    expect(panel.hidden).toBe(true);
  });
});

describe('main.ts feeds the gate the phonePad flag', () => {
  // Comments blanked, so a commented-out call cannot satisfy it.
  const src = readFileSync('src/main.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it("calls applyPhonePadFlag with enabled: isEnabled('phonePad'), not its negation", () => {
    // The call must END at `)` then `,` or `}`: `isEnabled('phonePad') === false` is a negation too (round 2).
    expect(src).toMatch(/applyPhonePadFlag\(\{[^}]*\benabled:\s*isEnabled\('phonePad'\)\s*[,}]/);
    expect(src).not.toMatch(/enabled:\s*!\s*isEnabled\('phonePad'\)/);
  });
  // Milestone panel round 3 (2026-11-11): a call made only when the flag is ON (`if (isEnabled('phonePad'))
  // applyPhonePadFlag(…)`, `isEnabled('phonePad') && applyPhonePadFlag(…)`, an if-block around it) passed the check
  // above and left a flag-OFF build with the block visible and unwired. The call must be its own statement (after `;`
  // or `}`) and the flag read exactly once, in it (a bare `if (x)` on the line before ends at `)` and is caught).
  // Bound — not caught: the call inside a block after another statement (`if (x) { a(); applyPhonePadFlag({…`, measured)
  // when `x` does not name phonePad, a `return` or throw ABOVE the call, or the call moved into a function never run.
  it('calls it unconditionally: its own statement, and the only place the phonePad flag is read', () => {
    expect(src).toMatch(/[;}]\s*applyPhonePadFlag\(\{/);
    expect(src.match(/isEnabled\('phonePad'\)/g)?.length).toBe(1);
  });

  it('has no other #sigSources handling of its own', () => {
    expect(src).not.toMatch(/sigSources/);
  });
});
