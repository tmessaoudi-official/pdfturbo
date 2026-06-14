# PDFturbo — Architecture & Code-Quality Audit (2026-06-14)

Scope: `src/` tree (11,910 LoC, 90 TS files). Senior architecture + craftsmanship pass.
No code modified. All findings cite `file:line`.

## Headline

The codebase is **markedly healthier than `CLAUDE.md` describes**. CLAUDE.md is stale: it
references a `pdfTurboApp.ts` "~580 lines" god-class with three triplicated export paths and
flat `src/core | src/elements | src/handlers | src/utils` layout. The real tree has since been
decomposed into `core/`, `core/commands/`, `ui/`, `ui/binders/`, `export/`, `infra/`,
`contracts/`, and a dedicated `IAppContext` seam. **The historically-bad smells have largely
been fixed.** Remaining findings are mostly P2/P3 polish plus two genuine P1s (history-stack
memory leak, command-dir test gap).

Evidence grade legend per finding.

---

## 1. God Object / Coupling — IMPROVING (was degrading)

`PDFTurboApp` (`core/pdfTurboApp.ts`, 577 LoC) still exposes **181 public members**
[Verified: `grep -cE` on method/getter signatures], which reads as a god class by surface area.
But the internals tell the opposite story:

- It is now a **thin facade**. The vast majority of those 181 members are one-line delegators to
  ~25 injected services, e.g. `downloadPDF()` → `_exportService.downloadPDF()`
  (`pdfTurboApp.ts:570`), `_loadDocument()` → `_documentLoader.load()` (`:458`),
  `applyZoom()` → `_pageService.applyZoom()` (`:550`), `get effectiveFillColor` →
  `_formattingService` (`:499`). [Verified: read of the getter/delegator block.]
- **Inbound coupling is narrow**: only **10 files** reference `PDFTurboApp` at all
  [Verified: `grep -rln`], and 6 of those are `ui/binders/*` (the intentional wiring layer).
- **The decoupling seam exists and is adopted**: `core/appContext.ts` defines `IAppContext` — a
  curated ~30-member interface. **All six handlers depend on `IAppContext`, none on the concrete
  class** [Verified: `grep` of handler constructors — `drawingHandler.ts:20`,
  `eraserHandler.ts:13`, `inkLayerHandler.ts:11`, `interactionHandler.ts:37`,
  `textEditHandler.ts:35`]. This is exactly the "extend an existing seam" guidance in CLAUDE.md,
  now realized.

**P2 — `IAppContext` leaks private surface.** The "narrow" interface exposes `_autosave()`,
`_commitPlacement()`, and `_applySourcePdfEdit()` (`appContext.ts:54-58`) — underscore-private
methods promoted into a public contract. The underscore now lies (it is part of the handler API).
Either rename these to non-underscore contract methods or document them as intentional context
hooks. [Inferred: underscore convention is codebase-wide per CLAUDE.md; these violate it.]

**P3 — facade breadth.** 181 members is still a discoverability tax. Consider grouping
delegators behind sub-facades already implied by the service split (`app.export.*`, `app.pages.*`)
rather than flattening everything onto the app. Low priority — current form is mechanically fine.

**Verdict: coupling is improving and the trajectory is correct.** Do not "fix" the 181 count by
moving logic back in; the count is delegation, not god-logic.

---

## 2. Fat Files — mostly cohesive-but-large; one real split candidate

Function-size scan [Verified: awk brace-pair measurement + manual confirmation]:

| File | LoC | Verdict |
|---|---|---|
| `utils/contentStreamEditor.ts` | 1406 | **Cohesive library**, 48 functions. Only 2 exceed limits: `tokenizeContentStream` (156) `:44`, `locateTextOps` (113) `:280`. Split by concern, not by size (below). |
| `core/pdfTurboApp.ts` | 577 | Facade — see §1. Not a decomposition target. |
| `ui/uiController.ts` | 503 | Largest method `updateFormattingToolbar` (`:397`, ~56 LoC). Cohesive DOM-wiring. No function >150. |
| `handlers/drawingHandler.ts` | 447 | `handlePointerUp` (`:121-266`, ~145 LoC) is the worst method but **under 150 and shallow** (max indent observed is data-continuation, not control nesting; 0 `switch` statements) [Verified]. Borderline; see split note. |
| `export/exportService.ts` | 447 | Post-dedup (see §3). Healthy. |
| `handlers/textEditHandler.ts` | 438 | True-edit orchestration; inherently branchy. |
| `utils/flowDoc.ts` | 405 | Heuristic flow reconstruction; cohesive. |

**Only file that genuinely warrants splitting: `contentStreamEditor.ts` (P2).** Not because of
function length (only 2 borderline) but because it bundles **four distinct responsibilities** in
one 1406-line module:
1. **Tokenizer/serializer** (`:39-238` — `tokenizeContentStream`, `serializeTokens`, `groupOps`,
   `serializeOps`) → `contentStream/tokenizer.ts`
