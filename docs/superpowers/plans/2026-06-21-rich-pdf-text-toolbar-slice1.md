# Rich PDF Text Toolbar — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Tier-1 text-formatting controls (discrete L/C/R align, highlight/background color, line spacing, opacity, text case, clear formatting, format painter, color presets/recent) to PDFturbo's overlay `TextElement`s, surfaced via inline buttons + a new "Text ⋮" popover.

**Architecture:** Pure-attribute extensions to `TextElement` (3 new optional fields), all mutations routed through `FormattingService` recording `MoveResizeCmd`/`MacroCmd` for free undo+autosave, baked in `pdfElementRenderer.renderText`, with a new `textOptionsPopover.ts` mirroring the existing `batesPanel.ts` modal pattern.

**Tech Stack:** TypeScript, Vite, @cantoo/pdf-lib (export bake), vitest (jsdom + real-Chrome browser harness), i18next (en/fr/ar).

## Global Constraints

- New `TextElement` fields are **optional with defaults → NO `SCHEMA_VERSION` bump** (Bates/crop convention). `toJSON` emits them; `fromJSON` reads with `?? default`.
- Every formatting mutation goes through `FormattingService` and records a history command — never mutate `documentModel`/elements directly from UI.
- Every user-visible string goes through `t()`; the three locale files (`locales/en.json|fr.json|ar.json`) MUST stay key-identical (a write hook enforces this). Arabic values marked [Unverified] pending native review.
- Numeric inputs use NaN-safe parsing (`intOr`/`floatOr` — never `parseX(...) || fallback`, which rewrites a deliberate 0) then clamp.
- `localStorage` access wrapped in try/catch (degrade to in-memory).
- Private members use the `_underscore` prefix (oxlint `no-underscore-dangle` is OFF).
- Before commit: `npm run type-check && npm run lint && npm run test`. Browser guard: `npm run test:browser`.
- No `Co-Authored-By` trailer. `git push` is manual (not part of any task).
- Rotated-element background/decoration is the documented ceiling (guard with `elemRot`, the unrotated signal — not `pdfRotVal`).

---

### Task 1: TextElement model + serialization

**Files:**
- Modify: `src/elements/textElement.ts`
- Modify: `src/utils/elementFactory.ts` (text branch, ~L27-37)
- Test: `tests/elements/textElement.test.ts`

**Interfaces:**
- Produces: `TextElement.backgroundColor?: string`, `TextElement.lineHeight?: number`, `TextElement.opacity?: number`; `TextOptions` gains the same three optional keys. Defaults: `backgroundColor` undefined, `lineHeight` undefined (treated as 1.2 at render), `opacity` undefined (treated as 1).

- [ ] **Step 1: Write the failing test**

```ts
// tests/elements/textElement.test.ts — add to the existing describe block
import { TextElement } from '../../src/elements/textElement';
import { ElementFactory } from '../../src/utils/elementFactory';

it('round-trips backgroundColor, lineHeight, opacity through toJSON/fromJSON', () => {
  const te = new TextElement(10, 20, 'page-1', {
    backgroundColor: '#ffff00', lineHeight: 1.8, opacity: 0.5,
  });
  te.text = 'hi';
  const json = te.toJSON();
  expect(json['backgroundColor']).toBe('#ffff00');
  expect(json['lineHeight']).toBe(1.8);
  expect(json['opacity']).toBe(0.5);

  const back = ElementFactory.fromJSON(json) as TextElement;
  expect(back.backgroundColor).toBe('#ffff00');
  expect(back.lineHeight).toBe(1.8);
  expect(back.opacity).toBe(0.5);
});

it('defaults the three new fields to undefined when unset (legacy blob)', () => {
  const te = new TextElement(0, 0, 'p');
  expect(te.backgroundColor).toBeUndefined();
  expect(te.lineHeight).toBeUndefined();
  expect(te.opacity).toBeUndefined();
});

it('applies backgroundColor and opacity to the rendered element div', () => {
  const te = new TextElement(0, 0, 'p', { backgroundColor: '#ff0000', opacity: 0.4 });
  const div = te.render(document.createElement('div'), { left: 0, top: 0 }, 1);
  expect(div.style.background).toContain('255'); // rgba(255,0,0,...)
  expect(div.style.opacity).toBe('0.4');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/elements/textElement.test.ts`
Expected: FAIL (`backgroundColor` not a constructor option / `undefined`).

- [ ] **Step 3: Write minimal implementation**

In `src/elements/textElement.ts`:

```ts
export interface TextOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: TextAlign;
  multiline?: boolean;
  backgroundColor?: string;
  lineHeight?: number;
  opacity?: number;
}
```

Add fields + constructor assignment to the class:

```ts
  backgroundColor?: string;
  lineHeight?: number;
  opacity?: number;
```

```ts
    // in constructor, after this.multiline = ...
    this.backgroundColor = options.backgroundColor;
    this.lineHeight = options.lineHeight;
    this.opacity = options.opacity;
```

In `applyStyles(...)` add (after the `zIndex` line):

```ts
    if (this.opacity !== undefined) div.style.opacity = String(this.opacity);
    if (this.backgroundColor) {
      const hex = this.backgroundColor.replace(/^#/, '');
      const ch = (s: string) => { const v = parseInt(s, 16); return Number.isNaN(v) ? 0 : v; };
      const r = ch(hex.substring(0, 2)), g = ch(hex.substring(2, 4)), b = ch(hex.substring(4, 6));
      div.style.background = `rgba(${r},${g},${b},1)`;
    }
```

