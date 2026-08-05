/**
 * The toolbar's reachability invariant, as a static guard.
 *
 * `src/styles/base.css` states it for `.toolbar`: *"wrap overflowing groups to a second row instead of
 * hiding them behind a horizontal scrollbar (every control stays reachable without scrolling)"* — a
 * QA-D F3 finding. But `.toolbar-group` is itself a flex row, so a GROUP that outgrows the viewport
 * pushed its own children past the right edge, and `.container { overflow: hidden }` leaves no scroll
 * to reach them.
 *
 * Measured at 375px when `#cropControls` gained the four margin inputs: `cropMarginBottom`,
 * `cropMarginLeft` and `cropMarginApplyBtn` were all off-screen AND not hit-testable
 * (`elementFromPoint` at their own centre returned null).
 *
 * WHY A STATIC TEST rather than relying on the live sweep: the sweep's 375px check asks
 * `documentElement.scrollWidth > innerWidth`, which stays exactly 375 because the container clips the
 * overflow — so it reports "no horizontal overflow" while controls are unreachable. It is also run in
 * SELECT mode, where `#cropControls` is `display:none` and therefore has no width at all. The gate is
 * blind to this class twice over, which is precisely why the rule needs pinning here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = readFileSync(resolve(__dirname, '../../src/styles/base.css'), 'utf8');
const responsive = readFileSync(resolve(__dirname, '../../src/styles/responsive.css'), 'utf8');

/** The declarations inside the first `.<selector> { … }` rule in `css`, whitespace-collapsed. */
function ruleBody(css: string, selector: string): string | null {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close).replace(/\s+/g, ' ').trim();
}

describe('toolbar reachability — nothing may be pushed off-screen', () => {
  it('.toolbar wraps (the original QA-D F3 invariant)', () => {
    const body = ruleBody(base, '.toolbar {');
    expect(body).not.toBeNull();
    expect(body).toContain('flex-wrap: wrap');
  });

  it('.toolbar-group ALSO wraps at the mobile breakpoint', () => {
    // Desktop deliberately keeps a group on one line; the mobile breakpoint is where a group can
    // outgrow the viewport, so that is where the wrap belongs.
    const mobile = responsive.slice(responsive.indexOf('@media (max-width: 640px)'));
    const body = ruleBody(mobile, '.toolbar-group {');
    expect(body, '.toolbar-group must wrap inside the 640px breakpoint').not.toBeNull();
    expect(body).toContain('flex-wrap: wrap');
  });

  it('the crop controls live inside a wrappable group, not floating in the toolbar', () => {
    // If a future change moves them out of #cropControls / .toolbar-group, the wrap above stops
    // protecting them and this test says so.
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const controls = doc.getElementById('cropControls');
    expect(controls, '#cropControls must exist').not.toBeNull();
    // Real ancestor check — a string search cannot tell nesting from adjacency.
    expect(controls?.closest('.toolbar-group'),
      '#cropControls must be nested inside a .toolbar-group, or the wrap above stops protecting it')
      .not.toBeNull();
    // And every one of the five new controls must be inside it.
    for (const id of ['cropMarginTop', 'cropMarginRight', 'cropMarginBottom', 'cropMarginLeft',
      'cropMarginApplyBtn']) {
      expect(controls?.querySelector(`#${id}`), `${id} must live inside #cropControls`).not.toBeNull();
    }
  });
});