2. **Matrix math** (`:239-278` — `translateMatrix`, `multiplyMatrix`, `applyMatrixToPoint`) →
   `contentStream/matrix.ts` (pure, trivially unit-testable in isolation)
3. **Font/CMap/ToUnicode** (`:739-1281` — `parseToUnicodeCMap`, `detectCMapBytesPerCode`,
   `matchStandardFont`, `getPageFont*`, `isByteSwapUnsafeFont`, `isSubsetFontName`) →
   `contentStream/fonts.ts`
4. **Edit operations** (`replaceTextAt`, `changeColorAt`, `changeSizeAt`, `deleteTextAt`,
   `findTarget`, `writeBack`) → `contentStream/edits.ts`
This is a pure file-split (move + re-export from a barrel); behavior-neutral, makes the
ISSUE-2-critical font-gating logic testable in isolation. [Speculative on the exact carve lines;
the four-way grouping is Verified from the function inventory.]

**`tokenizeContentStream` (156 LoC, `:44`)** — single hot loop with a char-classification switch;
extracting the operator/operand/string-literal sub-scanners into helpers would bring it under 150
without hurting readability. P3.

`drawingHandler.handlePointerUp` (P3): it dispatches per shape-type after the gesture. Extracting
per-element-type commit helpers (`_commitShape`, `_commitInk`) would shrink it, but it is already
under threshold and shallow — optional.

---

## 3. Duplication — the triplicate is FIXED

The historically-triplicated `downloadPDF` / `downloadPage` / `downloadPageAsImage` rotation+
cropbox+watermark+ink logic [per CLAUDE.md] has been **extracted and deduplicated**
[Verified: read of `export/exportService.ts` + `export/exportPipeline.ts`]:

- Shared pipeline lives in `export/exportPipeline.ts` (261 LoC): `buildPageOverlays`,
  `rasterizePageWithRedactions`, `getPageCropBox` (`:36`), `renderInkForExport` (`:49`),
  `BuildPageCtx` (`:21`).
- All three download methods now call `buildPageOverlays(...)` + the two private helpers
  `_applyOverlaysToPage` (`exportService.ts:274`) and `_savePdfDocAndDownload` (`:293`)
  [Verified: each method body calls all three — `:115/:118`, `:149/:152`, `:181`]. This matches
  the ISSUE-4 dedup note in CLAUDE.md.

**P3 residual:** the three methods still share the same *open-doc → loop-pages → overlay → save*
skeleton with only the page-selection predicate differing. A single
`_export(pageFilter, filename)` private would collapse the last ~30 lines of structural
repetition, but the current state is acceptable — the load-bearing duplication is gone.

---

## 4. Design Patterns

**Command / undo-redo — CORRECT.** [Verified.]
- `Command` interface is sync `execute()/undo()` (`core/commands/command.ts`).
- Async work is done *before* command construction and the result snapshotted, so `execute()`
  stays synchronous — e.g. `ReplaceSourcePdfBytesCmd` takes pre-computed `before`/`after`
  snapshots and only swaps refs (`sourcePdfCmds.ts:20-30`). Clean.
- **No direct `documentModel` mutation bypassing commands** [Verified: `grep` for
  `addElement|removeElement|elements.push|elements.splice` outside `commands/` → zero hits].
  Undo integrity holds.
- `historyManager` caps at `maxSize` via `shift()` (`:32`); `_push` clears redo stack. Correct.

**Handler↔app coupling — see §1.** Resolved via `IAppContext`. The only residual smell is the
private-leak (§1 P2).

**Factory usage — fine.** `utils/elementFactory.ts` centralizes element creation (1 sanctioned
`any` for the discriminated-union construction).

**Error handling — consistent and clean (P3).** There is a real `IErrorReporter` contract
(`core/errorReporter.ts`) injected via `IAppContext.reportError`, with `showToast` as the legacy
path (appContext comments steer new code to `reportError`). **Zero silent-swallow catches**
[Verified: `grep` for `catch(){}` and `catch(_)` → none] and **only 1 raw `console.*` in src**
[Verified]. 50 catch blocks, all routed to reporter/toast.

**Async patterns — P2.** Five functions in `contentStreamEditor.ts` are declared `async` but
contain no `await` (`findTextOpAt:675`, `deleteTextAt:721`, `changeSizeAt:1003`,
`changeColorAt:1033`, `locatePageTextOps:1372`) [Verified: oxlint `require-await` warnings]. They
return needless promises, forcing callers to `await` synchronous work. Either drop `async` or
document the intent (API-symmetry with truly-async siblings like `replaceTextAt`). Likely the
latter is the design rationale — but it should be a comment, not a silent oxlint warning.