In `toJSON()` extend the returned object:

```ts
      multiline: this.multiline,
      ...(this.backgroundColor !== undefined ? { backgroundColor: this.backgroundColor } : {}),
      ...(this.lineHeight !== undefined ? { lineHeight: this.lineHeight } : {}),
      ...(this.opacity !== undefined ? { opacity: this.opacity } : {}),
```

In `src/utils/elementFactory.ts` text branch (the `new TextElement(...)` options object):

```ts
      backgroundColor: data['backgroundColor'],
      lineHeight: typeof data['lineHeight'] === 'number' ? data['lineHeight'] : undefined,
      opacity: typeof data['opacity'] === 'number' ? data['opacity'] : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/elements/textElement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elements/textElement.ts src/utils/elementFactory.ts tests/elements/textElement.test.ts
git commit -m "feat(text): add backgroundColor/lineHeight/opacity to TextElement model"
```

---

### Task 2: Export bake — bg rect, editable line height, opacity

**Files:**
- Modify: `src/export/pdfElementRenderer.ts` (`renderText`)
- Test: `tests/browser/text-toolbar-bake.browser.test.ts` (NEW, real Chrome)

**Interfaces:**
- Consumes: `TextElement.backgroundColor/lineHeight/opacity` (Task 1).
- Produces: bake honors all three. `lineHeight` multiplier defaults to 1.2 when unset; `opacity` defaults to 1; `backgroundColor` draws a filled rect over the element box before glyphs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/browser/text-toolbar-bake.browser.test.ts
import { describe, it, expect } from 'vitest';
import { renderTextElementToTestPdf, rasterizeFirstPage } from './helpers/bakeHarness';
// renderTextElementToTestPdf: small helper that builds a blank page, adds one TextElement
// with given props, runs the export bake, returns Uint8Array bytes.
// rasterizeFirstPage: pdf.js → ImageData. (Add to tests/browser/helpers/bakeHarness.ts;
// reuse the existing browser-test rasterization helpers — see underline-strike.browser.test.ts.)

describe('text toolbar bake', () => {
  it('draws a background fill behind text', async () => {
    const bytes = await renderTextElementToTestPdf({
      text: 'BG', x: 50, y: 50, width: 120, height: 30,
      color: '#000000', backgroundColor: '#ff0000',
    });
    const img = await rasterizeFirstPage(bytes);
    // sample a pixel inside the box but off the glyph strokes → should be red-ish
    const { data, width } = img;
    const idx = ((60) * width + (160)) * 4; // bottom-right of the box, likely no glyph
    expect(data[idx]).toBeGreaterThan(150);     // R high
    expect(data[idx + 1]).toBeLessThan(120);    // G low
  });

  it('honors reduced opacity (text not fully opaque black)', async () => {
    const opaque = await rasterizeFirstPage(await renderTextElementToTestPdf({
      text: 'O', x: 50, y: 50, color: '#000000', opacity: 1,
    }));
    const faded = await rasterizeFirstPage(await renderTextElementToTestPdf({
      text: 'O', x: 50, y: 50, color: '#000000', opacity: 0.3,
    }));
    expect(meanDarkness(faded)).toBeLessThan(meanDarkness(opaque));
  });

  it('increases vertical gap with larger lineHeight', async () => {
    const tight = await renderTextElementToTestPdf({ text: 'a\nb', lineHeight: 1.0, x: 40, y: 40 });
    const loose = await renderTextElementToTestPdf({ text: 'a\nb', lineHeight: 2.5, x: 40, y: 40 });
    expect(secondLineBaselineY(await rasterizeFirstPage(loose)))
      .toBeGreaterThan(secondLineBaselineY(await rasterizeFirstPage(tight)));
  });
});
// meanDarkness / secondLineBaselineY: small pixel-scan helpers in bakeHarness.ts.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:browser -- tests/browser/text-toolbar-bake.browser.test.ts`
Expected: FAIL (no bg fill; opacity ignored; line gap identical).

- [ ] **Step 3: Write minimal implementation**

In `src/export/pdfElementRenderer.ts` `renderText`, near the top after `const col = ...`:

```ts
  const alpha = te.opacity ?? 1;
  // Background fill behind the whole text box (skip when rotated — documented ceiling).
  if (te.backgroundColor && !elemRot) {
    const bg = hexToRgbValues(te.backgroundColor);
    const tl = tp(te.x, te.y);
    page.drawRectangle({
      x: tl.x, y: tl.y - (te.height || 0), width: te.width || 0, height: te.height || 0,
      color: rgb(bg.r, bg.g, bg.b), opacity: alpha,
    });
  }
```

> NOTE: confirm rect anchor against the existing `renderHighlight`/`renderRedaction` rect math (they bake filled boxes with the same `tp` transform) and match their `y`/`height` handling exactly. Adjust the `y - height` line to whatever those renderers use so the box aligns with the element bounds.

Replace the hardcoded line height:

```ts
  const lineHeight = te.fontSize * (te.lineHeight ?? 1.2);
```

Thread `opacity` into the glyph + decoration draws:

```ts
      page.drawText(line, { x: a.x, y: a.y, size: te.fontSize, font, color: rgb(col.r, col.g, col.b), opacity: alpha, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
```

