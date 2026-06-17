# PDFturbo QA Sweep — Consolidated Findings (2026-06-17)

Severity-ranked, category-tagged synthesis of the six Phase-1 static-discovery raw files
(`raw/bugs.md`, `raw/i18n.md`, `raw/gaps.md`, `raw/ux-a11y.md`, `raw/fidelity.md`,
`raw/00-baseline.md`). This is the Phase-1 deliverable the prior autonomous run never reached
(it hung after writing the raw files). The live browser sweep (Phase-1 serial half) is still
pending — items flagged **[needs-live]** require it to confirm.

Severity legend: **P0** blocker · **P1** high · **P2** medium · **P3** low/cosmetic.
Status: ✅ FIXED this session · 🔲 open · ☑ verified-resolved-in-code (no change needed).

---

## Fixed this session (P0 + P1 a11y)

| # | Sev | Finding | Fix | Guard |
|---|-----|---------|-----|-------|
| F1 | **P0** | **Drawn signature "resets on Save."** `SignatureManager.save()` armed placement via `setMode('addSignature')`, whose side effect `openSignatureModal()` → `signaturePad.clear()` re-opened a BLANK pad — the just-drawn signature appeared to vanish. | Added `SetModeOptions { suppressSignatureModal }`; `save()` now arms the mode without re-opening the modal (`signatureManager.ts`, `toolModeService.ts`, `pdfTurboApp.ts:584`). | `tests/core/signatureSaveFlow.test.ts` (real two-service integration), `toolModeService.test.ts`, `signatureManager.test.ts`. **[needs-live]** confirm pad persists on Save in real Chrome. |
| F2 | **P1** | `signModal` not focus-trapped — largest form in the app (10+ fields); keyboard/SR users Tab into the background toolbar. | `openSignModal`/`closeSignModal` now wire `trapFocus` via `_focusTrapService` (the settings/help/signature pattern). | **[needs-live]** Tab-cycle verification in browser. |
| F3 | **P1** | `ocrModal` not focus-trapped. | `openOcrModal`/`closeOcrModal` wire `trapFocus`. | **[needs-live]** Tab-cycle verification. |
| F4 | **P2** | **6 modals could not be closed with Esc** (signModal, ocrModal, blankPageModal, pdfPasswordModal, lockPdfModal, extractPagesModal). | `keyboardBinder` Esc branch extended: `.active` modals call their close method; the 4 display-toggled modals click their existing Cancel button (preserves `pdfPasswordModal`'s pending-promise resolution). | `tests/ui/keyboardBinder.test.ts` (+7 cases). |

---

## Open — triaged (for live sweep + fidelity sprints)

### Bugs / silent failures (raw/bugs.md, raw/gaps.md)
| # | Sev | Finding | Location |
|---|-----|---------|----------|
| B1 | P2 | Form-fill value silently dropped on dropdown/radio/listbox **option mismatch** — no toast. | `export/exportService.ts:85-88` |
| B2 | P2 | True-edit: a word spanning **multiple show-ops** edits only the clicked fragment (clustered-overlay fallback covers the whole word). | `utils/contentStreamEditor.ts:918` (documented ceiling) |
| B3 | P2 | `ElementFactory.fromJSON` sets `el.id = data.id` unconditionally → a legacy/corrupt blob missing `id` poisons `syncIdCounter` (`NaN`). Restore-path robustness. | `elementFactory.ts:17-19,79` |
| B4 | P3 | Form field name-not-found = silent skip (intended cross-source resilience, but a renamed-field fill is a silent no-op). | `export/exportService.ts:64-66` |
| B5 | P3 | `signature` and `code` elements both serialize payload under JSON key `data` (disambiguated by `type` today; latent foot-gun). | `elementFactory.ts:33,68` |

### Accessibility (raw/ux-a11y.md) — beyond the F2–F4 fixes above
| # | Sev | Finding | Location |
|---|-----|---------|----------|
| A1 | P2 | blankPage/extractPages/pdfPassword/lockPdf modals are `display:flex` only — **no focus trap** (Esc now works via F4, but Tab can still escape). | `modalBinder.ts:151-230` |
| A2 | P2 | Crop tool title advertises shortcut **"Crop page (P)" but no `P` handler exists**; help table omits crop entirely. | `index.html:74` vs `keyboardBinder.ts` |
| A3 | P2 | **Tool-mode changes not announced** — `modeBadge` has no `aria-live`; hotkey mode switches are silent to SR users. | `index.html:139` |
| A4 | P2 | Toolbar-customizer **merged-group submenu trigger has no accessible name** (empty `<button>` + `aria-haspopup` only). | `toolbarCustomizer.ts:259-262` |
| A5 | P3 | `progress-overlay` empty `aria-label=""` may suppress the dynamic progress label on some SRs. | `index.html:648-652` |
| A6 | P3 | Export flyout hides 12 actions behind one chevron (low discoverability for top-level features). | `index.html:115-133` |
| A7 | P3 | Two near-identical signing entry points (✍ draw vs 🔏 cert); 🖊 emoji labels 4 different controls. | `index.html:89,114` |

### i18n (raw/i18n.md) — headline: **key parity perfect (488/488/488), Arabic natively translated, routing clean**
| # | Sev | Finding | Location |
|---|-----|---------|----------|
| I1 | P3 | `codeGenerator.ts` barcode `placeholder:'Any text…'` — English literal, but the field is **never consumed** (dead data). Remove or i18n it before any future panel wires it. | `codeGenerator.ts:16-18` |
| I2 | P3 | `toast.clickToPlaceImage` defined in all 3 locales but **referenced nowhere** (locale clutter). | `locales/*.json:387` |

### Fidelity gaps (raw/fidelity.md, raw/00-baseline.md) — reachable vs structural
| # | Sev | Finding | Class |
|---|-----|---------|-------|
| D1 | P2 | DOCX spot/Separation `scn` color → black-collapse on export (no `setFillColorN` case in op-walk). True-edit twin is DONE; this is the DOCX-export side. | REACHABLE (Gap 6) |
| D2 | P2 | Arabic DOCX/copy bidi is **word-level only** — mixed LTR+RTL single line, char-level reorder, tashkeel GPOS not handled. `bidi-js` installed-but-unused = the lever. | REACHABLE (low ROI) |
| D3 | P2 | Searchable-OCR **Arabic** exact full-word search imperfect (fontkit GSUB contextual glyphs + incomplete ToUnicode). Latin-7 is exact. | CEILING (documented) |
| D4 | P2 | Lattice-table → CSV only; **borderless** tables not detected; **multi-table page** collapses to one grid. | borderless=STRUCTURAL; lattice→DOCX-Table(#64)=REACHABLE |
| D5 | P3 | True-edit `cm` scale/rotation Path-3 redraw emits identity `Tm` (wrong scale/orient; rare; overlay covers). | REACHABLE (low ROI) |
| D6 | P2 | `#60b` compress: no in-place image-XObject downsampling (lossless keeps rasters; lossy flattens whole page). | CEILING (pdf-lib no XObject-replace) |
| D7 | P3 | `renderElements()` destroys+recreates every node each call (#50). Focus hacks DEPEND on this. | REACHABLE (keyed diff) |

### Stale claims now BETTER than documented (retire from backlog)
- ☑ **ISSUE-1 toolbar DnD** — flagged "uncertain/Reset orphaned"; actually a full SortableJS impl, wired + `reset()` not orphaned (`toolbarCustomizer.ts`). **[needs-live]** confirm drag works.
- ☑ **Non-WinAnsi ligature `ﬁ` Path-3** — scorecard says "no refusal"; code now refuses→overlay via `hasNonWinAnsi()`. Retire SC-T row.
- ☑ **DOCX heading bold/ALL-CAPS promotion** — scorecard r16 says open; shipped as conservative G11 pass (`flowDoc.ts:1167-1201`). Retire SC-D r16.
- ☑ **Spot-color true-edit Path-3 fill color** — DONE (`resolveRedrawColor` + canvas sample).

### Backlog (not started; not promised in current UI) — P3
`#55` PII detector · `#58` PDF compare/diff · `#54b` open-picker + recent-files · `#56b` XLSX ·
`#47` render-on-demand · `#49` worker offload · `#51` incremental save · `#63` PAdES-BES ·
`#65` R6 AES-256 · `#66` TSA/LTV. Signing v1 scope: no TSA/LTV/multi-sig/CA-trusted.

---

## Live sweep — executed 2026-06-17 (Playwright, real Chrome, dev server :5174)

All checks ran against the corpus fixtures with a clean IndexedDB. **0 app console errors**
across every flow (the only console errors observed were from the test instrumentation itself:
fetching a revoked blob URL, and the corrupt fixture below).

| Area | Result |
|------|--------|
| **F1** signature reset-on-Save | ✅ Save keeps the pad (ink preserved, modal stays closed); placement adds the element (0→1) |
| **F2** signModal focus trap | ✅ focus enters modal, Esc closes, focus returns to `signBtn`, password scrubbed |
| **F3** ocrModal focus trap | ✅ focus enters, **Tab from last wraps to first**, Esc closes, focus returns to `ocrBtn` |
| **F4** Esc-close (8 modals) | ✅ watermark/bates/code/help/settings (`.active`) + sign/ocr + extractPages/blankPage/lockPdf (display-toggled via Cancel) all close on Esc |
| **#60** compress lossless | ✅ `w3c-accessible-table.pdf` 66 887 → 52 592 B (−21.4%), valid `%PDF-` |
| **#56** table→CSV (lattice) | ✅ `sample-tables-lattice-table.csv`, 19 rows, correct headers/data (see N2) |
| **OCR** visible mode (was fully broken pre-fix) | ✅ recognized page, added **91 TextElements**, progress 100% |
| **DOCX** export (CJK doc) | ✅ `japanese-cjk.docx`, 115 KB, valid ZIP (PK) |
| **e-Sign** generate-cert → sign | ✅ emitted `.p12`+`.pem`+`-signed.pdf`; signed PDF valid (`/ByteRange`, `adbe.pkcs7.detached`, sig field) |
| Empty state (no PDF) | ✅ all 11 action buttons correctly disabled |
| Corpus render | ✅ w3c (1pg), lattice (11pg), CJK (11pg) render, 0 errors |
| Responsive @375px | ✅ no horizontal overflow, toolbar in-view, canvas renders |
| Restore-session dialog | ✅ appears from persisted session; "Start fresh" dismisses |

### New findings from the live sweep
| # | Sev | Finding |
|---|-----|---------|
| N1 | ✅ FIXED | `data-tables.pdf` was an HTML error page (`<!doctype…`, 8 KB) saved as `.pdf` (failed download). **Replaced** with a locally-generated valid borderless data-table PDF (`@cantoo/pdf-lib`, 2492 B, `%PDF-1.7`) — adds genuine borderless-table coverage (lattice already covered). Verified: loads as 1 page, 0 console errors. |
| N2 | P3 | Lattice table→CSV emits **spurious empty interstitial columns** (`,,` between data) — v-rule clustering detects more column boundaries than data columns. Content is correct; columns are noisy. |
| N3 | P3 | The session-restore dialog can be dismissed *after* a new file was already opened on top of it — the two states coexist briefly. Minor; "Start fresh" resolves correctly. |

### Deferred items — now exercised live (resume sweep, 2026-06-18, Playwright real Chrome :5174)

The three items the first sweep deferred were verified end-to-end through the running app UI
(real button/handler/file-input wiring, not just the harness logic). **0 app console errors**
(a clean reload restored the valid session with 0 errors/0 warnings — see the InvalidPDFException
note below).

| # | Item | Live result |
|---|------|-------------|
| **#57** | XFDF export → import round-trip | ✅ Drew a highlight via the real `drawHighlight` pointer path → clicked `#exportXfdfBtn` → valid `data-tables.xfdf` (419 B, `<xfdf>` root + `<highlight>`, correct editor→user-space **Y-flip** 765→780 pt on an 842 pt page). Cleared the element (0), re-imported via the real `#xfdfInput` change handler → highlight **recreated at identical coords (31,62, 133×15)**, valid `pageId`, undoable. Perfect round-trip. Logic also: jsdom 22/22 (`xfdf`/`xfdfMapping`/`xfdfExport`/`xfdfImport`). |
| **#62** | Form flatten | ✅ `#flattenBtn` → valid `data-tables-flattened.pdf` (3289 B, `%PDF-1.7`, `%%EOF`), highlight baked in. Form-residue flatten logic: jsdom `flatten.test.ts`. |
| **Arabic overlay** | addText → Arabic → export | ✅ Placed a text box via the real `addText` drag flow, set `مرحبا بالعالم` through the input event → `downloadPDF` → valid `data-tables-edited.pdf` (8268 B) with **Noto Naskh embedded as Type0/CIDFont**, no export error. Rasterized multi-glyph **ink-width** is harness-proven (`arabic-overlay.browser.test.ts` 3/3 real Chrome). |

**InvalidPDFException note (root-caused, not a build bug):** on the very first navigate (before
clearing IndexedDB) a *stale persisted session* auto-restored the **pre-N1-fix corrupt `data-tables.pdf`**
(HTML error page) — pdf.js's `getHexString` decoded its bytes as `<!doctype html>` and threw
`InvalidPDFException`. After clearing IDB + loading the regenerated valid fixture, a clean reload
restored the valid session with **0 errors/0 warnings** — the persist/restore path is sound. The
only other console error was the test-instrumentation blob fetch (no-op'd `revokeObjectURL`).

### Still not exercised live (no silent caps — explicitly deferred)
`#53` OpenAction-JS strip · `#54` native Save dialog (FS-Access picker has no UI under Playwright —
forced the anchor path) · arxiv-multicol-japanese.pdf render · compress lossy raster path ·
per-element edit tools beyond highlight/text (redact/crop pointer gestures). These are covered by
the jsdom + existing browser harness; flagged here so coverage isn't overstated.
