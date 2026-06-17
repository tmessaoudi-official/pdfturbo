import { describe, it, expect, vi } from 'vitest';
import { wireSwUpdate } from '../src/pwaUpdate';

// G16: the PWA "update available" prompt must be ACTIONABLE — surfacing the
// notice is not enough; the user must be able to apply the waiting service
// worker and reload. `registerSW` from `virtual:pwa-register` returns
// `updateSW(reloadPage?)`; calling `updateSW(true)` posts SKIP_WAITING to the
// waiting SW and reloads on controllerchange. `main.ts` imports the Vite-only
// virtual module (unresolvable under jsdom), so the wiring is extracted into
// `src/pwaUpdate.ts` and tested with an injected `registerSW`-like dependency.
//
// These tests pin the seam:
//  - onNeedRefresh shows the update prompt (notify),
//  - the prompt's apply action calls updateSW(true) (act → activate + reload),
//  - updateSW is NOT called before the user acts (no auto-reload — registerType
//    'prompt' is deliberate),
//  - onOfflineReady is wired through and does NOT show the update prompt.

/** Build a fake `registerSW` that captures the option callbacks and hands back a spy updateSW. */
function makeFakeRegisterSW() {
  const updateSW = vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve());
  let captured: { onNeedRefresh?: () => void; onOfflineReady?: () => void } = {};
  const registerSW = vi.fn((opts: { onNeedRefresh?: () => void; onOfflineReady?: () => void }) => {
    captured = opts;
    return updateSW;
  });
  return {
    registerSW,
    updateSW,
    fireNeedRefresh: () => captured.onNeedRefresh?.(),
    fireOfflineReady: () => captured.onOfflineReady?.(),
  };
}

describe('wireSwUpdate (G16 — actionable PWA update)', () => {
  it('registers the SW exactly once on wire-up', () => {
    const fake = makeFakeRegisterSW();
    wireSwUpdate({ registerSW: fake.registerSW, showUpdatePrompt: vi.fn(), onOfflineReady: vi.fn() });
    expect(fake.registerSW).toHaveBeenCalledTimes(1);
  });

  it('does NOT call updateSW until the user acts (no auto-reload)', () => {
    const fake = makeFakeRegisterSW();
    wireSwUpdate({ registerSW: fake.registerSW, showUpdatePrompt: vi.fn(), onOfflineReady: vi.fn() });
    fake.fireNeedRefresh();
    expect(fake.updateSW).not.toHaveBeenCalled();
  });

  it('shows the update prompt on onNeedRefresh', () => {
    const fake = makeFakeRegisterSW();
    const showUpdatePrompt = vi.fn<(apply: () => void) => void>();
    wireSwUpdate({ registerSW: fake.registerSW, showUpdatePrompt, onOfflineReady: vi.fn() });
    fake.fireNeedRefresh();
    expect(showUpdatePrompt).toHaveBeenCalledTimes(1);
  });

  it('invoking the prompt action calls updateSW(true) → activate + reload', () => {
    const fake = makeFakeRegisterSW();
    let captured: (() => void) | undefined;
    const showUpdatePrompt = vi.fn<(apply: () => void) => void>((apply) => { captured = apply; });
    wireSwUpdate({ registerSW: fake.registerSW, showUpdatePrompt, onOfflineReady: vi.fn() });

    fake.fireNeedRefresh();
    expect(captured).toBeTypeOf('function');
    expect(fake.updateSW).not.toHaveBeenCalled(); // still no call until the action runs

    captured?.();
    expect(fake.updateSW).toHaveBeenCalledTimes(1);
    expect(fake.updateSW).toHaveBeenCalledWith(true);
  });

  it('wires onOfflineReady through without showing the update prompt', () => {
    const fake = makeFakeRegisterSW();
    const showUpdatePrompt = vi.fn();
    const onOfflineReady = vi.fn();
    wireSwUpdate({ registerSW: fake.registerSW, showUpdatePrompt, onOfflineReady });

    fake.fireOfflineReady();
    expect(onOfflineReady).toHaveBeenCalledTimes(1);
    expect(showUpdatePrompt).not.toHaveBeenCalled();
    expect(fake.updateSW).not.toHaveBeenCalled();
  });
});
