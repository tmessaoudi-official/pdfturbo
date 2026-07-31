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

  // tabindex is "-1": the classic skip-nav idiom. Briefly "0" on 2026-07-29, reverted 2026-07-30 by
  // developer ruling. Two a11y goals genuinely collide here:
  //   - Skip-nav target (this ruling): `-1` keeps the landmark out of the tab order, so a keyboard
  //     user reaches the page content without an extra stop. The skip link lands on it either way.
  //   - WCAG 2.1.1 keyboard access: the canvas viewer is a SCROLLABLE region whose content (a
  //     rendered page) is not focusable, so with `-1` a keyboard-only user cannot reach or
  //     arrow-scroll it. axe flags this as `scrollable-region-focusable` (serious) against the LIVE
  //     app, where the region actually scrolls — the static DOM here never does, which is why this
  //     file cannot catch it.
  // The violation is therefore REAL and knowingly accepted: scripts/qa-sweep.mjs lists it in
  // A11Y_ACCEPTED so the deploy gate does not veto the ruling, and reports it as ACCEPT on every run
  // rather than hiding it. The genuine fix — give the scroll region focusable CONTENT so the rule
  // passes with `-1` intact — is open, not refused.
  it('exposes the canvas viewer as the main landmark, kept out of the tab order (skip-nav idiom)', () => {
    const main = doc.querySelector('main, [role="main"]') as HTMLElement | null;
    expect(main).not.toBeNull();
    expect(main?.id).toBe('canvasContainer');
    expect(main?.getAttribute('tabindex')).toBe('-1');
  });

  // The other half of the ruling above, and what finally let scripts/qa-sweep.mjs drop its last
  // A11Y_ACCEPTED entry. axe's `scrollable-region-focusable` (serious) wants a scrollable region to be
  // keyboard-reachable; it is satisfied by the region containing focusable CONTENT, not only by the
  // region itself being focusable. #pdfCanvas IS the content, and it already carries role="img" plus
  // an i18n aria-label, so making it the tab stop names it properly too.
  //
  // Verified live 2026-07-31 with a document loaded (this static DOM never scrolls, so the rule can
  // only be checked in the running app): the violation is present before and absent after, and with
  // the canvas focused ArrowDown genuinely scrolls the region — #canvasContainer.scrollTop 20 -> 100.
  // Both halves must hold together: landmark -1 (above) AND focusable content (here).
  it('makes the page canvas focusable, so the scroll region is keyboard-reachable', () => {
    const canvas = doc.getElementById('pdfCanvas');
    expect(canvas, '#pdfCanvas must exist').not.toBeNull();
    expect(canvas?.getAttribute('tabindex')).toBe('0');
    // A focusable region needs a name as much as a label does.
    const named = (canvas?.hasAttribute('data-i18n-aria') ?? false)
      || (canvas?.hasAttribute('aria-label') ?? false);
    expect(named, '#pdfCanvas is a tab stop, so it needs an accessible name').toBe(true);
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

  // ── QA 2026-06-18 — A3 / A5 ──────────────────────────────────────────────
  it('A3: #modeBadge is a polite live region (mode switches are announced to SRs)', () => {
    const badge = doc.getElementById('modeBadge');
    expect(badge, '#modeBadge must exist').not.toBeNull();
    expect(badge?.getAttribute('aria-live')).toBe('polite');
    expect(badge?.getAttribute('role')).toBe('status');
  });

  it('A5: #progress-overlay has no empty aria-label (would suppress the dynamic label)', () => {
    const overlay = doc.getElementById('progress-overlay');
    expect(overlay, '#progress-overlay must exist').not.toBeNull();
    // An empty aria-label="" overrides the accessible name with the empty string
    // on some SRs, hiding the #progress-label text. Either drop the attribute or
    // give it a real value — never leave it empty.
    expect(overlay?.getAttribute('aria-label') ?? 'absent').not.toBe('');
  });

  // ── QA-sweep 2026-07-31 — the whole class, not four hand-picked ids ────────────
  // /qa-sweep caught `select-name` (axe CRITICAL — higher than the three `serious` rules fixed on
  // 2026-07-29) on #blankPageSize and #blankPagePosition, and caught it only by luck: it fires only
  // while the control is VISIBLE, so it needed a run that happened to leave blankPageModal open. The
  // cause was systemic, not local — 16 controls sat beside a bare `<label>` with no `for=`, i.e. a
  // label rendered next to a sibling control with ZERO programmatic association, so a screen reader
  // announced an unnamed combo box / text field. Enumerate the class here so the live gate never has
  // to be the one that catches it.
  //
  // What "unnamed" means HERE, precisely — the first version of this comment overstated it.
  // These controls are NOT axe violations and never were: measured live in Chrome on 2026-07-31, the
  // accname algorithm falls back to `placeholder` and then `title`, so every one of them DOES expose
  // a name and axe reported zero violations for the whole set. This test enforces a deliberately
  // STRICTER bar than axe — an EXPLICIT association (`label[for]`, `aria-label(ledby)`,
  // `data-i18n-aria`, or a wrapping label) — because the fallback is fragile:
  //   - a placeholder is the same mechanism that made #batesPrefix announce "ACME-", i.e. an example
  //     value masquerading as a field name, and #pdfPasswordInput announced "Enter password…" while
  //     a perfectly good <label>Password</label> sat unassociated right above it;
  //   - `title` as a name is a last-resort fallback that some AT and most touch UIs never surface.
  // Fixed 2026-07-31 with ZERO new i18n keys, by reusing the keys those placeholders/titles already
  // referenced and adding role="group"/aria-labelledby so the grouped X/Y/W/H spin buttons are
  // announced with their group label instead of a bare "X".
  //
  // UNNAMED_OK is a DECLINING allowlist, not a budget. What remains is one coherent category, not a
  // backlog: hidden inputs that exist only to be `.click()`ed by a visible button. axe skips hidden
  // nodes, no user can focus them, and naming them would be decoration. Adding an id here needs a
  // reason; removing one is always welcome.
  const UNNAMED_OK = new Set([
    'fileInput', 'addImageInput', 'addPdfInput', 'xfdfInput', 'redactColor',
  ]);

  function unnamedControls(): string[] {
    const forTargets = new Set(
      [...doc.querySelectorAll('label[for]')].map((l) => l.getAttribute('for')),
    );
    const out: string[] = [];
    for (const el of doc.querySelectorAll('input, select, textarea')) {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (['hidden', 'button', 'submit', 'reset'].includes(type)) continue;
      if (el.hasAttribute('aria-label') || el.hasAttribute('data-i18n-aria')
        || el.hasAttribute('aria-labelledby')) continue;
      if (el.closest('label')) continue;            // wrapped by its own label
      if (el.id && forTargets.has(el.id)) continue; // label[for] association
      out.push(el.id || '(no id)');
    }
    return out;
  }

  it('every <select> has an accessible name (axe select-name is CRITICAL)', () => {
    const forTargets = new Set(
      [...doc.querySelectorAll('label[for]')].map((l) => l.getAttribute('for')),
    );
    const unnamed = [...doc.querySelectorAll('select')].filter((s) => !(
      s.hasAttribute('aria-label') || s.hasAttribute('data-i18n-aria')
      || s.hasAttribute('aria-labelledby') || s.closest('label')
      || (s.id && forTargets.has(s.id))
    )).map((s) => s.id || '(no id)');
    expect(unnamed, `selects with no accessible name: ${unnamed.join(', ')}`).toEqual([]);
  });

  it('no form control outside the known-gap allowlist lacks an accessible name', () => {
    const unexpected = unnamedControls().filter((id) => !UNNAMED_OK.has(id));
    expect(unexpected, `unnamed control(s) not in UNNAMED_OK: ${unexpected.join(', ')}`).toEqual([]);
  });

  it('UNNAMED_OK has no stale entries (a fixed control must be removed from it)', () => {
    const stale = [...UNNAMED_OK].filter((id) => !unnamedControls().includes(id));
    expect(stale, `these now HAVE a name — drop them from UNNAMED_OK: ${stale.join(', ')}`).toEqual([]);
  });

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
