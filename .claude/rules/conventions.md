# pdfturbo gotchas — conventions

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: repo-wide conventions: base path, jsdom tests, the one PDF write library, private methods. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### Base path is `/pdfturbo/`

(vite.config.ts) — asset URLs and SW scope depend on it.

### Tests run in jsdom

Canvas rendering, real PDF rasterization, and pointer gestures
are not exercised by `npm run test`. There is now a real-browser harness — `npm run test:browser`
(`tests/browser/*.browser.test.ts`, real Chrome) — that DOES exercise these; use it for
editor/export/DnD changes alongside `npm run dev` manual checks. CI runs both suites (deploy.yml).

### Only `@cantoo/pdf-lib` is the PDF write library

(the dead `pdf-lib` and `qpdf-wasm`
deps were removed 2026-06-11). Never add the bare `pdf-lib` back — it has been abandoned
upstream since ~2021.

### Private-method convention

`_underscore` prefix throughout; oxlint's `no-unused-vars`
allows unused args/vars only when `_`-prefixed (`argsIgnorePattern`/`varsIgnorePattern`).
`no-underscore-dangle` is deliberately OFF in `.oxlintrc.json` so it doesn't fight this convention.

### The architecture ratchet is two-sided — edit its baseline in the same commit (2026-10-17)

`tests/tools/architecture.test.ts` (architecture plan step 0) pins `src/`'s import graph to
`tests/tools/architecture.baseline.json`: the edge count between every pair of top-level directories (all edges and
runtime edges), the files in import cycles with type edges included, the `app._` reach-ins from `ui/` and the
`getDocument(` sites, plus zero runtime import cycles — the JSON holds the current values. A count ABOVE its baseline fails, and so does one
BELOW it — `lower the baseline to N` — because unrecorded slack can be spent again silently; a
`new dependency direction a->b` fails until it is either removed or added to the baseline on purpose. So a change that
moves an import edits the JSON **in the same commit**, by hand, and the diff of that file is what a reviewer reads.
Edges INTO `shared-kernel/`, `contracts/` and `types/` are not counted (shared vocabulary); those three may import
only each other, `shared-kernel/` only itself plus the npm allowlist `KERNEL_NPM_ALLOWLIST` (today `bidi-js`, ruled
2026-10-17); `src/*.ts` (the composition root) may import anything. The scanner is a lexer in
`tests/tools/architectureGraph.ts`, not tsc (TypeScript 7 has no JS API): an unmarked import used only as a type is
a runtime edge — mark it `import type` to move it. Its fixture tree `tests/tools/fixtures/architecture/` is
type-checked by tsc and never collected by vitest (no `.test.ts` in it).

**Moved homes (architecture step 2, 2026-10-17).** A citation elsewhere in these rules of `flowDoc.ts`, `utils/bidi.ts`
or `contentStreamEditor.ts` as the home of `isArabicText`, `reverseRtlText`, `letterDirection`, `rowIsRtl`,
`orderLineWords`, `mirrorShapeBrackets`, `needsWordSpace`, the bidi engine (`mirrorForDisplay`, `visualRuns`, …) or
`Matrix` / `multiplyMatrix` / `applyMatrixToPoint` resolves to `src/shared-kernel/text/script.ts`,
`src/shared-kernel/text/bidi.ts` and `src/shared-kernel/geometry/matrix.ts`; the old paths re-export them. The
walker's `Matrix6` and its local `composeCtm` are gone — it composes with `multiplyMatrix(M_cm, ctm)`, pinned
bit-identical to the old formula by `tests/shared-kernel/geometry/matrix.test.ts`.

### Rect frames are soft brands — `shared-kernel/geometry/frames.ts` (architecture step 3, 2026-10-17)

Every rect converter in `src/utils/geometry.ts` names its frame: `DisplayRect` (editor, rotated, y down),
`ContentRect` (unrotated, y down, crop-relative), `CropRect` (y up, crop-relative), `AbsRect` (absolute user space)
and `PageSpaceRect` (x absolute, y down from the crop top — the frame `isItemRedacted` compares in). The brand is an
OPTIONAL phantom `__frame`, so a plain literal fits any frame and a converter's output passed to a parameter of
another frame does not compile; nothing exists at run time (comment-stripped JS identical). Bound: a brand lives only
as far as a typed value flows — a rect stored in a plain-typed model field (a page crop, an element) is unbranded
again, so tsc checks converter-to-converter chains, not the model. When it landed tsc found 0 wrong-frame callers;
the shipped frame bugs were already fixed, so this is a fence, not a catch. A new converter takes a brand, never an
anonymous `{ x: number; y: number; … }` — `tests/shared-kernel/geometry/frames.test.ts` fails on one, and its
`@ts-expect-error` line is what reds if the brands ever collapse into one.
