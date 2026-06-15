# Core correctness blockers — research (2026-06-15)

Scope: redaction, forms, encryption, export pipeline, undo/redo, persistence, render
fidelity, lighter pass (barcode/QR, watermark, PWA, i18n/RTL, a11y). Excludes DOCX-flow,
true-edit, Arabic, OCR, signing (separate agents). Structural read only; no private fixtures opened.

---

## P0 / DATA-LOSS / SECURITY — READ FIRST

> **⚠️ CORRECTION (2026-06-15, post-implementation):** This finding was WRONG about the location.
> An empirical browser test (`tests/browser/blockers-redaction.browser.test.ts`) proves the raster
> `fillRect` path below is CORRECT at all four rotations (0 leaked pixels) — element coords are in
> DISPLAYED space and the export viewport renders that same orientation. The REAL leak was the
> **flow-export (DOCX/MD/TXT)** path: `_extractFlowDoc` passed displayed-space rects to
> `reconstructPage`, which compares against unrotated-content text → leak on 90/180°. FIXED via
> `reconstructPage(pageRotation)` + `geometry.redactionRectToContent`. The PDF-raster sub-claim here
> is retained below for the record but is a false positive (3rd this session from source-reading).

### CORE-P0-1 — Redaction on ROTATED pages mis-places the burn box → SECRET STAYS VISIBLE
- **CLASS:** REACHABLE (fix is geometry; flatten path already exists)
- **file:line:** `src/export/exportPipeline.ts:225-233` (rasterizer fillRect) vs `:188-211` (rotation handling)
- **Root cause:** `rasterizePageWithRedactions` renders the page to a canvas at the **rotated** viewport (`vp = renderPage.getViewport({ scale })` after `page.setRotation`/source rot baked into `tempBytes`), but the redaction `fillRect` uses **editor-space, unrotated** coords `el.x*SCALE, el.y*SCALE` with NO rotation transform applied to the rect corners. On a 90/270 page the black box lands in the wrong quadrant; the underlying text is rasterized but the *cover is misaligned*, so the sensitive text is rendered in the clear in the exported PNG-page. The text bytes ARE gone (good — no copy-paste leak) but the **pixels remain visible** = redaction failed its one job. Known + UNFIXED (`KNOWN_ISSUES.md:119` "redaction geometry on rotated pages is approximate").
- **test env:** jsdom CAN build/save the PDF and assert text-byte removal; the *pixel-position* assertion needs **browser** (real canvas raster). Two-tier test.
- **confirming test:**
  - jsdom (byte side): make a 1-page PDF with text "SECRET" at known coords, rotate the docPage 90°, add a redaction rect over SECRET (editor coords), run `rasterizePageWithRedactions`, re-parse output with pdf.js `getTextContent()` → assert "SECRET" absent (likely PASSES — bytes gone).
  - browser (pixel side): same input, rasterize, sample canvas pixels at the rotated location where SECRET visually sits → assert they are the fill color, not glyph ink. Today: FAILS (box in wrong quadrant). This is the real proof.

### CORE-P0-2 — "Lock PDF" uses AES-128 (not 256) and silently DENIES all permissions; algorithm is unselectable
- **CLASS:** REACHABLE
- **file:line:** `src/export/exportService.ts:297-301` (`encrypt({userPassword, ownerPassword})` — no `algorithm`, no `permissions`); `src/ui/binders/modalBinder.ts:186-194`
- **Root cause:** `@cantoo/pdf-lib` picks the encryption revision **from the PDF header version**, not from any option. `PDFContext` default header = **1.7** (`node_modules/@cantoo/pdf-lib/es/core/PDFContext.js:26`) → `v=4` → **R=4, 128-bit AESV2** (`PDFSecurity.js:32-90`). AES-256 (V5/R6) is only reachable with header `1.7ext3`, which the app never sets. So "Lock PDF" is **AES-128, not AES-256** — adequate but below modern expectation and not what a security-conscious user assumes. Worse: no `permissions` object is passed → `getPermissionsR3({})` returns `0xfffff0c0` with **every allow-bit cleared** → printing/copying/modifying/accessibility all DENIED in the owner permission flags. A user who only wanted a password gets an accidentally crippled doc (and since owner defaults to user password, `modalBinder.ts:189`, anyone with the open password can strip it anyway — the permissions are security theater).
- **test env:** jsdom (pdf-lib runs there; re-parse the Encrypt dict).
- **confirming test:** encrypt a doc via the export path, `PDFDocument.load(bytes, {throwOnInvalidObject})`, inspect trailer `Encrypt` dict → assert `V===5 && CF.StdCF.CFM==='AESV3'` (EXPECTED for "256"). Today: `V===4, CFM==='AESV2'` → FAILS. Second assert: `P` permission int has copying/printing bits SET when user passed no restriction. Today: cleared → FAILS.