---

## 5. Dead Code / Unused Exports

[Verified: cross-tree `grep` incl. tests.]

- **`diagnosePage` (`contentStreamEditor.ts:685`)** — exported, **zero references anywhere**
  (no src, no test). Dead. P2 — either delete or wire into a debug path.
- **`getFormXObjectMatrix` (`contentStreamEditor.ts:1332`)** — exported, **zero references**.
  Dead. P2.
- `detectCMapBytesPerCode` (`:804`) — only referenced by its own test; no production caller.
  P3 — likely intentional building block, but currently test-only.
- No commented-out code blocks anywhere [Verified: `grep` for `// const|// return|// this.` →
  zero]. Clean.
- Only 6 TODO/FIXME markers total, none in critical paths [Verified].

---

## 6. Test Coverage Gaps

Suite: 41 jsdom test files + 6 real-Chrome browser tests (ISSUE-1..5 + smoke) [Verified: `find`].

**P1 — the entire `core/commands/` directory has no dedicated unit tests.**
`elementCmds.ts`, `sourcePdfCmds.ts`, `moveCmds.ts`, `macroCmds.ts`, `pageCmds.ts`, `inkCmds.ts`
have **no `*.test.ts`** [Verified: file-by-file check]. Undo/redo *integration* is exercised via
`historyManagerCommands.test.ts` and `undoRedoController.test.ts`, but the individual command
execute/undo round-trips (especially `MacroCmd` composition and `ReplaceSourcePdfBytesCmd`
ref-swap symmetry) are not directly asserted. These are the correctness core of the app — they
deserve direct tests. **Cheap win:** these are pure logic, fully jsdom-testable.

**P2 — export paths have no jsdom test.** `export/exportService.ts`, `exportPipeline.ts`,
`pdfElementRenderer.ts` have no `*.test.ts`. Pixel-level export *is* covered by the browser
harness (ISSUE-2/3/4), and `exportCoords.test.ts` covers coordinate math — but the overlay/
crop/watermark assembly logic (the formerly-triplicated code) has no fast unit test guarding
regressions. Add a jsdom test that mocks `buildPageOverlays` and asserts each download method
calls it with the right page filter.

**Browser-harness-only (correctly placed):** canvas rasterization, `commonObjs`/`VideoFrame`
image extraction (ISSUE-3), pointer-drag DnD (ISSUE-1), content-stream pixel verification
(ISSUE-2). These cannot run in jsdom and are correctly in `tests/browser/`. CLAUDE.md's guidance
here is accurate.

**Untested utilities (P3):** `utils/hitTest.ts`, `utils/geometry.ts`, `utils/binaryUtils.ts`,
`utils/textLayer.ts`, `utils/formFieldOverlay.ts` — pure, easily testable, currently uncovered.
`core/signatureManager.ts`, `core/searchManager.ts`, `core/sessionManager.ts` also lack tests.

---

## 7. Type Safety

[Verified: `grep` + `npx oxlint`.]

- **`any` is concentrated, gated, and mostly justified.** 37 `any` occurrences in src, **23 of
  them in `contentStreamEditor.ts`** (pdf-lib internals lack types — see the `pdfLibTypes.ts`
  shim). Each is paired with an `eslint-disable-next-line` (oxlint honors these directives, which
  is why the 19 live `no-explicit-any` warnings surface only in *tests*, which lack the disables).
- **P2 — `moveCmds.ts` `any` is avoidable** (`:31/:37/:52/:58`): `this.elements.find(...) as any`
  to reach element fields. This is a real type hole in a *command* (the correctness core). Use a
  proper discriminated union or a narrowing type guard instead of `as any`. The shape-field cast
  at `:102` (`as any` "to avoid circular import") is fixable by extracting the shape type to
  `types/`.
- **P2 — `pdfElementRenderer.ts` types its whole `BuildPageCtx` as `any`** (`:13-18`: `pdfDoc:
  any; page: any; libs: { rgb: any; ... }`). pdf-lib *does* ship types; these should be
  `PDFDocument`, `PDFPage`, etc. This is the export render path — worth tightening.
- **`textSearchHandler.ts` `any`** (`:27/:42/:48`): pdf.js `page`/`viewport`/text-item types.
  pdfjs-dist ships `PDFPageProxy` / `PageViewport` / `TextItem` — these `any`s are replaceable
  with real imports. P2.
- **Non-null assertions: clean.** `no-non-null-assertion` is `error` in `.oxlintrc.json` and the
  build is green [Verified: oxlint output has zero non-null-assertion errors]. No `foo!` hotspots.

**Net:** the unavoidable `any` (pdf-lib/pdf.js untyped internals) is correctly isolated and
suppressed; the *avoidable* `any` in `moveCmds`, `pdfElementRenderer`, and `textSearchHandler`
(~12 occurrences) should be typed — they're in correctness-critical paths and have real upstream
types available.

