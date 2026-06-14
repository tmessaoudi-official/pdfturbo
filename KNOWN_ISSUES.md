# PDFturbo — Known Issues & Roadmap

Living tracker of confirmed defects with reproduction, root cause, fix direction, and the regression
test each one needs before it can be called "fixed with confidence."

- **Proof:** every entry was reproduced in a real browser. Full evidence + method:
  [`docs/reviews/2026-06-14-qa-sweep-findings.md`](docs/reviews/2026-06-14-qa-sweep-findings.md).
- **Feature-level status & usage:** [`FEATURES.md`](FEATURES.md).
- **Confidence scale:** Verified (reproduced + measured) · Inferred (consistent with evidence) ·
  Needs-manual (automation couldn't drive it).

> ⚠️ **Why these shipped green:** the default Vitest suite runs in **jsdom**, which cannot exercise
> pointer drag, canvas-coordinate text matching, or `ImageBitmap`/`VideoFrame` extraction. All issues
> below live in that real-browser layer. A browser-level harness is now in place —
> **`npm run test:browser`** (`@vitest/browser` + Playwright, real Chrome) — and every fix below ships
> with a regression test that runs there. jsdom CI alone still can't catch these; run `test:browser` too.

---

## Status: ALL FIXED — 2026-06-14 (browser-harness execution)

| ID | Sev | Area | One-line | Status |
|----|-----|------|----------|--------|
| ISSUE-1 | P1 | Toolbar | Native HTML5 DnD — flaky + not automatable | ✅ Fixed — `forceFallback` (pointer DnD) |
| ISSUE-2 | P1 | Edit text | Subset/embedded-font edits lost the replacement (data loss) | ✅ Fixed — skip byte-swap + in-stream redraw |
| ISSUE-3 | P1 | DOCX export | Images in pdf.js `commonObjs` (`g_` prefix) dropped | ✅ Fixed — resolve from `commonObjs` |
| ISSUE-4 | P2 | DOCX export | No-op on text-less PDF that has images | ✅ Fixed — export images / always feedback |
| ISSUE-5 | P2 | Add text | Text tool: blank-canvas click did nothing | ✅ Fixed — unified text mode |
| THUMB-DND | – | Thumbnails | Page-reorder uses native HTML5 DnD | ⏳ User manual check (likely works; not Playwright-drivable) |

> **Two earlier findings were false positives, corrected during execution:** ISSUE-1 was *not*
> "unwired" — SortableJS was attached all along; the real defect was native-DnD mode. And
> `qa-imagetext.pdf` (page-local image) already exported its image end-to-end; ISSUE-3 is specifically
> the `commonObjs` (cross-page reused image) case.

---

### ISSUE-1 — Toolbar drag/sort non-functional · P1 · ✅ FIXED
- **Correction:** the original "not wired / no Sortable instance" diagnosis was wrong. Live-DOM probe
  showed SortableJS WAS attached to the container and every group (`Sortable<ts>` expando present).
  `draggable=true` is absent at rest because that's normal for SortableJS *native* DnD (set at
  mousedown only).
- **Real root cause:** native HTML5 DnD mode — flaky inside the dense toolbar and impossible to drive
  from automation (why it read as "broken").
- **Fix:** `forceFallback: true` on both Sortable configs (`toolbarCustomizer.ts`) → pointer-based DnD.
- **Tests:** `tests/ui/toolbarCustomizer.test.ts` (asserts `forceFallback` on every instance) +
  `tests/browser/issue1-toolbar-dnd.browser.test.ts` (real pointer drag reorders + persists; restore
  across reload). Proven RED without the fix.

### ISSUE-2 — Subset/embedded-font edit lost the replacement · P1 · ✅ FIXED
- **Repro (CV, pixel-confirmed):** edit a heading drawn in a subset font → original blanked, new text
  neither rendered nor text-extractable (`sentinelInStream=true, sentinelExtractable=false, ink↓`).