### CORE-P0-3 — Redaction is the ONLY destructive op; non-rotated path is sound (positive finding, documented to bound the P0s)
- **CLASS:** N/A (verification)
- **file:line:** `src/export/exportService.ts:139-145` (`hasRedaction` → `rasterizePageWithRedactions` + `continue`)
- **Root cause / status:** On NON-rotated pages redaction genuinely flattens the whole page to a raster image (`exportPipeline.ts:213-260`) — underlying text/image bytes are NOT carried into the output, so copy-paste/extraction leak is closed for `downloadPDF` and `downloadPage`. The vector-cover path (`pdfElementRenderer.ts:216-223`, draws a rectangle over live text) is **dead for redaction** because `_assemblePdfDoc`/`downloadPage` divert redacted pages to the rasterizer before overlay rendering. DOCX/MD leak already fixed (REDACT-DOCX). The residual P0 is purely the rotated-page geometry (CORE-P0-1). Confirm by grepping that no export entry calls `buildPageOverlays` on a page whose `pageElements` include a redaction without first diverting.

---

## P1 — correctness / data-loss-adjacent

| ID | one-line | CLASS | file:line | root cause | test env | confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| CORE-1 | `downloadPageAsImage` ignores `hasRedaction` | REACHABLE (low sev — output is PNG) | `exportService.ts:190-234` | Unlike `downloadPage`/`downloadPDF`, the image-export path never branches on redaction; it draws the **vector cover rect** via `renderElementToPdfLib` then rasterizes to PNG. Output is an image so text can't be extracted (no leak), BUT it uses the cover-rect (no flatten-of-page semantics) and shares CORE-P0-1's rotation bug for the rect position. Inconsistent with the other two entry points. | jsdom (build+save) + browser (pixel) | Export a redacted page as image; pixel-sample under the rect → assert fill color. On rotated page: FAILS (same as P0-1). |
| CORE-2 | Forms: only text fields (`Tx`) fill/flatten; checkbox/radio/choice/sig **lost** | CEILING-ish (REACHABLE for Btn/Ch with work) | `exportService.ts:98-103`, `formFieldOverlay.ts:32-35,49` | `_assemblePdfDoc` only `form.getTextField(name).setText()`. Overlay renders only `fieldType==='Tx'`; everything else is counted as `unsupported` and shown read-only. On flatten, **unfilled non-text fields keep their original /V** (may be fine) but the user CANNOT set a checkbox/dropdown — a filled government form silently exports with empty checkboxes. | jsdom | Build a PDF with a checkbox + dropdown + text field; set values via the public form API the app exposes; export; re-parse → assert checkbox is checked / choice selected. Today only the text field round-trips → FAILS for Btn/Ch. |
| CORE-3 | Form-fill targets fields by **name**; same-named fields across sources / duplicate names collide | REACHABLE | `exportService.ts:94-102` | `formValues` keyed by `sourcePdfId` then fieldName; `getTextField(name)` returns the first match. Multiple widgets sharing a field name (common in multi-page AcroForms) all get the same value (PDF spec-correct) but **distinct fields that happen to share a name across merged sources** are filled per-source, OK. Real risk: a field whose type the app guessed as text but is actually a combo → `getTextField` throws, caught, value silently dropped. | jsdom | PDF with a `/Ch` field named "country"; put a value in formValues; export → `getTextField('country')` throws → value lost silently. Assert exported value present → FAILS. |
| CORE-4 | `cleanEmptyTextElements` mutates `elements[]` OUTSIDE a history Command | REACHABLE | `cleanupService.ts:14-23` | Pre-export (`downloadPDF:43`, `assemblePdfBytes:75`) it `elements.splice(0,len,...keep)` directly, bypassing `historyManager`. If it removes an empty text box that the user *intended* to keep (e.g. just created, not yet focused), there is **no undo** for that removal and the redo/undo stacks may now reference an element no longer in `elements` → an undo that re-adds a stale element or a no-op. Removal of truly-empty boxes is benign, but it is an un-tracked mutation of the model the whole undo system assumes it owns. | jsdom | Create empty text element via the AddElementCmd, blur it, call `cleanEmptyTextElements`, then `historyManager.undo()` → assert model integrity (no orphan / no duplicate). Likely surfaces a stale-reference inconsistency. |
| CORE-5 | Persistence does NOT save `_exportPassword`, undo/redo stacks, true-edit `SourcePdf.bytes` swaps survive only as bytes | INFERRED gap (REACHABLE doc-fix) | `sessionManager.ts:26-38`, `storage.ts:5-14` | `SavedState` persists elements/pages/watermark/sourcePdfs.bytes/formValues/inkData. It does NOT persist: the lock password (acceptable — security), the **undo/redo history** (reload = history lost, expected but undocumented), and large-PDF quota: `saveState` re-throws `QuotaExceededError` → toast, but a multi-MB source over IDB quota means **the whole session silently isn't saved** (autosave fails every 800ms debounce; user loses everything on reload with only a transient toast). | jsdom + fake-indexeddb | Stub IDB to throw QuotaExceededError on put; run a session edit; reload via `loadState` → assert null/last-good and that the user was warned. Confirms the silent-total-loss window. |
| CORE-6 | Render is NOT devicePixelRatio-aware → blurry on HiDPI | REACHABLE | `infra/pdfRenderer.ts:124,181-182` | `canvas.width = widthPt * this.scale` (scale capped 0.25–3.0, no `* devicePixelRatio`). On a 2× display the bitmap is half the physical resolution and CSS-upscaled → blurry text/lines. Pure fidelity, no data loss. | browser only (DPR + canvas) | In real Chrome with `devicePixelRatio=2`, render a page, read back canvas vs CSS box size → assert backing store ≥ DPR×CSS. Today equal → FAILS. Evidence-only / visual. |

