# True-PDF Restyle — Honest Font-Substitution Labeling (Phase 2 Slice B) — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature flag:** rides existing `trueEdit` (#28 seam) — no new flag, no new dependency.

## Problem

The safe-subset true-PDF restyle is **already wired**: the inline true-edit editor
(`src/handlers/textEditHandler.ts`) enables the main toolbar (bold / italic / font-size /
font-family / color) while editing real PDF text and, on commit, applies the change via
in-stream ops (`changeSizeAt` / `changeColorAt`) or a full `replaceTextAt(..., style)`.

The gap is **honesty, not UI**. When a restyle (a family change, or a bold/italic toggle on
embedded text) can only be realized by `replaceTextAt`'s **Path 3** — blanking the original and
redrawing in a base-14 standard font (Helvetica / Times / Courier) — the original embedded glyphs
are replaced **silently**. The user gets no signal that the font was substituted. There is no
"font substituted" string anywhere in `locales/` today. This clashes with the project's
honest-fallback ethos (`toast.trueEditOverlay` already exists for the overlay case) and risks a
fidelity surprise the feasibility note explicitly warned about.

This slice makes the existing base-14 substitution **honest** — it does NOT remove the ceiling
(arbitrary in-place font embedding is a separate, larger effort and still wouldn't be lossless).

## Scope

In scope:
1. Engine reports **which path** a successful `replaceTextAt` took (font kept vs substituted).
2. A post-commit toast when (and only when) a substitution actually occurred.
3. jsdom + real-Chrome guards over the restyle commit branches.
4. A bounded audit of the `commit()` restyle branches; any defect found → its own TDD fix.

Out of scope (documented ceilings, unchanged): arbitrary in-place font embedding; restyle of
Arabic / CJK / Cyrillic / Form-XObject / rotated-sheared-CTM / Type3 text (these already refuse →
overlay); naming the exact base-14 family in the toast (deferred nicety — would widen the engine
contract).

## Architecture

Three small, well-bounded changes plus tests. No new module; no new dependency; no new flag.

### 1. Engine contract — `src/utils/contentStreamEditor.ts`

Change `replaceTextAt`'s return type from `Promise<boolean>` to
`Promise<false | true | 'substituted'>`:

- **Path 1** (literal byte-swap, standard font) → `true` — original font kept.
- **Path 2** (subset glyph reuse via ToUnicode) → `true` — original font kept.
- **Path 3** (standard-font redraw, the `setPageContent(...)+redraw` branch) → `'substituted'`.
- **All refuse paths** (`!found`, Type3 / invisible / vertical, Form XObject, Arabic, non-WinAnsi,
  Path-3 build throw) → `false`.

**Why `true` (not `'inplace'`) for the font-kept paths:** keeping the literal `true` return for
Path 1/2 leaves the ~12 existing `expect(ok).toBe(true)` assertions in `contentStreamEditor.test.ts`
green (only the few Path-3 cases change to `'substituted'`), minimising blast radius. The behaviour
— a toast only when substitution happened — is identical to the three-string variant.

**Backward compatibility:** `false` stays falsy and both `true`/`'substituted'` are truthy, so the
single production caller's `if (!ok)` guard and every pixel-based browser guard keep working
unchanged. Only the type annotation and the substitution-branch check are new.

### 2. Handler — `src/handlers/textEditHandler.ts`

In `commit()`, the full-replacement branch already does `const ok = await replaceTextAt(...)`.
Rename to `const result` and:

- `if (!result)` → existing overlay fallback (unchanged).
- After `_applySourcePdfEdit` succeeds: toast `trueEditFontSubstituted` when
  `result === 'substituted'`, else `trueTextEdited`.

The delete path (`deleteTextAt`) and the size/color-only in-stream path (`changeSizeAt` /
`changeColorAt`, which keep the original font) are **not touched** — they keep `trueTextDeleted` /
`trueTextEdited`, so no spurious substitution warning fires when the font was preserved.

### 3. i18n — `locales/{en,fr,ar}.json`

New key `toast.trueEditFontSubstituted`, key-identical across all three files:
- en: `"Font substituted — the original font couldn't be kept in place; the text was redrawn in a standard font. Ctrl+Z to undo."`
- fr: `"Police remplacée — la police d'origine n'a pas pu être conservée ; le texte a été redessiné dans une police standard. Ctrl+Z pour annuler."`
- ar: `[Unverified]` machine translation — flagged for native review.

## Data flow

```
user edits text + changes family/bold/italic in toolbar
  → commit() builds TextStyle
  → replaceTextAt(..., style)
       Path 1/2 succeed (no restyle requested) → true
       restyle requested → forced Path 3 → 'substituted' | false(refuse)
  → result === 'substituted' ? toast.trueEditFontSubstituted : toast.trueTextEdited
  → false ? overlay fallback (unchanged)
```

## Error handling

No new failure modes. A Path-3 build throw still returns `false` (F9 guarantee: original
untouched), routing to the overlay fallback exactly as today.

## Testing

- **jsdom `tests/utils/contentStreamEditor.test.ts`** — `replaceTextAt` returns `true` for a
  standard-font literal edit (Path 1); `'substituted'` for a forced restyle on a standard font
  (Path 3); `false` for a Form-XObject refuse.
- **jsdom `tests/handlers/textEditHandler.test.ts`** — substitution toast fires on a `'substituted'`
  result; `trueTextEdited` (not substitution) on `true`; neither substitution path on delete
  or size/color-only edits.
- **real-Chrome `tests/browser/trueedit-restyle.browser.test.ts`** — on a fixture with embedded
  text: toggling bold (or changing family) re-renders with a base-14 substitute (text still
  pdf.js-extractable) AND surfaces the substitution toast; a size-only control keeps the original
  font and shows no substitution toast.

## Verification

`npm run type-check && npm run lint && npm run test && npm run test:browser` all green; the two
pre-existing `it.fails` blocker tests remain the only expected failures.

## Ceiling (unchanged, documented)

Base-14 substitution is the structural ceiling for client-side in-place restyle: a font NAME maps
only to the Helvetica/Times/Courier families; arbitrary embedded fonts are not re-embedded. Arabic,
CJK/Cyrillic, Form-XObject, rotated/sheared, Type3, and encrypted text refuse → overlay. This slice
labels the substitution; it does not eliminate it.
