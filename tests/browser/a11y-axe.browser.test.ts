/**
 * G22 — automated accessibility gate (axe-core, real Chrome).
 *
 * WHY A BROWSER TEST: WCAG contrast checks need COMPUTED styles (resolved
 * colors, composited rgba) — jsdom has no layout/paint, so the existing static
 * guard (tests/ui/indexHtmlA11y.test.ts) can only assert attributes, never
 * contrast. Here the real index.html markup is injected into document.body, the
 * real app CSS is loaded (the import below), and i18n is initialized so every
 * data-i18n-aria → aria-label resolves exactly as in production. axe then audits
 * the live, styled DOM.
 *
 * THE GATE (do NOT weaken): zero `critical` and zero `serious` violations on the
 * main view AND on an open modal. `moderate`/`minor` are collected, logged, and
 * asserted against a documented baseline ceiling (see MODERATE_MINOR_CEILING) so
 * the count can't silently grow, without forcing WCAG perfection in one pass.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import axe, { type AxeResults, type Result } from 'axe-core';
import { initI18n } from '../../src/utils/i18n';
// Load the real app styles so contrast rules see production colors.
import '../../src/styles/index.css';
// Vite serves the real index.html as a string we can parse for its <body>.
import indexHtml from '../../index.html?raw';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Moderate/minor ceiling — TIGHTENED 60 → 0 on 2026-07-30.
 *
 * The 60 was set when there was real outstanding debt, so the gate would not block on it. That debt
 * has since been paid: measured on this exact fixture, the main view reports
 * `{critical:0, serious:0, moderate:0, minor:0}`. A ceiling of 60 against an actual count of 0 is 60
 * points of slack — a regression introducing 40 new moderate violations would have passed silently,
 * which is the opposite of what a baseline guard is for. A ratchet only works if it is tightened
 * once the debt is gone.
 *
 * At 0 this is now a real guard: any new moderate/minor violation fails the build. If a future change
 * legitimately needs headroom, raise it DELIBERATELY, in the same commit, with the measured count and
 * the reason — never as a quiet nudge to make a red build green.
 */
const MODERATE_MINOR_CEILING = 0;

function injectAppDom(): void {
  // Extract the real <body> markup from index.html (minus the module script tag,
  // which we don't want to execute — initI18n + CSS give us the rendered view).
  const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyInner = (bodyMatch ? bodyMatch[1] : indexHtml)
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = bodyInner;
}

function summarize(results: AxeResults): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of results.violations) counts[v.impact ?? 'minor'] = (counts[v.impact ?? 'minor'] ?? 0) + 1;
  return counts;
}

function describeViolations(violations: Result[]): string {
  return violations
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) → ${v.nodes[0]?.target?.join(' ')}`)
    .join('\n');
}

function runAxe(context: unknown = document): Promise<AxeResults> {
  return axe.run(context as Parameters<typeof axe.run>[0], {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
    resultTypes: ['violations'],
  });
}

describe('G22 — axe-core WCAG 2.1 A/AA gate (real Chrome)', () => {
  beforeAll(async () => {
    injectAppDom();
    await initI18n();
  });

  it('main view (empty state): zero critical and zero serious violations', async () => {
    const results = await runAxe(document);
    const counts = summarize(results);
    // Full violation log — visible in the test output as the documented baseline.
    // eslint-disable-next-line no-console
    console.log('[axe main-view] impact counts:', JSON.stringify(counts));
    if (results.violations.length) {
      // eslint-disable-next-line no-console
      console.log('[axe main-view] violations:\n' + describeViolations(results.violations));
    }

    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.map((v) => `${v.impact}:${v.id}`)).toEqual([]);

    // Baseline guard: moderate/minor may exist but must not balloon.
    expect(counts.moderate + counts.minor).toBeLessThanOrEqual(MODERATE_MINOR_CEILING);
  });

  it('open dialog (help modal): zero critical and zero serious violations', async () => {
    const modal = document.getElementById('helpModal');
    expect(modal).not.toBeNull();
    if (!modal) return;
    // The help modal is shown via `.active` (display:flex). Render it so axe can
    // audit dialog semantics (role/aria-modal/labelledby/focusable content).
    modal.classList.add('active');

    const results = await runAxe(modal);
    const counts = summarize(results);
    // eslint-disable-next-line no-console
    console.log('[axe help-modal] impact counts:', JSON.stringify(counts));
    if (results.violations.length) {
      // eslint-disable-next-line no-console
      console.log('[axe help-modal] violations:\n' + describeViolations(results.violations));
    }

    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.map((v) => `${v.impact}:${v.id}`)).toEqual([]);

    modal.classList.remove('active');
  });
});
