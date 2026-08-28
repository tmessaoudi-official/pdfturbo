/**
 * Every tool mode must have a badge string in every locale.
 *
 * ── The defect this pins ──────────────────────────────────────────────────────────
 * `uiController`'s `badgeKeys` was typed `Record<string, string>` and covered 16 of the 17
 * `ToolMode` members — `signRect` (the e-signature rectangle mode) was missing from the map AND
 * from `badge.*` in all three locales. Because the lookup carried a `?? 'badge.select'` fallback,
 * entering that mode rendered the badge as **"SELECT"** while `.active` was toggled on: visibly
 * wrong, and not the raw key a user would think to report. Reachable end to end via
 * `pdfTurboApp.beginSignRect` → `toolModeService.setMode` → `uiController.updateModeButtons`.
 *
 * ── Why a test, when the map is now exhaustively typed ────────────────────────────
 * The compiler enforces the MAP (`Record<ToolMode, string>` rejects a missing member) but it
 * cannot see inside `locales/*.json`. Both halves failed together here, so both halves need a
 * check. This is the half TypeScript cannot do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOL_MODES } from '../../src/types/tools';

const LOCALES = ['en', 'fr', 'ar'] as const;

// `resolve(__dirname, …)`, matching indexHtmlA11y.test.ts. A `new URL(…, import.meta.url)` here
// resolves against the jsdom document base, not the file, and reads as `/locales/en.json`.
function badges(locale: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, `../../locales/${locale}.json`), 'utf8'));
  return raw.badge as Record<string, string>;
}

describe('mode badge locale coverage', () => {
  it.each(LOCALES)('%s has a badge string for every ToolMode', (locale) => {
    const present = badges(locale);
    const missing = TOOL_MODES.filter(m => typeof present[m] !== 'string' || present[m].trim() === '');
    expect(missing, `locale ${locale} is missing badge.* entries`).toEqual([]);
  });

  it('has no badge key that is not a ToolMode', () => {
    // The other direction. A stale key is not user-visible, but it is the signal that a mode was
    // renamed and only one side was updated — the same drift, caught one release earlier.
    const extra = Object.keys(badges('en')).filter(k => !(TOOL_MODES as readonly string[]).includes(k));
    expect(extra).toEqual([]);
  });

  it('covers signRect specifically, the member that was missing', () => {
    // Named explicitly so a future reader sees the regression this file was written for, rather
    // than only a generic set-difference that happens to be empty.
    expect((TOOL_MODES as readonly string[])).toContain('signRect');
    for (const locale of LOCALES) expect(badges(locale).signRect).toBeTruthy();
  });
});
