# Feature 2 — Overlay-text lists — Implementation Plan

**Goal:** Bullet/numbered lists on overlay `TextElement` (editor + all export paths).
**Tech:** TS, @cantoo/pdf-lib bake, jsdom + real-Chrome tests. TDD throughout.

## Global Constraints
- No `SCHEMA_VERSION` bump (`list` is optional, omitted-when-unset).
- Markers: `'• '` (bullet) / `'N. '` (ordered, 1-based over non-empty lines).
- One feature commit (spec + plan + code + tests). No Co-Authored-By. Push manual.
- Full gate per commit: `type-check && lint && test && test:browser && build`.

---

### Task 1: pure `listMarkers.ts`
- Test `tests/utils/listMarkers.test.ts`: `listMarker`/`applyListMarkers` (bullet, ordered ordinals over non-empty, blank pass-through, empty string).
- Create `src/utils/listMarkers.ts` per spec. Run jsdom file → pass.

### Task 2: model + factory + toJSON
- `textElement.ts`: `list?: ListType` field + `TextOptions.list` + constructor `options.list`; `toJSON` spreads `...(this.list ? { list: this.list } : {})`.
- `elementFactory.ts`: `list: data['list'] === 'bullet' || data['list'] === 'ordered' ? data['list'] : undefined`.
- Test in `tests/elements/textElement.test.ts`: omit-when-unset, include-when-set, factory round-trip.

### Task 3: FormattingService setListType/toggleList + app delegator
- `formattingService.ts`: `setListType(kind|null)`, `toggleList(kind)` (MoveResizeCmd `{list}`); add `list` to `clearFormatting` before/after + copy/paste field set.
- `pdfTurboApp.ts`: `toggleListType(kind)` thin delegator.
- Test `tests/core/formattingService.test.ts`: set/clear/toggle, undoable, no-op w/o text selection.

### Task 4: bake markers in renderText
- `pdfElementRenderer.ts:171`: `const lines = te.list ? applyListMarkers(te.text, te.list) : te.text.split('\n');` + import.
- Browser test `tests/browser/text-list.browser.test.ts`: bullet+ordered export → pdf.js text has `•`/`1.`/`2.`; unset control has none.

### Task 5: editor gutter
- `textElement.ts render()`: when `this.list`, append `.text-list-gutter` div (markers, shared metrics, `pointer-events:none`), set input `padding-left`; `input` listener rebuilds gutter.
- CSS `.text-list-gutter` in the elements stylesheet.
- jsdom test in `tests/elements/textElement.test.ts`: gutter present + contains `•` when bullet; absent when unset.

### Task 6: UI wiring + i18n
- `index.html`: `#bulletListBtn` (•) + `#numberedListBtn` (1.) in the Text ⋮ popover Slice-2 area.
- `uiController.ts` AppDOMRefs: add the two refs; `updateFormattingToolbar` toggles `btn-active-fmt` per `te.list`.
- `textOptionsPopover.ts`: wire clicks → `svc.toggleList(...)`.
- `locales/{en,fr,ar}.json`: `formatting.bulletList` / `formatting.numberedList`.
- Tests `tests/ui/{textOptionsPopover,uiController}.test.ts`: wired + active-state.

### Final: full gate, one commit, visual screenshot (qa-shots/f2-lists/).
