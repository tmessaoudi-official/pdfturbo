# QA-Sweep Findings — 2026-06-14

**Method:** Real-browser QA via Playwright MCP against `npm run dev` (`http://localhost:5173/pdfturbo/`),
combined with in-page instrumentation: pdf.js `getOperatorList`/`getTextContent`, in-page ZIP
unpacking of exported DOCX (`DecompressionStream('deflate-raw')`), blob capture via a
`URL.createObjectURL` hook, and canvas pixel-density sampling of exported PDFs.

**Why this pass found what unit tests don't:** every confirmed defect below lives in the
real-browser layer — pointer drag, canvas-coordinate→content-stream matching, and
`ImageBitmap`/`VideoFrame` canvas extraction. The Vitest suite runs in **jsdom**, which exercises
none of these. The suite is green and stays green while these defects ship. The fix is not more
jsdom tests — it is a **browser-level regression harness** (see "Regression tests required" per issue).

**Console health:** 0 uncaught errors across the entire session. Every defect is a *silent*
logic/behavior failure (which is exactly why code review + jsdom tests passed them).

---

## Test matrix — exports across 5 PDFs

| PDF | pages | source image ops | DOCX text runs | DOCX media (images) | MD | PDF export |
|---|---|---|---|---|---|---|
| `test-document.pdf` (590 B, minimal) | 1 | 0 | 1 ✓ | n/a | ✓ | ✓ valid |
| `AttestationDeDroits` (161 KB, official) | 2 | 8 | 30 ✓ | **3** ⚠ (partial) | ✓ | ✓ valid |
| `AUDENSIEL` CV (287 KB) | 4 | 4 | 166 ✓ | **0 ✗** | ✓ | ✓ valid |
| `qa-imageonly.pdf` (image, no text) | 1 | 1 | **no file ✗** | — | **no file ✗** | ✓ valid |
| `qa-imagetext.pdf` (image+text) | 2 | 2 | 4 ✓ | **0 ✗** | ✓ | ✓ valid |

(`qa-imageonly.pdf` / `qa-imagetext.pdf` are synthetic fixtures generated with `@cantoo/pdf-lib`
for this sweep — see "Fixtures" below.)

**PDF export (`Download filled PDF`) is rock-solid across all 5** — every output is a valid `%PDF-`,
round-trips text item count and image-op count identically to the source. No defects found in PDF export.

**DOCX/MD text extraction is accurate** for every text-bearing PDF (headings, body, lists, RTL).

---

## ISSUE-1 — Toolbar drag / sort is non-functional  ·  Severity P1  ·  [Verified]

**Symptom:** Toolbar items cannot be dragged or reordered; the feature does not exist at runtime.

**Evidence:**
- All toolbar `<button>`s report `draggable === false`.
- No `Sortable` instance attached to any toolbar node; `window.Sortable === undefined`.
- A full synthetic pointer-drag (pointerdown → 10× pointermove → pointerup) between two toolbar
  buttons produced **zero change** in DOM order (before === after).
- `Settings → Toolbar → "↺ Reset toolbar to default"` ships, but is **orphaned**: there is no drag
  handle and no "customize" mode, and `localStorage` holds no toolbar-layout key
  (only `i18nextLng` + `pdfturbo_storage_notice`). Nothing can create a layout to reset.

**Status vs. intent:** The handoff notes "Toolbar DnD overhaul" as *next planned feature, not started*.
So this is closest to **unbuilt**, not regressed — but the shipped "Reset toolbar" button advertises a
capability that does not exist, which reads to users as "broken."

**Fix direction:** Build the DnD (e.g. SortableJS on `.toolbar-group`), persist layout to
`localStorage`, wire the existing reset button. Until then, hide the orphaned reset button.

**Regression test required (browser):** Playwright — drag button A past button B, assert DOM order
changed and persists across reload.

---

## ISSUE-2 — True text edit loses the replacement on heading / styled-font text  ·  Severity P1  ·  [Verified, pixel-confirmed]

**Context:** The edit-text tool now has a genuine content-stream editor
(`input.true-edit-input`, `contentStreamEditor.ts`) that replaces text in place — confirmed working.
FEATURES.md §38 still documents only the *old* overlay approach and is stale (see FEATURES update).

