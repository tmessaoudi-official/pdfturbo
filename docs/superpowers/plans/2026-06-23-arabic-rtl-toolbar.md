# Arabic-RTL Toolbar (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `TextElement.direction` field (default `'auto'`) + a toolbar RTL toggle so editing Arabic overlay text gets correct `dir`/caret + a right-align default, with explicit user override. Export is unchanged (already content-auto-RTL).

**Architecture:** Reuse the Slice-1 bidi engine (`baseDirection` for first-strong resolution). Direction resolves to `'rtl'|'ltr'` for the editor `<input>.dir` and the align default. All mutations go through `FormattingService` (`MoveResizeCmd`, undoable). No export change. No `SCHEMA_VERSION` bump (optional field).

**Tech Stack:** TypeScript, Vite, vitest (jsdom + real-Chrome), the existing FormattingService/uiController/formattingBinder toolbar plumbing.

## Global Constraints

- TDD: failing test first, RUN it (paste output). RTK proxy mangles output → `node_modules/.bin/vitest run --reporter=dot > /tmp/claude-1000/-stack-projects-pdfturbo/20f03b4b-dd13-4cad-b96b-f777ba1ae954/scratchpad/vt.log 2>&1` then grep.
- Gate: `npm run type-check && npm run lint && npm run test`, then the browser test.
- **One commit (slice 2)**, `feat:` prefix. **NO Co-Authored-By.** `git push` MANUAL.
- `direction?: 'auto'|'rtl'|'ltr'`, default `'auto'`; `toJSON` omits when `'auto'`; `fromJSON` reads `?? 'auto'`. NO `SCHEMA_VERSION` bump.
- LTR elements + export byte-identical. Private `_underscore`; oxlint `no-non-null-assertion` ON (use `?.`).
- i18n keys added to ALL THREE locales (en/fr/ar; ar [Unverified]).

---

### Task 1: `baseDirection` in the bidi engine

**Files:**
- Modify: `src/utils/bidi.ts` (export a public first-strong helper)
- Test: `tests/utils/bidi.test.ts`

**Interfaces:**
- Produces: `baseDirection(text: string): 'rtl' | 'ltr'` — UAX#9 P2/P3 first-strong; defaults `'rtl'` when no strong char (consistent with `_baseRtl`). Reuses the existing private `_baseRtl`.

