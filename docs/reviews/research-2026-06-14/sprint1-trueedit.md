# Sprint 1 — True-edit engine P1 bug fixes (2026-06-14)

Scope: `src/utils/contentStreamEditor.ts`, `src/handlers/textEditHandler.ts`, tests only.
Test runner note: `npx vitest` prints a bogus `PASS (0) FAIL (0)` shim in this env;
real runs use `node node_modules/vitest/vitest.mjs run <file>`.

## BUG A2 — 4pt over-blank wipes a distinct neighbour word

- **Root cause**: `blankAllNearby` blanked every show op within `SHADOW_RADIUS = 4`
  PDF points of the matched origin. A distinct adjacent word a couple of points
  away was inside that radius and got wiped (data loss).
- **RED**: new test `does NOT blank a distinct neighbour word ~2.5pt from the target
  origin (A2)` — two distinct words ("EditMe" @ (50,300), "Neighbour" @ (52,298.5),
  ~2.5pt apart). Editing "EditMe" produced `[ '', '' ]` → "Neighbour" was wrongly
  blanked. `AssertionError: expected [ '', '' ] to include 'Neighbour'`.
- **FIX**: `SHADOW_RADIUS` 4 → 0.5 (sub-point). Only ops at (essentially) the same
  baseline origin — true drop-shadow / same-origin multi-op — are blanked; a
  neighbour at a clearly different origin is preserved. Rationale documented in the
  const comment (missing a faint 1pt shadow << wiping a real word).
- **GREEN**: A2 test passes; reframed legitimate-shadow test (`ShadowDup` drawn at
  the EXACT same origin (50,300)) still blanks correctly. The old test, which
  asserted a 2pt-offset DISTINCT string got blanked, encoded the bug and was
  rewritten to a true same-origin shadow.

## BUG A1 — XObject target silent no-op

- **Root cause**: `findTarget` finds text inside Form XObjects, so the handler
  opened the true-edit input; on commit `replaceTextAt` hit the Path-3 XObject
  refusal (returns `false` without blanking) and the handler did `if (!ok) return`
  → user clicks, types, nothing happens (no edit, no overlay).
- **RED**: handler test `falls back to overlay when the only match is inside a Form
  XObject (A1)` — mock `findTextOpAt` returns a target with `inXObject: true`.
  `AssertionError: expected 0 to be greater than 0` (overlay `historyManager.execute`
  never fired; editor opened instead).
- **FIX**: (1) `findTarget` now flags XObject targets `{ ...t, inXObject: true }`;
  (2) handler candidate loop treats an `inXObject` hit as a MISS
  (`if (hit && !hit.inXObject)`) so it falls through to the overlay path — exactly
  like the no-match case, before any editor opens. `replaceTextAt`'s XObject
  refusal is kept as a safety net (boolean returns unchanged → no handler blast).
- **GREEN**: handler test passes (overlay fires, no `.true-edit-input`). Engine tests
  added: `flags a target found inside a Form XObject with inXObject (A1)` (built a
  synthetic PDF whose only text lives in a Form XObject invoked via `Do`), and
  `replaceTextAt never blanks an XObject target without a replacement` (the
  never-delete-without-replacement invariant). Note: a standard-font literal op
  inside an XObject edits in place (Path 1 writes back to the XObject stream) — that
  is correct, not the bug; the user-facing no-op was the Path-3/handler case.

## Verification (scoped — parent runs full gate)

- `node node_modules/vitest/vitest.mjs run tests/utils/contentStreamEditor.test.ts
  tests/handlers/textEditHandler.test.ts` → **101 passed** (engine 97 = 94 orig +1 A2
  +2 A1; handler 4 = 3 orig +1 A1).
- `npx oxlint <4 changed files>` → **ok** (no new warnings; no new disables needed).

## Files changed

- `src/utils/contentStreamEditor.ts` — `SHADOW_RADIUS` 4→0.5 + comment; `findTarget`
  flags XObject targets `inXObject: true`.
- `src/handlers/textEditHandler.ts` — candidate loop skips `inXObject` targets → overlay.
- `tests/utils/contentStreamEditor.test.ts` — `makeAdjacentWordsPdf`,
  `makeXObjectTextPdf` helpers; reframed `makeOverlappingTextPdf` to same-origin
  shadow; A2 test; 2 A1 engine tests.
- `tests/handlers/textEditHandler.test.ts` — A1 overlay-fallback test.
