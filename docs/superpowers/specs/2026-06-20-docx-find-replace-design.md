# DOCX-Editor Find/Replace — Design Spec

> Slice C feature #2 (first half). Find/replace **inside the Track-B DOCX editor**
> (`src/docx/*`, ProseMirror). A separate brainstorm→spec→plan covers the PDF
> true-edit find/replace follow-up ("DOCX first, PDF after").

**Date:** 2026-06-20
**Status:** Approved design — ready for implementation plan.

## Goal

Add a Word/Google-Docs-style find & replace bar to the DOCX editor: find text
(plain, case-sensitive, whole-word, and regex), see all matches highlighted with
the active one emphasized and an "n of m" counter, navigate Next/Prev, and Replace
/ Replace-all. Lossless — operates on the live ProseMirror document, inheriting no
glyph/font ceilings (those belong to the PDF follow-up).

## Constraints (verbatim, project-wide)

- **No new runtime dependency.** Uses ProseMirror (already present) only.
- **No new feature flag.** Rides the existing `VITE_FEATURE_DOCX_EDIT` (#28 seam) —
  the find/replace bar exists only inside the DOCX editor, which is itself flagged.
- **i18n:** every user-visible string goes through `t()`; new `findReplace.*` keys
  added to **all three** locales (en/fr/ar key-identical). Arabic values are
  `[Unverified]` — flagged for native review (standing project rule).
- **TS strict / oxlint zero-warning:** no `any`, no non-null `!`, `_`-prefix for
  unused/private (project convention).
- **jsdom + real-Chrome dual testing:** pure logic covered by `npm run test`
  (jsdom); decoration paint + keyboard + selection covered by a real-Chrome
  `tests/browser/*.browser.test.ts`.

## Architecture

Four units, each one responsibility, communicating through explicit interfaces.

### 1. `src/docx/findReplace.ts` — pure matching core

```ts
export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}
export interface FindMatch {
  from: number;        // ProseMirror doc position (inclusive)
  to: number;          // ProseMirror doc position (exclusive)
  groups?: string[];   // regex capture groups (regex mode only)
}
export type FindResult =
  | { ok: true; matches: FindMatch[] }
  | { ok: false; error: 'invalid-regex' | 'empty-query' };

/** Find every match of `query` in `doc`, searched per textblock. */
export function findMatches(doc: PMNode, query: string, opts: FindOptions): FindResult;

/** Expand `$1`/`$2`… capture refs in a replacement template (regex mode). */
export function expandReplacement(template: string, groups: string[] | undefined): string;
```

- **Per-textblock matching:** walk `doc.descendants`; for each textblock, take its
  `textContent` and the node's start position `pos`. Run the matcher against the
  block string, map each string offset → doc position (`pos + 1 + offset` — `+1`
  for the block's open token). Cross-run / cross-mark matches Just Work because we
  match the *flattened block string*, not per-text-node.
- **Plain mode:** `caseSensitive ? indexOf : toLowerCase().indexOf`, looped for all
  occurrences (advance past each hit; zero-length impossible in plain mode).
  `wholeWord` → reject a hit whose neighbouring char is `\w`.
- **Regex mode:** compile `new RegExp(query, caseSensitive ? 'g' : 'gi')` inside
  try/catch → `{ ok:false, error:'invalid-regex' }` on throw. `wholeWord` wraps the
  pattern `\b(?:…)\b`. Guard against zero-length matches (advance `lastIndex` by 1)
  to avoid infinite loops. Capture groups stored on the match.
- **Empty query** → `{ ok:false, error:'empty-query' }` (clears the bar; no matches).
- **Ceiling (documented):** matches never cross a textblock boundary; regex `^`/`$`
  anchor per block, not per document.

### 2. `src/docx/findReplacePlugin.ts` — ProseMirror plugin (state + decorations + commands)

```ts
export interface FindReplaceState {
  active: boolean;
  query: string;
  replacement: string;
  opts: FindOptions;
  matches: FindMatch[];
  activeIndex: number;     // -1 when no matches
  error: 'invalid-regex' | null;
}
export const findReplaceKey: PluginKey<FindReplaceState>;
export function findReplacePlugin(): Plugin;

// Commands (each (state, dispatch?) => boolean):
export function openFindReplace(withReplace: boolean): Command;
export function closeFindReplace(): Command;
export function setFindQuery(query: string, opts: FindOptions): Command;
export function setReplacement(text: string): Command;
export function findNext(): Command;
export function findPrev(): Command;
export function replaceCurrent(): Command;
export function replaceAll(): Command;
```

- Plugin state recomputes `matches` whenever query/opts change or the doc changes
  (recompute in `apply` on the relevant meta or when `tr.docChanged`). `activeIndex`
  clamps into range after recompute.
- **Decorations:** a `DecorationSet` of `Decoration.inline(from,to,{class:'fr-match'})`
  for every match and `'fr-match fr-match-active'` for `activeIndex`. Built from
  plugin state in the `decorations` prop; empty set when `active` is false.
- **`replaceCurrent`:** delete `[from,to)` of the active match and insert the
  (capture-expanded) replacement **with the stored mark-set at `from`** (marks of
  the match's first character — "inherit match start"). One transaction → one undo
  step. Recompute after; keep `activeIndex` pointing at the next match.
- **`replaceAll`:** apply every match **right-to-left** (descending `from`) in ONE
  transaction so earlier positions never shift mid-apply → one undo step for the
  batch. Each replacement uses its own match-start marks.

### 3. `src/docx/findReplaceBar.ts` — the UI bar

```ts
export interface FindReplaceBar {
  dom: HTMLElement;
  open(withReplace: boolean): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}
export function buildFindReplaceBar(view: EditorView): FindReplaceBar;
```

- DOM: find `<input>`, replace `<input>` (shown only in replace mode), three toggle
  buttons (case `Aa`, whole-word, regex `.*`), ▲▼ prev/next, a `n of m` counter
  `<span>`, **Replace**, **Replace all**, **✕** close. All labels via
  `t('findReplace.*')`.
- Wiring: find input → `setFindQuery`; toggles flip the matching `FindOptions` field
  and re-run; ▲▼ → `findPrev`/`findNext`; Replace → `replaceCurrent`; Replace all →
  `replaceAll`; ✕ → `close`. Counter + error read
  `findReplaceKey.getState(view.state)`. Invalid regex → red find field +
  `findReplace.invalidRegex` title, counter shows `0`.
- Keyboard while the find field is focused: `Enter` = next, `Shift+Enter` = prev.
- CSS: a new `.fr-bar` family in `modals.css`, reusing the `.docx-editor-*`
  variables; `.fr-match` (translucent yellow) + `.fr-match-active` (solid).

### 4. Wiring — `src/docx/docxProseMirror.ts` + `src/docx/docxEditorController.ts`

- `mountDocxEditor` adds `findReplacePlugin()` to `plugins` and a
  `keymap({ 'Mod-f': …, 'Mod-h': … })` whose commands open the bar (the keymap
  command calls back into the handle/bar to open + focus). `DocxEditorHandle` gains
  `findReplaceBar?: HTMLElement` (mirrors `toolbarDom`), built in the lazy chunk.
- `docxEditorController.ts` mounts `findReplaceBar` inside the editor modal and tears
  it down in cleanup. Modal `Esc` closes the bar first when open, only closing the
  modal once the bar is shut.

## Data flow

```
Mod-f / Mod-h ─▶ openFindReplace ─▶ bar.open() + plugin.active=true
find input ─▶ setFindQuery(q,opts) ─▶ findMatches() ─▶ plugin.matches + decorations
▲▼ / Enter ─▶ findNext/Prev ─▶ activeIndex±1 ─▶ decorations repaint + scrollIntoView
Replace ─▶ replaceCurrent ─▶ tx(delete+insert @ match-start marks) ─▶ recompute
Replace all ─▶ replaceAll ─▶ one tx, matches applied desc(from) ─▶ recompute (0 left)
Esc / ✕ ─▶ closeFindReplace ─▶ active=false ─▶ decorations cleared
```

## Error handling

- Invalid regex → typed `invalid-regex`; surfaced in the bar (red field, 0 count);
  never throws into the transaction pipeline.
- Empty query → no matches, no decorations, blank counter.
- Doc edited while bar open → matches recompute on the transaction; `activeIndex`
  re-clamped so Next/Prev never point out of range.
- Replace with `activeIndex === -1` → no-op (`Command` returns false).

## Testing

- `tests/docx/findReplace.test.ts` (jsdom, pure): plain/case/whole-word/regex
  matching incl. cross-mark spans; capture-group expansion; invalid-regex →
  `{ok:false}`; whole-word boundary rejection; per-block boundary (no cross-para
  match).
- `tests/docx/findReplacePlugin.test.ts` (jsdom): build a doc, set query, assert
  match count + activeIndex cycling; `replaceCurrent` inherits match-start marks;
  `replaceAll` is one undo step and applies right-to-left; doc-edit recompute
  clamps activeIndex.
- `tests/browser/docx-find-replace.browser.test.ts` (real Chrome): mount editor,
  open via Mod-f, type a query, assert decorations paint all matches + active class,
  Enter cycles, Replace/Replace-all mutate the doc, and a bold match's replacement
  stays bold (match-start inheritance) through a save→reopen OPC round-trip.

## Documented ceilings (v1)

1. Matches do not cross textblock (paragraph) boundaries; regex anchors per block.
2. Replacement formatting = match-start marks only (mixed-format matches collapse).
3. Table-cell text is not searched (tables aren't in the PM model until feature #3).
4. No "preserve case" smart-replace, no replace-within-selection scope (v1b).
5. PDF find/replace is out of scope — separate spec/plan ("DOCX first, PDF after").
