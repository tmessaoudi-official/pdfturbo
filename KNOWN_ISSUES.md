# PDFturbo — Known Issues & Roadmap

Living tracker of confirmed defects with reproduction, root cause, fix direction, and the regression
test each one needs before it can be called "fixed with confidence."

- **Proof:** every entry was reproduced in a real browser. Full evidence + method:
  [`docs/reviews/2026-06-14-qa-sweep-findings.md`](docs/reviews/2026-06-14-qa-sweep-findings.md).
- **Blockers-to-100% (all domains, test-backed):**
  [`docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md`](docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md)
  — 11 blockers proven by `tests/blockers/*.blockers.test.ts` (`it.fails` convention), incl. P0
  AES-128 encryption. **CORE-P0-1 update (2026-06-15):** the rotated-redaction P0 was empirically
  re-scoped — the PDF **raster** path is correct; the real leak was the **flow-export** path
  (DOCX/MD/TXT) and is now **fixed** (see `REDACT-ROT` below).
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
| REDACT-ROT | P0 | Redaction / DOCX-MD-TXT export | **Redacted text leaked into flow export (DOCX/MD/TXT) on rotated pages.** `_extractFlowDoc` passed redaction rects in editor DISPLAYED space, but `reconstructPage`/`isItemRedacted` compare against pdf.js text items in UNROTATED content space — on 90/180/270 pages the spaces mismatched and the box missed the text. Fix: `reconstructPage` takes `pageRotation` and un-rotates each rect via new `geometry.redactionRectToContent` (identity at 0°). **The raster PDF path was NOT affected** — empirically verified pixel-accurate at all four rotations (the original research claim pointed at `exportPipeline.ts:225` fillRect, which is correct). | `tests/browser/blockers-redaction.browser.test.ts` (RED→GREEN @ 90/180; raster pins all 4 rotations), `tests/core/exportCoords.test.ts` (helper) |

