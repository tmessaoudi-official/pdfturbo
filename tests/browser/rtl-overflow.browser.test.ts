/**
 * RTL horizontal-overflow regression guard (real Chrome).
 *
 * BUG (2026-06-21 QA sweep): `.skip-link` was hidden with `left:-9999px`. That
 * off-screen-LEFT trick is RTL-unsafe — under `dir=rtl` the −9999px box flips
 * into ~10000px of horizontal PAGE overflow: `documentElement.scrollWidth`
 * ballooned from the viewport width to ~11584px, displacing the whole layout
 * (the app rendered blank / scrolled to empty space for Arabic users). Fixed in
 * base.css by switching to the clip-based visually-hidden pattern (no physical
 * offset → no overflow in any writing direction).
 *
 * WHY A BROWSER TEST: jsdom has no layout engine — `scrollWidth` and
 * `getBoundingClientRect` are meaningless there, so this can only be caught with
 * real layout. Mirrors the a11y-axe harness: inject the real index.html <body>
 * + load the real app CSS, then measure.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initI18n } from '../../src/utils/i18n';
import '../../src/styles/index.css';
import indexHtml from '../../index.html?raw';

function injectAppDom(): void {
  const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyInner = (bodyMatch ? bodyMatch[1] : indexHtml).replace(
    /<script[\s\S]*?<\/script>/gi,
    '',
  );
  document.body.innerHTML = bodyInner;
}

describe('RTL layout — no horizontal overflow (skip-link regression)', () => {
  beforeAll(async () => {
    await initI18n();
    injectAppDom();
  });

  it('does not create horizontal page overflow in dir=rtl', () => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
    void document.documentElement.offsetWidth; // force reflow
    const docW = document.documentElement.scrollWidth;
    const viewW = document.documentElement.clientWidth;
    // The bug produced ~10000px of overflow; a healthy layout stays within the
    // viewport (small slop for sub-pixel rounding / scrollbar).
    expect(docW).toBeLessThanOrEqual(viewW + 50);
  });

  it('keeps the skip-link clipped until focused (a11y intact)', () => {
    const link = document.querySelector<HTMLElement>('.skip-link');
    expect(link).toBeTruthy();
    if (!link) return;
    const hidden = getComputedStyle(link);
    // visually-hidden: clipped to a zero-area region (not painted)
    expect(hidden.clipPath).toBe('inset(50%)');
    link.focus();
    const focused = getComputedStyle(link);
    expect(focused.clipPath).toBe('none'); // revealed on keyboard focus
  });
});
