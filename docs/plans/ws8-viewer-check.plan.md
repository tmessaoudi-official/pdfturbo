# WS8 — viewer check Plan

Replace the load guard's pdf.js MIRROR (`src/utils/pdfLoadGuard.ts`: the cross-reference chain and page-walk model
behind `PdfXrefMismatchError` / `PdfPageMismatchError`) with pdf.js itself: compare, page by page, what pdf.js shows
for a source with what pdf.js shows for pdf-lib's export-shaped copy of it. Master plan row 30.

## Decisions Log
- [2026-09-24 18:55] AGREED: build WS8 and REPLACE the mirror (master plan Decisions Log; measured by
  `tests/tools/ws8Cost.test.ts`, f21485c).

## Evidence this plan rests on (2026-09-24)
- Catch rate: every closing-audit shape built as a file (P1, P2, P3b, P4, P5, P7, P8, P9, P9b, C1, C1b, C2) flags; P3a
  and the clean controls do not; 0 of 360 corpus pages mismatch. Text fingerprint alone missed nothing in that set;
  the operator fingerprint alone missed dupFirst and C1 — but a caption-plus-swapped-image page needs operators, so
  BOTH are used on every page.
- Design traps measured: the copy must be pages copied into a FRESH document (`libDoc.save()` re-reads identically);
  operator lists with annotations DISABLED (widgets → false alarms on 7 of 8 forms).
- `copyPages` keeps resources inherited from `/Pages` (fixture: identical text and operators).
- Optional content: `copyPages` drops the catalog's `/OCProperties`; an OFF layer is invisible on screen and drawn in
  the export (0 vs 307 dark pixels). Text/operator fingerprints cannot see it. Disclosed 8afa56d.
- Encryption: every source site loads with no password and pdf-lib refuses encrypted input, so encrypted sources
  cannot be exported today; WS8 changes nothing there. `ignoreEncryption` loads yield an EMPTY copy, so the check
  must never run on them (they are the two signer sites, which receive app-written bytes).
- pdf.js's main build runs under jsdom with its fake worker (295 ms for a one-page file), so jsdom suites exercise
  the real check.
- Cost in Node (no worker): text + operators ≈ +19 s over today's 5.0 s on the 15-file corpus; the mirror itself is
  ~0.3 s of the guard. Browser cost with the real worker: NOT yet measured — step 1.

## Formal Plan

**My understanding:** swap the mirror for a real pdf.js comparison without adding false refusals, UI freezes, or
per-export repeat cost, and keep every caller's refusal handling unchanged.
**Key assumption:** the pdf.js work runs in pdf.js's worker, so the main thread pays only pdf-lib's copy+save.
**What would redirect me:** step 1 showing a main-thread cost you find too high, or a real-file false refusal.

1. **Browser cost gate (go/no-go).** `tests/browser/ws8-cost.browser.test.ts` (opt-in, not in CI) on Publication 17
   and one form, real worker: total time and main-thread time (long tasks via `PerformanceObserver`). Threshold
   proposed: no main-thread task over 200 ms; total reported. If it fails, stop and report — do not build on it.
