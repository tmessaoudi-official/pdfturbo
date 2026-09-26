# Limits walkthrough Plan

Every open issue and known limitation in `KNOWN_ISSUES.md` / `SECURITY.md` / `CLAUDE.md`, walked one at a time
with the developer on 2026-09-25 (47 items: A = open defects, B = small gaps and doc drift, C = deliberate
bounds, D = structural ceilings and deferred features). Each ruling is below; the Status block holds the work.

## Decisions Log

- [2026-09-25 21:06] AGREED: A1 — measure and fix redaction over VERTICAL text to 100% confidence: a hand-built Identity-V fixture from the bundled font AND a real vertical Japanese PDF, real pdf.js, every rotation, both the leak and the wrongly-dropped direction, sabotage-verified.
- [2026-09-25 21:06] AGREED: A2 — investigate whether text outside a Form XObject's /BBox can be attributed exactly to its form; decide together after; an export warning is the last resort.
- [2026-09-25 21:06] AGREED: A3 — fix OCR "visible" word placement on a user-rotated page with the redaction burn's composed mapping, real-browser tested at 0/90/180/270.
- [2026-09-25 21:06] AGREED: A4 — on the raster (redaction) export path, re-add every link (overlay AND source) that does not meet a redaction, in the clipped canvas frame; a covered link must never return.
- [2026-09-25 21:06] AGREED: A5 — reproduce the overflowing-text-under-redaction case on a blank page first, then test the DRAWN text extent rather than the stored box.
- [2026-09-25 21:06] AGREED: A6 — a failed redacted-thumbnail render shows a "preview unavailable" placeholder, never the plain source page (one new string ×3).
- [2026-09-25 21:06] AGREED: B1 — remove getPageCropBox's (0,0)-origin fallback; pdf-lib's getCropBox already falls back to the MediaBox.
- [2026-09-25 21:06] AGREED: B2 — type MODE_HINT_KEYS as Record<Exclude<ToolMode,'select'>, string>.
- [2026-09-25 21:06] AGREED: B3 — pin in the test that the tesseract caching rule precedes the catch-all .js rule, sabotage-verified.
- [2026-09-25 21:06] AGREED: B4 — cache the Arabic .ttf on first use with a same-origin runtime rule; README note.
- [2026-09-25 21:06] AGREED: B5 — add a "Clear recent files" control; delete the unused canUseFsSave.
- [2026-09-25 21:06] AGREED: B6 — map OCR engine status to two translated labels (loading model / recognizing text).
- [2026-09-25 21:06] AGREED: B7 — correct the Arabic pending count (once, after the new strings land) and the date, and collapse KNOWN_ISSUES' four superseded mirror sections into a short history note.
- [2026-09-25 21:06] AGREED: C1 — keep session storage unencrypted, as designed.
- [2026-09-25 21:06] AGREED: C2 — keep the multi-source layer refusal; the developer checks Claude-generated layer PDFs in Acrobat/Reader.
- [2026-09-25 21:06] AGREED: C3 — the viewer check compares a decoded-pixel hash per painted image (time cost measured before shipping), and wrong refusals are measured on 50–100 more public PDFs.
- [2026-09-25 21:06] AGREED: C4 — keep the damaged-object-plus-any-drop refusal.
- [2026-09-25 21:06] AGREED: C5 — measure once whether pdf-lib's /Info stamp taking over a dangling reference changes any export; close or keep with evidence.
- [2026-09-25 21:06] AGREED: C6 — keep sanitize's refusal on an unparseable object.
- [2026-09-25 21:06] AGREED: C7 — keep the 2026-09-24 ruling: sanitize keeps in-document media actions.
- [2026-09-25 21:06] AGREED: C8 — before a locked save, hoist inline annotations into their own objects so they are encrypted.
- [2026-09-25 21:06] AGREED: C9 — map the drawn signature rect onto the page box read from the assembled bytes signing already builds.
- [2026-09-25 21:06] AGREED: C10 — the developer checks a Claude-generated 2–3-signature PDF in Adobe Reader before any decision to wire incremental multi-sign.
- [2026-09-25 21:06] AGREED: C11 — not a limit: searchable OCR supports cardinal rotations; correct the stale CLAUDE.md line.
- [2026-09-25 21:06] AGREED: C12 — one native Arabic review table at the end, covering the 5 pending and every string this plan adds.
- [2026-09-25 21:06] AGREED: D1 — keep C1's standard-font fallback; correct KNOWN_ISSUES (no engine draws a glyph absent from the file, so PDFium does not lift C1).
- [2026-09-25 21:06] AGREED: D2 — time-boxed PDFium+HarfBuzz evaluation (payload, real success rate); nothing ships without numbers. Also covers D16 highlight precision and D17 vowel-mark positioning.
- [2026-09-25 21:06] AGREED: D3 — keep the Type3 overlay fallback.
- [2026-09-25 21:06] AGREED: D4 — C4 already shipped (A1 full-affine redraw) and C3's XObject half too (A3a/A3b); correct the rows.
- [2026-09-25 21:06] AGREED: D5 — keep: PDF→Word targets editable, not identical.
- [2026-09-25 21:06] AGREED: D6 — measure out-of-allowlist fonts in the corpus, then pass through cleaned real family names (rejecting generated ones); correct the C6 row.
- [2026-09-25 21:06] AGREED: D7 — fold into D6: also write the real name as the w:eastAsia font when present.
- [2026-09-25 21:06] AGREED: D8 — measure mixed Arabic+English lines through the Word export; narrow the C8 row or fix what breaks.
- [2026-09-25 21:06] AGREED: D9 — research a new borderless-table discriminator (column similarity / continuation / alphabetical order); wire into DOCX only at zero false tables with all 5 real ones kept.
- [2026-09-25 21:06] AGREED: D10 — loosen the 4+-column split only with 4/5-column fixtures and a clean corpus re-run.
- [2026-09-25 21:06] AGREED: D11 — map PDF GoTo links to Word bookmarks (and Markdown anchors); sheared images and ICC colour stay limits; correct the row.
- [2026-09-25 21:06] AGREED: D12 — Flatten draws each source annotation's /AP appearance into the page per ISO 32000 §12.5.5, skipping and counting ones with none.
- [2026-09-25 21:06] AGREED: D13 — keep Arabic OCR exact search as a disclosed limit.
- [2026-09-25 21:06] AGREED: D14 — keep OCR accuracy as engine-bound.
- [2026-09-25 21:06] AGREED: D15 — build PAdES-B-B (hand-rolled ESS signing-certificate-v2) verified with the C10 Reader check, and probe public TSAs for browser (CORS) access; correct the "CA-trusted" part of C17.
- [2026-09-25 21:06] AGREED: D16 — fold RTL highlight precision into the D2 spike.
- [2026-09-25 21:06] AGREED: D17 — mirror brackets and place RTL list markers on the right now, without HarfBuzz; vowel marks go to the D2 spike.
- [2026-09-25 21:06] AGREED: D18 — rotation-aware XFDF import/export, plus an XFDF file in the developer's Acrobat checklist.
- [2026-09-25 21:06] AGREED: D19 — keep raster ink as designed.
- [2026-09-25 21:06] AGREED: D20 — a third compress mode that downsamples embedded JPEGs in place, keeping text.
- [2026-09-25 21:06] AGREED: D21 — XFDF gains square/circle/line/ink, multi-line highlights and form <fields>; stamps stay skipped.
- [2026-09-25 22:40] FOUND (A1): `src/` never passes `cMapUrl` to pdf.js, so pdf.js's own `vertical.pdf` extracts NO text in the app; recorded as row 32, not yet ruled.
- [2026-09-26 09:27] FOUND (A3-pre): the thumbnail of a blank page whose rotate button was used composites with userRot = docPage.rotation (exportService `_applyOverlaysToPage`), while the editor and the PDF export draw a blank page unrotated; pre-existing, thumbnail-only, not yet ruled.
- [2026-09-26 08:36] AGREED: A3-pre — one shared fix for every oriented overlay (text, image, signature, code, comment): orientation = page rotation minus element rotation, pivot about the box centre, real-browser tested at page 0/90/180/270 x element 0/90; then A3.
- [2026-09-25 21:06] AGREED: D22 — Bates: reload integration test, restored-value validation, oversized start-number cap.
- [2026-09-26 08:33] AGREED: A3 — first fix the rotated-text export to turn about the box centre as the editor does (own reproduction + tests), then do A3 with rotated OCR words.
- [2026-09-26 11:04] AGREED: A2 — ship the exact filter: drop text runs fully outside their Form XObject's /BBox clip from the Word/MD/TXT and CSV/XLSX exports, attributed by marker injection on a throwaway copy, trigger-gated, fail-open on any ambiguity; a run crossing the edge exports whole (disclosed).
- [2026-09-26 10:58] FOUND (A2 investigation): exact item-level attribution IS possible — wrapping each Form XObject's stream in a unique `BMC … EMC` in a throwaway copy makes pdf.js getTextContent({includeMarkedContent}) bracket every item with its form chain (shared and nested forms included), and the operator list carries the same tags after each paintFormXObjectBegin, so the k-th occurrence pairs with that placement's /BBox clip. Extracted text is unchanged on all 360 corpus pages. Field frequency: 5 fully-hidden items in 1 of 15 real files (attention paper, figure labels, render-confirmed invisible); 13 items 87–95% inside (Inferred box slop and visible — not render-checked; kept either way, and a run crossing the edge would export whole). Cost: the copy re-saves the whole file, up to ~20 s on a 142-page report at load 20 — so it needs a cheap trigger. Not per-glyph: a run half past the edge is one item.
- [2026-09-26 12:17] FOUND (B1 probe): the (0,0) fallback is NOT dead — pdf-lib's getCropBox throws on a malformed /CropBox, and with a MediaBox origin of (50,50) the redaction burn then lands 50pt off and the secret stays visible. Three sibling shapes leak through the same function because it returns pdf-lib's RAW CropBox while pdf.js shows the CropBox ∩ MediaBox: a CropBox past the MediaBox and a disjoint one leave the secret visible, a zero-area one exports a blank 612x792 page. 0 of 360 corpus pages (242 with a /CropBox) diverge. Renders: var/claude/qa-shots/b1/.
- [2026-09-26 12:19] AGREED: B1 (supersedes the 21:06 B1 line) — getPageCropBox returns exactly pdf.js's page view (a valid, non-empty CropBox intersected with the MediaBox, else the MediaBox, else Letter), closing all four shapes.
- [2026-09-26 12:31] FOUND (B1 probe): /UserUnit is a SECOND redaction leak, not ruled. pdf.js scales the viewport by it (`pdf.mjs:826`, a /UserUnit 2 page renders 800x600 at scale 1), so editor coordinates are scaled too, while the bake maps them as raw points: a redaction drawn over the secret in editor space lands at twice the position and the secret stays visible (render var/claude/qa-shots/b1/userunit-2-redacted.png). Passes the source loader; 0 of 360 corpus pages carry /UserUnit.
- [2026-09-26 12:31] FOUND (B1 probe): the searchable-OCR layer (`searchableTextLayer.ts:314`) positions its invisible text with pdf-lib `getSize()` — MediaBox size at origin (0,0) — while the OCR canvas is pdf.js's view, so on a page whose CropBox differs from its MediaBox, or whose MediaBox origin is not (0,0), the searchable text is offset from the words. Placement only, not a leak; 0 of 360 corpus pages have a CropBox that differs from the MediaBox. Not ruled.
- [2026-09-26 13:38] AGREED: /UserUnit — the editor measures in points: one helper divides the viewport scale by the page's UserUnit, every getViewport call in src/ goes through it, and a test bans direct calls.
- [2026-09-26 14:55] FOUND (row 34, crash-recovery review): the redaction raster and lossy compress BUILD a page sized from the points viewport and dropped /UserUnit, so on a /UserUnit 2 document those pages exported at half physical size; both now copy the source's /UserUnit (within the 13:38 ruling, no new decision).
- [2026-09-26 15:20] FOUND (row 34 6C): on a /UserUnit page every raster (redaction page, lossy compress, page-as-image) now renders at 1/u of the physical DPI, because dpiToScale is dpi/72 over a points viewport; disclosed in KNOWN_ISSUES/SECURITY, then ruled and fixed (15:35, row 35).
- [2026-09-26 15:35] AGREED: /UserUnit raster DPI — the three raster outputs (redaction page, lossy compress, page-as-image) multiply only their RASTER scale by the page's UserUnit, so the chosen DPI is physical again; page size stays points + /UserUnit.
- [2026-09-26 15:55] AGREED: row 32 — ship pdf.js's CMap files from the app origin (vendored into gitignored public/pdfjs/cmaps/, runtime-cached by the PWA, never precached); one helper adds cMapUrl + cMapPacked to every getDocument in src/, and a test bans a call that bypasses it.
- [2026-09-26 16:20] FOUND (row 32): pdf.js also loads its JBIG2 / JPEG 2000 decoders (wasm and JS fallback) and ICC module from `wasmUrl`, which src/ never passes, so JBIG2/JPX scan images may not decode — read from pdf.worker.mjs WasmImage, not measured (no fixture); row 36, not ruled.
- [2026-09-26 16:55] FOUND (row 36, measured): without `wasmUrl` all four JBIG2 / JPX test files from pdf.js draw 0 pixels, and 5067 / 5043 / 8192 / 600 with it; `wasmUrl` alone suffices (useWorkerFetch stays false), and so does the pure-JS fallback. Turning worker fetch on as well enables ICC colour management — up to 18 levels per channel on 2 of 8 pages of a corpus paper — so ICC is split into row 37, not ruled. Row 36 ships `wasmUrl` with useWorkerFetch pinned false (scope chosen by the session after the developer picked "row 36, measure first").
- [2026-09-26 08:33] FOUND (A3 probe): on a rotated page (source /Rotate or user rotation) every overlay with content orientation — text, image, signature, code, comment — exports turned by the page rotation, because the glyph/image rotation is degrees(-elemRot) and ignores totalRot; not yet ruled.

