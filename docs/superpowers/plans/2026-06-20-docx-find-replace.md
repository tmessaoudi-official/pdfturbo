# DOCX-Editor Find/Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development per task. Steps use `- [ ]`.

**Goal:** Word-style find & replace inside the Track-B DOCX editor.

**Architecture:** pure core (`findReplace.ts`) → PM plugin (`findReplacePlugin.ts`, state+decorations+commands) → bar UI (`findReplaceBar.ts`) → wiring in `docxProseMirror.ts` + `docxEditorController.ts`. Spec: `docs/superpowers/specs/2026-06-20-docx-find-replace-design.md`.

**Tech Stack:** TypeScript, ProseMirror (model/state/view/keymap), Vite, vitest (jsdom + real-Chrome).

## Global Constraints
- No new runtime dependency. No new feature flag (rides `VITE_FEATURE_DOCX_EDIT`).
- i18n keys `findReplace.*` in en/fr/ar (key-identical; ar `[Unverified]`).
- TS strict, oxlint zero-warning, `_`-prefix for unused/private. No `any`, no `!`.
- Pure logic → jsdom test; decoration/keyboard/selection → real-Chrome test.

---

### Task 1: pure matching core — `findReplace.ts`
**Files:** Create `src/docx/findReplace.ts`; Test `tests/docx/findReplace.test.ts`.
**Produces:** `FindOptions`, `FindMatch`, `FindResult`, `findMatches(doc,query,opts)`, `expandReplacement(template,groups)`.
- [ ] Tests: plain match (multi), case toggle, whole-word boundary reject, regex + capture, invalid-regex → `{ok:false,error:'invalid-regex'}`, empty → `{ok:false,error:'empty-query'}`, cross-mark span (one match over bold+plain), per-block boundary (no cross-paragraph match), `expandReplacement('$1-$2',['a','b'])==='a-b'`.
- [ ] Implement per-textblock walk + offset→pos map; plain/regex matchers; zero-length guard.
- [ ] Run jsdom; commit.

### Task 2: plugin — `findReplacePlugin.ts`
**Files:** Create `src/docx/findReplacePlugin.ts`; Test `tests/docx/findReplacePlugin.test.ts`.
**Consumes:** Task 1. **Produces:** `findReplaceKey`, `findReplacePlugin()`, commands `openFindReplace/closeFindReplace/setFindQuery/setReplacement/findNext/findPrev/replaceCurrent/replaceAll`.
- [ ] Tests: setFindQuery → matches+activeIndex 0; findNext/Prev wrap; replaceCurrent inherits match-start marks + advances; replaceAll one undo step + right-to-left correctness; doc-edit recompute clamps activeIndex; close clears.
- [ ] Implement PluginState `apply` (meta-driven recompute + docChanged recompute), `decorations` prop, commands.
- [ ] Run jsdom; commit.

### Task 3: bar UI — `findReplaceBar.ts` + CSS
**Files:** Create `src/docx/findReplaceBar.ts`; Modify `src/styles/modals.css`; Test in `tests/docx/findReplaceBar.test.ts` (jsdom: open/close/isOpen/toggle wiring, counter text).
**Consumes:** Task 2. **Produces:** `buildFindReplaceBar(view)` → `{dom,open,close,isOpen,update,destroy}`.
- [ ] Tests: open(false) shows find only; open(true) shows replace; isOpen; typing dispatches setFindQuery (counter reflects); ✕ closes; invalid-regex adds error class.
- [ ] Implement DOM + listeners + `update()` reading `findReplaceKey.getState`.
- [ ] `.fr-bar`/`.fr-match`/`.fr-match-active` CSS. Run jsdom; commit.

### Task 4: wiring — `docxProseMirror.ts` + `docxEditorController.ts` + i18n
**Files:** Modify `src/docx/docxProseMirror.ts`, `src/docx/docxEditorController.ts`, `locales/{en,fr,ar}.json`; Test: extend `tests/docx/docxEditorController.test.ts` if present (bar mounts) + real-Chrome `tests/browser/docx-find-replace.browser.test.ts`.
**Consumes:** Tasks 2,3.
- [ ] Add `findReplacePlugin()` + Mod-f/Mod-h keymap (open bar via mutable ref); add `findReplaceBar?` to `DocxEditorHandle`; centralize dispatchTransaction to update toolbar+bar; destroy bar.
- [ ] Controller mounts `findReplaceBar` in modal, tears down.
- [ ] i18n `findReplace.*` in 3 locales.
- [ ] Browser test: Mod-f opens, decorations paint all+active, Enter cycles, Replace/Replace-all mutate, bold replacement stays bold through save→reopen.
- [ ] type-check + lint + test + test:browser; commit.

### Task 5: docs
**Files:** Modify `CLAUDE.md` (append find/replace sub-note to the DOCX bullet); update memory + plan Status=DONE.
- [ ] Document units, ceilings, guard files. Commit.
