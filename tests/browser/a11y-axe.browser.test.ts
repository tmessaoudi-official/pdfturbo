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
import { page } from 'vitest/browser';
import axe, { type AxeResults, type Result } from 'axe-core';
import { initI18n, changeLanguage } from '../../src/utils/i18n';
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

  // The browser runner's iframe is 414 px wide, where the toolbar hides its `.btn-label` text — so until 2026-11-10 this
  // gate only ever audited the MOBILE toolbar. At desktop width the labels are visible, and axe-core 4.14's Label in Name
  // rule (WCAG 2.5.3, serious) failed three buttons there that nothing saw (the QA sweep runs wcag2a/aa tags only).
  it('main view at desktop width (1280 px): zero critical and zero serious violations', async () => {
    const [w0, h0] = [window.innerWidth, window.innerHeight];
    await page.viewport(1280, 900);
    try {
      expect(window.innerWidth).toBe(1280); // the pass is vacuous if the resize did not take
      const results = await runAxe(document);
      const counts = summarize(results);
      // eslint-disable-next-line no-console
      console.log('[axe main-view 1280] impact counts:', JSON.stringify(counts));
      if (results.violations.length) {
        // eslint-disable-next-line no-console
        console.log('[axe main-view 1280] violations:\n' + describeViolations(results.violations));
      }
      const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(blocking.flatMap((v) => v.nodes.map((n) => `${v.impact}:${v.id}:${n.target.join(' ')}`))).toEqual([]);
      expect(counts.moderate + counts.minor).toBeLessThanOrEqual(MODERATE_MINOR_CEILING);
    } finally {
      await page.viewport(w0, h0);
    }
  });

  // Every disclosure OPEN, one at a time — every `.draw-flyout-wrap` and every `role="dialog"` — at 414 and 1280 px, in
  // en/fr/ar. Until 2026-11-10 no gate audited an opened flyout or panel, nor any locale but English, and seven buttons
  // failed Label in Name there (`#exportDocxBtn` "DOCX" named "Export as Word document (beta)", `#bulletListBtn` "• List"
  // in English inside the French UI, …). Axe runs on `document`, not on the disclosure: scoped to the flyout it missed
  // `#editTextBtn` in Arabic (measured). Zero violations of ANY impact: MODERATE_MINOR_CEILING is 0, so this is the same
  // gate as the main view's, applied to 120 states. ONE test per width × locale (20 axe runs each): as a single test the
  // 120 runs took 10–15 s quiet but 30.8 s at load 8 — past the 30 s `testTimeout` — and vitest does not abort a timed-out
  // body, so it kept opening dialogs under the next test, which went red too (measured 2026-11-10).
  for (const width of [414, 1280]) {
    for (const lng of ['en', 'fr', 'ar']) {
      it(`every flyout and dialog opened, ${width} px, ${lng}: zero violations`, async () => {
        await auditOpenDisclosures(width, lng);
      });
    }
  }

  async function auditOpenDisclosures(width: number, lng: string): Promise<void> {
    type Disclosure = { name: string; shown: HTMLElement; open: () => void; close: () => void };
    const states: Disclosure[] = [];
    for (const wrap of Array.from(document.querySelectorAll<HTMLElement>('.draw-flyout-wrap'))) {
      const menu = wrap.querySelector<HTMLElement>('.draw-flyout');
      if (!menu) throw new Error(`flyout #${wrap.id} has no .draw-flyout menu`);
      states.push({ name: `flyout#${wrap.id}`, shown: menu,
        open: () => wrap.classList.add('open'), close: () => wrap.classList.remove('open') });
    }
    for (const dlg of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
      const inline = dlg.style.display; // a few dialogs are hidden by an inline `display:none`, the rest by CSS
      states.push({ name: `dialog#${dlg.id}`, shown: dlg,
        open: () => { dlg.classList.add('active'); dlg.style.display = 'flex'; },
        close: () => { dlg.classList.remove('active'); dlg.style.display = inline; } });
    }
    // The ✍ modal's phone panel (phone-signature-pad step 5a) is a disclosure INSIDE a dialog: open both. It is in the
    // static markup whatever the `phonePad` flag says (`phonePadGate.ts` removes it when off), so it is audited here either way.
    const sigModal = document.getElementById('signatureModal');
    const sigPanel = document.getElementById('sigPhonePanel');
    const sigBtn = document.getElementById('sigPhoneBtn');
    if (!sigModal || !sigPanel || !sigBtn) throw new Error('#signatureModal / #sigPhonePanel / #sigPhoneBtn missing');
    states.push({ name: 'panel#sigPhonePanel', shown: sigPanel,
      open: () => { sigModal.classList.add('active'); sigPanel.hidden = false; sigBtn.setAttribute('aria-expanded', 'true'); },
      close: () => { sigModal.classList.remove('active'); sigPanel.hidden = true; sigBtn.setAttribute('aria-expanded', 'false'); } });
    // 3 flyouts + 17 dialogs on 2026-11-10; a selector that silently matched nothing would make this pass vacuous.
    expect(states.length).toBeGreaterThanOrEqual(20);

    const [w0, h0] = [window.innerWidth, window.innerHeight];
    const found: string[] = [];
    try {
      await page.viewport(width, 900);
      expect(window.innerWidth).toBe(width); // the pass is vacuous if the resize did not take
      await changeLanguage(lng);
      for (const s of states) {
        expect(s.shown.checkVisibility(), `${s.name} is closed before the pass`).toBe(false);
        s.open();
        try {
          // The pass is vacuous unless the disclosure actually rendered.
          expect(s.shown.checkVisibility(), `${s.name} did not open`).toBe(true);
          const results = await runAxe(document);
          for (const v of results.violations) {
            for (const n of v.nodes) found.push(`${s.name} ${v.impact}:${v.id}:${n.target.join(' ')}`);
          }
        } finally {
          s.close();
        }
      }
    } finally {
      await changeLanguage('en');
      await page.viewport(w0, h0);
    }
    expect(found).toEqual([]);
  }

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
