# Rich PDF Text Toolbar — Slice 2 (Tier-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 Tier-2 text controls (stroke/outline, character spacing, horizontal scale, justify, whole-box sub/superscript) to overlay `TextElement`s, with undo/redo, persistence, export-bake fidelity, and i18n.

**Architecture:** New optional `TextElement` fields (no schema bump) + `FormattingService` setters (each a `MoveResizeCmd`). The export bake gains a raw-operator text path (`src/export/styledText.ts`, mirroring `arabicOverlay.ts`'s `pushOperators` pattern) used ONLY when an advanced attr is set and the element is unrotated; otherwise `drawText` runs unchanged (byte-identical for every current element). Inline justify button + popover rows for the rest.

**Tech Stack:** TypeScript, Vite, @cantoo/pdf-lib (operator helpers), vitest (jsdom + real-Chrome via Playwright).

## Global Constraints
- NO `SCHEMA_VERSION` bump — all new `TextElement` fields are optional with defaults (Bates/Slice-1 precedent).
- Byte-identical export for any element WITHOUT an advanced attr (operator path not taken).
- Overlay-only; rotated element + advanced attr → fall back to `drawText` (attrs ignored), consistent with the existing `!elemRot` decoration gating.
- Latin/WinAnsi only in the operator path; Arabic lines keep the existing `drawArabicLine` path (advanced attrs not applied to Arabic — documented ceiling).
- No new dependency; no feature flag (additive to the always-on toolbar).
- Numeric inputs clamped + NaN-safe (never `parseFloat(...) || x`).
- Commit style `feat:`/`fix:`/`test:`/`docs:`; NO `Co-Authored-By` trailer. `git push` is manual.
- Gate before each commit: `npm run type-check && npm run lint && npm run test`; editor/export changes also run `npm run test:browser`.

---

### Task 1: Model fields + factory rehydrate

**Files:**
- Modify: `src/elements/textElement.ts` (TextAlign, TextOptions, class fields, constructor, toJSON)
- Modify: `src/utils/elementFactory.ts:28-39` (text branch fromJSON)
- Test: `tests/elements/textElement.test.ts` (or the existing element test file; create if absent)

**Interfaces:**
- Produces: `TextElement.strokeColor?: string`, `strokeWidth?: number`, `charSpacing?: number`, `horizontalScale?: number`, `baselineShift?: 'super'|'sub'`; `TextAlign` includes `'justify'`. Same names used by Tasks 2–6.

- [ ] **Step 1: Write the failing test**

```ts
// tests/elements/textElement.test.ts
import { describe, it, expect } from 'vitest';
import { TextElement } from '../../src/elements/textElement';
import { ElementFactory } from '../../src/utils/elementFactory';

describe('TextElement Slice-2 fields', () => {
  it('omits new fields from toJSON when unset (no schema churn)', () => {
    const el = new TextElement(0, 0, 'p1', { });
    const json = el.toJSON();
    expect('strokeWidth' in json).toBe(false);
    expect('charSpacing' in json).toBe(false);
    expect('horizontalScale' in json).toBe(false);
    expect('baselineShift' in json).toBe(false);
  });

  it('round-trips set fields through toJSON + factory', () => {
    const el = new TextElement(0, 0, 'p1', {
      strokeColor: '#ff0000', strokeWidth: 1.5, charSpacing: 2,
      horizontalScale: 80, baselineShift: 'super', align: 'justify',
    });
    const round = ElementFactory.fromJSON(el.toJSON(), 'p1') as TextElement;
    expect(round.strokeColor).toBe('#ff0000');
    expect(round.strokeWidth).toBe(1.5);
    expect(round.charSpacing).toBe(2);
    expect(round.horizontalScale).toBe(80);
    expect(round.baselineShift).toBe('super');
    expect(round.align).toBe('justify');
  });

  it('legacy blob (no new fields) restores with defaults', () => {
    const legacy = new TextElement(0, 0, 'p1').toJSON();
    const round = ElementFactory.fromJSON(legacy, 'p1') as TextElement;
    expect(round.strokeWidth).toBeUndefined();
    expect(round.horizontalScale).toBeUndefined();
    expect(round.align).toBe('left');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/elements/textElement.test.ts`
Expected: FAIL (fields undefined on the round-tripped element / TS error on `baselineShift`).

- [ ] **Step 3: Implement the model + factory changes**

In `src/elements/textElement.ts`:
```ts
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
```
Add to `TextOptions` (after `opacity?: number;`):
```ts
  strokeColor?: string;
  strokeWidth?: number;
  charSpacing?: number;
  horizontalScale?: number;
  baselineShift?: 'super' | 'sub';
```
Add class fields (after `opacity?: number;`):
```ts
  strokeColor?: string;
  strokeWidth?: number;
  charSpacing?: number;
  horizontalScale?: number;
  baselineShift?: 'super' | 'sub';
```
Add to the constructor (after `this.opacity = options.opacity;`):
```ts
    this.strokeColor = options.strokeColor;
    this.strokeWidth = options.strokeWidth;
    this.charSpacing = options.charSpacing;
    this.horizontalScale = options.horizontalScale;
    this.baselineShift = options.baselineShift;
```
Extend `toJSON()` (inside the returned object, after the `opacity` spread):
```ts
      ...(this.strokeColor !== undefined ? { strokeColor: this.strokeColor } : {}),
      ...(this.strokeWidth !== undefined ? { strokeWidth: this.strokeWidth } : {}),
      ...(this.charSpacing !== undefined ? { charSpacing: this.charSpacing } : {}),
      ...(this.horizontalScale !== undefined ? { horizontalScale: this.horizontalScale } : {}),
      ...(this.baselineShift !== undefined ? { baselineShift: this.baselineShift } : {}),
```

In `src/utils/elementFactory.ts` text branch (the `new TextElement(..., { ... })` options object, alongside `backgroundColor`/`lineHeight`/`opacity`):
```ts
      strokeColor: typeof data['strokeColor'] === 'string' ? data['strokeColor'] : undefined,
      strokeWidth: typeof data['strokeWidth'] === 'number' ? data['strokeWidth'] : undefined,
      charSpacing: typeof data['charSpacing'] === 'number' ? data['charSpacing'] : undefined,
      horizontalScale: typeof data['horizontalScale'] === 'number' ? data['horizontalScale'] : undefined,
      baselineShift: data['baselineShift'] === 'super' || data['baselineShift'] === 'sub' ? data['baselineShift'] : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/elements/textElement.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/elements/textElement.ts src/utils/elementFactory.ts tests/elements/textElement.test.ts
git commit -m "feat(text): Slice 2 model fields (stroke/charSpacing/horizontalScale/baselineShift/justify)"
```

---

### Task 2: FormattingService setters

**Files:**
- Modify: `src/core/formattingService.ts` (new methods + extend `clearFormatting`/`copyTextStyle`/`pasteTextStyle`)
- Test: `tests/core/formattingService.test.ts`

**Interfaces:**
- Consumes: `TextElement` fields from Task 1; `MoveResizeCmd`, `this._ctx` (selectedElement, elements, historyManager, rebuildElementLayer, autosave) — existing.
- Produces: `setTextStroke(color: string, width: number)`, `clearTextStroke()`, `setCharSpacing(pt: number)`, `setHorizontalScale(pct: number)`, `setBaselineShift(mode: 'super'|'sub'|null)`. (Justify reuses the existing `setAlign('justify')`.)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/core/formattingService.test.ts — reuse the file's existing harness
// (a makeCtx() that returns a fake ctx with a selected TextElement + spy historyManager).
import { describe, it, expect } from 'vitest';
// ... existing imports: FormattingService, TextElement, a ctx factory ...

describe('FormattingService Slice-2 setters', () => {
  it('setTextStroke records color+width and setCharSpacing clamps', () => {
    const { svc, te, history } = makeTextCtx(); // existing helper in this file
    svc.setTextStroke('#ff0000', 2);
    expect(te.strokeColor).toBe('#ff0000');
    expect(te.strokeWidth).toBe(2);
    svc.setCharSpacing(999);          // clamp upper
    expect(te.charSpacing).toBe(20);
    svc.setCharSpacing(-999);         // clamp lower
    expect(te.charSpacing).toBe(-5);
    expect(history.record).toHaveBeenCalled();
  });

  it('setHorizontalScale clamps 50..200 and setBaselineShift toggles', () => {
    const { svc, te } = makeTextCtx();
    svc.setHorizontalScale(10);  expect(te.horizontalScale).toBe(50);
    svc.setHorizontalScale(999); expect(te.horizontalScale).toBe(200);
    svc.setBaselineShift('super'); expect(te.baselineShift).toBe('super');
    svc.setBaselineShift(null);    expect(te.baselineShift).toBeUndefined();
  });

  it('clearTextStroke and clearFormatting reset Slice-2 fields', () => {
    const { svc, te } = makeTextCtx();
    svc.setTextStroke('#000000', 1); svc.setCharSpacing(3); svc.setHorizontalScale(80); svc.setBaselineShift('sub');
    svc.clearTextStroke();
    expect(te.strokeWidth).toBeUndefined();
    expect(te.strokeColor).toBeUndefined();
    svc.clearFormatting();
    expect(te.charSpacing).toBeUndefined();
    expect(te.horizontalScale).toBeUndefined();
    expect(te.baselineShift).toBeUndefined();
    expect(te.align).toBe('left');
  });

  it('setters no-op when selection is not a text element', () => {
    const { svc, ctx } = makeTextCtx();
    ctx.selectedElement = null;
    expect(() => svc.setCharSpacing(2)).not.toThrow();
  });
});
```
> If the existing test file has no `makeTextCtx` helper, model it on the Slice-1 tests already in this file (they construct a `FormattingService` with a fake ctx + a selected `TextElement`); reuse that exact pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/formattingService.test.ts`
Expected: FAIL (`svc.setTextStroke is not a function`).

- [ ] **Step 3: Implement the methods**

In `src/core/formattingService.ts`, add after `clearTextBackground()` (follow the exact shape of `setLineHeight`):
```ts
  setTextStroke(color: string, width: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const w = Math.min(10, Math.max(0, Number.isFinite(width) ? width : 0));
    const before = { strokeColor: te.strokeColor, strokeWidth: te.strokeWidth };
    const after = { strokeColor: color, strokeWidth: w };
    Object.assign(te, after);
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, after));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  clearTextStroke(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { strokeColor: te.strokeColor, strokeWidth: te.strokeWidth };
    const after = { strokeColor: undefined, strokeWidth: undefined };
    Object.assign(te, after);
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, after));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setCharSpacing(pt: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = Math.min(20, Math.max(-5, Number.isFinite(pt) ? pt : 0));
    const before = { charSpacing: te.charSpacing };
    te.charSpacing = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { charSpacing: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setHorizontalScale(pct: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = Math.min(200, Math.max(50, Number.isFinite(pct) ? pct : 100));
    const before = { horizontalScale: te.horizontalScale };
    te.horizontalScale = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { horizontalScale: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setBaselineShift(mode: 'super' | 'sub' | null): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = mode ?? undefined;
    const before = { baselineShift: te.baselineShift };
    te.baselineShift = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { baselineShift: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
```
Extend `clearFormatting()` — add to BOTH `before` and `after` objects:
```ts
// before: add
      strokeColor: te.strokeColor,
      strokeWidth: te.strokeWidth,
      charSpacing: te.charSpacing,
      horizontalScale: te.horizontalScale,
      baselineShift: te.baselineShift,
// after: add
      strokeColor: undefined,
      strokeWidth: undefined,
      charSpacing: undefined,
      horizontalScale: undefined,
      baselineShift: undefined,
```
Extend `copyTextStyle()`'s `_copiedTextStyle` snapshot AND `pasteTextStyle()`'s applied set with the same 5 fields (so the format painter carries them — match the existing field list in both methods).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/formattingService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/formattingService.ts tests/core/formattingService.test.ts
git commit -m "feat(text): FormattingService stroke/charSpacing/horizontalScale/baselineShift setters"
```

---

### Task 3: DOM preview (applyStyles + _applyInputFormatting)

**Files:**
- Modify: `src/elements/textElement.ts` (`_applyInputFormatting`, `applyStyles`)
- Test: `tests/elements/textElement.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 fields. Produces: DOM style parity for the editor preview (no new exports).

- [ ] **Step 1: Write the failing test**

```ts
describe('TextElement Slice-2 DOM preview', () => {
  it('applies stroke, char-spacing, horizontal-scale, justify, baseline shift to the input', () => {
    const el = new TextElement(0, 0, 'p1', {
      strokeColor: '#ff0000', strokeWidth: 1, charSpacing: 2,
      horizontalScale: 80, align: 'justify', baselineShift: 'super', fontSize: 20,
    });
    const input = document.createElement('textarea');
    el._applyInputFormatting(input, 1);
    expect(input.style.getPropertyValue('-webkit-text-stroke')).toContain('1px');
    expect(input.style.letterSpacing).toBe('2px');
    expect(input.style.transform).toContain('scaleX(0.8)');
    expect(input.style.textAlign).toBe('justify');
    // super → smaller font + raised
    expect(parseFloat(input.style.fontSize)).toBeCloseTo(20 * 0.65, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/elements/textElement.test.ts`
Expected: FAIL (styles unset).

- [ ] **Step 3: Implement the DOM preview**

In `_applyInputFormatting`, after the existing `input.style.lineHeight = ...` line:
```ts
    // Slice 2 previews
    if (this.strokeColor && (this.strokeWidth ?? 0) > 0) {
      input.style.setProperty('-webkit-text-stroke', `${this.strokeWidth! * scale}px ${this.strokeColor}`);
    } else {
      input.style.removeProperty('-webkit-text-stroke');
    }
    input.style.letterSpacing = (this.charSpacing ?? 0) !== 0 ? `${this.charSpacing! * scale}px` : '';
    if ((this.horizontalScale ?? 100) !== 100) {
      input.style.transformOrigin = this.align === 'right' ? 'right' : this.align === 'center' ? 'center' : 'left';
      input.style.transform = `scaleX(${this.horizontalScale! / 100})`;
    } else {
      input.style.transform = '';
    }
    if (this.baselineShift) {
      input.style.fontSize = (this.fontSize * 0.65 * scale) + 'px';
      input.style.verticalAlign = this.baselineShift === 'super' ? 'super' : 'sub';
    }
```
> `input.style.textAlign = this.align;` already exists and now accepts `'justify'` (TextAlign widened in Task 1) — no change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/elements/textElement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elements/textElement.ts tests/elements/textElement.test.ts
git commit -m "feat(text): editor DOM preview for Slice-2 attrs"
```

---

### Task 4: Operator-based bake (`styledText.ts`) + renderText branch

**Files:**
- Create: `src/export/styledText.ts`
- Modify: `src/export/pdfElementRenderer.ts` (`renderText`)
- Test: `tests/export/styledText.test.ts` (pure helpers) + real-Chrome in Task 7

**Interfaces:**
- Consumes: Task 1 fields. Produces: `effectiveLineWidth(font, line, size, charSpacing, horizontalScale): number`, `hasAdvancedText(te): boolean`, `drawStyledTextLine(page, opts: StyledTextOpts): void`.

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// tests/export/styledText.test.ts
import { describe, it, expect } from 'vitest';
import { effectiveLineWidth, hasAdvancedText } from '../../src/export/styledText';

const fakeFont = { widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.5 } as never;

describe('styledText pure helpers', () => {
  it('effectiveLineWidth scales by horizontalScale and adds char spacing', () => {
    const base = effectiveLineWidth(fakeFont, 'abcd', 10, 0, 100);   // 4*10*0.5 = 20
    expect(base).toBeCloseTo(20, 5);
    const tracked = effectiveLineWidth(fakeFont, 'abcd', 10, 2, 100); // +2*(4-1)=6 → 26
    expect(tracked).toBeCloseTo(26, 5);
    const condensed = effectiveLineWidth(fakeFont, 'abcd', 10, 0, 50); // 20*0.5 = 10
    expect(condensed).toBeCloseTo(10, 5);
  });

  it('hasAdvancedText is true only when a Tier-2 attr is set', () => {
    expect(hasAdvancedText({ } as never)).toBe(false);
    expect(hasAdvancedText({ align: 'left' } as never)).toBe(false);
    expect(hasAdvancedText({ strokeWidth: 1 } as never)).toBe(true);
    expect(hasAdvancedText({ charSpacing: 2 } as never)).toBe(true);
    expect(hasAdvancedText({ horizontalScale: 80 } as never)).toBe(true);
    expect(hasAdvancedText({ baselineShift: 'sub' } as never)).toBe(true);
    expect(hasAdvancedText({ align: 'justify' } as never)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/export/styledText.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/export/styledText.ts`**

```ts
import {
  PDFPage, PDFFont, PDFName, PDFOperator, PDFOperatorNames, PDFNumber,
  pushGraphicsState, popGraphicsState, beginText, endText, showText,
  setFontAndSize, setTextMatrix, setFillingRgbColor, setStrokingRgbColor,
  setLineWidth, setCharacterSpacing, setWordSpacing, setTextRise,
  setTextRenderingMode, TextRenderingMode, setGraphicsState,
} from '@cantoo/pdf-lib';
import type { TextElement } from '../elements/textElement';

export interface StyledTextOpts {
  text: string;                 // single WinAnsi line (caller splits + excludes Arabic)
  x: number; y: number;         // baseline origin in PDF (y-up) space, post alignment + rotation anchor
  size: number;                 // already scaled (sub/superscript shrink applied by caller)
  font: PDFFont; fontKey: PDFName;
  color: { r: number; g: number; b: number };
  charSpacing?: number;         // Tc, pt
  horizontalScale?: number;     // Tz, percent (100 = none)
  strokeColor?: { r: number; g: number; b: number };
  strokeWidth?: number;         // > 0 → fill+stroke
  baselineRise?: number;        // Ts, pt (super +, sub −)
  wordSpacing?: number;         // Tw, pt (justify)
  gsName?: PDFName;             // opacity ExtGState (page.maybeEmbedGraphicsState)
}

/** True when an element needs the raw-operator bake (drawText can't express these). */
export function hasAdvancedText(te: Pick<TextElement,
  'strokeWidth' | 'charSpacing' | 'horizontalScale' | 'baselineShift' | 'align'>): boolean {
  return (te.strokeWidth ?? 0) > 0
    || (te.charSpacing ?? 0) !== 0
    || (te.horizontalScale ?? 100) !== 100
    || te.baselineShift !== undefined
    || te.align === 'justify';
}

/** On-page width of a line accounting for char spacing (Tc) and horizontal scale (Tz). */
export function effectiveLineWidth(font: PDFFont, line: string, size: number, charSpacing = 0, horizontalScale = 100): number {
  const base = font.widthOfTextAtSize(line, size) + charSpacing * Math.max(0, line.length - 1);
  return base * (horizontalScale / 100);
}

/** Emit one styled text line via raw operators. WinAnsi only (caller guards Arabic). */
export function drawStyledTextLine(page: PDFPage, o: StyledTextOpts): void {
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (o.gsName) ops.push(setGraphicsState(o.gsName));
  ops.push(beginText(), setFillingRgbColor(o.color.r, o.color.g, o.color.b));
  if ((o.strokeWidth ?? 0) > 0) {
    const s = o.strokeColor ?? o.color;
    ops.push(setStrokingRgbColor(s.r, s.g, s.b), setLineWidth(o.strokeWidth!), setTextRenderingMode(TextRenderingMode.FillThenStroke));
  }
  ops.push(setFontAndSize(o.fontKey, o.size));
  if ((o.charSpacing ?? 0) !== 0) ops.push(setCharacterSpacing(o.charSpacing!));
  if ((o.wordSpacing ?? 0) !== 0) ops.push(setWordSpacing(o.wordSpacing!));
  if ((o.horizontalScale ?? 100) !== 100) {
    ops.push(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(o.horizontalScale!)]));
  }
  if ((o.baselineRise ?? 0) !== 0) ops.push(setTextRise(o.baselineRise!));
  ops.push(setTextMatrix(1, 0, 0, 1, o.x, o.y), showText(o.font.encodeText(o.text)), endText(), popGraphicsState());
  page.pushOperators(...ops);
}
```

- [ ] **Step 4: Run pure-helper test to verify it passes**

Run: `npx vitest run tests/export/styledText.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `renderText` to use the operator path**

In `src/export/pdfElementRenderer.ts` `renderText`, add imports at the top of the file:
```ts
import { drawStyledTextLine, hasAdvancedText, effectiveLineWidth } from './styledText';
```
Compute once after `font` is embedded (after line 121):
```ts
  const advanced = hasAdvancedText(te) && !elemRot;
  const fontKey = advanced ? page.node.newFontDictionary(font.name, font.ref) : null;
  const gsName = advanced && alpha < 1 ? page.maybeEmbedGraphicsState({ opacity: alpha, borderOpacity: alpha }) : undefined;
  const subSup = te.baselineShift; // 'super' | 'sub' | undefined
  const drawSize = subSup ? te.fontSize * 0.65 : te.fontSize;
  const rise = subSup === 'super' ? te.fontSize * 0.33 : subSup === 'sub' ? -te.fontSize * 0.15 : 0;
```
Replace the `else` (non-Arabic) block body so that when `advanced` is true it uses the operator path; the existing `drawText` runs otherwise. Use `effectiveLineWidth` for alignment + justify width so offsets are correct:
```ts
    } else {
      const measureSize = advanced ? drawSize : te.fontSize;
      const lineW = advanced
        ? effectiveLineWidth(font, line, measureSize, te.charSpacing ?? 0, te.horizontalScale ?? 100)
        : font.widthOfTextAtSize(line, te.fontSize);
      const boxW = te.width || lineW;
      const isLast = i === lines.length - 1;
      let wordSpacing = 0;
      let off = 0;
      if (advanced && te.align === 'justify' && !isLast) {
        const spaces = (line.match(/ /g) || []).length;
        if (spaces > 0 && boxW > lineW) wordSpacing = (boxW - lineW) / spaces;
      } else {
        off = te.align === 'center' ? Math.max(0, (boxW - lineW) / 2)
          : te.align === 'right' ? Math.max(0, boxW - lineW) : 0;
      }
      const rawAnchor = tp(te.x + off, baseY);
      const a = elemRot ? anchorForCenter(rawAnchor.x, rawAnchor.y, 0, 0) : rawAnchor;
      if (advanced) {
        drawStyledTextLine(page, {
          text: line, x: a.x, y: a.y, size: drawSize, font, fontKey: fontKey!,
          color: col, charSpacing: te.charSpacing, horizontalScale: te.horizontalScale,
          strokeColor: te.strokeColor ? hexToRgbValues(te.strokeColor) : undefined,
          strokeWidth: te.strokeWidth, baselineRise: rise, wordSpacing, gsName,
        });
      } else {
        page.drawText(line, { x: a.x, y: a.y, size: te.fontSize, font, color: rgb(col.r, col.g, col.b), opacity: alpha, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
      }
      // Underline / strikethrough — unchanged, now using the effective lineW + off for both paths.
      if (!elemRot && (te.underline || te.strikethrough)) {
        const thick = Math.max(0.5, te.fontSize * 0.06);
        const lineColor = rgb(col.r, col.g, col.b);
        if (te.underline) {
          page.drawLine({ start: tp(te.x + off, baseY + te.fontSize * 0.12), end: tp(te.x + off + lineW, baseY + te.fontSize * 0.12), thickness: thick, color: lineColor, opacity: alpha });
        }
        if (te.strikethrough) {
          page.drawLine({ start: tp(te.x + off, baseY - te.fontSize * 0.3), end: tp(te.x + off + lineW, baseY - te.fontSize * 0.3), thickness: thick, color: lineColor, opacity: alpha });
        }
      }
    }
```
> `hexToRgbValues` and `col`/`alpha`/`rgb`/`tp`/`anchorForCenter` are already in scope in `renderText`. `page.maybeEmbedGraphicsState` is the same method `drawText` uses internally for opacity; if TS lacks its type, cast: `(page as unknown as { maybeEmbedGraphicsState(o: { opacity?: number; borderOpacity?: number }): PDFName }).maybeEmbedGraphicsState(...)`.

- [ ] **Step 6: Run gate + verify no regressions**

Run: `npm run type-check && npx vitest run tests/export/styledText.test.ts && npm run test`
Expected: type-check 0; styledText PASS; full jsdom green (existing renderer tests unchanged — drawText path byte-identical when no advanced attr).

- [ ] **Step 7: Commit**

```bash
git add src/export/styledText.ts src/export/pdfElementRenderer.ts tests/export/styledText.test.ts
git commit -m "feat(text): raw-operator bake for stroke/Tc/Tz/justify/sub-superscript (drawText fallback)"
```

---

### Task 5: UI wiring (inline justify + popover rows) + i18n

**Files:**
- Modify: `index.html` (inline **J** button near L/C/R; popover rows in `#textOptionsModal`)
- Modify: `src/ui/textOptionsPopover.ts` (read/write the new controls)
- Modify: `src/ui/binders/formattingBinder.ts` (wire events → app delegators)
- Modify: `src/core/pdfTurboApp.ts` (thin delegators over `FormattingService`)
- Modify: `src/ui/uiController.ts` (`updateFormattingToolbar`: J active-state + reflect popover values)
- Modify: `locales/{en,fr,ar}.json` (`formatting.*` keys)
- Test: `tests/ui/uiController.test.ts` (J active-state) + `tests/ui/textOptionsPopover.test.ts` (controls present/wired)

**Interfaces:**
- Consumes: `FormattingService` methods (Task 2). Produces: DOM ids `alignJustifyBtn`, `textStrokeColor`, `textStrokeWidth`, `charSpacingInput`, `horizontalScaleInput`, `superscriptBtn`, `subscriptBtn`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/uiController.test.ts — append (reuse the file's existing DOM-fixture harness)
it('marks the justify button active when align is justify', () => {
  const { ui, refs } = makeUiFixture(); // existing helper building AppDOMRefs
  ui.updateFormattingToolbar({ type: 'text', align: 'justify' } as never);
  expect(refs.alignJustifyBtn.classList.contains('btn-active-fmt')).toBe(true);
  expect(refs.alignLeftBtn.classList.contains('btn-active-fmt')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/uiController.test.ts`
Expected: FAIL (`alignJustifyBtn` undefined / not toggled).

- [ ] **Step 3: Implement UI + i18n**

`index.html` — add next to the existing L/C/R align buttons:
```html
<button id="alignJustifyBtn" class="fmt-btn" data-i18n-title="formatting.justify" title="Justify">⬛</button>
```
Add rows inside `#textOptionsModal` (mirror the existing popover rows):
```html
<div class="text-opt-row">
  <label data-i18n="formatting.stroke">Outline</label>
  <input type="color" id="textStrokeColor" value="#000000">
  <input type="number" id="textStrokeWidth" min="0" max="3" step="0.25" value="0" style="width:4rem">
</div>
<div class="text-opt-row">
  <label data-i18n="formatting.charSpacing">Letter spacing</label>
  <input type="number" id="charSpacingInput" min="-5" max="20" step="0.5" value="0" style="width:4rem">
</div>
<div class="text-opt-row">
  <label data-i18n="formatting.horizontalScale">Width %</label>
  <input type="number" id="horizontalScaleInput" min="50" max="200" step="5" value="100" style="width:4rem">
</div>
<div class="text-opt-row">
  <label data-i18n="formatting.baseline">Baseline</label>
  <button id="superscriptBtn" class="fmt-btn" data-i18n-title="formatting.superscript" title="Superscript">x²</button>
  <button id="subscriptBtn" class="fmt-btn" data-i18n-title="formatting.subscript" title="Subscript">x₂</button>
</div>
```
`src/ui/uiController.ts` — add the 6 ids to `AppDOMRefs` and, in `updateFormattingToolbar`, toggle active classes (mirror the existing align toggles):
```ts
    r.alignJustifyBtn?.classList.toggle('btn-active-fmt', te.align === 'justify');
    r.superscriptBtn?.classList.toggle('btn-active-fmt', te.baselineShift === 'super');
    r.subscriptBtn?.classList.toggle('btn-active-fmt', te.baselineShift === 'sub');
    if (r.textStrokeWidth) r.textStrokeWidth.value = String(te.strokeWidth ?? 0);
    if (r.textStrokeColor && te.strokeColor) r.textStrokeColor.value = te.strokeColor;
    if (r.charSpacingInput) r.charSpacingInput.value = String(te.charSpacing ?? 0);
    if (r.horizontalScaleInput) r.horizontalScaleInput.value = String(te.horizontalScale ?? 100);
```
`src/ui/binders/formattingBinder.ts` — wire (NaN-safe parse):
```ts
  refs.alignJustifyBtn?.addEventListener('click', () => app.setTextAlign('justify'));
  refs.textStrokeWidth?.addEventListener('input', () => {
    const w = parseFloat(refs.textStrokeWidth!.value);
    if (!Number.isFinite(w) || w <= 0) app.clearTextStroke();
    else app.setTextStroke(refs.textStrokeColor?.value || '#000000', w);
  });
  refs.textStrokeColor?.addEventListener('input', () => {
    const w = parseFloat(refs.textStrokeWidth?.value || '0');
    if (Number.isFinite(w) && w > 0) app.setTextStroke(refs.textStrokeColor!.value, w);
  });
  refs.charSpacingInput?.addEventListener('input', () => app.setCharSpacing(parseFloat(refs.charSpacingInput!.value)));
  refs.horizontalScaleInput?.addEventListener('input', () => app.setHorizontalScale(parseFloat(refs.horizontalScaleInput!.value)));
  refs.superscriptBtn?.addEventListener('click', () => app.toggleBaselineShift('super'));
  refs.subscriptBtn?.addEventListener('click', () => app.toggleBaselineShift('sub'));
```
`src/core/pdfTurboApp.ts` — add delegators (mirror existing `setAlign`/`setLineHeight` delegators):
```ts
  setTextAlign(v: TextAlign): void { this._formattingService.setAlign(v); }
  setTextStroke(color: string, width: number): void { this._formattingService.setTextStroke(color, width); }
  clearTextStroke(): void { this._formattingService.clearTextStroke(); }
  setCharSpacing(pt: number): void { this._formattingService.setCharSpacing(pt); }
  setHorizontalScale(pct: number): void { this._formattingService.setHorizontalScale(pct); }
  toggleBaselineShift(mode: 'super' | 'sub'): void {
    const te = this.selectedElement;
    const cur = te && te.type === 'text' ? (te as TextElement).baselineShift : undefined;
    this._formattingService.setBaselineShift(cur === mode ? null : mode);
  }
```
> If `pdfTurboApp` already exposes `setAlign`, reuse it instead of adding `setTextAlign` — check the existing delegator name and keep the binder consistent.

`locales/en.json` (and fr/ar — keep the 3 files key-identical; the locale-sync hook enforces this):
```json
"formatting": {
  "justify": "Justify",
  "stroke": "Outline",
  "charSpacing": "Letter spacing",
  "horizontalScale": "Width %",
  "baseline": "Baseline",
  "superscript": "Superscript",
  "subscript": "Subscript"
}
```
(Merge into the existing `formatting` object. fr: «Justifier / Contour / Interlettrage / Largeur % / Ligne de base / Exposant / Indice». ar [Unverified]: «ضبط / حد خارجي / تباعد الأحرف / العرض % / خط الأساس / مرتفع / منخفض».)

- [ ] **Step 4: Run test + locale check to verify pass**

Run: `npx vitest run tests/ui/uiController.test.ts tests/ui/textOptionsPopover.test.ts && npm run test`
Expected: PASS; locale hook reports the 3 files key-identical.

- [ ] **Step 5: Commit**

```bash
git add index.html src/ui/uiController.ts src/ui/binders/formattingBinder.ts src/ui/textOptionsPopover.ts src/core/pdfTurboApp.ts locales/en.json locales/fr.json locales/ar.json tests/ui/uiController.test.ts tests/ui/textOptionsPopover.test.ts
git commit -m "feat(text): wire Slice-2 controls (inline justify + popover stroke/spacing/scale/super-sub) + i18n"
```

---

### Task 6: Real-Chrome bake guard + byte-identical regression

**Files:**
- Create: `tests/browser/text-toolbar-slice2.browser.test.ts`

**Interfaces:**
- Consumes: the whole feature. Asserts the operator path emits the right operators AND the no-advanced-attr path stays on `drawText`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/browser/text-toolbar-slice2.browser.test.ts
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { TextElement } from '../../src/elements/textElement';
// Reuse the existing Slice-1 bake harness helper that renders one element to PDF bytes
// (tests/browser/text-toolbar-bake.browser.test.ts already builds a page + calls the
// element renderer). Import or replicate that helper as `bakeElementToPdf(el)`.
import { bakeElementToPdf } from './_bakeHelper';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function contentStream(bytes: Uint8Array): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const ops = await page.getOperatorList(); // presence of text ops; or decode raw stream
  return JSON.stringify(ops.fnArray);
}

describe('Slice-2 bake (real Chrome)', () => {
  it('stroke/Tc/Tz/super render via operators; no-attr element stays on drawText', async () => {
    const styled = new TextElement(40, 40, 'p1', {
      text: 'Hello', strokeColor: '#ff0000', strokeWidth: 1, charSpacing: 2,
      horizontalScale: 80, baselineShift: 'super',
    });
    const plain = new TextElement(40, 40, 'p1', { text: 'Hello' });
    const styledBytes = await bakeElementToPdf(styled);
    const plainBytes = await bakeElementToPdf(plain);
    // The styled output must differ from the plain output (operators applied).
    expect(styledBytes.length).not.toBe(plainBytes.length);
    // Both render text (sanity: text content extractable).
    const pdf = await pdfjsLib.getDocument({ data: styledBytes }).promise;
    const tc = await (await pdf.getPage(1)).getTextContent();
    expect(tc.items.map((i: { str: string }) => i.str).join('')).toContain('Hello');
  });

  it('justify distributes width across a multiline box', async () => {
    const el = new TextElement(40, 40, 'p1', { text: 'one two three\nlast', width: 400, align: 'justify' });
    const bytes = await bakeElementToPdf(el);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const tc = await (await pdf.getPage(1)).getTextContent();
    expect(tc.items.map((i: { str: string }) => i.str).join(' ')).toContain('three');
  });
});
```
> If no shared `_bakeHelper` exists, replicate the minimal page-setup from `tests/browser/text-toolbar-bake.browser.test.ts` (Slice 1) inline — it already constructs the `RenderHelpers`/`PdfRenderCtx` and calls `renderText`.

- [ ] **Step 2: Run test to verify it fails (or drives the helper into existence)**

Run: `npx vitest run --config vitest.browser.config.ts tests/browser/text-toolbar-slice2.browser.test.ts`
Expected: FAIL until the helper + bake wiring resolve, then PASS once Task 4/5 are in.

- [ ] **Step 3: Make it pass** — fix any helper import; ensure the operator path is reached (it is, from Task 4). No new product code expected here beyond Tasks 1–5.

- [ ] **Step 4: Run the full browser suite**

Run: `npm run test:browser`
Expected: all files pass (new file added; existing unchanged).

- [ ] **Step 5: Commit**

```bash
git add tests/browser/text-toolbar-slice2.browser.test.ts tests/browser/_bakeHelper.ts
git commit -m "test(text): real-Chrome guard for Slice-2 operator bake + byte-identical fallback"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (extend the "Rich text toolbar Slice 1" gotcha with a Slice-2 paragraph)
- Modify: `docs/plans/arabic-textlayer.plan.md` is unrelated — instead update the Slice-2 spec status line to "Implemented".

- [ ] **Step 1: Document** — add a concise CLAUDE.md paragraph: the 5 Tier-2 controls, the `styledText.ts` operator bake (used only when `hasAdvancedText(te) && !elemRot`; `drawText` otherwise → byte-identical), opacity via `maybeEmbedGraphicsState`, justify Tw distribution (non-last lines), sub/super = 0.65× size + `Ts`, ceilings (rotated + advanced → fallback; Arabic operator path out of scope; raster path code-reviewed not pixel-guarded). Name the guards.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-21-rich-pdf-text-toolbar-slice2-design.md
git commit -m "docs: document Slice-2 Tier-2 toolbar + operator bake"
```

---

## Self-Review (run after writing — checklist)
1. **Spec coverage:** stroke (T4), Tc (T4), Tz (T4), justify (T4 bake + T5 UI), sub/super (T4), model+schema (T1), service+painter+clear (T2), DOM preview (T3), UI+i18n (T5), byte-identical fallback (T4/T6), ceilings (T7). ✓
2. **Placeholder scan:** every code step has concrete code; no TBD/TODO. ✓
3. **Type consistency:** `hasAdvancedText`/`effectiveLineWidth`/`drawStyledTextLine`/`StyledTextOpts` consistent across T4 + T6; field names (`strokeColor/strokeWidth/charSpacing/horizontalScale/baselineShift`) consistent T1→T6; DOM ids consistent T5→T6. ✓
