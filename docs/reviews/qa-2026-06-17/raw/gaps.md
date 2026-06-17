# PDFturbo — Incomplete-Implementation / Gap Hunt (2026-06-17)

Read-only source sweep of `/stack/projects/prsnl/pdfturbo/src`. Scope: TODO/FIXME markers,
deferred `#xxb` tags, ceiling/partial/not-yet notes that map to USER-FACING gaps, silent
no-op / early-return surfaces, feature flags wired-but-not-surfaced, and toast/UI text
promising behavior not implemented. Cross-referenced against `raw/00-baseline.md` — items the
baseline already enumerates are summarized, NOT rediscovered. New findings (and baseline items
this sweep could now RESOLVE in code) are called out.

**Method notes**: no literal `TODO/FIXME/HACK/XXX` exists anywhere in `src/` (verified). All 8
feature flags (`config/features.ts`) default ON and each is consumed by `isEnabled()` AND
surfaced in `main.ts` (`searchableOcr` used twice — gate + UI removal) — **no wired-but-dead
flag**. Ceiling cases consistently surface honest toasts (`noTableFound`, `ocrNoText`,
`ocrRotatedUnsupported`, `xfdfNoAnnots`, `trueEditOverlay`) — not silent failures.

| Gap | Location | User impact | Severity |
|-----|----------|-------------|----------|
| **`toast.clickToPlaceImage`** defined in all 3 locales but referenced NOWHERE in code (image-place flow uses `toast.modeHint.addImage` instead) | `locales/{en,fr,ar}.json:387`; no `src/` ref | Dead string — no user impact; locale clutter / drift risk only | P3 |
| **Form-fill value silently dropped on option mismatch** — `applyFormFieldValue` swallows the error when a typed value doesn't match a dropdown/radio/listbox option | `export/exportService.ts:85-88` | A user-entered form value that doesn't match a field's option list vanishes from the export with no toast/warning | P2 |
| **Form field name not found = silent skip** — `getField` throws → `return` with no notice | `export/exportService.ts:64-66` | Intended cross-source resilience, but a fill targeting a renamed/absent field is silently a no-op | P3 |
| **True-edit: word spanning MULTIPLE show-ops only edits the matched op** | `utils/contentStreamEditor.ts:918` (`getEditableTextAt` ceiling) | Editing one word split across separate `Tj`/`TJ` ops edits only the clicked fragment; whole word handled by G7 clustered overlay fallback | P2 (documented ceiling) |
| **DOCX heading promotion misses bold / ALL-CAPS same-size headings** (`assignHeadings` deliberately conservative — size-cluster only, won't promote bold/caps to avoid false positives) | `utils/flowDoc.ts:1142,1170-1174` | A bold or ALL-CAPS section label at body font size exports as body text, not a Word heading (no TOC/nav) | P2 (= baseline SC-D r16, still open) |
| **DOCX RTL bidi is WORD-level only** — mixed LTR+RTL single line, char-level reorder, tashkeel GPOS not handled | `export/arabicOverlay.ts:29-30`; `utils/flowDoc.ts:488-497`; `utils/rtlClipboard.ts:16` | A line mixing Arabic + embedded Latin/digits inside one word can reorder wrong on DOCX/copy; tashkeel positioning imperfect | P2 (= baseline ⛔/PARTIAL; `bidi-js` installed-but-unused = reachable lever) |
| **Searchable-OCR Arabic layer: exact full-word search imperfect** — recovers selectable Unicode but ToUnicode incomplete (fontkit GSUB contextual glyphs) | `ocr/searchableTextLayer.ts:215,331` | Ctrl-F over OCR'd Arabic may miss whole-word matches; Latin-7 is exact | P2 (= baseline, documented partial) |
| **OCR'd searchable layer NOT supported on rotated pages** — throws `SearchableLayerError('ROTATED_PAGE')`, warns + skips | `ocr/searchableTextLayer.ts` (rotation throw); toast `ocrRotatedUnsupported` | User OCR-searchable export on a rotated page silently produces nothing for that page (toast shown — honest) | P2 |
| **Text-search RTL match is item/box-level, not sub-character** | `handlers/textSearchHandler.ts:106-115` | Arabic search highlight lands on the whole text item, not the exact matched substring | P3 (documented partial) |
| **`renderElements()` destroys + recreates every element DOM node each call** (#50 keyed-diff not built; focus hacks DEPEND on this) | `core/pdfTurboApp.ts` renderElements; CM gotcha | Perf on element-dense pages; no functional break | P3 (= baseline #50, reachable) |
| **Lattice-table → CSV only; borderless tables NOT detected; multiple tables on one page collapse to one grid** | `utils/tableExtract.ts:5`; `utils/flowDoc.ts:145,907` | Table extraction silently yields nothing (borderless) or a merged/garbled grid (multi-table page); `noTableFound` toast covers the empty case | P2 (= baseline ceiling) |
| **XFDF #57b**: ink/stamp/square/circle/line subtypes, multi-line highlight QuadPoints, freetext DA font, form `<fields>`, rotated-page transform all skipped (return null, never mis-mapped) | `utils/xfdf.ts:15`; `export/xfdfMapping.ts:10` | Importing an Acrobat XFDF with those subtypes silently drops them (only highlight/comment/freetext round-trip) | P2 (= baseline #57b) |
| **True-edit cm scale/rotation Path-3 redraw emits identity `Tm`** | `utils/contentStreamEditor.ts` (redraw); baseline SC-T A6 | Editing standard-font text under a scale/rotate CTM redraws at wrong scale/orientation (rare; overlay covers most) | P3 (= baseline ⛔, reachable low-ROI) |
| **#60b compress**: no true in-place image-XObject downsampling (lossless keeps rasters; lossy flattens whole page to JPEG, drops text) | `export/compress.ts:14` | "Compress" can't shrink only embedded images while keeping selectable text — must choose lossless-light or lossy-flatten | P2 (= baseline #60b ceiling) |
| **Whole categories NOT STARTED** (no code): #55 PII detector, #58 PDF compare/diff, #54b open-via-picker + recent-files, #56b XLSX export, #47 render-on-demand, #49 worker offload, #51 incremental save | n/a (absent from `src/`) | Advertised-in-roadmap features users may expect are unbuilt; not promised in current UI | P3 (backlog, = baseline §1) |
| **Signing v1 scope gaps**: no TSA timestamp, LTV/DSS, multi-signature, CA-trusted certs; PAdES is `adbe.pkcs7.detached` not `ETSI.CAdES.detached` | `signing/pdfSigner.ts`; baseline §1 Sign | Self-signed sig shows "validity unknown"; no long-term-validation; not PAdES-compliant | P2 (= baseline, scope-bounded) |

## Baseline items this sweep can RESOLVE in code (no longer gaps)

| Baseline item | Evidence in current source | Status |
|---------------|----------------------------|--------|
| **ISSUE-1 toolbar DnD non-functional / "Reset toolbar" orphaned** (baseline §1 + §3 "verify live") | `ui/toolbarCustomizer.ts` is a full SortableJS impl (pointer-fallback drag, nested group sortables, submenu merge, `restore()`/`save()`/`reset()` persistence via `pdfturbo_toolbar_order`); instantiated + `restore()`+`enableDragDrop()` in `core/pdfTurboApp.ts:336-341`; `resetToolbarBtn` → `_resetToolbarLayout()` → `reset()` wired in `ui/binders/modalBinder.ts:239`; `sortablejs ^1.15.7` in deps | **RESOLVED in code** — needs live drag confirmation only |
| **True-edit non-WinAnsi ligature `ﬁ` silently mis-substitutes, NO refusal** (baseline SC-T / §3) | `hasNonWinAnsi()` (`contentStreamEditor.ts:67`) flags any codepoint >0xFF; `ﬁ` = U+FB01 → Path-3 redraw REFUSES (`:1449-1451`) → routes to overlay, same as Arabic/CJK | **RESOLVED in code** — ligature now refuses→overlay as baseline wanted |
| **Spot/Separation Path-3 true-edit fill color** | `resolveRedrawColor` precedence + canvas-sampled fallback (`contentStreamEditor.ts:1456-1458`) | Already DONE (baseline agreed); confirmed present |
