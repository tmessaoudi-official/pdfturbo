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
_Last updated: 2026-06-14 (browser-harness fix execution). Evidence:
`docs/reviews/2026-06-14-qa-sweep-findings.md` + this run's per-issue browser tests._