## Formal Plan

<!-- written when work starts; each row gets its own TDD + sabotage evidence per CLAUDE.md -->

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | A1 vertical-text redaction measured + fixed | M | done | 2a40782 | src/utils/flowDoc.ts, tests/** |
| 2 | A2 Form /BBox hidden text: attribution investigation | M | done | 76bed69 | src/export/**, src/utils/** |
| 33 | A3-pre oriented overlays export upright on rotated pages + centre pivot | M | done | 94add82 | src/export/pdfElementRenderer.ts, src/export/textExtent.ts, tests/** |
| 3 | A3 OCR visible mode on user-rotated pages | S | done | bf8655e | src/handlers/ocrHandler.ts, tests/** |
| 4 | A4 re-add safe links on the raster export path | M | done | 5bc6dfe | src/export/**, tests/** |
| 5 | A5 overflowing text vs blank-page redaction drop | M | done | 4533a88 | src/export/**, tests/** |
| 6 | A6 redacted thumbnail fails closed | S | done | c2ba354 | src/ui/pageThumbnailPanel.ts, src/export/exportService.ts, locales/** |
| 7 | B1 getPageCropBox returns pdf.js's page view | M | done | 5c2ed18 | src/export/exportPipeline.ts, tests/** |
| 8 | B2 MODE_HINT_KEYS exhaustive by type | S | todo | - | src/core/toolModeService.ts |
| 9 | B3 PWA rule-order guard | S | todo | - | tests/infra/pwaOcrCaching.test.ts |
| 10 | B4 Arabic font runtime cache | S | todo | - | vite.config.ts, README.md, tests/** |
| 11 | B5 clear recent files + delete canUseFsSave | S | todo | - | src/ui/recentFilesMenu.ts, src/utils/fileSystemAccess.ts, locales/** |
| 12 | B6 OCR progress labels | S | todo | - | src/core/pdfTurboApp.ts, locales/** |
| 13 | C3 image pixel hash in the viewer check + wider corpus | M | todo | - | src/utils/viewerCheck.ts, tests/** |
| 14 | C5 dangling reference vs /Info stamp measured | S | todo | - | tests/** |
| 15 | C8 hoist inline annotations before a locked save | M | todo | - | src/export/**, tests/export/exportPasswordSave.test.ts |
| 16 | C9 signature rect mapped onto the assembled page | M | todo | - | src/core/pdfTurboApp.ts, src/signing/**, tests/** |
| 17 | D2 PDFium+HarfBuzz evaluation (incl. D16, D17 marks) | M | todo | - | var/claude/** |
| 18 | D6+D7 real font names incl. eastAsia in DOCX | M | todo | - | src/utils/flowDocWriters.ts, tests/** |
| 19 | D8 mixed-bidi DOCX lines measured | S | todo | - | src/utils/flowDoc.ts, tests/** |
| 20 | D9 borderless-table discriminator research | M | todo | - | src/utils/borderlessTable.ts, tests/** |
| 21 | D10 4+ column split with corpus proof | M | todo | - | src/utils/flowDoc.ts, tests/** |
| 22 | D11 internal links to bookmarks/anchors | M | todo | - | src/export/**, src/utils/flowDocWriters.ts, tests/** |
| 23 | D12 markup annotation appearance flatten | M | todo | - | src/export/**, tests/** |
| 24 | D15 PAdES-B-B + TSA CORS probe | M | todo | - | src/signing/**, tests/signing/** |
| 25 | D17 RTL bracket mirroring + list markers | M | todo | - | src/export/arabicOverlay.ts, src/export/pdfElementRenderer.ts, tests/** |
| 26 | D18+D21 XFDF rotation + more subtypes + fields | M | todo | - | src/utils/xfdf.ts, src/export/xfdfMapping.ts, tests/** |
| 27 | D20 JPEG downsampling compress mode | M | todo | - | src/export/compress.ts, src/ui/compressPanel.ts, locales/** |
| 28 | D22 Bates hardening | S | todo | - | src/ui/batesPanel.ts, src/ui/documentLoader.ts, tests/** |
| 29 | Acrobat/Reader checklist pack (C2, C10, D15, D18) | S | todo | - | var/claude/** |
| 30 | Doc corrections (B7, C11, D1, D4, D6, D11, D15 rows) | S | todo | - | KNOWN_ISSUES.md, SECURITY.md, CLAUDE.md |
| 31 | Arabic review table (5 pending + every new string) | S | todo | - | locales/ar.json |
| 32 | NEW: src/ never passes cMapUrl — CJK text needing pdf.js's CMap files is not extracted | M | done | a16768e | src/infra/**, src/export/** |
| 34 | UserUnit: editor measures in points (one viewport helper, direct calls banned) | M | done | fdd13c6 | src/**, tests/** |
| 35 | UserUnit raster DPI: raster scale × UserUnit at the 3 raster sites | S | done | c6550bc | src/export/**, tests/browser/** |
| 36 | NEW: src/ never passes wasmUrl — JBIG2/JPX images draw nothing (measured; wasmUrl served, useWorkerFetch pinned false) | M | doing | - | src/utils/pdfjsParams.ts, scripts/**, tests/** |
| 37 | NEW: pdf.js ICC colour management is off (on only with worker fetch; measured ≤18 levels/channel on ICC pages) | S | todo | - | src/utils/pdfjsParams.ts, tests/** |
<!-- /progress-block -->

### Blocked
### Needs input
- C2, C10, D15, D18 results need the developer's Acrobat/Reader check (row 29).
- C12 needs a native Arabic reader (row 31).
### Needs research
- A2, D2, D9 are investigations whose outcome decides whether code ships.
### Fragile
- A4, C9, D12, D18 convert coordinates between frames — the defect shape behind this repo's worst redaction bugs; test every rotation and a crop.
### Known issues
- Kept by ruling: C1, C4, C6, C7, D3, D5, D13, D14, D19.
