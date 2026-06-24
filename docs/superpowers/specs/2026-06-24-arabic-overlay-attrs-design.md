# Feature 4 — stroke / Tc / Tz on the Arabic overlay (design)

**Date:** 2026-06-24  **Status:** approved (autonomous-design mode)  **Program:** feature-program-2026-06-24

## Goal

The Slice-2 advanced text attrs **stroke width**, **character spacing (Tc)**, and **horizontal
scale (Tz)** are applied to Latin/WinAnsi overlay text (via `styledText.drawStyledTextLine`) but
were IGNORED on the Arabic overlay path (`arabicOverlay.ts`) — a documented ceiling. Feature 4
makes those three attrs take effect on shaped RTL Arabic text in the export bake.

## Scope / non-goals (ceiling)

- ONLY stroke / Tc / Tz. `baselineShift` (super/sub) and `justify` stay Latin-only for Arabic
  (super/sub rise + Tw justification on shaped CID runs is out of v1 scope).
- Mixed Arabic+Latin lines (`drawBidiLine`): the attrs apply to the **Arabic (Noto) runs**; the
  Latin runs keep `page.drawText` (no Tc/Tz/stroke) — documented partial, consistent with the
  existing "Noto vs Helvetica per run" split.
- Tc width for shaped CID text is approximated from the shaped **glyph count** (cidHex.length/4),
  not `text.length` (the 2-byte CIDs are the real glyph units).

## Core — `src/export/arabicOverlay.ts`

1. `ArabicLineOpts` gains optional `charSpacing?`, `horizontalScale?`, `strokeWidth?`.

2. New PURE exported helper (jsdom-testable — pdf-lib operator classes load in jsdom; no font
   fetch needed):

```ts
export interface ArabicRunStyle { charSpacing?: number; horizontalScale?: number; strokeWidth?: number; }

/** Operator list for ONE shaped Arabic run. Byte-identical to the prior emission when style is empty. */
export function buildArabicRunOps(
  fontKey: PDFName, hex: string, x: number, y: number, size: number,
  color: { r: number; g: number; b: number }, style: ArabicRunStyle = {},
): PDFOperator[]
```

   Order (mirrors `drawStyledTextLine`, so the no-style path is byte-identical to today):
   `q · BT · rg(fill) · [stroke: RG(=fill) · w · Tr 2] · Tf · [Tc] · [Tz] · Tm · Tj · ET · Q`.
   Stroke uses `TextRenderingMode.FillAndOutline` (mode 2) with the stroke colour = the fill
   colour (same "outline = fill colour" rule as Slice 2). Tz via
   `PDFOperator.of(SetTextHorizontalScaling, [pct])`.

3. PURE width helper for right-alignment:

```ts
export function effectiveArabicWidth(baseWidth: number, glyphCount: number, charSpacing = 0, horizontalScale = 100): number {
  return (baseWidth + charSpacing * Math.max(0, glyphCount - 1)) * (horizontalScale / 100);
}
```

4. `drawArabicLine` (pure-Arabic) + the RTL branch of `drawBidiLine` build their ops via
   `buildArabicRunOps` and compute `startX`/`cx` from `effectiveArabicWidth` (glyphCount =
   `hex.length / 4`). When no attrs are set, output is byte-identical (regression-guarded).

## Wire-up — `src/export/pdfElementRenderer.ts`

The Arabic branch of `renderText` passes `te.charSpacing`, `te.horizontalScale`, `te.strokeWidth`
into `drawArabicLine`. (These already exist on `TextElement` from Slice 2.) No gating change —
an Arabic line with none of the three set is byte-identical.

## Tests

- `tests/export/arabicOverlay.test.ts` (jsdom) — `buildArabicRunOps`: no-style op sequence
  (q/BT/rg/Tf/Tm/Tj/ET/Q, no stroke/Tc/Tz); stroke → `setTextRenderingMode` + `w` present;
  Tc → `setCharacterSpacing`; Tz → the horizontal-scale operator. `effectiveArabicWidth` math.
- `tests/browser/arabic-overlay.browser.test.ts` (real Chrome) — extend: render Arabic text with
  `strokeWidth>0` and assert the page op list contains `setTextRenderingMode` (mode 2) — ABSENT
  for a plain Arabic control (catches a silent regression to the no-attr path); render with
  `horizontalScale` and assert ink width changes vs the control.

## Gate (one commit)

`npm run type-check && lint && test && test:browser && build`. No Co-Authored-By. Push manual.
