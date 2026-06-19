# Full QA Sweep — 2026-06-19

Live real-Chrome sweep (Playwright MCP) + deterministic suites + fuzz/stress, across every
sprint feature. **No source changes made** — findings only; fixes are gated to a follow-up.

## Deterministic nets (baseline) — ALL GREEN
| Suite | Result |
|---|---|
| `type-check` + `lint` | pass (exit 0) |
| `test` (jsdom) | 1633 passed \| 2 expected-fail (1635), exit 0 |
| `test:browser` (real Chrome) | **80 passed / 33 files**, exit 0 |

The browser suite includes the `trueedit-sequential`, `trueedit-underline-resize`, `arabic-overlay`,
`arabic-selection`, `cert-gen`, `ocr-csp`, `searchable-ocr`, and `issue3-docx-images` guards — so the
recently-fixed sequential-edit ghost bug is authoritatively confirmed fixed.

## Findings

### P2-1 — Error toast shows the literal `{{error}}` placeholder  [Verified]
- **Repro:** open any invalid / corrupt / 0-byte / truncated PDF → toast reads
  `Failed to load PDF — {{error}}` (literal, un-interpolated). Same for `Image conversion failed — {{error}}`.
- **Evidence:** saw the literal toast in real Chrome (`toast--error show` → `"Failed to load PDF — {{error}}"`);
  traced to `src/core/errorReporter.ts:34` — `error(msgKey, err?, params?)` interpolates with `params`
  (3rd arg), but call sites `documentLoader.ts:379` (`pdfLoadFailed`) and `:282` (`imageConversionFailed`)
  pass `err` as the 2nd arg and **no params**, so `{{error}}` is never filled.
- **Scope:** exactly 2 keys × 3 locales (`pdfLoadFailed`, `imageConversionFailed`). All other
  `reportError.error(…, err)` sites use placeholder-free keys → unaffected.
- **Impact:** the *most common* error path (user picks a non-PDF) looks broken. High polish value pre-LinkedIn.
- **Fix (1 line, root cause):** in `errorReporter.error`, inject the error message as the `error`
  interpolation var, e.g. `t(msgKey, { error: err instanceof Error ? err.message : '', ...params })`.
  Fixes both keys at once and is future-proof. Add a guard test (load garbage → toast has no `{{`).

### P3-1 — Default export embeds pdf-lib metadata + timestamps  [Verified]
- **Evidence:** `downloadPDF` byte dump contains `/Producer (pdf-lib …)`, `/Creator (pdf-lib …)`,
  `/CreationDate (D:2026…Z)`, `/ModDate`. A small metadata/privacy footprint for a "100% local /
  nothing leaves your browser" tool.
- **Note:** stripping IS available but opt-in (🧹 Sanitize, `sanitizeAndDownload`). Options: strip
  `/Producer`+`/Creator`+dates on the default path too, or leave as-is (documented opt-in). UX call, not a defect.

### OBS — Export-flyout discoverability  [Speculative — UX]
- Watermark, Bates, Compress, Sanitize, Flatten, XFDF in/out, Table→CSV, Extract-pages all live behind
  the single `▾` export chevron. Functional and tidy, but a large share of the feature set is one
  hidden click deep. Worth a glance for the public launch (e.g., a short "More tools" hint).

## Verified-good (robustness / happy path)
- **Malformed inputs** (empty / garbage / truncated): graceful — `InvalidPDFException` caught, **no
  pageerror, no crash**, placeholder intact, error toast shown (modulo P2-1).
- **Encrypted PDF:** correct password prompt (`#pdfPasswordInput` + Unlock btn) → correct password opens it.
- **Stress:** 60-page PDF loads in **230 ms**, huge-text 289 ms, heap ~31 MB. No jank.
- **Undo/redo:** draw→1, undo→0, redo→1; **12×/12× undo-redo storm** ends correct, zero pageerrors.
- **Export pipeline:** `assemblePdfBytes` (2.5 KB), `downloadPDF` (valid 2-page `%PDF-1.7`…`%%EOF`),
  `exportAsDocx` (Blob), `exportAsMarkdown` (322 B) all produce output. `exportXfdf` correctly warns
  `xfdfNoAnnots` when there are no annotations.