| LOCK-AES | P0 | Encryption ("Lock PDF") | **"Lock PDF" produced AES-128 (V4/AESV2) and silently cleared every permission bit** (print/copy/a11y denied), with owner password defaulting to the user password (theater). Fix: `src/export/encryption.ts` `encryptPdf` bumps the header to `1.7ext3` → **AES-256 (V5/R6/AESV3)**, passes `FULL_PERMISSIONS`, and `modalBinder` generates a random distinct owner password when blank. | `tests/blockers/core-security.blockers.test.ts` (AES-256 + perm bits + decrypt round-trip) |
| SIGN-RESIGN | P1 | E-signing | **Re-signing an already-signed PDF threw an opaque ByteRange crash** (pdf-lib full re-save corrupts the existing signature). `PdfSigner._assertNotAlreadySigned` now detects `/ByteRange` + a sig SubFilter and refuses with a typed `ALREADY_SIGNED` SignError. (PAdES SubFilter stays a ceiling — node-forge can't add the ESS signed attribute.) | `tests/blockers/signing.blockers.test.ts` (S3) |

> **Residual (honest):** the flow-export redaction fix derives the un-rotate dims from the
> export viewport, so a source page with an **intrinsic `/Rotate`** (rare; e.g. some scans)
> combined with redaction may still be approximate — the common case (user-applied rotation on
> an un-rotated source) is now exact. The PDF **raster** redaction path is exact at all rotations.
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

## All-Features → 100% sprint (2026-06-17) — 22 reachable gaps closed

A 10-lens bounded audit (raw plan: `docs/plans/all-features-to-100.plan.md`, intentionally untracked)
split every feature into **reachable gaps** (closeable client-side) and **structural ceilings** (next
section). All 22 reachable, non-gated gaps were closed — each TDD (failing test first), full gate green
(type-check + oxlint 0/0 + jsdom + browser where relevant), **one commit per gap**. Push is manual.

| ID | Area | Fix | Commit |
|----|------|-----|--------|
| G1 | Undo | Shape stroke colour/width, comment body, code/QR payload re-edits go through Commands (were direct mutations → broke undo) | `7f24113` |
| G2 | Redaction export | Burn honours a user-rotated box's own `rotation` (was AABB over/under-cover) | `c862ee5` |
| G3 | Pages | Blank-page insert is undoable (`InsertBlankPageCmd`) | `618d4e4` |
| G4 | Vector export | Element rotation baked for arrow/ellipse/freehand (handle was shown, not baked) | `8ac36ff` |
| G5 | Sanitizer | Strip annotation/field JS (`/AA`+`/A`), XFA, page XMP, `/AF`, trailer `/ID` | `1a17239` |
| G6 | Encryption | Password-strength gate + first encryption tests | `de42285` |
| G7 | True-edit | Cover sized to the run bbox, not `max(width,40)` (was "covers word, edits char") | `136bbe0` |
| G8 | True-edit | Prefill the inline editor from the matched op text, not one pdf.js glyph | `28e1a18` |
| G9 | DOCX | Lattice tables → real `docx.Table` (were ~5% recognised) | `c70418f` |
| G10 | DOCX | Pin Separation/spot-colour→DOCX colour contract (was a non-issue; regression test) | `deae397` |
| G11 | DOCX | Promote bold/all-caps body-size lines to headings | `61a1619` |
| G12 | DOCX | Interleave typed overlay text into the page by reading order (was appended) | `e8bc691` |
| G13 | Search | Whole-document find with cross-page navigation (was single-page) | `5f0fce3` |
| G14 | Forms | Checkbox/radio/dropdown/listbox AcroForm fill + bake (were dropped) | `f7dd0b6` |
| G15 | OCR | Cardinal page-rotation support in the searchable layer | `10cdf0c` |
| G16 | PWA | Update prompt is click-to-reload (was notify-only) | `7eec7ff` |
| G17 | Thumbnails | Composite overlay annotations + ink (were source-only) | `ffc609d` |
| G18 | OCR | Searchable-layer word width matched via per-word `Tz` | `8422021` |
| G19 | Export | Native Save-As on page/image/CSV/DOCX/sanitize paths | `ac7d710` |
| G20 | Export | Resolution + JPEG/PNG control for page-image export (was fixed scale-2 PNG) | `fc9806d` |
| G21 | XFDF | Round-trip ink/square/circle/line annotations | `0599504` |
| G22 | a11y | axe-core CI gate + 2 serious WCAG fixes (contrast, footer-link underline) | `0e53125` |

> Not pushed yet — `git push` triggers the deploy; the pre-push hook re-runs the full cumulative gate.

---

## Structural ceilings — the honest limit of "100% in the browser"

These are **not defects** and **not on a fix list**. They are the points where a pure client-side,
no-backend PDF editor hits a hard wall: the glyph outline literally isn't in the file, the target format
can't represent the source, or the library/spec doesn't expose the operation. Each is documented with the
**escape-hatch** that *would* lift it and the **trade-off** of taking it — so a future session doesn't
re-investigate a solved-as-impossible item.

> **Decision 2026-06-17: none greenlit.** The cost (multi-MB deps, multi-week builds, or breaking the
> no-backend / selectable-text promises) isn't justified by current need. Revisit **per-item** only when a
> real user need forces it. Class is [Inferred: cross-verified in code during the 10-lens audit]; escape-hatch
> feasibility is [Speculative] unless noted; effort is [Speculative].

### Escape-hatch families (the levers — most ceilings map to one)

| EH | Lever | Unlocks | Pros | Cons / trade-off |
|----|-------|---------|------|------------------|
| **EH-A** | **PDFium-WASM** — Google's PDF engine compiled to WASM; page-object text API (e.g. `FPDFText_SetText`) | True in-place edit of *any* font incl. subset/CID/Type3 (C1–C4) | The only path to faithful in-place editing of real-world PDFs; battle-tested engine | ~several-MB wasm payload (whole app precache is ~5 MB today); large integration surface (a 2nd engine beside pdf.js + pdf-lib); Apache-2.0/BSD licence review; CI/build complexity. [Unverified: PDFium WASM text-edit completeness not validated in-repo] |
| **EH-B** | **HarfBuzz-WASM** (shaping) **+ bidi-js** (UAX#9 bidi — *already a dep*) | Arabic/complex-script char-level shaping + mixed LTR↔RTL single-line reorder + tashkeel GPOS (C2-shaping, C8, C18, C19) | Correct complex-script layout; reuses the already-present bidi-js | Another wasm dep; the shaping↔ToUnicode tension still blocks *exact search* (see C14); word-level RTL already covers the common case |
| **EH-C** | **Page-as-image** — rasterise each page, embed as one image in the output | DOCX/export **pixel-identity** (C5) | Trivial to build; visually exact | **Destroys all editable/selectable/searchable text** — a real regression for the primary DOCX use-case; very large files. "Looks-exact" niche only |
| **EH-D** | **Server-side conversion** — headless LibreOffice (`soffice --convert-to docx`) or a render service | Best-in-class PDF→DOCX identity (C5); any heavy transform (C6/C11/C15 TSA) | Highest fidelity available anywhere | **Breaks the core no-backend / nothing-uploaded privacy promise** — the project's whole identity. Off the table unless that promise is renegotiated |
| **EH-E** | **Whitespace-inference table detection** — cluster text by gaps, infer columns without ruled lines | Borderless tables → DOCX & CSV (C9, C13) | No new dep; pure heuristic | Chronic false positives (aligned prose misread as a table); needs a confidence gate + corpus tuning. Lattice (ruled) tables already work |

### The ceilings (C1–C21)

| ID | Ceiling | Why structural | Escape-hatch |
|----|---------|----------------|--------------|
| C1 | True in-place edit of subset/CID fonts with a **new** glyph | The new character's outline is **absent from the embedded subset** — it cannot be drawn in the original font client-side | **EH-A**. Today: Path-2 reuses in-subset glyphs; new glyphs → base-14 redraw or overlay |
| C2 | Arabic in-place true-edit | Subset CID font + no client-side shaping/bidi → would emit `?` / mis-join | **EH-A** (glyphs) + **EH-B** (shaping). Today: refuses → overlay (which renders correctly via the Arabic overlay path) |
| C3 | Type3 / Form-XObject true-edit | Type3 glyphs are CharProcs; XObject text lives in its own coordinate space | **EH-A**. Today: refuses → overlay |
| C4 | `cm` rotation/shear in the Path-3 redraw | Standard-font redraw uses identity `Tm`; translation survives, rotation + typeface are lost | **EH-A**. Today: translation-only redraw |
| C5 | PDF→DOCX **pixel-identity** | Fixed-layout PDF → reflowable DOCX is lossy by definition | **EH-C** (image, kills text) or **EH-D** (server). Target is high-fidelity *editable*, not identical |
| C6 | DOCX subset-font **face** | Subset tag strips the real family name; only a heuristic family map remains (~75% face accuracy) | **EH-D**, or font-fingerprint matching (heavy, fuzzy). Content is exact; only the typeface is approximate |
| C7 | DOCX CJK font-face | No universal CJK family; forcing one risks Han-unification mis-render. **Content is preserved** — only the face is approximate | Per-script `w:eastAsia` mapping (still a guess); Word's own fallback renders the codepoints |
| C8 | DOCX char-level bidi / mixed LTR+RTL single line | Word-level reorder only; true bidi needs UAX#9 + shaping | **EH-B** |
| C9 | DOCX **borderless** tables | No ruled lines to detect | **EH-E** |
| C10 | DOCX 3+ column recursive XY-cut | Reconstructor is 2-column; recursive cut is a research-grade layout problem | Recursive XY-cut algorithm (multi-day, FP-prone) |
| C11 | DOCX internal GoTo links / sheared images / exact ICC spot colour | No DOCX representation / no client ICC engine | Mostly **EH-D**. External (URL) links already work |
| C12 | Markup-annotation flatten (#62b) | pdf-lib has no generic markup-flatten API | Raster path (already covers the nuclear redaction-rasterise case) |
| C13 | Borderless table → CSV | Same as C9 (no grid lines) | **EH-E** |
| C14 | Arabic searchable-OCR **exact search** (~60% ceiling) | Shaping yields contextual glyphs with incomplete pdf-lib ToUnicode; a clean-ToUnicode PoC was tried + **rejected** (it traded the artifact for RTL order reversal in `getTextContent`) | **EH-B** + a richer ToUnicode writer. Selectable / screen-reader-accessible text already works |
| C15 | OCR recognition **accuracy** (~85–95% on clean scans) | tesseract LSTM model bound | A cloud OCR (breaks the **EH-D** promise) or a larger local model |
| C16 | Encryption R6 hash-hardening | `@cantoo/pdf-lib` hardcodes `R:5` | Fork/patch the lib, or a custom AES-256 R6 writer. AES-256 R5 is already strong |
| C17 | PAdES / TSA / LTV / CA-trusted signatures | node-forge can't emit the ESS signing-cert-v2 signed attribute PAdES-BES needs; TSA/LTV need a backend | Hand-rolled CAdES ASN.1 (large) + **EH-D** for TSA. Multi-sig is **reachable-but-L** (needs an incremental-update writer). Valid ISO-32000 `adbe.pkcs7.detached` ships today |
| C18 | RTL text-layer select/copy/search **precision** | pdf.js v6 builds the layer as per-glyph, visual-order, presentation-form spans; highlight is item-level | **EH-B** for sub-character precision. Copy/search logical reconstruction already works |
| C19 | Arabic overlay tashkeel/GPOS micro-positioning | Needs a GPOS shaper; legibility is already fine | **EH-B** |
| C20 | XFDF Acrobat byte-exactness + rotated-page coords + freetext DA appearance | No Acrobat in-repo to verify against; rotated-page transform unimplemented | Internal round-trip is the correctness guarantee; rotated-page coords are reachable-but-deferred |
| C21 | Raster ink — no per-stroke edit | Rasterised by design | Use the **vector** freehand tool (the built-in escape) |

---

## Crop tool (#G23) — SHIPPED 2026-06-17

Per-page crop: a `crop` tool mode + drag-rect (`DrawingHandler`) → `PageService.cropPage` maps the drawn
display-space rect into unrotated content space (`redactionRectToContent`) and stores `DocumentPage.crop`
(rotation-invariant; persists via `toJSON`'s `pages`, **no SCHEMA_VERSION bump** — loader restores `pages`
wholesale). Export clips via `page.setCropBox` in `buildPageOverlays`, applied **last** so overlays draw in
source space first (element/ink positions unaffected); Bates/watermark use the cropped "effective box";
raster + thumbnail + export-preview inherit it (all route through `getPageCropBox`). Undoable
(`SetPageCropCmd`); **apply-to-all** = one `MacroCmd` (clamped per page). Live editor preview = dimmed-margin
frame (Design β — full page renders, no pdf.js sub-region). **Full rotation support** (the crop maps through
the page's effective rotation). Gated `VITE_FEATURE_CROP` (#28; default ON → byte-identical export when no crop).
Guards: `tests/utils/cropGeometry.test.ts`, `tests/core/{historyManagerCommands,pageService}.test.ts`,
`tests/export/cropCropBox.test.ts`, `tests/browser/crop-tool.browser.test.ts`.
**v1b ceilings:** resizable crop-rect handles / numeric margin inputs (v1 = drag-to-set + re-drag + ⤺ Remove);
apply-to-all uses identical content-space margins clamped per page (not aspect-aware across differing sizes);
markup annotations authored elsewhere aren't clipped at the content-stream level (the CropBox hides them, as
PDF viewers do).

## Deferred features (next — NOT part of the "100%" mandate)

- **Arabic native-speaker review** — one human pass over the AR locale + RTL rendering (non-engineering).

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
_Last updated: 2026-06-17 (All-Features→100% sprint: 22 reachable gaps G1–G22 closed + 21 structural
ceilings C1–C21 documented with escape-hatch families & trade-offs). **Crop tool (#G23) shipped 2026-06-17** —
per-page, rotation-aware, undoable crop via `setCropBox`; dimmed-margin live preview; gated `VITE_FEATURE_CROP`.
Prior 2026-06-14 (mega-roadmap Sprint 3 batch 2: DOCX hyperlinks + JPEG re-encode + list nesting
+ headings H4–H6 + true-edit TJ-kerning preservation; jsdom 858 / browser 12). Prior batch 1: text-tool
UX trap fix + DOCX lettered ordered-lists + fidelity scorecards (jsdom 842 / browser 11).
Evidence: `docs/reviews/research-2026-06-15/` (scorecards
+ 01-docx-gaps + 02-trueedit-matrix + 03-ux-a11y). Prior: `docs/reviews/2026-06-14-qa-sweep-findings.md`,
`docs/reviews/research-2026-06-14/01-true-edit.md` + `02-docx-fidelity.md`
+ per-fix tests (832 jsdom / 11 browser) + real-Chrome manual QA._