2. **`src/utils/viewerCheck.ts`** (new, pure orchestration): `viewerMismatch(libDoc, original: PDFDocumentProxy,
   pdfjs)` → `{ pages: number[], hiddenLayers: boolean }`. Builds the fresh copy, opens it with the SAME pdfjs module,
   fingerprints text (`getTextContent` str + origin) and operators (`getOperatorList`, annotations DISABLED) for
   every page pdf.js shows; a page differs, or pdf-lib holds fewer pages → mismatch. pdf.js showing FEWER pages than
   pdf-lib stays allowed (today's disclosed rule). `hiddenLayers` = the original has any OFF optional-content group.
   Destroys the copy's loading task.
3. **Source registry** in `documentModel`: `addSourcePdf` stores the `PDFDocumentProxy` against the bytes (WeakMap by
   identity) and starts the check in the background; the entry is a `Promise`, so an export awaits the pending
   check instead of starting another. `ReplaceSourcePdfBytesCmd` (`pdfTurboApp.ts:555`) and the OCR-layer swap
   register their new doc/bytes, which replaces the entry.
4. **`loadPdfDocument` rewired.** Keeps: pdf-lib load, the drop recorder and `PdfObjectDroppedError`, the metadata
   stamp order, `isPdfLoadRefusal`. Removes: `inspectParse`'s chain/page-walk mirror and everything only it uses
   (xref-stream decoding, `viewerTableRows`, `describeParse`'s chain fields). New option `viewerCheck: 'source' |
   false` with NO default — the TypeScript signature forces every call site to choose: the 6 source sites
   (exportService ×4, textEditHandler, searchableTextLayer) pass `'source'`; the 6 app-written sites (sanitize input,
   assembled, compress, both signers, sanitized re-load) pass `false`. A mismatch throws `PdfPageMismatchError`
   (existing name, pages listed), so all seven caller branches and `toast.pdfLoadRefused` work unchanged.
   `PdfXrefMismatchError` stays exported and listed in `isPdfLoadRefusal` (no thrower left; kept so no caller or
   test keyed on the name breaks silently — removal is a later cleanup).
5. **Optional content — needs your ruling (see question):** (a) refuse when `hiddenLayers`, (b) fix the export by
   copying `/OCProperties` into the assembled document for single-source exports and refuse only multi-source ones,
   or (c) leave it to its own work item and keep only the disclosure.
6. **Tests.** Migrate `tests/utils/pdfLoadGuard.test.ts`: every existing REFUSE case must still refuse (now as a page
   mismatch) and every LOAD case must still load — that file is the regression contract; mirror-internal cases
   (predictor decoding, table-state, describeParse landing) are deleted with the code, each listed in the commit.
   Add the closing-audit shapes as tracked fixtures (from the probe builders) so the ten are pinned in CI. A
   call-site test fails when a new `loadPdfDocument` caller omits `viewerCheck`. Corpus test: 15 of 15 load.
   Browser: `pdf-load-guard.browser.test.ts` extended to one refused shape through the real worker.
7. **Sabotage** (each must land and go red): fingerprint compare disabled; operators dropped; annotations enabled;
   `libDoc.save()` instead of a fresh copy; registry skipped (check runs on bytes without the source doc); a
   `'source'` site switched to `false`.
8. **Docs.** `CLAUDE.md` § pdf-lib 2.11.0 drop/guard entry rewritten (the round history condenses to a pointer to
   `docs/ws7-certification-record.md`), `SECURITY.md` § "One file, two readers" and `KNOWN_ISSUES.md` (the ten-shape
   bound closed, new bounds stated: annotations not compared; encrypted sources unchanged; pdf.js-fewer-pages
   allowed), `CHANGELOG.md`, master plan row 30.
9. **Gate.** Full deploy gate on Node 26 before push; milestone panel on the frozen commit (tier asked then).

Rollback: the work lands as a series on `master`; `git revert` of the series restores the mirror (no schema, no
persisted-state change — the registry is in-memory only).

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Browser cost gate (go/no-go) | S | todo | - | tests/browser/ws8-cost.browser.test.ts |
| 2 | viewerCheck module | M | todo | - | src/utils/viewerCheck.ts |
| 3 | Source registry + background check | M | todo | - | src/core/documentModel.ts, src/core/pdfTurboApp.ts |
| 4 | loadPdfDocument rewired, mirror removed | L | todo | - | src/utils/pdfLoadGuard.ts |
| 5 | Optional-content handling (per ruling) | M | todo | - | src/export/exportService.ts |
| 6 | Test migration + tracked shape fixtures | L | todo | - | tests/utils/**, tests/browser/** |
| 7 | Sabotage round | S | todo | - | - |
| 8 | Docs | M | todo | - | CLAUDE.md, SECURITY.md, KNOWN_ISSUES.md, CHANGELOG.md |
| 9 | Full gate + milestone panel | S | todo | - | - |
<!-- /progress-block -->
### Blocked
### Needs input
- Go on this plan; the optional-content choice (step 5).
### Needs research
### Fragile
### Known issues