- [ ] **Step 1: Write the failing test**
```ts
// append to tests/utils/bidi.test.ts
import { baseDirection } from '../../src/utils/bidi';
describe('baseDirection', () => {
  it('Arabic-first → rtl', () => expect(baseDirection('مرحبا World')).toBe('rtl'));
  it('Latin-first → ltr', () => expect(baseDirection('Hello مرحبا')).toBe('ltr'));
  it('leading digits are not strong → rtl when Arabic follows', () => expect(baseDirection('100 مرحبا')).toBe('rtl'));
  it('empty / no strong char → rtl default', () => expect(baseDirection('123 ...')).toBe('rtl'));
});
```
- [ ] **Step 2: Run → FAIL** (`baseDirection is not a function`).
Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -15 /tmp/.../scratchpad/vt.log`
- [ ] **Step 3: Implement** — add to `src/utils/bidi.ts` (after `visualToLogical`):
```ts
/** Base paragraph direction (UAX#9 P2/P3 first-strong); defaults 'rtl' when no strong char. */
export function baseDirection(text: string): 'rtl' | 'ltr' {
  try {
    return _baseRtl(text, 'auto', _api()) ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}
```
- [ ] **Step 4: Run → PASS.**

---

### Task 2: `TextElement.direction` field + editor `dir` + round-trip

**Files:**
- Modify: `src/elements/textElement.ts` (option, field, ctor, `toJSON`, render `input.dir`)
- Modify: `src/utils/elementFactory.ts:43` (fromJSON read)
- Test: `tests/elements/textElement.test.ts`, `tests/utils/elementFactory.test.ts` (or the existing equivalents)

**Interfaces:**
- Consumes: `baseDirection`, `resolveDirection`.
- Produces: `type TextDirection = 'auto'|'rtl'|'ltr'`; `TextElement.direction: TextDirection`; helper `resolveDirection(direction, text): 'rtl'|'ltr'`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/elements/textElement.test.ts — render sets input.dir from resolved direction
it('sets input dir=rtl for auto direction with Arabic content', () => {
  const te = new TextElement(0, 0, 'p1', {});
  te.text = 'مرحبا';
  const el = te.render(1); // returns the element DOM; find the input
  const input = el.querySelector('input,textarea') as HTMLElement;
  expect(input.getAttribute('dir')).toBe('rtl');
});
it('explicit ltr direction overrides Arabic content', () => {
  const te = new TextElement(0, 0, 'p1', { direction: 'ltr' });
  te.text = 'مرحبا';
  const input = te.render(1).querySelector('input,textarea') as HTMLElement;
  expect(input.getAttribute('dir')).toBe('ltr');
});
```
(Adjust `render` call + input selector to the actual `textElement` render signature/DOM — read it first; the assertion is `dir` reflects resolved direction.)
And round-trip in the elementFactory test:
```ts
it('round-trips direction and defaults legacy to auto', () => {
  const te = new TextElement(0,0,'p1',{ direction: 'rtl' }); te.text='x';
  const restored = ElementFactory.fromJSON(te.toJSON()) as TextElement;
  expect(restored.direction).toBe('rtl');
  // legacy blob lacking direction → 'auto'
  const legacy = { ...te.toJSON() }; delete (legacy as Record<string,unknown>)['direction'];
  expect((ElementFactory.fromJSON(legacy) as TextElement).direction).toBe('auto');
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
In `src/elements/textElement.ts`:
```ts
export type TextDirection = 'auto' | 'rtl' | 'ltr';
// TextOptions: add `direction?: TextDirection;`
// class field: `direction: TextDirection;`
// ctor: `this.direction = options.direction ?? 'auto';`
```
Add the resolver (import `baseDirection` from `../utils/bidi`):
```ts
import { baseDirection } from '../utils/bidi';
export function resolveDirection(direction: TextDirection, text: string): 'rtl' | 'ltr' {
  return direction === 'auto' ? baseDirection(text) : direction;
}
```
In render (where `input.style.textAlign = this.align;` is set, ~line 94):
```ts
input.dir = resolveDirection(this.direction, this.text);
```
In `toJSON` (omit when auto): add to the spread
```ts
...(this.direction !== 'auto' ? { direction: this.direction } : {}),
```
In `src/utils/elementFactory.ts` TextElement opts (after `align:`):
```ts
direction: data['direction'] === 'rtl' || data['direction'] === 'ltr' ? data['direction'] : 'auto',
```
- [ ] **Step 4: Run → PASS** (both files). Confirm existing textElement/elementFactory tests still green.

---

### Task 3: `FormattingService` direction mutators + app delegator

**Files:**
- Modify: `src/core/formattingService.ts` (`setDirection`, `toggleDirection`)
- Modify: `src/core/pdfTurboApp.ts:872` area (delegators)
- Test: `tests/core/formattingService.test.ts`

**Interfaces:**
- Consumes: `resolveDirection`, `TextDirection`, `MoveResizeCmd`.
- Produces: `FormattingService.setDirection(dir: TextDirection)`, `toggleDirection()`; `app.toggleDirection()` / `app.setDirection(dir)`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/core/formattingService.test.ts (mirror existing setAlign tests' harness)
it('toggleDirection flips auto-resolved RTL to explicit ltr', () => {
  const te = selectText('مرحبا'); // helper that selects a TextElement with this text
  svc.toggleDirection();
  expect(te.direction).toBe('ltr'); // resolved was rtl → override to ltr
});
it('toggling an LTR element to rtl also defaults align left→right', () => {
  const te = selectText('Hello'); // align defaults 'left'
  svc.toggleDirection();
  expect(te.direction).toBe('rtl');
  expect(te.align).toBe('right'); // RTL defaults right-align
});
it('toggleDirection is a no-op without a selected text element', () => {
  deselect(); expect(() => svc.toggleDirection()).not.toThrow();
});
it('undo restores direction (and align)', () => {
  const te = selectText('Hello'); svc.toggleDirection(); ctx.historyManager.undo();
  expect(te.direction).toBe('auto'); expect(te.align).toBe('left');
});
```
(Use the existing test harness pattern in this file — read its `setAlign`/`toggleUnderline` tests for the exact `svc`/`ctx`/select helpers.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `src/core/formattingService.ts` (mirror `setAlign`):
```ts
setDirection(dir: import('../elements/textElement').TextDirection): void {
  if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
  const te = this._ctx.selectedElement as TextElement;
  const before = { direction: te.direction, align: te.align };
  te.direction = dir;
  // RTL defaults a still-default 'left' align to 'right'
  if (resolveDirection(dir, te.text) === 'rtl' && te.align === 'left') te.align = 'right';
  this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { direction: te.direction, align: te.align }));
  this._ctx.rebuildElementLayer();
  this._ctx.autosave();
}
toggleDirection(): void {
  if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
  const te = this._ctx.selectedElement as TextElement;
  this.setDirection(resolveDirection(te.direction, te.text) === 'rtl' ? 'ltr' : 'rtl');
}
```
Import `resolveDirection` + `TextDirection` from `../elements/textElement`. App delegators (`pdfTurboApp.ts`, near `setAlign`):
```ts
toggleDirection(): void { this._formattingService.toggleDirection(); this._formattingService.updateFormattingToolbar(); }
```
- [ ] **Step 4: Run → PASS.** Confirm `MoveResizeCmd` undo restores both `direction` and `align` (the `before` carries both).

---

### Task 4: Toolbar button + UI registry + reflection + wiring + i18n

**Files:**
- Modify: `index.html` (add `rtlBtn` to the align group, ~line 174)
- Modify: `src/ui/uiController.ts` (registry decl ~243, instantiation ~492, `updateFormattingToolbar` disabled ~649 + active ~668)
- Modify: `src/ui/binders/formattingBinder.ts` (wire click)
- Modify: `locales/{en,fr,ar}.json` (`formatting.rtlTitle`)
- Test: covered by the uiController test (if present) + the Task-5 browser test.

**Interfaces:** Consumes `app.toggleDirection`, `resolveDirection`.

- [ ] **Step 1: `index.html`** — after `alignJustifyBtn`:
```html
<button id="rtlBtn" class="btn btn-icon" disabled data-i18n-title="formatting.rtlTitle" title="Right-to-left">⇋</button>
```
- [ ] **Step 2: `src/ui/uiController.ts`** — registry decl (beside `alignRightBtn`): `rtlBtn: HTMLButtonElement;` and instantiation: `rtlBtn: document.getElementById('rtlBtn') as HTMLButtonElement,`. In `updateFormattingToolbar`, disabled block: `r.rtlBtn.disabled = !isText;` and active block (after the align toggles):
```ts
r.rtlBtn.classList.toggle('btn-active-fmt', resolveDirection(te.direction, te.text) === 'rtl');
```
(import `resolveDirection` from `../elements/textElement`). In the non-text/clear branch (~line 677) also `r.rtlBtn.classList.remove('btn-active-fmt');`.
- [ ] **Step 3: `src/ui/binders/formattingBinder.ts`** — after the align wiring:
```ts
app.ui.rtlBtn.addEventListener('click', () => app.toggleDirection());
```
- [ ] **Step 4: locales** — add `"rtlTitle"` under `formatting` in en/fr/ar:
  - en: `"rtlTitle": "Right-to-left (RTL)"`
  - fr: `"rtlTitle": "De droite à gauche (RTL)"`
  - ar: `"rtlTitle": "من اليمين إلى اليسار"` (ar [Unverified])
  Write all three together (the locale-sync hook requires key-parity).
- [ ] **Step 5: type-check + lint** — `npm run type-check && npm run lint` → clean (fix any unused-import).

---

### Task 5: Real-Chrome guard + full gate + visual + commit

**Files:**
- Modify: `tests/browser/text-toolbar.browser.test.ts` (add an RTL case)

- [ ] **Step 1: Add the browser test** (real layout; jsdom can't lay out caret/dir behavior fully):
```ts
it('typing Arabic into a text box resolves dir=rtl; toggle overrides to ltr', async () => {
  // create a TextElement with Arabic, render into the live DOM, assert input.dir==='rtl'
  // then app.toggleDirection() (or click #rtlBtn) and assert input.dir==='ltr'.
});
```
(Model setup on the existing cases in this file — select a text element, read its rendered input.)
- [ ] **Step 2: Run the browser test**
Run: `node_modules/.bin/vitest run --config vitest.browser.config.ts tests/browser/text-toolbar.browser.test.ts --reporter=dot > /tmp/.../scratchpad/bt.log 2>&1; tail -20 /tmp/.../scratchpad/bt.log` → PASS.
- [ ] **Step 3: Full gate**
`npm run type-check` (clean) · `npm run lint` (clean) · `node_modules/.bin/vitest run --reporter=dot` (jsdom green, ≥ prior 2026+2) · `npm audit --audit-level=high` (0).
- [ ] **Step 4: Visual (eyes-on)** — `npm run dev`: add a text box, type Arabic → caret/flow RTL + right-aligned; toggle ⇋ → flips to LTR. Screenshot before/after to `qa-shots/f3-rtl-toolbar/`.
- [ ] **Step 5: Commit (one, slice 2)**
```bash
git add src/utils/bidi.ts src/elements/textElement.ts src/utils/elementFactory.ts \
  src/core/formattingService.ts src/core/pdfTurboApp.ts src/ui/uiController.ts \
  src/ui/binders/formattingBinder.ts index.html locales/en.json locales/fr.json locales/ar.json \
  tests/utils/bidi.test.ts tests/elements/textElement.test.ts tests/utils/elementFactory.test.ts \
  tests/core/formattingService.test.ts tests/browser/text-toolbar.browser.test.ts
git commit -m "feat(arabic): RTL-aware text direction toggle + editor dir (Feature 3 slice 2)"
```
Do NOT push. Update plan/memory/CLAUDE.md (doc commit) with the slice-2 sha.

---

## Self-Review

**Spec coverage:** direction field+default → Task 2; baseDirection/resolveDirection → Tasks 1-2; toggle + RTL→right-align + undo → Task 3; toolbar button/reflection/wiring/i18n → Task 4; editor `dir` → Task 2; export unchanged (no task touches renderText — explicit); real-Chrome + visual → Task 5. ✓

**Placeholder scan:** `/tmp/.../scratchpad/` = the full path in Global Constraints. The "adjust to actual render signature / test harness" notes (Tasks 2, 3, 5) require reading the real `textElement.render`/`formattingService.test` harness first — the invariant asserted is explicit; only the setup boilerplate must match the existing files. No TBD/"handle edge cases".

**Type consistency:** `TextDirection='auto'|'rtl'|'ltr'`, `direction` field, `resolveDirection(direction,text)`, `baseDirection(text)`, `toggleDirection()`/`setDirection(dir)`, `rtlBtn` — consistent across Tasks 1-5. `MoveResizeCmd` `before` carries `{direction, align}` so undo restores both.
