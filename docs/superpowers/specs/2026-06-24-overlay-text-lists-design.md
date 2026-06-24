# Feature 2 — Overlay-text bullet / numbered lists (design)

**Date:** 2026-06-24  **Status:** approved (autonomous-design mode)  **Program:** feature-program-2026-06-24

## Goal

Let a user turn an overlay `TextElement` into a **bullet** or **numbered** list. Each
`\n`-separated line becomes a list item; the marker (`• ` or `1. `, `2. `…) is rendered
in the editor and baked into every export path. One item per `\n`-line (the overlay bake
already treats `\n`-lines as the unit and does not auto-wrap — lists inherit that model).

## Non-goals (v1 ceiling — documented)

- Nested / multi-level lists (one flat level).
- Custom marker styles (a/A/i, custom bullets, start-at-N).
- RTL/Arabic marker placement nuance — the marker still prefixes the logical string; precise
  right-edge marker placement for Arabic items is deferred.
- Hanging indent for visually-wrapped lines (the overlay bake never wraps, so N/A).

## Data model

`TextElement.list?: 'bullet' | 'ordered'` — OPTIONAL, **no `SCHEMA_VERSION` bump**.
- `toJSON()` omits the key when unset (matches every other Slice-1/2 optional attr).
- `elementFactory.fromJSON` reads it with a type guard (`=== 'bullet' || === 'ordered'` else `undefined`) → legacy blobs restore unchanged.
- Added to `TextOptions`, `clearFormatting` (reset → `undefined`), and the format-painter copy/paste field set.

## Pure core — `src/utils/listMarkers.ts`

```ts
export type ListType = 'bullet' | 'ordered';

/** The marker string for one item. ordinal is 1-based (ignored for bullets). */
export function listMarker(kind: ListType, ordinal: number): string {
  return kind === 'bullet' ? '• ' : `${ordinal}. `;
}

/**
 * Split text on '\n' and prefix each NON-EMPTY line with its marker.
 * Ordered ordinals count only non-empty lines (1-based). Empty lines pass through as ''
 * (the bake skips them; they do not advance the ordinal). Never throws.
 */
export function applyListMarkers(text: string, kind: ListType): string[] {
  const out: string[] = [];
  let ord = 0;
  for (const line of text.split('\n')) {
    if (line.length === 0) { out.push(''); continue; }
    ord += 1;
    out.push(listMarker(kind, ord) + line);
  }
  return out;
}
```

- `•` (•) is WinAnsi 0x95 → Helvetica/StandardFonts draw it; no font work needed.

## Export bake — `src/export/pdfElementRenderer.ts` `renderText`

One line changes the line source:

```ts
const lines = te.list ? applyListMarkers(te.text, te.list) : te.text.split('\n');
```

Everything downstream (`if (!line) continue`, width measure, align offset, underline/strike,
advanced operator path, Arabic branch) operates on the marked line unchanged. Because the
redaction-raster path also draws overlays through `buildPageOverlays` → `renderText`, both
export paths get markers from this single edit. Byte-identical when `list` is unset.

## Editor preview — `src/elements/textElement.ts`

A non-editable **marker gutter** so the editor is WYSIWYG (no fragile prefix-and-strip on the
live value — that risks eating user content like a line typed as "3. foo"):

- When `this.list` is set, `render()` appends `<div class="text-list-gutter">` (sibling of the
  input, `pointer-events:none`, `white-space:pre`), and the input gets `padding-left` =
  a fixed marker column (`1.4em` bullet / `2.0em` ordered).
- The gutter text = the per-line markers (`applyListMarkers` markers only, one per line) and
  shares the input's `fontSize·scale`, `fontFamily`, `color`, `lineHeight`.
- An `input` listener rebuilds the gutter on every keystroke (line count changes → markers
  re-number). Vertical scroll-sync is out of scope (overlay boxes rarely overflow); documented.
- CSS `.text-list-gutter` added to the elements stylesheet.

## Service — `src/core/formattingService.ts`

```ts
setListType(kind: ListType | null): void   // null clears
toggleList(kind: ListType): void            // re-click active kind → clear
```

Both early-return unless a `text` element is selected; both record a `MoveResizeCmd`
(`{ list: <before> }` → `{ list: <after> }`), then `rebuildElementLayer()` + `autosave()`
(identical shape to `setBaselineShift`). `app.toggleListType(kind)` delegator on `pdfTurboApp`.

## UI

- Two toggle buttons in the **Text ⋮** popover (`index.html`, in the Slice-2 area):
  `#bulletListBtn` (•) and `#numberedListBtn` (1.). Added to `AppDOMRefs`.
- `textOptionsPopover.ts` wires each click to `svc.toggleList('bullet'|'ordered')`.
- `uiController.updateFormattingToolbar` adds `btn-active-fmt` to the button matching
  `te.list` (and clears both when unset). Tests that build refs from a partial DOM must seed
  the two ids (the rtlBtn-style gotcha).
- i18n `formatting.bulletList` / `formatting.numberedList` in en/fr/ar (ar [Unverified],
  flagged for native review). No feature flag (additive core-toolbar improvement).

## Tests

- `tests/utils/listMarkers.test.ts` — pure: bullet/ordered markers, ordinal counts non-empty
  only, blank lines pass through, multi-line, empty string.
- `tests/core/formattingService.test.ts` — `setListType`/`toggleList` set+clear, undoable,
  no-op without a text selection.
- `tests/ui/textOptionsPopover.test.ts` + `tests/ui/uiController.test.ts` — buttons wired;
  active-state reflects `te.list`.
- `tests/elements/textElement.test.ts` — `toJSON` omits when unset / includes when set;
  factory round-trip; gutter present with markers when `list` set, absent otherwise.
- `tests/browser/text-list.browser.test.ts` — real Chrome: a 2-line bullet and a 2-line
  ordered overlay export → pdf.js text content contains `•`/`1.`/`2.`; an unset control has
  none (catches a silent regression).

## Gate (every commit)

`npm run type-check && npm run lint && npm run test && npm run test:browser && npm run build`
— the full CI-equivalent. One commit for the feature. No Co-Authored-By. Push manual.