```ts
        if (te.underline) {
          page.drawLine({ start: tp(te.x + off, baseY + te.fontSize * 0.12), end: tp(te.x + off + lineW, baseY + te.fontSize * 0.12), thickness: thick, color: lineColor, opacity: alpha });
        }
        if (te.strikethrough) {
          page.drawLine({ start: tp(te.x + off, baseY - te.fontSize * 0.3), end: tp(te.x + off + lineW, baseY - te.fontSize * 0.3), thickness: thick, color: lineColor, opacity: alpha });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:browser -- tests/browser/text-toolbar-bake.browser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/pdfElementRenderer.ts tests/browser/text-toolbar-bake.browser.test.ts tests/browser/helpers/bakeHarness.ts
git commit -m "feat(text): bake background fill, editable line height, opacity"
```

---

### Task 3: FormattingService — align/lineHeight/opacity/background methods

**Files:**
- Modify: `src/core/formattingService.ts`
- Test: `tests/core/formattingService.test.ts`

**Interfaces:**
- Consumes: `TextElement` fields (Task 1), `MoveResizeCmd`, `IFormattingContext`.
- Produces: `FormattingService.setAlign(value: TextAlign)`, `setLineHeight(mult: number)`, `setTextOpacity(v: number)`, `setTextBackground(value: string)`, `clearTextBackground()`. Each records a `MoveResizeCmd`, early-returns on non-text selection, calls `rebuildElementLayer()` + `autosave()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/formattingService.test.ts — reuse the existing test harness/fakes in this file
it('setAlign records a command and updates the element', () => {
  const { svc, te, history } = makeTextCtx({ align: 'left' });
  svc.setAlign('right');
  expect(te.align).toBe('right');
  expect(history.record).toHaveBeenCalledTimes(1);
});

it('setLineHeight clamps to 1.0–3.0', () => {
  const { svc, te } = makeTextCtx();
  svc.setLineHeight(5);   expect(te.lineHeight).toBe(3);
  svc.setLineHeight(0.2); expect(te.lineHeight).toBe(1);
});

it('setTextOpacity clamps to 0–1', () => {
  const { svc, te } = makeTextCtx();
  svc.setTextOpacity(2);  expect(te.opacity).toBe(1);
  svc.setTextOpacity(-1); expect(te.opacity).toBe(0);
});

it('setTextBackground / clearTextBackground set and clear the field', () => {
  const { svc, te } = makeTextCtx();
  svc.setTextBackground('#00ff00'); expect(te.backgroundColor).toBe('#00ff00');
  svc.clearTextBackground();        expect(te.backgroundColor).toBeUndefined();
});

it('all new methods no-op on a non-text selection', () => {
  const { svc, history } = makeShapeCtx();
  svc.setAlign('right'); svc.setLineHeight(2); svc.setTextOpacity(0.5);
  svc.setTextBackground('#fff'); svc.clearTextBackground();
  expect(history.record).not.toHaveBeenCalled();
});
// makeTextCtx/makeShapeCtx: thin factories building an IFormattingContext with a fake
// historyManager ({ record: vi.fn() }), a selected element, and no-op rebuild/autosave.
// Model them on the existing tests in this file.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/core/formattingService.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Write minimal implementation**

Append to `FormattingService` (mirror the existing `cycleAlign`/`setFontSize` shape):

```ts
  setAlign(value: TextAlign): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { align: te.align };
    te.align = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { align: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setLineHeight(mult: number): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = Math.min(3, Math.max(1, mult));
    const before = { lineHeight: te.lineHeight };
    te.lineHeight = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { lineHeight: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setTextOpacity(v: number): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const o = Math.min(1, Math.max(0, v));
    const before = { opacity: te.opacity };
    te.opacity = o;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { opacity: o }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setTextBackground(value: string): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { backgroundColor: te.backgroundColor };
    te.backgroundColor = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { backgroundColor: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  clearTextBackground(): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { backgroundColor: te.backgroundColor };
    te.backgroundColor = undefined;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { backgroundColor: undefined }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/core/formattingService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/formattingService.ts tests/core/formattingService.test.ts
git commit -m "feat(text): FormattingService align/lineHeight/opacity/background setters"
```

---

### Task 4: Text case transform

**Files:**
- Create: `src/utils/textCase.ts`
- Modify: `src/core/formattingService.ts`
- Test: `tests/utils/textCase.test.ts`, `tests/core/formattingService.test.ts`

**Interfaces:**
- Produces: `applyTextCase(text: string, mode: 'upper'|'lower'|'title'): string` (pure); `FormattingService.transformCase(mode)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/textCase.test.ts
import { applyTextCase } from '../../src/utils/textCase';
it('uppercases / lowercases', () => {
  expect(applyTextCase('aB cD', 'upper')).toBe('AB CD');
  expect(applyTextCase('aB cD', 'lower')).toBe('ab cd');
});
it('title-cases each whitespace-delimited word, preserving newlines/spacing', () => {
  expect(applyTextCase('hello   world', 'title')).toBe('Hello   World');
  expect(applyTextCase('one two\nthree', 'title')).toBe('One Two\nThree');
});
```

```ts
// tests/core/formattingService.test.ts
it('transformCase rewrites the element text via one command', () => {
  const { svc, te, history } = makeTextCtx();
  te.text = 'hello world';
  svc.transformCase('title');
  expect(te.text).toBe('Hello World');
  expect(history.record).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/utils/textCase.test.ts tests/core/formattingService.test.ts`
Expected: FAIL (module/method missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/textCase.ts
export type TextCaseMode = 'upper' | 'lower' | 'title';

export function applyTextCase(text: string, mode: TextCaseMode): string {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  // title: capitalize the first letter of each whitespace-delimited token, keep the
  // original whitespace runs (split on a capturing group so separators are preserved).
  return text
    .split(/(\s+)/)
    .map((tok) => (/\s/.test(tok) || tok.length === 0 ? tok : tok[0].toUpperCase() + tok.slice(1).toLowerCase()))
    .join('');
}
```

In `formattingService.ts` import + method:

```ts
import { applyTextCase, type TextCaseMode } from '../utils/textCase';
```

```ts
  transformCase(mode: TextCaseMode): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const next = applyTextCase(te.text, mode);
    if (next === te.text) return;
    const before = { text: te.text };
    te.text = next;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { text: next }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/utils/textCase.test.ts tests/core/formattingService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/textCase.ts src/core/formattingService.ts tests/utils/textCase.test.ts tests/core/formattingService.test.ts
git commit -m "feat(text): text case transform (UPPER/lower/Title)"
```

---

### Task 5: Clear formatting

**Files:**
- Modify: `src/core/formattingService.ts`
- Test: `tests/core/formattingService.test.ts`

**Interfaces:**
- Produces: `FormattingService.clearFormatting()` — resets formatting fields (NOT `text`) in one `MoveResizeCmd`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/formattingService.test.ts
it('clearFormatting resets fmt fields but keeps text, in one command', () => {
  const { svc, te, history } = makeTextCtx({
    bold: true, italic: true, underline: true, strikethrough: true,
    align: 'right', fontFamily: 'Times', fontSize: 30, color: '#ff0000',
  });
  te.text = 'keep me';
  te.lineHeight = 2; te.opacity = 0.5; te.backgroundColor = '#ff0';
  svc.clearFormatting();
  expect(te.text).toBe('keep me');
  expect(te.bold).toBe(false); expect(te.italic).toBe(false);
  expect(te.underline).toBe(false); expect(te.strikethrough).toBe(false);
  expect(te.align).toBe('left'); expect(te.fontFamily).toBe('Arial');
  expect(te.fontSize).toBe(14); expect(te.color).toBe('#000000');
  expect(te.lineHeight).toBeUndefined(); expect(te.opacity).toBeUndefined();
  expect(te.backgroundColor).toBeUndefined();
  expect(history.record).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/core/formattingService.test.ts`
Expected: FAIL (`clearFormatting` undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
  clearFormatting(): void {
    if (this._ctx.selectedElement?.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = {
      bold: te.bold, italic: te.italic, underline: te.underline, strikethrough: te.strikethrough,
      align: te.align, fontFamily: te.fontFamily, fontSize: te.fontSize, color: te.color,
      lineHeight: te.lineHeight, opacity: te.opacity, backgroundColor: te.backgroundColor,
    };
    const after = {
      bold: false, italic: false, underline: false, strikethrough: false,
      align: 'left' as const, fontFamily: 'Arial', fontSize: 14, color: '#000000',
      lineHeight: undefined, opacity: undefined, backgroundColor: undefined,
    };
    Object.assign(te, after);
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, after));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/core/formattingService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/formattingService.ts tests/core/formattingService.test.ts
git commit -m "feat(text): clear-formatting resets style fields in one command"
```

---

### Task 6: Format painter (copy/apply style)

**Files:**
- Modify: `src/core/formattingService.ts`
- Test: `tests/core/formattingService.test.ts`

**Interfaces:**
- Produces: `FormattingService.copyTextStyle(): boolean` (snapshots the selected text element's style into transient `_copiedTextStyle`, returns true if armed), `pasteTextStyle(): void` (applies `_copiedTextStyle` to the currently-selected text element via one `MoveResizeCmd`, then disarms), `get painterArmed(): boolean`. The selection-path hook is wired in Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/formattingService.test.ts
it('copyTextStyle then pasteTextStyle transfers formatting to another element', () => {
  const src = new TextElement(0, 0, 'p', { bold: true, fontSize: 22, color: '#ff0000', align: 'center' });
  const dst = new TextElement(0, 0, 'p');
  const { svc, setSelected, history } = makeSelectableCtx([src, dst]);
  setSelected(src);
  expect(svc.copyTextStyle()).toBe(true);
  expect(svc.painterArmed).toBe(true);
  setSelected(dst);
  svc.pasteTextStyle();
  expect(dst.bold).toBe(true); expect(dst.fontSize).toBe(22);
  expect(dst.color).toBe('#ff0000'); expect(dst.align).toBe('center');
  expect(svc.painterArmed).toBe(false);             // disarmed after paste
  expect(history.record).toHaveBeenCalledTimes(1);   // copy is not a command, paste is
});

it('copyTextStyle returns false when selection is not text', () => {
  const { svc } = makeShapeCtx();
  expect(svc.copyTextStyle()).toBe(false);
  expect(svc.painterArmed).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/core/formattingService.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
  private _copiedTextStyle: Record<string, unknown> | null = null;

  get painterArmed(): boolean { return this._copiedTextStyle !== null; }

  copyTextStyle(): boolean {
    if (this._ctx.selectedElement?.type !== 'text') return false;
    const te = this._ctx.selectedElement as TextElement;
    this._copiedTextStyle = {
      bold: te.bold, italic: te.italic, underline: te.underline, strikethrough: te.strikethrough,
      align: te.align, fontFamily: te.fontFamily, fontSize: te.fontSize, color: te.color,
      lineHeight: te.lineHeight, opacity: te.opacity, backgroundColor: te.backgroundColor,
    };
    return true;
  }

  cancelPainter(): void { this._copiedTextStyle = null; }

  pasteTextStyle(): void {
    if (!this._copiedTextStyle || this._ctx.selectedElement?.type !== 'text') { this._copiedTextStyle = null; return; }
    const te = this._ctx.selectedElement as TextElement;
    const keys = Object.keys(this._copiedTextStyle);
    const before: Record<string, unknown> = {};
    for (const k of keys) before[k] = (te as unknown as Record<string, unknown>)[k];
    Object.assign(te, this._copiedTextStyle);
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, this._copiedTextStyle));
    this._copiedTextStyle = null;
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/core/formattingService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/formattingService.ts tests/core/formattingService.test.ts
git commit -m "feat(text): format painter copy/apply style"
```

---

### Task 7: Recent-colors store

**Files:**
- Create: `src/utils/recentColors.ts`
- Test: `tests/utils/recentColors.test.ts`

**Interfaces:**
- Produces: `pushRecentColor(hex: string): void`, `getRecentColors(): string[]` (most-recent first, max 8, deduped, localStorage-backed, try/catch safe). Static preset palette exported as `COLOR_PRESETS: readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/recentColors.test.ts
import { pushRecentColor, getRecentColors, COLOR_PRESETS } from '../../src/utils/recentColors';
beforeEach(() => localStorage.clear());
it('keeps most-recent-first, deduped, capped at 8', () => {
  for (const c of ['#111','#222','#333','#111']) pushRecentColor(c);
  expect(getRecentColors().slice(0, 3)).toEqual(['#111', '#333', '#222']);
  for (let i = 0; i < 12; i++) pushRecentColor('#' + i.toString().padStart(6, '0'));
  expect(getRecentColors().length).toBe(8);
});
it('exposes a non-empty preset palette', () => {
  expect(COLOR_PRESETS.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/utils/recentColors.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/recentColors.ts
const KEY = 'pdfturbo.recentColors';
const MAX = 8;

export const COLOR_PRESETS: readonly string[] = [
  '#000000', '#ffffff', '#ff0000', '#ff9900', '#ffff00',
  '#00cc00', '#0066ff', '#9900ff', '#888888', '#a52a2a',
];

let _mem: string[] = [];

function read(): string[] {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) as string[] : _mem; }
  catch { return _mem; }
}
function write(list: string[]): void {
  _mem = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

export function getRecentColors(): string[] { return read(); }

export function pushRecentColor(hex: string): void {
  const norm = hex.toLowerCase();
  const next = [norm, ...read().filter((c) => c.toLowerCase() !== norm)].slice(0, MAX);
  write(next);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/utils/recentColors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/recentColors.ts tests/utils/recentColors.test.ts
git commit -m "feat(text): recent-colors store + preset palette"
```

---

### Task 8: "Text ⋮" popover component + markup + DOM refs

**Files:**
- Create: `src/ui/textOptionsPopover.ts`
- Modify: `index.html` (add the popover modal markup + the inline "⋮ More" trigger button in `#formattingGroup`)
- Modify: `src/ui/uiController.ts` (add the new DOM refs to `AppDOMRefs` + the `getElementById` block; enable them in the text-selected branch ~L581)
- Test: `tests/ui/textOptionsPopover.test.ts`

**Interfaces:**
- Consumes: `FormattingService` methods (Tasks 3-6), `trapFocus`, `AppDOMRefs`.
- Produces: `TextOptionsPopover` class with `open()`, `close()`, `setupListeners()`, syncing controls from the selected element. New `AppDOMRefs` keys: `textOptionsBtn`, `textOptionsModal`, `textLineHeight`, `textOpacity`, `textBgColor`, `textBgNoneBtn`, `textCaseUpperBtn`, `textCaseLowerBtn`, `textCaseTitleBtn`, `clearFmtBtn`, `formatPainterBtn`, plus inline `alignLeftBtn`/`alignCenterBtn`/`alignRightBtn` and `colorSwatchRow`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/textOptionsPopover.test.ts
import { TextOptionsPopover } from '../../src/ui/textOptionsPopover';
// Build a minimal DOM with the modal markup + trigger (copy the markup snippet from Step 3),
// a fake ctx exposing the FormattingService methods as vi.fn()s and a selected TextElement.
it('open() adds .active and close() removes it', () => {
  const { pop, modal } = makePopover();
  pop.open();
  expect(modal.classList.contains('active')).toBe(true);
  pop.close();
  expect(modal.classList.contains('active')).toBe(false);
});
it('line-height input change calls svc.setLineHeight with the parsed value', () => {
  const { pop, ui, svc } = makePopover();
  pop.setupListeners();
  ui.textLineHeight.value = '2.0';
  ui.textLineHeight.dispatchEvent(new Event('change'));
  expect(svc.setLineHeight).toHaveBeenCalledWith(2);
});
it('case buttons call transformCase with the right mode', () => {
  const { pop, ui, svc } = makePopover();
  pop.setupListeners();
  ui.textCaseUpperBtn.click();
  expect(svc.transformCase).toHaveBeenCalledWith('upper');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/ui/textOptionsPopover.test.ts`
Expected: FAIL (module + markup missing).

- [ ] **Step 3: Write minimal implementation**

Add to `index.html` inside `#formattingGroup` (after `#color`, near L161): inline discrete-align buttons, the swatch row container, and the More trigger:

```html
      <span class="toolbar-sep"></span>
      <button id="alignLeftBtn" class="btn btn-icon" disabled data-i18n-title="formatting.alignLeftTitle" title="Align left">⯇</button>
      <button id="alignCenterBtn" class="btn btn-icon" disabled data-i18n-title="formatting.alignCenterTitle" title="Align center">≡</button>
      <button id="alignRightBtn" class="btn btn-icon" disabled data-i18n-title="formatting.alignRightTitle" title="Align right">⯈</button>
      <span id="colorSwatchRow" class="color-swatch-row"></span>
      <button id="textOptionsBtn" class="btn btn-icon" disabled data-i18n-title="formatting.moreTextTitle" title="More text options">⋮</button>
```

Add the popover modal markup before `</body>` (reuse the `.watermark-modal`/`.watermark-content` CSS so no new layout is needed; see `#batesModal` in index.html as the template):

```html
  <div id="textOptionsModal" class="watermark-modal" role="dialog" aria-modal="true" data-i18n-aria-label="formatting.moreTextTitle">
    <div class="watermark-content">
      <h3 data-i18n="formatting.moreTextTitle">Text options</h3>
      <label><span data-i18n="formatting.caseLabel">Case</span>:
        <button id="textCaseUpperBtn" class="btn btn-sm" title="UPPER">AA</button>
        <button id="textCaseLowerBtn" class="btn btn-sm" title="lower">aa</button>
        <button id="textCaseTitleBtn" class="btn btn-sm" title="Title">Aa</button>
      </label>
      <label><span data-i18n="formatting.lineSpacingLabel">Line spacing</span>
        <input type="number" id="textLineHeight" class="wm-input" min="1" max="3" step="0.1" value="1.2"></label>
      <label><span data-i18n="formatting.opacityLabel">Opacity</span>
        <input type="range" id="textOpacity" min="0" max="1" step="0.05" value="1"></label>
      <label><span data-i18n="formatting.bgColorLabel">Background</span>
        <input type="color" id="textBgColor" value="#ffff00">
        <button id="textBgNoneBtn" class="btn btn-sm" data-i18n="formatting.none">None</button></label>
      <div class="wm-actions">
        <button id="clearFmtBtn" class="btn btn-secondary btn-sm" data-i18n="formatting.clearFmt">Clear formatting</button>
        <button id="formatPainterBtn" class="btn btn-secondary btn-sm" data-i18n="formatting.formatPainter">🖌 Format painter</button>
      </div>
      <button id="textOptionsCloseBtn" class="btn btn-sm" data-i18n="modal.close">Close</button>
    </div>
  </div>
```

Add the refs to `AppDOMRefs` and the `getElementById` block in `src/ui/uiController.ts` (follow the existing `bates*` entries exactly), and enable them in the `isText` branch (~L581):

```ts
    r.textOptionsBtn.disabled  = !isText;
    r.alignLeftBtn.disabled    = !isText;
    r.alignCenterBtn.disabled  = !isText;
    r.alignRightBtn.disabled   = !isText;
```

Create `src/ui/textOptionsPopover.ts` (mirror `batesPanel.ts`):

```ts
import type { AppDOMRefs } from './uiController';
import type { FormattingService } from '../core/formattingService';
import type { TextElement } from '../elements/textElement';
import { trapFocus } from '../utils/focusTrap';

function floatOr(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? fallback : n;
}

export interface ITextOptionsContext {
  readonly ui: AppDOMRefs;
  readonly svc: FormattingService;
  readonly selectedText: TextElement | null;
}

export class TextOptionsPopover {
  private _trapCleanup: (() => void) | null = null;
  constructor(private readonly _ctx: ITextOptionsContext) {}

  setupListeners(): void {
    const ui = this._ctx.ui;
    ui.textOptionsBtn.addEventListener('click', () => this.open());
    ui.textOptionsCloseBtn.addEventListener('click', () => this.close());
    ui.textLineHeight.addEventListener('change', () => this._ctx.svc.setLineHeight(floatOr(ui.textLineHeight.value, 1.2)));
    ui.textOpacity.addEventListener('input', () => this._ctx.svc.setTextOpacity(floatOr(ui.textOpacity.value, 1)));
    ui.textBgColor.addEventListener('input', () => this._ctx.svc.setTextBackground(ui.textBgColor.value));
    ui.textBgNoneBtn.addEventListener('click', () => this._ctx.svc.clearTextBackground());
    ui.textCaseUpperBtn.addEventListener('click', () => this._ctx.svc.transformCase('upper'));
    ui.textCaseLowerBtn.addEventListener('click', () => this._ctx.svc.transformCase('lower'));
    ui.textCaseTitleBtn.addEventListener('click', () => this._ctx.svc.transformCase('title'));
    ui.clearFmtBtn.addEventListener('click', () => this._ctx.svc.clearFormatting());
    ui.formatPainterBtn.addEventListener('click', () => {
      if (this._ctx.svc.copyTextStyle()) ui.formatPainterBtn.classList.add('btn-active-fmt');
    });
  }

  open(): void {
    const ui = this._ctx.ui;
    const te = this._ctx.selectedText;
    if (te) {
      ui.textLineHeight.value = String(te.lineHeight ?? 1.2);
      ui.textOpacity.value = String(te.opacity ?? 1);
      if (te.backgroundColor) ui.textBgColor.value = te.backgroundColor;
    }
    ui.textOptionsModal.classList.add('active');
    this._trapCleanup?.();
    this._trapCleanup = trapFocus(ui.textOptionsModal.querySelector('.watermark-content') as HTMLElement, ui.textOptionsBtn);
  }

  close(): void {
    this._ctx.ui.textOptionsModal.classList.remove('active');
    this._trapCleanup?.();
    this._trapCleanup = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/ui/textOptionsPopover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html src/ui/textOptionsPopover.ts src/ui/uiController.ts tests/ui/textOptionsPopover.test.ts
git commit -m "feat(text): Text options popover + inline align buttons + DOM refs"
```

---

### Task 9: Wire binder + app delegators + main.ts (inline controls, swatches, painter selection hook)

**Files:**
- Modify: `src/ui/binders/formattingBinder.ts`
- Modify: `src/core/pdfTurboApp.ts` (thin delegators + painter selection hook)
- Modify: `src/main.ts` (instantiate `TextOptionsPopover`, render swatch row)
- Test: covered by Task 11 browser guard (wiring is not unit-testable in jsdom without the full app).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: `app.setAlign`, `app.transformCase`, `app.clearFormatting`, and the painter paste-on-select behavior. The swatch row is populated from `COLOR_PRESETS` + `getRecentColors()`; clicking a swatch sets `app.ui.colorInput.value` and dispatches `input`.

- [ ] **Step 1: Add delegators to `pdfTurboApp.ts`** (next to the existing `toggleBold`/`cycleAlign`):

```ts
  setAlign(v: TextAlign): void { this._formattingService.setAlign(v); this._formattingService.updateFormattingToolbar(); }
  transformCase(m: TextCaseMode): void { this._formattingService.transformCase(m); }
  clearFormatting(): void { this._formattingService.clearFormatting(); }
```

- [ ] **Step 2: Painter selection hook** — in the method that runs when an element becomes selected (find where `updateFormattingToolbar()` is called on selection; e.g. `selectElement`/`setSelectedElement`), add at the end:

```ts
    if (this._formattingService.painterArmed && el?.type === 'text') {
      this._formattingService.pasteTextStyle();
      this.ui.formatPainterBtn.classList.remove('btn-active-fmt');
    }
```

- [ ] **Step 3: Extend `formattingBinder.ts`**:

```ts
  app.ui.alignLeftBtn.addEventListener('click', () => app.setAlign('left'));
  app.ui.alignCenterBtn.addEventListener('click', () => app.setAlign('center'));
  app.ui.alignRightBtn.addEventListener('click', () => app.setAlign('right'));
```

- [ ] **Step 4: Swatch row + popover in `main.ts`** — after the app is constructed:

```ts
import { COLOR_PRESETS, getRecentColors, pushRecentColor } from './utils/recentColors';
import { TextOptionsPopover } from './ui/textOptionsPopover';

function renderSwatches(app: PDFTurboApp): void {
  const row = app.ui.colorSwatchRow;
  row.replaceChildren();
  for (const hex of [...COLOR_PRESETS, ...getRecentColors()]) {
    const sw = document.createElement('button');
    sw.className = 'color-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      app.ui.colorInput.value = hex;
      app.ui.colorInput.dispatchEvent(new Event('input', { bubbles: true }));
      pushRecentColor(hex);
    });
    row.appendChild(sw);
  }
}
// ...after construction:
const textPopover = new TextOptionsPopover({
  ui: app.ui, svc: app.formattingService,
  get selectedText() { return app.selectedElement?.type === 'text' ? app.selectedElement as TextElement : null; },
});
textPopover.setupListeners();
renderSwatches(app);
```

> NOTE: `app.formattingService` and `app.selectedElement` must be accessible. If `_formattingService` is private, add a public `get formattingService()` getter to `pdfTurboApp.ts` (a one-line getter, consistent with the existing public surface).

- [ ] **Step 5: Add minimal CSS** for `.color-swatch-row`/`.color-swatch` in the toolbar stylesheet (small 16px squares, inline-flex row). Then commit:

```bash
git add src/ui/binders/formattingBinder.ts src/core/pdfTurboApp.ts src/main.ts src/styles/*.css
git commit -m "feat(text): wire align buttons, color swatches, popover, painter select-hook"
```

> Verify: `npm run type-check && npm run lint` pass before commit.

---

### Task 10: i18n keys (en / fr / ar)

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`
- Test: the `locale-sync-check` write hook (3-way key parity) + a quick `npm run test` run.

**Interfaces:**
- Produces: `formatting.alignLeftTitle`, `formatting.alignCenterTitle`, `formatting.alignRightTitle`, `formatting.moreTextTitle`, `formatting.caseLabel`, `formatting.lineSpacingLabel`, `formatting.opacityLabel`, `formatting.bgColorLabel`, `formatting.none`, `formatting.clearFmt`, `formatting.formatPainter`. Confirm `modal.close` already exists; if not, add it too.

- [ ] **Step 1: Add to `locales/en.json` `"formatting"`:**

```json
  "alignLeftTitle": "Align left",
  "alignCenterTitle": "Align center",
  "alignRightTitle": "Align right",
  "moreTextTitle": "Text options",
  "caseLabel": "Case",
  "lineSpacingLabel": "Line spacing",
  "opacityLabel": "Opacity",
  "bgColorLabel": "Background",
  "none": "None",
  "clearFmt": "Clear formatting",
  "formatPainter": "🖌 Format painter"
```

- [ ] **Step 2: Add the SAME keys to `locales/fr.json`:**

```json
  "alignLeftTitle": "Aligner à gauche",
  "alignCenterTitle": "Centrer",
  "alignRightTitle": "Aligner à droite",
  "moreTextTitle": "Options de texte",
  "caseLabel": "Casse",
  "lineSpacingLabel": "Interligne",
  "opacityLabel": "Opacité",
  "bgColorLabel": "Arrière-plan",
  "none": "Aucun",
  "clearFmt": "Effacer la mise en forme",
  "formatPainter": "🖌 Reproduire la mise en forme"
```

- [ ] **Step 3: Add the SAME keys to `locales/ar.json`** ([Unverified] — flag for native review):

```json
  "alignLeftTitle": "محاذاة لليسار",
  "alignCenterTitle": "توسيط",
  "alignRightTitle": "محاذاة لليمين",
  "moreTextTitle": "خيارات النص",
  "caseLabel": "حالة الأحرف",
  "lineSpacingLabel": "تباعد الأسطر",
  "opacityLabel": "الشفافية",
  "bgColorLabel": "الخلفية",
  "none": "بلا",
  "clearFmt": "مسح التنسيق",
  "formatPainter": "🖌 نسخ التنسيق"
```

- [ ] **Step 4: Verify parity + tests**

Run: `npm run test && npm run type-check && npm run lint`
Expected: PASS, no locale-sync drift warning.

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(text): toolbar Slice 1 keys (ar unverified)"
```

---

### Task 11: Real-Chrome integration guard

**Files:**
- Create/extend: `tests/browser/text-toolbar.browser.test.ts`

**Interfaces:**
- Consumes: the whole wired feature.

- [ ] **Step 1: Write the failing test** — drive the real app: add a text element, open the popover, set bg-color + line-spacing + opacity, type text, then export and assert the bake pixels (reuse Task 2 harness); separately verify format-painter copy→apply across two elements via real clicks.

```ts
// tests/browser/text-toolbar.browser.test.ts
import { describe, it, expect } from 'vitest';
import { mountApp, addTextElement, exportBytes, rasterizeFirstPage } from './helpers/appHarness';
// appHarness: existing real-app mount helpers used by other browser tests.

describe('rich text toolbar (real Chrome)', () => {
  it('background color + opacity + line spacing reach the exported PDF', async () => {
    const app = await mountApp();
    const te = addTextElement(app, { text: 'A\nB', x: 60, y: 60, width: 100, height: 40 });
    app.formattingService.setTextBackground('#00ff00');
    app.formattingService.setTextOpacity(0.5);
    app.formattingService.setLineHeight(2.2);
    const img = await rasterizeFirstPage(await exportBytes(app));
    expect(greenPixelPresent(img)).toBe(true);
  });

  it('format painter copies style from one box to another via clicks', async () => {
    const app = await mountApp();
    const a = addTextElement(app, { text: 'src', bold: true, color: '#ff0000', fontSize: 24 });
    const b = addTextElement(app, { text: 'dst' });
    selectInUi(app, a);
    app.ui.formatPainterBtn.click();             // arms
    selectInUi(app, b);                          // paste-on-select hook fires
    expect(b.bold).toBe(true);
    expect(b.color).toBe('#ff0000');
    expect(b.fontSize).toBe(24);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then iterate the harness helpers until the test exercises the real wiring.

Run: `npm run test:browser -- tests/browser/text-toolbar.browser.test.ts`

- [ ] **Step 3–4: Make it pass** (no production change expected if Tasks 1-10 are correct; fix wiring bugs the test surfaces).

- [ ] **Step 5: Final full gate + commit**

```bash
npm run type-check && npm run lint && npm run test && npm run test:browser
git add tests/browser/text-toolbar.browser.test.ts tests/browser/helpers/*
git commit -m "test(text): real-Chrome guard for rich toolbar Slice 1"
```

---

## Self-Review

**Spec coverage:** all 8 features map to tasks — align (T3+T8+T9), bg-color (T1/T2/T3/T8), line-spacing (T1/T2/T3/T8), opacity (T1/T2/T3/T8), text-case (T4/T8), clear-formatting (T5/T8), format-painter (T6/T9), color presets (T7/T9). Persistence (T1), bake (T2), popover placement (T8), i18n (T10), browser guard (T11). ✓

**Placeholder scan:** no "TBD"/"add error handling"/"similar to" — every code step has concrete code. The two `NOTE:` blocks (rect-anchor verification in T2, `formattingService` getter in T9) are explicit verification instructions, not deferred work. ✓

**Type consistency:** `setAlign(TextAlign)`, `transformCase(TextCaseMode)`, `copyTextStyle(): boolean`/`pasteTextStyle()`/`painterArmed`, `setLineHeight`/`setTextOpacity`/`setTextBackground`/`clearTextBackground`, `applyTextCase`, `pushRecentColor`/`getRecentColors`/`COLOR_PRESETS` are used identically across tasks. ✓

**Verification note (must-do during execution):** in Task 2, confirm the bg `drawRectangle` y/height against `renderHighlight`/`renderRedaction` (they bake filled boxes with the same `tp` transform) before trusting the placeholder `y - height`. In Task 9, add the public `formattingService`/`selectedElement` getters if they aren't already public.
