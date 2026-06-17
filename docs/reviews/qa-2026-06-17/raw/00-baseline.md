# PDFturbo QA + Fidelity Sweep — Consolidated BASELINE (2026-06-17)

Read-only synthesis of existing research/plan docs. No tests run, no source edited. Sources cited
per row. Purpose: give the live QA sweep a single ground-truth of what is open, what fidelity level
is claimed, which "ceilings" are structural vs reachable, and which DONE claims are jsdom-only and
need live re-verification.

Source docs read:
- `docs/plans/unified-master-plan-2026-06-16.plan.md` (UMP) — current forward plan, decision log
- `docs/plans/mega-roadmap-2026-06-14.plan.md` (MR) — Sprints 0–4 + Arabic history
- `docs/reviews/2026-06-14-qa-sweep-findings.md` (QA14) — last real-browser sweep (ISSUE-1..5)
- `docs/reviews/2026-06-15-ceiling-challenge.md` (CC) — ceiling-breakability analysis
- `docs/reviews/2026-06-15-new-ideas.md` (NI) — new-feature proposals
- `docs/reviews/research-2026-06-15/scorecard-docx.md` (SC-D), `scorecard-trueedit.md` (SC-T)
- `docs/reviews/research-2026-06-15/01-docx-gaps.md` (G1), `02-trueedit-matrix.md` (G2), `03-ux-a11y.md` (G3)
- `docs/reviews/research-2026-06-15-arabic/01..03` (AR1/AR2/AR3)
- project `CLAUDE.md` Gotchas + ceiling notes (CM)

---

## 1. Open backlog (still-open items)

Every deferred `#xxb`/`#xxc` tag, queued gap, and "next/deferred" note that has NOT been closed.

| ID | Feature | What's missing | Source |
|----|---------|----------------|--------|
| #53b | Sanitizer | Redaction-completeness check (warn if text still extractable under a redaction rect) — different shape from metadata-scrub | UMP, CM, NI#2 |
| #54b | File System Access | Open-via-picker (`showOpenFilePicker`) + recent-files (FileSystemFileHandle persistence) | UMP, CM, NI#3 |
| #55 | Local PII detector | Not started. Regex/dictionary MVP (IBAN/email/phone) → optional transformers.js NER smart-redaction | UMP M6, NI#4 |
| #56b | Table → XLSX | XLSX/SheetJS export deferred pending explicit dependency decision (CSV shipped) | UMP, CM, NI#5 |
| #57b | XFDF | ink/stamp/square/circle/line subtypes, multi-line highlight QuadPoints, freetext DA font appearance, form `<fields>` data, rotated-page coord transform | UMP, CM |
| #58 | PDF compare/diff | Not started. Pixel (pixelmatch-style) + text diff via pdf.js | UMP M6, NI#7, MR G6 |
| #60b | Compress | True in-place image-XObject downsampling (shrink embedded rasters, keep text) — pdf-lib has no XObject-replace API | UMP, CM |
| #61c | Bates UI | Full restore-path integration test (bates-less blob), malformed-blob restore hardening, off-page huge-startNumber cap | UMP, CM |
| #62b | Flattening | Source MARKUP annotations (notes/stamps authored elsewhere) — pdf-lib has no generic markup-flatten; raster/PNG export is the nuclear workaround | UMP, CM |
| #36 | Trusted Types | Adoption (L effort) — not started | UMP M3 |
| #41 | Logger | Listed; UMP notes it actually shipped in M0 `2cb4122` (table row stale) — verify | UMP M4 |
| #47 | Render-on-demand pages | Not started (M5 perf; #46 lazy-thumbnail done) | UMP M5, NI-T3 |
| #49 | Web Worker offload (comlink) | flowDoc reconstruction + content-stream parse + export off main thread (OCR already worker) | UMP M5, NI-T3 |
| #50 | Keyed element-layer diff | `renderElements()` still destroy/recreate-all; keyed diff not built | UMP M5, CM (renderElements gotcha) |
| #51 | Incremental save (history deltas) | Not started | UMP M5 |
| #52 | OPFS large-doc persistence | Optional; IndexedDB works today | UMP M5, NI-T3 |
| #63 | PAdES-BES | M7 ceiling-breaker; swap node-forge→PKI.js on CMS path; build only if compliance names PAdES | UMP M7, CC#2 |
| #64 | Lattice tables → DOCX+CSV | M7; reuse vector-rule extraction → grid clustering → docx Table (pairs with #56) | UMP M7, CC#8 |
| #65 | R6 AES-256 | M7; patch vendored PDFSecurity (Algorithm 2.B KDF + /Perms); only if R6 mandated | UMP M7, CC#1 |
| #66 | TSA timestamp (PAdES-T)+LTV/DSS | M7; PKI.js TSP — needs network → breaks 100%-client-side; opt-in only | UMP M7, CC#3 |
| ISSUE-1 | Toolbar DnD | Drag/reorder is non-functional at runtime; "Reset toolbar" button is orphaned (no layout to reset). Largest scope, essentially a feature build. **Status uncertain — verify against current code** | QA14 |
| SC-D r16 | DOCX heading bold/caps | H4–H6 size-cluster done; bold/ALL-CAPS same-size heading promotion still 🟡 reachable | SC-D, G1 Gap5 |
| SC-D r18 | DOCX spot/Separation color | `setFillColorN`/scn black-collapse on DOCX export still 🟡 (true-edit Path-3 color is DONE; this is the DOCX-export twin) | SC-D, G1 Gap6 |
| SC-T | True-edit non-WinAnsi ligature | `ﬁ` etc. on Path-3 silently drops/substitutes glyph with NO refusal — should refuse→overlay for consistency with A-5 | SC-T, G2 |
| SC-T | True-edit stroke color | Stroke-only text (`Tr 1/2`) stroke color untracked in redraw (narrow) | SC-T Gap2 note |
| Sign | Signing v1 gaps | TSA timestamp, LTV/DSS, multi-signature rounds, CA-issued/trusted certs all out of v1 scope | CM, MR |