- **Modals/panels:** Settings, Help, Watermark Settings (7 inputs), Bates (5), Compress (1), e-Sign,
  Signers, QR/Code all open with **0 console errors**.
- **i18n:** EN/FR/AR switch works; Arabic sets `dir=rtl`, `lang=ar`, labels translate.
- **True-edit:** inline `true-edit-input` opens & focuses on a word click; sequential correctness via the
  green browser guard.

## Test-method notes (NOT product bugs)
- **RTL screenshot is blank under Playwright headless** while the DOM is provably `visibility:visible /
  opacity:1`. A compositor artifact for `dir=rtl`; RTL is functionally verified + covered by the green
  Arabic browser tests. A real browser renders it fine.
- **Free-click sequential true-edit is flaky to automate** (coordinate drift after text shortens, editor
  focus races, leftover-open editors committing empty deletes). Use the deterministic browser guard, not
  free mouse clicks, to verify true-edit.

## Not live-tested this pass (covered by green suites)
Form fill+flatten, OCR (visible/searchable), crop apply, signature draw+place, watermark/bates apply —
all exercised by the jsdom (1635) + browser (80) suites which are green.

## Verdict
No P0/P1. One genuine P2 (the `{{error}}` toast) worth fixing before a public post — it's on the most
common error path and is a 1-line root-cause fix. P3 metadata + the discoverability note are polish calls.

---

## Fixes applied (Option 2 — TDD, zero-regression)
1. **P2 — `{{error}}` interpolation** (`src/core/errorReporter.ts`): `error()` now injects the err's
   message as the `error` interpolation var (explicit params still win) → `pdfLoadFailed` /
   `imageConversionFailed` show the real reason. Verified live (toast: "Failed to load PDF — <msg>").
   Guard: `tests/core/errorReporterInterpolation.test.ts` (5).
2. **P3 — export metadata** (`src/export/exportService.ts`): the user-facing download paths
   (`downloadPDF` / `downloadPageRange` / `downloadFlattened`) assemble with
   `PDFDocument.create({ updateMetadata: false })` via a new `opts.cleanMetadata` → no pdf-lib
   `/Producer`+`/Creator`+dates. **Deliberately narrowed**: `assemblePdfBytes` (→ sign/compress/SANITIZE)
   is left byte-identical. *(A broad strip first regressed `sanitize.browser.test` — `toast.sanitizeNothing`
   because the assembled bytes had nothing left to strip; narrowing resolved it, and a test now locks the
   scope by asserting `assemblePdfBytes` still carries `/Producer`.)* Guard: `tests/export/exportMetadataStrip.test.ts` (3).
3. **`package.json`**: added `"license": "UNLICENSED"` (npm convention for the proprietary All-Rights-Reserved LICENSE).
4. **THIRD-PARTY-NOTICES.md**: was stale — added the bundled deps it was missing (tesseract.js Apache-2.0,
   node-forge BSD, docx MIT, SortableJS MIT, @pdf-lib/fontkit MIT, Noto Naskh Arabic OFL-1.1).

**Verification (zero-regression mandate):** `type-check` + `lint` + jsdom (1640+ passed, 2 expected-fail)
+ real-Chrome browser suite (80/80) — full chained run exit 0. New tests red→green (TDD). The sanitize
regression was caught by the browser suite and fixed before completion.

## Non-finding (verified safe)
`tests/fixtures/private/` (real CV / attestation — personal data) is **gitignored and NOT git-tracked**
→ not present in the public GitHub repo.
Robustness (malformed/encrypted/stress/undo-storm) is solid.
