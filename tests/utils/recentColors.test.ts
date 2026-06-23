import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pushRecentColor, getRecentColors, COLOR_PRESETS } from '../../src/utils/recentColors';

describe('recentColors', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: () => null,
      length: 0,
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => localStorage.clear());

  it('keeps most-recent-first, deduped, capped at 8', () => {
    for (const c of ['#111', '#222', '#333', '#111']) pushRecentColor(c);
    expect(getRecentColors().slice(0, 3)).toEqual(['#111', '#333', '#222']);
    for (let i = 0; i < 12; i++) pushRecentColor('#' + i.toString().padStart(6, '0'));
    expect(getRecentColors().length).toBe(8);
  });

  it('exposes a non-empty preset palette', () => {
    expect(COLOR_PRESETS.length).toBeGreaterThan(0);
  });

  it('survives a corrupted localStorage value without throwing (QA-2026-06-23 P2)', () => {
    for (const bad of ['{}', '"hello"', '42', 'null', '[1,2,{"x":1}]', 'not-json']) {
      localStorage.setItem('pdfturbo.recentColors', bad);
      expect(() => getRecentColors()).not.toThrow();
      // every returned entry is a string, so the startup swatch-row spread can't crash
      expect(getRecentColors().every(c => typeof c === 'string')).toBe(true);
    }
  });
});