**Open count (distinct rows above): 26.**

---

## 2. Fidelity baseline (last measured level: DONE / PARTIAL / CEILING)

### 2a. DOCX export (SC-D tally: ✅ 25 / 🟡 2 / ⛔ 7)
> SC-D verdict quote: *"For mainstream business/technical PDFs (single/two-column text, standard
> fonts, lists, colored text, embedded raster images): fidelity is high and improving — the common
> attributes are done. … a number like '100%' is not achievable [for the ⛔ set] without a
> server-side engine, and we say so."*

| Area | Level | Note |
|------|-------|------|
| Body text, reading order (1-col + one 2-col XY-cut) | DONE | `reconstructPage`/`detectColumnSplit` |
| Font size, bold/italic name-sniff, family allow-list (28 entries) | DONE | exact subset face = ⛔ |
| Margins, para/line spacing, L/C/R/justify, indent | DONE | B-2/B-3/B-5 |
| Lists: bullet, decimal, lettered, roman, nesting (`w:ilvl`), continuation merge | DONE | Sprint 3/4 |
| Headings H1–H6 (size cluster) | DONE | bold/caps promotion 🟡 (open) |
| Color RGB/Gray/CMYK | DONE | spot/Separation/scn 🟡 (open #SC-D r18) |
| Images: embed, floating position, JPEG re-encode, rotated sizing | DONE | skew ⛔ |
| Hyperlinks, underline/strike, super/subscript | DONE | Sprint 3 batch 2 / Sprint 4 |
| Redaction-aware extraction (incl. rotated pages) | DONE | Sprint 1 P0 + 2026-06-15 rotated fix |
| RTL single-line reorder (word-level UAX#9 L2) | **PARTIAL** | embedded LTR runs keep forward order; char-level bidi ⛔ |
| Lattice/borderless tables, vector→DrawingML, 3+col recursive XY-cut, tagged-PDF fast path, header/footer routing, RTL char-level reorder + Arabic presentation forms, exact subset-font face | CEILING | SC-D rows 28–34 |

### 2b. True-edit engine (SC-T)
> SC-T verdict quote: *"The engine truly edits the large majority of real-world text (standard +
> subset/CID Latin, the common case) at perfect fidelity, and degrades visibly and safely (overlay,
> never silent garbage) on the structurally-hard targets."*

| Scenario | Level | Note |
|----------|-------|------|
| Standard-14 ASCII (Path-1 byte-swap) | DONE ✅ perfect | |
| Subset/CID glyph in ToUnicode (Path-2 reuse) | DONE ✅ perfect | keeps real font |
| TJ kerned line (Path-1 & Path-2, segment-split) | DONE ✅ | Gap 1 done Sprint 3 b2 |
| Standard font accented/€ (Path-3 redraw) | PARTIAL 🟡 | glyph OK, face degraded |
| Subset NEW char not in subset (Path-3) | PARTIAL 🟡 | face degraded |
| Spot/Separation Path-3 fill color | DONE ✅ | `d7879fb` resolveRedrawColor + canvas sample |
| Number tokenizer exponent `1e-3` | DONE ✅ | consumeNumberBody |
| Non-WinAnsi ligature `ﬁ` Path-3 | PARTIAL 🟡→open | wrong glyph, NO refusal (should refuse→overlay) |
| Form-XObject / Type3 / vertical / invisible-Tr / encrypted | DONE ✅ correct fallback | refuse→overlay (A-1/A-5), never silent |
| cm scale/rotation in Path-3 redraw (A6) | CEILING ⛔ | redraw emits identity Tm → wrong scale/rot |
| Rotated-page inline-input placement | CEILING ⛔ | edit correct, floating box approximate |
| In-place Arabic / RTL Path-3 | CEILING ⛔ | std fonts lack Arabic; subset CID lacks new glyphs |

### 2c. Arabic (three surfaces)
| Surface | Level | Note (source) |
|---------|-------|---------------|
| DOCX export | DONE-partial | logical-order restoration (`reverseRtlText` + NFKC P2 2026-06-17) + word-level reorder (AR-1) + complex-script attrs (cs/bCs/szCs). Char-level bidi-mixed line = ⛔ (AR1, CM) |
| Overlay render (PDF) | DONE | `arabicOverlay.ts` encodeText(visual)+raw Tj against vendored **Noto Naskh TTF** (P1 fix `1bf0ba8` 2026-06-17 — the prior WOFF was mis-embedded). Shaping via fontkit GSUB; right-aligned (AR3, CM) |
| Searchable-OCR layer | PARTIAL | Latin-7 exact-searchable; Arabic recovers as real Unicode (selectable/SR-accessible) but full-word exact **search is imperfect** — fontkit GSUB → contextual glyphs + incomplete ToUnicode (documented ceiling) (CM, MEMORY) |
| In-place Arabic true-edit | CEILING | refused → overlay; subset CID fonts lack the glyphs (structural) (AR2 Gap4, CC#5) |
| Text-layer selection/copy/search (RTL) | DONE-partial | copy reconstruct logical (#6), search NFKC fallback (#6b), selection span reorder (#6c). Sub-char highlight = item-level; mixed LTR+RTL single-line bidi = ⛔ (CM) |

### 2d. Element positioning / overlay rendering
| Item | Level | Note |
|------|-------|------|
| renderElementToPdfLib per-type dispatch (8 types) | DONE | Record<ElementType,renderFn> #23 `41590b8`; +6 jsdom char tests + 1 browser Arabic |
| Pixel-region tests (redaction opacity / highlight hue / image bbox / rotation anchor) | DONE | #13 `a2173a0` (closed the lone P0) + CI coverage gate #14 |
| Per-page crop (#G23) | DONE | unrotated content-space rect; effBox==cropBox → byte-identical when no crop |
| `renderElements()` keyed identity | NOT done (CEILING-by-design today) | destroys+recreates every node each call (#50 open) |

---

## 3. Ceiling classification (STRUCTURAL vs REACHABLE)

Skeptical pass: each documented ceiling labelled STRUCTURAL (cannot be solved client-side w/o
backend or format change) or REACHABLE (improvable with more client-side effort — lever named).

| Ceiling | Class | Reasoning / lever |
|---------|-------|-------------------|
| In-place Arabic true-edit (preserve original subset font) | **STRUCTURAL** | A `ABCDEF+` subset CID font contains only the glyph outlines the doc already drew; a NEW Arabic char/joining-form has no outline in the PDF → cannot be drawn in the original font client-side. Re-embedding Noto gives the SAME visual result as the overlay already shipped. Overlay IS the answer (CC#5, AR2 Gap4). |
| Mixed LTR+RTL single-line char-level bidi reorder; tashkeel GPOS | **REACHABLE (low ROI)** | NOT impossible: `bidi-js` (installed) does UAX#9 char-level; harfbuzzjs does GPOS marks. Lever = wire bidi-js at char granularity + harfbuzz for marks. Word-level ships today; char-level is large/fragile (CC#7, AR3). **Challenge: filed "REAL CEILING" but the libs exist — it is effort-gated, not impossible.** |
| Vector graphics → DrawingML | **STRUCTURAL (pragmatic)** | No client-side path→OOXML vector translator exists; realistic answer is region rasterization (lossy, not "vector"). True vector translation is effectively writing a vector compiler — out of any reasonable client-side budget (G1, SC-D r29). |
| Borderless / inferred-structure tables | **STRUCTURAL** | No ruling lines to detect → needs layout ML / a trained model; every converter hits chronic false positives. Not solvable by deterministic client-side code (CC#8, SC-D r28). |
| Lattice (ruled) tables → DOCX Table | **REACHABLE** | Vector rule extraction ALREADY built (underline/strike + CSV #56). Lever = cluster h+v rule positions → cell grid → docx `Table`. = #64, "BREAKABLE-CUSTOM, High ROI" (CC#8). **A genuine reachable lever, not a ceiling.** |
| Recursive 3+ column XY-cut | **REACHABLE (niche)** | `detectColumnSplit` does one V-cut. Lever = recursive alternating H/V cut. Tractable but degrades on magazine layouts; niche ROI (SC-D r30, G1). |
| Tagged-PDF `getStructTree` fast path | **REACHABLE** | pdf.js exposes `getStructTree()`; exact reading-order/headings for the ~15% of tagged PDFs. Lever = build the parallel tagged path (multi-day). Pure client-side, just unbuilt (SC-D r31, G1). |
| Headers/footers routing | **REACHABLE** | Repeated top/bottom-band detection across pages → docx header/footer. Deterministic, multi-day, noisy. Lever = band-frequency clustering (SC-D r32, G1). |
| Exact subset-font face match | **STRUCTURAL** | `ABCDEF+` subset carries no recoverable family name; without the embedded font program there is nothing to map to a real face. Allow-list+generic is the honest floor (SC-D r34, G1). |
| Type3 true-edit | **STRUCTURAL** | Type3 glyphs are CharProc content streams, not byte→glyph; no byte-level edit possible. Refuse→overlay is correct (SC-T, G2, CC#6). |
| cm scale/rotation in Path-3 redraw (A6); rotated-page inline-input placement | **REACHABLE (low ROI)** | Redraw hardcodes identity `Tm`. Lever = decompose CTM → emit matching Tm scale/rot (the DOCX side already does `decomposeImageCtm`). Rare; overlay/refuse covers it (SC-T, G2, CC#6). **Effort-gated, not impossible.** |
| PAdES-BES (`ETSI.CAdES.detached`) | **REACHABLE** | node-forge can't emit ESS signing-certificate-v2 attr; **PKI.js** (pure-JS WebCrypto CMS) can. Lever = swap CMS producer on that path; same ByteRange plumbing. = #63, BREAKABLE-NOW (CC#2). |
| R6 AES-256 (PDF-2.0) | **REACHABLE** | `@cantoo/pdf-lib` `initializeV5` hardcodes R=5; R6 is Algorithm 2.B (iterated SHA hash chain + /Perms), ~60–100 LOC WebCrypto. Lever = add `initializeV6` to the vendored PDFSecurity. = #65 (CC#1). |
| TSA timestamp (PAdES-T) / LTV/DSS | **STRUCTURAL to the product premise** | Code is reachable (PKI.js TSP), but it REQUIRES a network call to a TSA → breaks the "100% client-side, nothing leaves the browser" guarantee. Only viable as explicit opt-in; structurally incompatible with the default contract (CC#3, #66). |
| CA-issued / trusted certs | **STRUCTURAL** | "Trusted" means a CA vouches — inherently external to a client-only tool. Not a code problem (CC#4). |
| PDF/A | **STRUCTURAL (license/size)** | Only via Ghostscript-WASM = AGPL + 18 MB → license + size incompatible. Dropped (UMP, MR G9). |
| Accessibility PDF tagging (author struct tree) | **STRUCTURAL (tooling)** | No mature in-browser lib; pdf-lib cannot author a struct tree. No client-side path exists today (UMP, MR G10). |
| pdf.js v6 TextLayer not rotated (R1) | **REACHABLE (risky)** | Lever = position own selectable spans via rotated viewport transforms instead of pdf.js TextLayer; re-implements a pdf.js subsystem, risks selection/search regressions. Low ROI (CC#10). |
| `renderElements()` destroy/recreate-all (#50) | **REACHABLE** | Lever = keyed element-layer diff (stable node identity). Note focus-restoration hacks currently DEPEND on the destroy/recreate behavior (CM) — refactor must preserve that. |
| PDFium-WASM moonshot | **STRUCTURAL (scope)** | Would replace the whole content-stream surgery layer; several-MB WASM, out of scope (SC-T, G2). |

**Tally: STRUCTURAL = 11, REACHABLE = 11.**

### Skeptical challenges to "DONE" claims (re-verify live)
- **Arabic DOCX "DONE-partial"** depends entirely on the source PDF having a good ToUnicode CMap.
  PDFs encoding Arabic as PUA glyph IDs or presentation forms → garbage extraction; NFKC fix only
  helps presentation forms, not PUA (AR1 Gap3/4). Verify with a real Arabic PDF, not synthetic.
- **Searchable-OCR Arabic** is claimed DONE but exact-search is explicitly imperfect — do not treat
  as fully working in the sweep.
- **Spot-color true-edit (Gap 2) "DONE"** relies on a canvas pixel sample; verify the sampled color
  is actually the glyph color and not background on real spot-color PDFs.
- **ISSUE-1 toolbar DnD** was "unbuilt" as of QA14 (2026-06-14) and never appears closed in the
  decision log — the "Reset toolbar" button may still be orphaned. Verify live.

---

## 4. Known-but-unverified claims (DONE/fixed but jsdom-only → re-verify live)

UMP/MR explicitly note jsdom cannot exercise canvas/pointer/rasterize/image-extract; CLAUDE.md
echoes this. Items below have DONE claims whose only or primary guard is jsdom, OR a browser test
that should be re-confirmed against the live app during the sweep.

| Claim (DONE) | Guard type | Why re-verify live |
|--------------|-----------|--------------------|
| #60 compress lossy (per-page pdfjs→JPEG raster rebuild) | browser test exists (`compress.browser`) | canvas raster loop + size-reduction is real-browser only; verify before→after on real multi-image PDFs |
| #60 compress lossless (`updateMetadata:false` + objectStreams + strip /Info/XMP/ID) | jsdom (`compress.test`) | metadata re-stamp trap is load-time pdf-lib behavior; confirm stripped fields actually gone post-reload |
| #61/#61b Bates threaded through ALL export paths (full/single/range/image/redaction-raster) | jsdom engine + panel tests | redaction-raster + image branches are canvas paths; verify "5 / 10" full-doc numbering on a single-page/range export live |
| #61c restore-path (bates-less legacy blob → model default) | NOT integration-tested (deferred) | persistence restore is untested end-to-end; load a pre-#61b session blob |
| #62 form flatten (`form.flatten()` all sources, default leaves 1 widget) | jsdom (`flatten.test`) | widget→content-stream baking is a pdf-lib write; verify 0 residual widget annotations on a real AcroForm |
| #57 XFDF round-trip (highlight/comment/text) | jsdom codec/mapping tests | display↔user-space y-flip + multi-page pageId; verify a real Acrobat-authored XFDF imports to correct on-page positions |
| #56 ruled-table → CSV | browser e2e (pdf-lib lines→CSV) exists | v-rule capture + grid clustering; verify on a real ruled table, not just the synthetic 2×2 |
| #54 File System Access save | 6 unit + 3 wired (jsdom) | `showSaveFilePicker` transient-activation + `createWritable` are Chromium-only runtime; verify the native dialog + actual file write live |
| #53 sanitize (`/Info`/XMP/OpenAction/AA/JS/EmbeddedFiles strip) | jsdom round-trip + browser e2e | verify on a real PDF carrying `/OpenAction` JS that it's gone after re-open |
| Arabic overlay TTF embed (5 glyphs, multi-glyph ink width) | browser test (`arabic-overlay.browser`, width assertion) | font embedding is the exact thing that regressed with WOFF; re-confirm full word renders, not single alef |
| Arabic P2 NFKC presentation-form fold (DOCX/MD) | jsdom (`flowDocArabic.test` +3) | jsdom can't render Word; the fold is verified at string level only — open exported DOCX in Word to confirm glyphs connect |
| DOCX images via `commonObjs`/`VideoFrame` (ISSUE-3/4) | browser tests (`issue3-docx-images`) | `commonObjs` `g_` lookup + VideoFrame→canvas is real-browser only; verify on a PDF with a cross-page reused image |
| True-edit ISSUE-2 (heading subset/CID byte-swap gated) | browser (`issue2-true-edit`) | the original data-loss bug was pixel-confirmed only in a browser; re-edit a styled heading and pixel-check |
| True-edit spot-color Path-3 redraw stays chromatic | browser (`truedit-spot-color`) | canvas-sample fallback is browser-only; UMP notes this test + `issue2` flake under parallel load (timeout) |
| ISSUE-5 separate text modes (editText edits existing only; addText draws to place) | browser (`issue5-unified-text`) | pointer-events gating + draw-to-place are pointer-gesture paths jsdom can't drive |
| OCR engine (createWorker + blocks:true + self-served assets, no CDN) | browser (`ocr-csp`, `ocr.blockers`) | CSP + WASM worker load is runtime; verify OCR actually adds elements on a scanned page |
| Searchable-OCR invisible layer (`3 Tr` text) | jsdom (14) + browser (Latin exact + Arabic honest) | invisible-ink placement + select/search is a browser behavior; verify selection lands on the right words |
| #46 lazy thumbnail (IntersectionObserver) | jsdom (fake IO) | real IntersectionObserver + scroll-container rasterization is browser-only; verify thumbnails render on scroll |
| #48 OCR runtimeCaching (precache 16.5→5.0 MB; `globIgnores tesseract`) | infra/config tests + build manifest | SW runtime cache behavior + offline-after-first-use is runtime; verify OCR works after one online use |
| e-Sign full flow (generate-cert → signed PDF /ByteRange+pkcs7; S-FLOW preflight) | browser (`cert-gen`, `signing`) + 2026-06-17 live QA pass | crypto + Blob download verified live 2026-06-17; re-confirm signature validity in a real PDF reader |

Note: the 2026-06-17 decision log records a **live Playwright UI-gesture QA pass** (redaction, lock,
watermark, page delete+undo, OCR, e-Sign all PASS, 0 console errors) — but it predates #60 compress.
The full deep QA sweep (this effort) is the post-#60 re-verification.

---

## Cross-cutting notes for the sweep
- **CI flake**: browser suite `truedit-spot-color` / `issue2-true-edit` time out under parallel load
  (testTimeout raised to 30s `87180d1`); both pass in isolation. Not a code bug — flag if it recurs.
- **`ask-human` gate**: background continuations are blocked by the gate hook (MEMORY) — only
  AskUserQuestion clears it.
- **Never read/print/commit** `tests/fixtures/private/*` — structural metrics only.
- **Push is MANUAL**; #60 compress (`5b8872d`) was unpushed at last checkpoint.