---

## 8. Staff-Engineer Flags

**P1 — pdfjs-document memory leak on the history stack.**
`ReplaceSourcePdfBytesCmd` keeps both the `before` and `after` `PDFDocumentProxy` alive
(`sourcePdfCmds.ts:6-30`), and CLAUDE.md acknowledges "old pdfjs docs stay alive by design."
**But `historyManager._push` evicts via `shift()` (`historyManager.ts:32`) without any disposal
hook** [Verified: no `.destroy()` call anywhere on a doc; `Command` has no `dispose()`]. So:
1. Every true-text-edit pins an extra multi-MB pdfjs document.
2. When the command is evicted from the 50-deep stack, its docs are **dropped without
   `.destroy()`** — pdfjs holds worker-side buffers that GC alone may not reclaim promptly.
On an edit-heavy session this is unbounded growth followed by leaked worker memory on eviction.
**Fix:** add an optional `dispose()` to the `Command` interface; call it in `_push` on the
evicted command and on `redoStack` clear; `ReplaceSourcePdfBytesCmd.dispose()` calls
`.destroy()` on the doc that is no longer the live one. [Inferred severity: high for a
"100% client-side, long-lived PWA session" app where the tab is never reloaded — PWA autoUpdate
means sessions can run for days.]

**P2 — stale `// eslint-disable-next-line` directives post-eslint-removal.** CLAUDE.md says
"eslint removed 2026-06-14 / oxlint is sole linter," yet ~41 `eslint-disable-next-line
@typescript-eslint/no-explicit-any` comments remain (e.g. `contentStreamEditor.ts:539+`,
`pdfLibTypes.ts:12`, `moveCmds.ts:30+`). They *happen* to still work (oxlint honors the
eslint directive syntax) but they reference a tool that no longer exists, which is confusing and
will rot. Migrate to `// oxlint-disable-next-line typescript/no-explicit-any` for honesty.

**P3 — `documentLoader.test.ts` carries 10 `no-explicit-any` warnings** and several
`require-await` warnings live in tests. The src disables don't extend to tests; either type the
test mocks or add a test-scoped oxlint override.

**P3 — `pdfTurboApp.unit.test.ts:145` has a stray `console` statement** (oxlint `no-console`).
Trivial cleanup.

---

## Prioritized Summary

| Pri | Finding | Location |
|---|---|---|
| **P1** | pdfjs docs leak: no `dispose()` on Command eviction → unbounded memory in long PWA sessions | `historyManager.ts:32`, `sourcePdfCmds.ts:6-30` |
| **P1** | Entire `core/commands/` dir has no unit tests (the undo correctness core) | `core/commands/*.ts` |
| **P2** | Split `contentStreamEditor.ts` (1406) into tokenizer/matrix/fonts/edits — pure file move | `utils/contentStreamEditor.ts` |
| **P2** | Avoidable `any` in correctness paths (moveCmds, pdfElementRenderer, textSearchHandler) — real types exist | `moveCmds.ts:31+`, `pdfElementRenderer.ts:13`, `textSearchHandler.ts:27` |
| **P2** | `IAppContext` exposes underscore-private methods as public contract | `appContext.ts:54-58` |
| **P2** | Export assembly logic (exportService/exportPipeline) has no jsdom test | `export/*.ts` |
| **P2** | 5 fake-`async` functions (no await) emit warnings, no documented intent | `contentStreamEditor.ts:675,721,1003,1033,1372` |
| **P2** | Dead exports `diagnosePage`, `getFormXObjectMatrix` (zero refs incl. tests) | `contentStreamEditor.ts:685,1332` |
| **P2** | ~41 stale `eslint-disable` comments after eslint removal | repo-wide |
| **P3** | Export methods share collapsible skeleton (last ~30 dup lines) | `exportService.ts:41,130,161` |
| **P3** | Untested pure utils (hitTest, geometry, binaryUtils, textLayer) | `utils/*.ts` |
| **P3** | `tokenizeContentStream` 156 LoC; `drawingHandler.handlePointerUp` 145 LoC | per file |
| **P3** | Stray `console` in test; test-file lint warnings | `pdfTurboApp.unit.test.ts:145` |

**Bottom line:** the architecture is on a clearly *improving* trajectory — the three historic
smells (god class, export triplication, handler coupling) are all materially resolved. CLAUDE.md
is the most out-of-date artifact in the repo and should be refreshed to reflect the
`core/commands` + `ui/binders` + `IAppContext` structure. The one finding that needs prompt
attention is the **P1 pdfjs-document memory leak** — it is invisible in tests, grows silently,
and the PWA autoUpdate model means sessions are long-lived.