- **Two combined root causes (both verified on the real CV):**
  1. **Path 1 fired on subset fonts.** The literal in-place byte-swap (`replaceShowOpInPlace`) ran for
     subset/embedded fonts whose bytes map to custom glyphs → wrong/blank glyphs, broken extraction.
  2. **Path 3 redraw was orphaned.** `writeBack`→`setPageContent` replaced the page `/Contents`, then
     pdf-lib's `page.drawText` appended to a stream no longer referenced by the page → invisible + not
     extractable.
- **Fix (`contentStreamEditor.ts`):** (a) `isByteSwapUnsafeFont()` gates Path 1 — skipped for
  subset-tagged, CID/Type0, and embedded-FontFile fonts; (b) Path 3 redraw emitted as explicit text
  operators appended to the SAME stream in one `writeBack` (renders + extracts); (c) XObject targets
  refuse *before* blanking (no delete-without-replacement; caller overlays).
- **Tests:** `tests/browser/issue2-true-edit.browser.test.ts` (fontkit subset heading → edit →
  extractable + ink, original gone) + `isSubsetFontName` unit tests. Verified end-to-end on the CV
  (`ink 4878→5499`, sentinel now extractable). After-fix the new text uses a standard fallback font
  for out-of-subset characters (Path 2 keeps the original font for in-subset edits).

### ISSUE-3 — DOCX drops `commonObjs` images · P1 · ✅ FIXED
- **Correction:** `qa-imagetext.pdf` (page-local image) already exported its image end-to-end on
  current code — the earlier "0 media" was on stale code. The real bug is the `commonObjs` case.
- **Repro (probe-confirmed):** one image reused across ≥2 pages → pdf.js GlobalImageCache promotes it
  to `page.commonObjs` with a `g_` name (`g_d0_img_p1_1`); extraction read `page.objs` only, so
  `page.objs.get('g_…')` threw → image silently skipped.
- **Fix (`exportService.ts`):** resolve `g_`-prefixed names from `page.commonObjs` (else `page.objs`);
  widen the bitmap type to `CanvasImageSource` (pdf.js v6 bitmaps are `VideoFrame`; `drawImage` accepts).
- **Test:** `tests/browser/issue3-docx-images.browser.test.ts` — generates a 3-page reused-image PDF,
  asserts `[1,1,1]` images extracted + `word/media/` non-empty; page-local guard. Proven RED (`[1,0,0]`).

### ISSUE-4 — No-op DOCX on text-less (image-only) PDF · P2 · ✅ FIXED
- **Repro:** `qa-imageonly.pdf` → `exportAsDocx` guard checked `paragraphs.length > 0` only, so an
  image-only PDF (no text, but images after ISSUE-3) was rejected as "no text" → no file.
- **Fix (`exportService.ts`):** export when there is text **or** images; the "no extractable text"
  toast (`toast.exportNoText`, present in all 3 locales) shows only for genuinely empty docs.
- **Test:** `tests/browser/issue4-textless-export.browser.test.ts` — image-only PDF produces a `.docx`
  (no warn); blank PDF warns + no file. Proven RED (image-only produced 0 downloads).

### ISSUE-5 — Unified text mode · P2 · ✅ FIXED
- **Decision (user):** one text mode — click existing text → true-edit; click empty area → new box.
- **Root cause:** in `editText` mode the blank-canvas click returned early (`if (!best) return`).
- **Fix (`textEditHandler.ts`):** on a no-text-hit click, call `app.addTextAtPosition(e)` (undoable,
  focuses the new box). Added `addTextAtPosition` to `IAppContext`. `editText` is now the unified mode.
  (Follow-up UI option: merge the "Add Text" + "Edit PDF text" toolbar buttons into one.)
- **Test:** `tests/browser/issue5-unified-text.browser.test.ts` — blank click adds a box; text-hit does
  not. Proven RED.

