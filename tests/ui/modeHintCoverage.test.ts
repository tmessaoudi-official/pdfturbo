/**
 * Every tool mode but `select` must have a mode-hint toast string in every locale (limits row 8, B2).
 *
 * `toolModeService`'s `MODE_HINT_KEYS` was typed `Partial<Record<ToolMode, string>>`, so a new mode that
 * forgot its hint compiled and silently showed no toast — measured 2026-09-26: deleting the `signRect` entry
 * left `tsc` at exit 0. It is now `Record<Exclude<ToolMode, 'select'>, string>`, which the compiler enforces.
 * This file is the half the compiler cannot see: the strings in `locales/*.json`. Same shape as
 * `modeBadgeCoverage.test.ts`, for the same reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOL_MODES } from '../../src/types/tools';

const LOCALES = ['en', 'fr', 'ar'] as const;
const HINTED = TOOL_MODES.filter(m => m !== 'select');

function hints(locale: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, `../../locales/${locale}.json`), 'utf8'));
  return raw.toast.modeHint as Record<string, string>;
}

describe('mode hint locale coverage', () => {
  it.each(LOCALES)('%s has a toast.modeHint string for every mode but select', (locale) => {
    const present = hints(locale);
    const missing = HINTED.filter(m => typeof present[m] !== 'string' || present[m].trim() === '');
    expect(missing, `locale ${locale} is missing toast.modeHint.* entries`).toEqual([]);
  });

  it('has no toast.modeHint key that is not a hinted mode (a rename updated on one side only)', () => {
    const stale = Object.keys(hints('en')).filter(k => !(HINTED as readonly string[]).includes(k));
    expect(stale).toEqual([]);
  });

  it('non-vacuity: the hinted set is every mode but one', () => {
    expect(HINTED.length).toBe(TOOL_MODES.length - 1);
    expect(HINTED.length).toBeGreaterThanOrEqual(16);
  });
});