**What works (verified end-to-end):** Editing **body text** replaces it in the actual content stream,
consistently across the live view, the exported PDF, and the exported DOCX:
- `"…C#, Bash"` → `"…C#, Go"` — present in live + PDF + DOCX; old text gone in all three.
- `"Symfony, Angular, API Platform, Spring Boot, Vue.js, React"` → `"Symfony, Angular, NestJS, Spring Boot"`
  — clean replacement; the edited line in the exported PDF reads exactly the new text.
  (Note: `"API Platform"` still appears elsewhere in the exported PDF — those are *legitimate*
  occurrences in the page-2/3 experience bullets, not edit residue. Verified by location.)

**The bug:** Editing a **heading / large styled-font** item deletes the original but the replacement
is lost from the PDF:
- Target `"Compétences techniques"` → `"ZZZSENTINEL Skills Section"` (unique sentinel, 1.8 s settle).
- Result: original deleted everywhere ✓; new text present in **DOCX only**; **absent from the live
  view and the exported PDF** (text extraction finds nothing).
- **Pixel proof:** rendering the exported PDF page 1, the heading band has **0 dark pixels**, while
  the adjacent "Langages" row has **1136** — the replacement is neither drawn nor extractable. This is
  **data loss**, not a non-extractable-glyph case.

**Root cause (high confidence):** font/glyph embedding for the heading's subset font — the
Helvetica-fallback limitation already noted in `docs/reviews/2026-06-11-pdf-text-editing-verdict.md`
(Phase B/C). Body text edits succeed because their font has the needed glyphs; heading edits produce
no renderable glyphs and the new run is dropped.

**Also observed:** live `.textLayer` only reflects the currently-rendered page(s), so a single-page
live check can disagree with a whole-document export check. Not a bug, but a QA gotcha — verify
exports across all pages, not just the live view.

**Fix direction:** when the original font cannot encode the new characters, embed a fallback font
(e.g. a bundled Helvetica/NotoSans) and write the run with it; never delete-without-replace. Surface a
warning when a true-edit cannot preserve the glyphs.

**Regression test required (browser):** edit a heading, export PDF, assert the new string is both
text-extractable AND renders ink (pixel check) at the expected location.

---

## ISSUE-3 — DOCX export drops images stored in pdf.js `commonObjs`  ·  Severity P1  ·  [Verified, root-caused]

**Symptom:** Images are missing from exported DOCX for some PDFs (CV: 0 of 4; `qa-imagetext`: 0 of 2)
but present for others (`AttestationDeDroits`: 3 of 8).

**Root cause (two factors, both proven):**
1. **Primary — wrong object store.** pdf.js stores document-shared / deduplicated images as *global*
   objects in `page.commonObjs` with a `g_` name prefix (e.g. `g_d0_img_p1_1`). The extraction reads
   `page.objs` only. For such images, `page.objs.has(name) === false` and `page.commonObjs.has(name) === true`
   → the image is silently skipped. (`AttestationDeDroits` images extract because they are page-local
   in `page.objs`.)