---

## P2 — lighter pass

| ID | one-line | CLASS | file:line | root cause | test env | confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| CORE-7 | Owner password silently defaults to user password → permission lock is bypassable | REACHABLE | `modalBinder.ts:189` | `const owner = ...value.trim() || user`. With owner==user, anyone who can open the file (knows user pw) can remove restrictions in any reader. Combined with CORE-P0-2 the whole permission model is non-enforcing. Document or split the two passwords in UI. | jsdom | Encrypt with only a user pw, reopen with that pw as owner → permissions strippable. Assert owner≠user enforced → FAILS. |
| CORE-8 | Watermark spacing/step uses `W_orig/H_orig` (cropbox) but draws from `cropOriginX/Y` — OK; density index off-by clamp | INFERRED minor | `exportPipeline.ts:112-128` | `densityFactors[Math.max(1,Math.min(5,density??3))]` — index 0 is unreachable (`0` factor) by clamp, fine; but `density` outside 1–5 silently clamps with no feedback. Cosmetic. | jsdom | Set density=9, export, assert chosen factor==0.5 (clamped). Passes; documents behavior only. |
| CORE-9 | Ink export rasterizes at fixed SCALE=2 regardless of page size → huge pages get coarse ink | REACHABLE minor | `exportPipeline.ts:59-92` | Ink canvas is `W_orig*2 × H_orig*2`; on an A0 page this is a multi-MP PNG embedded per page (memory) while on tiny pages it's coarse. No DPR/area adaptation. | browser | Export ink on a large page; measure embedded PNG dims vs page → fixed 2×. Evidence-only. |
| CORE-10 | `_downloadBlob` revokes object URL synchronously after `link.click()` | INFERRED (browser-dependent) | `exportService.ts:288-295` | `URL.revokeObjectURL(url)` immediately after `click()` can race the download in some browsers (the navigation to the blob may not have started). Most Chromium tolerates it; Firefox historically flaky. | browser only | Trigger download, assert file saved. Non-deterministic → evidence-only; recommend `setTimeout(revoke, ...)` or revoke on `window` unload. |
| CORE-11 | Multi-source page order relies on `documentModel.pages` order + per-source copyPages dedup — correct, but blank-page + redaction interleave untested | INFERRED OK | `exportService.ts:106-153` | Pages added in `documentModel.pages` order; redacted & blank pages `continue` after their own add, copied pages added inline. Logic looks order-preserving. Worth a guard test for [normal, redacted, blank, normal] interleave. | jsdom | Build 4 pages in that mix; export; assert output page count==4 and order via a per-page marker. Likely PASSES — regression guard. |

---

## CEILING (not client-side-fixable without major work)

- **CORE-C1 — True PDF redaction (object removal) for non-rasterized output.** The app's only safe redaction is full-page rasterization (loses text selectability of the *whole* page, not just the redacted region). Surgical content-stream removal of just the covered glyphs/images while keeping the rest of the page as live text is a hard PDF-surgery problem (overlapping clips, XObjects, shared fonts). Current flatten approach is the pragmatic correct choice; "redact one word, keep page selectable" is the ceiling.
- **CORE-C2 — AES-256 (V5/R6).** Reachable only if `@cantoo/pdf-lib` is driven to header `1.7ext3`; needs verifying the lib's V5 path is wired and the `encrypt` API surface accepts it. Borderline reachable (see CORE-P0-2 — may just need setting the header before encrypt) — promote to REACHABLE if the lib exposes a version setter.
- **CORE-C3 — Non-text AcroForm widget rendering/editing (checkbox/radio/choice/signature fields)** at full fidelity (appearance streams, /AP regeneration on flatten) is substantial work; partial (set /V + flatten with pdf-lib's `getCheckBox`/`getDropdown`) is REACHABLE for the common cases (see CORE-2).

---

## Highest-ROI reachable

**CORE-P0-1 (rotated-page redaction geometry)** is the single highest-value fix: it is a true
security/data-exposure bug (sensitive pixels remain visible after the user believes they redacted),
it is already acknowledged-but-unfixed, the flatten machinery exists, and the fix is bounded —
transform the redaction rect corners by the same `totalRot` used for the page render before `fillRect`
(rotate `el.x/y/w/h` into the rasterized viewport space at `exportPipeline.ts:225-233`), with a
two-tier test (jsdom byte-absence + browser pixel-position). Closes the only remaining redaction leak.

Second: **CORE-P0-2 + CORE-7 (encryption)** — pass an explicit `permissions` object so a plain
password lock does not silently strip printing/copying, surface AES-128-vs-256 honestly in the UI (or
set the 1.7ext3 header to get AES-256), and stop defaulting owner==user. Cheap, removes
security-theater, and the encrypt path is jsdom-testable end to end.