### THUMB-DND — Page reorder via thumbnail drag · ⏳ user manual check
- `pageThumbnailPanel.ts` uses native HTML5 DnD (`dragstart`/`dragover`/`drop`) — the same native
  mechanism the toolbar used, which a real mouse drives fine but Playwright cannot. Left as-is pending
  the user's manual confirmation. If it proves broken for a real mouse, apply the same `forceFallback`
  /pointer approach as ISSUE-1 and add a `tests/browser/` guard.

---

## Sprint 1 — hazard fixes (2026-06-14, mega-roadmap)

All TDD (failing test first), all confirmed via the full gate (type-check + oxlint 0/0 +
800 jsdom + 11 browser). Evidence: `docs/reviews/research-2026-06-14/sprint1-*.md`.

| ID | Sev | Area | Fix | Test |
|----|-----|------|-----|------|
| REDACT-DOCX | P0 | DOCX/MD/TXT export | Redacted source text **leaked** into flow export (extractor read source text, ignored redaction overlays). Now `flowDoc.reconstructPage` drops any text item under a redaction rect; `_extractFlowDoc` passes per-page redactions. | `tests/utils/flowDocRedaction.test.ts` (RED proved leak) |
| MEMLEAK | P1 | Undo stack | `ReplaceSourcePdfBytesCmd` pinned multi-MB pdf.js docs; evicted/cleared commands never freed them. Added optional `Command.dispose()`; `historyManager` calls it on overflow-eviction, dropped redo branch, and `clear()`. **Teardown via `doc.loadingTask.destroy()`** (pdfjs v6 has no `PDFDocumentProxy.destroy()` — the first draft was a no-op). Destroys only non-live docs (use-after-free safe). | `tests/core/historyManagerDispose.test.ts` (10) |
| TRUEEDIT-XOBJECT | P1 | Edit text | True-edit on Form-XObject text **silently did nothing**. `findTarget` now flags `inXObject`; handler treats it as a miss → falls back to overlay (redact+text). | `contentStreamEditor` + `textEditHandler` tests |
| TRUEEDIT-OVERBLANK | P1 | Edit text | Editing a word **wiped a distinct neighbor** within 4pt. Shadow-blank radius 4pt → 0.5pt (only true same-origin ops blanked). | `contentStreamEditor.test.ts` |
| A11Y-CANVAS | P1 | a11y | Placed annotation elements had no role/tabindex/name → invisible to keyboard + SR. Added `role`/`tabindex=0`/`aria-label` (via `t()`). WCAG 2.1.1/4.1.2. | `elementLayerRenderer.a11y.test.ts` |
| A11Y-TOAST | P1 | a11y | Toasts not announced. Added `role=status`/`aria-live=polite`/`aria-atomic` to the live region. WCAG 4.1.3. | `toastQueue.a11y.test.ts` |
| I18N-UPDATE-TOAST | P1 | i18n | Hardcoded English app-update toast shown to FR/AR users → now `t('toast.appUpdateAvailable')`. | `main.swUpdate.test.ts` |

> **Known limitation (unchanged):** redaction geometry on **rotated pages** is approximate in
> both the PDF and the new flow-export path — pre-existing, not introduced here. Tracked in the
> mega-roadmap (`docs/plans/mega-roadmap-2026-06-14.plan.md`).
> **Behavior note:** standard-font text inside a Form XObject now also routes to the overlay
> path (previously could true-edit) — safe, but a deliberate trade for fixing the silent no-op.

---

## Sprint 2 — fidelity (2026-06-14, mega-roadmap)

All TDD (failing test first), confirmed via the full gate (type-check + oxlint 0/0 + **832** jsdom +
**11** browser) and a real-Chrome manual QA pass (PDF render + DOCX export, 0 console errors; exported
DOCX verified to carry the new margins/spacing/font/floating-image XML). Evidence:
`docs/reviews/research-2026-06-14/01-true-edit.md`, `02-docx-fidelity.md`.