2. **Secondary — bitmap type.** pdf.js v6 stores decoded bitmaps as `VideoFrame` (the CV's case), not
   `ImageBitmap`. Any `instanceof ImageBitmap` guard fails. Confirmed the `qa-imagetext` image is
   `ImageBitmap` + `commonObjs` and was *still* dropped → the `commonObjs` miss is the primary cause.

**Proof the image is recoverable:** `ctx.drawImage(videoFrame, 0, 0)` followed by `toDataURL('image/png')`
produced a **111 KB PNG** for the CV's logo. The pixels are available; only the lookup + type-guard are wrong.

**Fix direction:** look up images via `page.commonObjs.get(name)` when `name` starts with `g_` (or
`commonObjs.has(name)`), falling back to `page.objs`; treat the bitmap as a generic `CanvasImageSource`
(`drawImage` accepts `VideoFrame`, `ImageBitmap`, and `HTMLCanvasElement`) instead of gating on
`instanceof ImageBitmap`. Also revisit the `AttestationDeDroits` 8→3 ratio (some images still dropped).

**Regression test required (browser):** export DOCX from a PDF whose image is in `commonObjs`; unzip
and assert `word/media/` is non-empty and the image bytes are valid.

---

## ISSUE-4 — DOCX/MD export silently does nothing on a text-less (scanned/image-only) PDF  ·  Severity P2  ·  [Verified]

**Symptom:** With `qa-imageonly.pdf` (1 image, 0 text), clicking **DOCX** or **MD** produces **no file
and no error**. The button is found, enabled, visible, and clicked; no blob is created within 8 s; the
console logs nothing. PDF export still works on the same document.

**Root cause (inferred):** the flow model is empty (no paragraphs) → the writer early-returns / produces
nothing → no download is triggered. There is no user feedback.

**Fix direction:** when the flow model is empty, either (a) still emit a DOCX/MD containing the page
images (depends on ISSUE-3), or (b) show a toast: "No extractable text — this looks like a scanned PDF."
Never no-op silently.

**Regression test required (browser):** export DOCX from a text-less PDF; assert either a non-empty file
is produced or a user-visible message is shown.

---

## ISSUE-5 — Primary "Add Text" toolbar button enters Edit-Text mode and cannot place a box on blank canvas  ·  Severity P2  ·  [Verified, needs design confirmation]

**Symptom:** Clicking the toolbar button with `aria-label="Add Text (T)"` from SELECT mode sets the mode
badge to **"✎ EDIT TEXT"** (not an add-text mode). Clicking an empty canvas area in that mode creates
**no element** (`true-edit-input`: 0, overlay textarea: 0, text elements: 0). The Text-tools flyout lists
both "Add Text (T)" and "Edit PDF text" as distinct entries, so they are intended to differ.

**Open question:** is "add a text box on blank canvas" reachable at all via the current toolbar? If the
two buttons share one mode, the add-text affordance is effectively missing; if mislabeled, the wiring is
wrong. Needs a maintainer decision on intended behavior.

**Regression test required (browser):** click "Add Text", click blank canvas, assert a new editable
text element is created.

---

## Drag matrix — every element type + sub-elements

| Element | Drag mechanism | Result |
|---|---|---|
| Toolbar buttons | none (`draggable=false`, no handlers) | ✗ not draggable — see ISSUE-1 |
| Toolbar flyout sub-items | none | ✗ not draggable |
| Page thumbnails | `ondragstart` handler present (`draggable=true`) | ⚠ **inconclusive** — neither Playwright `dragTo` nor a full manual HTML5 DnD sequence reordered them; Playwright cannot reliably drive native HTML5 DnD, so this needs **manual** confirmation. Handlers exist, so likely functional. |
| Annotation elements (comment/text/shape) | pointer-based | ✓ **move works** — dragged comment moved by exactly the (160,120) delta |
| Resize handle (sub-element) | pointer-based | ✓ **resize works** — 272×163 → 332×223 |
| Rotation handle (sub-element) | present | ✓ exists (not stress-tested) |

---

## Verified working (no defects found)

- **PDF export** (Download filled PDF) — all 5 PDFs, valid `%PDF-`, text + image ops round-trip.
- **DOCX/MD/TXT text extraction** — accurate for all text-bearing PDFs.
- **Single true-edit on body text** — replaces in content stream; consistent in live + PDF + DOCX; undo restores.
- **Annotation create + move + resize**, undo/redo (true-edit undo restores original cleanly).
- **Page navigation** (1→2→4, boundary buttons disable correctly), **zoom** (in/out/fit).
- **Find-in-page** (matches + highlight), **QR/barcode panel** (12 formats), **Sign modal** (draw/width/color).
- **Language EN/FR/AR + RTL** — full coverage, `dir=rtl`/`lang=ar` applied, **no missing/leaked i18n keys**.
- **Help modal, Settings, File menu** — open/close, Esc closes modals.

---

## Fixtures

Generated for this sweep with `@cantoo/pdf-lib` (run from the project dir so the local dep resolves):

- `qa-imageonly.pdf` — single embedded PNG, no text layer (scanned-PDF proxy).
- `qa-imagetext.pdf` — 2 pages, heading + body + embedded PNG per page.

Recommend moving these to `tests/fixtures/` and wiring them into the browser regression harness.

---

## Priority for the roadmap

1. **ISSUE-3** (DOCX images) — cleanest, fully root-caused, isolated fix; highest confidence.
2. **ISSUE-4** (silent no-op) — small, user-facing; partly depends on ISSUE-3.
3. **ISSUE-2** (heading edit data loss) — needs fallback-font embedding; medium scope.
4. **ISSUE-5** (Add Text mode) — needs a design decision first.
5. **ISSUE-1** (toolbar DnD) — largest scope (essentially a feature build).

**Cross-cutting prerequisite for "100% confidence":** stand up a Playwright (or Vitest-browser) harness
that drives the real app. The current jsdom suite cannot, by construction, catch any of ISSUE-1..5.
