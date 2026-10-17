# Architecture Plan — DDD + Hexagonal modular monolith

Target chosen by the developer on 2026-10-07 during the whole-repo review. Measured starting point (2026-10-07,
read-only review): about 2.5/10 against the target — layering 3, context boundaries 3, domain purity 2,
ports/adapters 4, value objects 1, composition root 2. The runtime import graph has no cycles; the real inversions
are core→ui (18 value imports) and core→handlers (8); only 64 of 184 `src/` files are free of DOM / pdf.js /
pdf-lib coupling.

## Decisions Log
- [2026-10-08 01:33] AGREED: Target architecture: DDD + Hexagonal as a modular monolith by bounded context; Clean Architecture's dependency rule only, enforced in CI by a fitness test; CQS via the existing Command + historyManager; no CQRS (developer, review session 2026-10-07).
- [2026-10-08 01:33] AGREED: Scope: record the ruling and the 13-step strangler roadmap here, run steps 0-3 now; steps 4-12 stay planned (developer, review session 2026-10-08).
- [2026-10-17 01:28] AGREED: Shared kernel dependency rule: shared-kernel/** imports no other src/ directory, and npm packages only from an explicit allowlist (today bidi-js, a pure UAX#9 library); bidi.ts moves into shared-kernel/text/ with the RTL primitives (developer, 2026-10-17).
- [2026-10-17 01:28] AGREED: Frame brands (step 3) are SOFT: an optional phantom __frame property, so plain literals still compile and tsc rejects a converter output handed over in the wrong frame; zero runtime change (developer, 2026-10-17).
- [2026-10-17 01:28] AGREED: PageFrame lands with step 4, its first user, not as an unused type in step 3 (developer, 2026-10-17).
- [2026-10-17 01:28] AGREED: Certification for steps 0-3: advisor() at each 3C/6C gate, one three-lens panel at the end of step 3 on a frozen commit (developer, 2026-10-17).
- [2026-10-17 04:03] ASSUMED (review): Step 1 repoints every whole-statement type-only src importer of IErrorReporter, IProgressManager, ToolMode, AppDOMRefs and RuleRect to its vocabulary home (contracts/, types/), not only the plan's named sites; mixed value+type statements and the re-export shims stay — full-set coverage, advisor agreed at 3C round 1.

## Target

- **Shape:** a modular monolith by bounded context.
  ```
  src/shared-kernel/   geometry value objects (AbsPt / CropPt / ViewPt frames, one Matrix), text-script primitives
  src/contexts/{editing,export,redaction,flow,docx,signing,ocr}/{domain,application,ports}
  src/adapters/{pdfjs,pdflib,indexeddb,fsaccess,tesseract,webcrypto}
  src/ui/              driving adapter: panels, binders, handlers
  src/main.ts          composition root
  ```
- **Dependency rule** (Clean Architecture's one rule, nothing more): dependencies point inward; a context's domain
  imports only the shared kernel; adapters implement ports. Enforced in CI by a fitness test.
- **CQS, not CQRS.** Every mutation stays a Command on `historyManager`; queries only read. No separate read
  models, no event sourcing: one user, one in-memory model, no server.
- **Strangler, never a rewrite.** The export byte-identity guarantees and the redaction leak invariants make a
  big-bang rewrite a one-way door.

## Formal Plan — roadmap

Rules for every step:
- Move, then refactor — never both in one commit. A move leaves a re-export shim at the old path (386 test files
  import `src/` paths); a shim is deleted only when the fitness test shows its fan-in is 0.
- Before each move, grep `vi.mock` for the old path (32 test files mock a `src/` path) and update those mocks in the
  same commit — a re-export shim does not carry `vi.mock` interception.
- The full deploy gate before every push.

| # | Step | Fitness rule it adds | Protected by |
|---|---|---|---|
| 0 | Architecture ratchet test (no install): baseline value-edge matrix between top-level dirs, zero runtime cycles, `app._` uses in `ui/` ≤ today, `getDocument(` sites ≤ today; a planted-violation control | the test itself | itself |
| 1 | Type-only edge fixes: export imports UI types from `contracts/`; `AppDOMRefs` → `contracts/`; `ToolMode` from `types/`; `RuleRect` out of `flowDoc` | export→ui = 0; type-only cycle count falls | type-check |
| 2 | Shared kernel part 1: one `Matrix` + one compose function (today two Matrix types compose in opposite order — that already caused a bug); Arabic/RTL text-script primitives out of `flowDoc`/`bidi` | `shared-kernel/**` imports nothing outside itself | bidi / flowDoc / rtl unit tests, Arabic browser suite |
| 3 | Coordinate-frame brands (types only, bodies unchanged): `AbsRect` / `CropRect` / `DisplayRect` / `ContentRect` + `PageFrame`; let tsc find every wrong-frame caller (≥8 shipped frame bugs) | `geometry.ts` exports no anonymous rect parameter types | geometry, crop, redaction page-space, UserUnit and CropBox-view browser tests |
| 4 | Redaction context: footprint + filter functions moved verbatim, then collapsed to one family typed on step-3 frames | `contexts/redaction/domain` imports only the shared kernel | the redaction jsdom + browser suites, qa:sweep `--allow-destructive` |
| 5 | Narrow handler ports (`IAppContext`, 26 members) and binder ports (6 binders use ~120 app members, 62 private) | `app._` count ratchets to 0 | ui / handler tests, qa:sweep |
| 6 | pdf.js and pdf-lib ports (library calls in 25 and 14 files today) | `getDocument(` only in `adapters/pdfjs`; pdf-lib value imports only in adapters | pointViewport, pdfjsParams, load-guard, ws8, viewerVerdict tests |
| 7 | Split `ExportService` by use case + `FileSaver` / `PageRasterizer` ports; export becomes query-only (today it mutates the model outside history) | `contexts/export/**` has no `document.` | export jsdom suite, export coverage gate, qa:sweep |
| 8 | Split `contentStreamEditor.ts` (3,023 lines) and `flowDoc.ts` (2,580) along their importer clusters | `utils/` line count ratchets down | contentStreamEditor + flowDoc suites, DOCX/MD export browser tests |
| 9 | Session aggregate + `SessionRepository` port + IndexedDB adapter (`SCHEMA_VERSION` must not change — a mandatory question if it would) | editing domain imports no infra/adapters | storage, sessionManager, history tests |
| 10 | Composition root: object construction moves from `PDFTurboApp` (48 collaborators) into `main.ts`, one per commit | core→ui and core→handlers value edges ratchet to 0 | core tests, qa:sweep |
| 11 | Element data/view split, one element type per commit, smallest first | editing domain elements have no `document.` / `HTMLElement` / i18n | element tests, mobile drag + DnD browser tests |
| 12 | Directory rename to the final shape; dependency-cruiser if a devDependency is acceptable | depcruise config mirrors the ratchet | everything |

Scope ruled 2026-10-08: steps 0–3 now; 4–12 stay planned.

### Steps 0–3 — execution plan (approved 2026-10-17, review-remediation row 8)

Moves are verbatim with a re-export shim at the old path; importers are NOT repointed in this row. The one
deliberate refactor (`composeCtm` → `multiplyMatrix`) has its own commit behind a bit-equality test. Each step is
gated by `advisor()` at 6C; one three-lens panel runs at the end on a frozen commit. `PageFrame` moves to step 4
(Decisions Log 2026-10-17).

| Step | Commits | Change | Proof |
|---|---|---|---|
| 0 | 1 | `tests/tools/architecture.test.ts` + `tests/tools/architecture.baseline.json`: a lexer + token-level import graph over `src/**/*.ts` (no `.d.ts`; Vite `?query` specifiers dropped). Value vs type edges. A **two-sided** ratchet on the top-level-dir value-edge matrix (above baseline fails; below fails with "lower it to N"). A new dir pair fails, except edges into `shared-kernel/`, `contracts/`, `types/`. Zero runtime SCCs. `\bapp\._[A-Za-z]` in `ui/**` and `\bgetDocument\(` in `src/**` pinned at today's counts (112, 13). | Fixture tree `tests/tools/fixtures/architecture/**` (valid TS, no `.test.ts`): every import form plus a planted cycle and a planted new pair, all caught. Non-vacuity: ≥ 600 edges, `core→ui` value = 18. |
| 1 | 1–2 | `exportService`/`exportPipeline` take `IErrorReporter`/`IProgressManager` from `contracts/`. `AppDOMRefs` → `src/contracts/appDomRefs.ts` (shim in `uiController`). `appContext` takes `ToolMode` from `types/tools`. `RuleRect` → `src/types/ruleRect.ts` (shim in `flowDoc`). | type-check. The ratchet baseline is lowered in the same commit (export→ui = 0, the 3-file type SCC gone). |
| 2a | 1 | Verbatim moves: `shared-kernel/geometry/matrix.ts` (`Matrix`, `multiplyMatrix`, `applyMatrixToPoint`), `shared-kernel/text/bidi.ts` (all of `utils/bidi.ts`), `shared-kernel/text/script.ts` (the flowDoc RTL set: `isArabicText`, `reverseRtlText`, `letterDirection`, `rowIsRtl`, `orderLineWords`, `mirrorShapeBrackets`, `needsWordSpace`, plus their private helpers). Shims at the old paths. Ratchet: the kernel imports no other `src/` dir and npm only from `['bidi-js']`. | Line-by-line verbatim check of moved bodies; full jsdom suite. |
| 2b | 1 | `opStreamWalker` uses the kernel `Matrix` + `multiplyMatrix`; its local `composeCtm` is removed; the anonymous 6-tuples in `flattenAnnotations.ts` and `flowDoc.ts` are typed `Matrix`. | An `Object.is` equality test of the old `composeCtm` formula against `multiplyMatrix` on random, −0 and large values, red-proven by swapping the argument order; the walker suites. |
| 3 | 1 | `shared-kernel/geometry/frames.ts`: soft brands `AbsRect`/`CropRect`/`DisplayRect`/`ContentRect` over one `Rect`; `geometry.ts` signatures retyped, bodies untouched. A real wrong-frame caller found by tsc is surfaced, not silently fixed. | type-check; a diff showing only signature lines changed in `geometry.ts`. |
| close | 1 | Full deploy gate, including the FULL `test:browser` and `coverage:export`; freeze; one three-lens panel; status rows marked. | Panel raw files under `var/claude/raw/`. |

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 0 | Architecture ratchet test | M | done | c1d70fa | tests/tools/** |
| 1 | Type-only edge fixes | S | done | 34323cb | src/export/**, src/contracts/**, src/core/appContext.ts, src/utils/flowDoc.ts |
| 2 | Shared kernel part 1 (one Matrix, text-script primitives) | M | doing | - | src/shared-kernel/**, src/utils/** |
| 3 | Coordinate-frame brands (types only) | M | todo | - | src/shared-kernel/**, src/utils/geometry.ts |
<!-- /progress-block -->
### Blocked
### Needs input
### Needs research
### Fragile
### Known issues