### Workstream A — true PDF text-edit correctness
| ID | Sev | Area | Fix | Test |
|----|-----|------|-----|------|
| A-1 (B4) | P1 | Edit text | XObject / refused edit was a **silent no-op at commit time** (typed text vanished). Handler now captures the overlay context (bbox + sampled bg/fg colors) when the inline input opens, and on a `replaceTextAt`=false commit falls back to the **overlay** (redact+text) via a shared `_emitOverlay`. | `textEditHandler.test.ts` |
| A-2 (B3) | P1 | Edit text | `replaceShowOpHex` on a multi-segment `TJ` array replaced **only the first** hex item, leaving stale old glyphs. Now writes the full payload into the first hexstring and **blanks every other** hex item — no stale text survives. | `contentStreamEditor.test.ts` |
| A-3 (B2) | P1 | Edit text | `cmapHexToUnicodeStr` used a length-parity guess → wrong decode for ligatures / non-BMP. Now decodes ToUnicode dst as **UTF-16BE code units** (4 hex/unit), combining surrogate pairs and guarding a lone surrogate. | `contentStreamEditor.test.ts` |
| A-4 (B5) | P1 | Edit text | `blankAllNearby` blanked distinct neighbours sharing an origin (origin-only proximity). Now restricted to true shadow/outline duplicates — **same font key + size + identical payload** (payload captured before mutation). | `contentStreamEditor.test.ts` |
| A-5 | P2 | Edit text | **Defensive routing**: Type3 fonts, vertical writing (Type0 `-V` CMap), and invisible text-render-mode (`Tr` 3/7) now **refuse** true-edit (→ A-1 overlay) instead of producing garbage / painting over scans. `renderMode` tracked in `locateTextOps`. | `contentStreamEditor.test.ts` |

### Workstream B — PDF→DOCX fidelity
| ID | Sev | Area | Fix | Test |
|----|-----|------|-----|------|
| B-1 | P0 | DOCX | Every non-Arial/Times/Courier face collapsed to **3 generics**. New 28-entry `WORD_FONT_ALLOWLIST` + `resolveWordFont` (strips subset tag/style/foundry suffix) maps Calibri/Garamond/Verdana/Georgia/… to real Word faces; unknown faces still fall back to serif/sans/mono. | `flowDocFidelity.test.ts` |
| B-2 | P0 | DOCX | No page margins emitted → Word forced 1″ margins (global drift). Margins now derived from per-page text bbox (Q1/Q3 glyph edges, outlier-robust), clamped to `[0, 40% of page dim]`, emitted as `w:pgMar`. | `flowDocExtraction.test.ts` |
| B-3 | P0 | DOCX | No paragraph/line spacing → flat Word default rhythm. `reconstructColumn` now records line height + inter-para gaps (clamped); writer emits `w:spacing before/after/line`. | `flowDocFidelity.test.ts` |
| B-4 | P1 | DOCX | Images were dumped **center-aligned after all text**. Now emitted as **floating anchored** `ImageRun` (`wp:anchor`/`wp:posOffset`, page-relative EMU, Y-flipped) at their PDF coords. Still routes through `word/media/` (ISSUE-3/4 guard intact). | `flowDocFidelity.test.ts` |
| B-5 | P2 | DOCX | Justified text became left; indentation dropped. Added `'justify'` to the alignment union (both-edges-flush detection) + first-line/left `w:ind`; tightened `isCentered` so full-width justified blocks aren't misread as centered. | `flowDocFidelity.test.ts` |

> **Still deferred (research-confirmed multi-day / fundamentally hard):** lattice tables (vector ruling
> detection), vector graphics → region rasterization, recursive 3-col XY-cut, rotated-page true-edit,
> RTL logical reordering / Arabic normalization, `cm` scale+rotation in the Path-3 redraw. Tracked in
> `docs/plans/mega-roadmap-2026-06-14.plan.md`.

---

## Sprint 3 — fidelity & UX deep sweep (2026-06-15, mega-roadmap)

