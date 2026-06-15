/**
 * Static a11y structure guard for index.html — the regression guard for the
 * 3 moderate accessibility findings from /qa-sweep 2026-06-15:
 *   1. missing <main>/<header> landmarks
 *   2. missing accessible names on the font-family / font-size / text-color /
 *      page-number toolbar inputs
 *   3. no skip-nav link
 *
 * jsdom parses the real index.html via DOMParser (no app boot needed). Input
 * accessible names come from the codebase's data-i18n-aria → aria-label
 * mechanism (i18n.ts), so we assert the attribute is present AND that the
 * referenced key resolves in every locale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

const en = JSON.parse(readFileSync(resolve(__dirname, '../../locales/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(resolve(__dirname, '../../locales/fr.json'), 'utf8'));
const ar = JSON.parse(readFileSync(resolve(__dirname, '../../locales/ar.json'), 'utf8'));

function keyExists(obj: Record<string, unknown>, dotted: string): boolean {
  return dotted.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj) !== undefined;
}

describe('index.html — accessibility landmarks', () => {
  it('has a banner landmark (semantic <header>)', () => {
    const header = doc.querySelector('header.header, header, [role="banner"]');
    expect(header).not.toBeNull();
  });

  it('has exactly one main landmark', () => {
    const mains = doc.querySelectorAll('main, [role="main"]');
    expect(mains.length).toBe(1);
  });

  it('exposes the canvas viewer as the main landmark and a focusable skip target', () => {
    const main = doc.querySelector('main, [role="main"]') as HTMLElement | null;
    expect(main).not.toBeNull();
    expect(main?.id).toBe('canvasContainer');
    expect(main?.getAttribute('tabindex')).toBe('-1');
  });

  it('has a skip-nav link pointing at the main landmark', () => {
    const skip = doc.querySelector('a.skip-link') as HTMLAnchorElement | null;
    expect(skip).not.toBeNull();
    expect(skip?.getAttribute('href')).toBe('#canvasContainer');
    // labelled via i18n
    expect(skip?.getAttribute('data-i18n')).toBeTruthy();
  });

  it('marks both toolbar rows and the find bar as widgets/landmarks', () => {
    const toolbars = doc.querySelectorAll('.toolbar[role="toolbar"]');
    expect(toolbars.length).toBe(2);
    const findBar = doc.querySelector('#findBar');
    expect(findBar?.getAttribute('role')).toBe('search');
  });
});

describe('index.html — accessible names on toolbar inputs', () => {
  const ids = ['fontFamily', 'fontSize', 'color', 'pageInput'];

  for (const id of ids) {
    it(`#${id} has an accessible name (aria-label or data-i18n-aria)`, () => {
      const el = doc.getElementById(id);
      expect(el, `#${id} must exist`).not.toBeNull();
      const hasName =
        (el?.hasAttribute('data-i18n-aria') ?? false) ||
        (el?.hasAttribute('aria-label') ?? false);
      expect(hasName, `#${id} needs data-i18n-aria or aria-label`).toBe(true);
    });
  }

  it('every data-i18n / data-i18n-aria key referenced for these a11y elements resolves in EN/FR/AR', () => {
    const selectors = [
      'a.skip-link',
      '#fontFamily',
      '#fontSize',
      '#color',
      '#pageInput',
      '.toolbar[role="toolbar"]',
      '#findBar[role="search"]',
    ];
    const keys = new Set<string>();
    for (const sel of selectors) {
      doc.querySelectorAll(sel).forEach((el) => {
        const k1 = el.getAttribute('data-i18n');
        const k2 = el.getAttribute('data-i18n-aria');
        if (k1) keys.add(k1);
        if (k2) keys.add(k2);
      });
    }
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(keyExists(en, key), `en.json missing ${key}`).toBe(true);
      expect(keyExists(fr, key), `fr.json missing ${key}`).toBe(true);
      expect(keyExists(ar, key), `ar.json missing ${key}`).toBe(true);
    }
  });
});