Hybrid method: 3 parallel static-research agents (raw findings → `docs/reviews/research-2026-06-15/`)
+ main-loop empirical work + TDD. Full gate per fix (type-check + oxlint 0/0 + **842** jsdom + **11**
browser). **Fidelity scorecards** (honest done/reachable/ceiling, and *why true-edit overlays some
text*): `docs/reviews/research-2026-06-15/scorecard-docx.md`, `scorecard-trueedit.md`.

| ID | Sev | Area | Fix | Test |
|----|-----|------|-----|------|
| UX-TEXT | P0 | Editor UX | **editText blank-click trap** (user-reported): a blank-area click dropped a fixed unselectable box and never left `editText`, where elements are `pointer-events:none` → "keeps adding/displacing text, can't resize/rotate/delete". editText now **edits existing text ONLY** (blank click re-shows the hint); new text uses the draw-to-place `addText` tool (split-button default, auto-switches to select). Reverts the ISSUE-5 unification. | `textEditHandler.test.ts`, `issue5-unified-text.browser.test.ts` |
| DOCX-LIST | P1 | DOCX | Ordered-list markers widened: decimal `(1)`/`1)` + lower/upper-alpha **paren** forms `a)`/`(a)`/`A)`/`(A)` (never bare-dot — dodges author-initials), each → docx `LevelFormat` (decimal/lowerLetter/upperLetter); writer maps each (format,text) to its own numbering reference (legacy decimal `%1.` keeps `ordered-list` id). | `flowDoc.test.ts`, `flowDocWriters.test.ts` |

**Reachable, queued (file:line + fix in the scorecards / `01-docx-gaps.md` / `02-trueedit-matrix.md`):**
DOCX — hyperlinks (getAnnotations→`ExternalHyperlink`), JPEG re-encode (S), list nesting, spot-color
black-collapse, super/subscript, underline/strike, H4–H6. True-edit — **TJ kerning preservation
(biggest-ROI)**, Path-3 fill-color canvas-sample fallback, number-tokenizer exponent.

**Ceiling (confirmed fundamentally hard client-side):** lattice/borderless tables, vector→raster,
recursive 3-col XY-cut, RTL logical reorder + Arabic forms, exact subset-font faces; true-edit
cm-scale/rotation Path-3 redraw, rotated-page input placement, Type3, Arabic shaping.

---

## Verified working (regression-guard candidates)
PDF export (all PDF types) · DOCX/MD/TXT **text** extraction · single body-text true-edit (live+PDF+DOCX
consistent) · annotation create/move/resize · undo/redo · page nav · zoom · find-in-page · QR panel ·
Sign modal · EN/FR/AR + RTL (no missing keys) · modals (Esc-close).

## Cross-cutting — browser test harness (DONE)
`@vitest/browser` + Playwright (system Chrome via `channel: 'chrome'`) now drives real-browser tests:
`npm run test:browser` (config: `vitest.browser.config.ts`; tests: `tests/browser/*.browser.test.ts`).
This is the structural fix that makes ISSUE-1..5 catchable; jsdom never can.

> **CI:** `.github/workflows/deploy.yml` runs `type-check → lint → test (jsdom) → test:browser → build`.
> The browser step uses the runner's system Chrome (`channel: 'chrome'`) after `playwright
> install-deps chromium`. If a future runner image lacks Chrome, switch the config to a
> Playwright-managed chromium or add `npx playwright install chromium`.

---
_Last updated: 2026-06-15 (mega-roadmap Sprint 3: text-tool UX trap fix + DOCX lettered ordered-lists
+ fidelity scorecards; jsdom 842 / browser 11). Evidence: `docs/reviews/research-2026-06-15/` (scorecards
+ 01-docx-gaps + 02-trueedit-matrix + 03-ux-a11y). Prior: `docs/reviews/2026-06-14-qa-sweep-findings.md`,
`docs/reviews/research-2026-06-14/01-true-edit.md` + `02-docx-fidelity.md`
+ per-fix tests (832 jsdom / 11 browser) + real-Chrome manual QA._
