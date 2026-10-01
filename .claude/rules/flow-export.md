---
paths:
  - "src/utils/flowDoc*.ts"
  - "src/utils/tableExtract.ts"
  - "src/utils/borderlessTable.ts"
  - "tests/utils/flowDoc*"
  - "tests/utils/table*"
  - "tests/blockers/**"
---

# pdfturbo gotchas — flow-export

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: PDF→DOCX/MD: flow reconstruction, columns, tables and CSV, the tagged-PDF fast path. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### A ceiling table is only as good as its last measurement — C10 was wrong in two places (2026-07-31)

> **[Re-checked 2026-09-28]** **superseded** by § "Columns: the cut, the depth and the gutter floor" (limits row 21): `COLUMN_MAX_DEPTH` is 3 now, and `tests/blockers/layout-flatten.blockers.test.ts` was deleted in `8321fd8`. What still holds is the habit — re-measure a ceiling before citing it.

`KNOWN_ISSUES.md` listed **C10** as *"DOCX 3+ column recursive layout — Reconstructor is 2-column"*.
That had been false since B6: `splitColumns` **is** recursive (`COLUMN_MAX_DEPTH = 2`) and
`tests/utils/flowDocColumns.test.ts` has asserted *"3 columns → three groups"* ever since. A same-day
cross-check table in `tests/blockers/README.md` repeated the error from the other direction ("only 1-
and 2-column are exercised") because it was written from the ceiling text instead of from the tests.

The real boundary came from measuring, and it is not the depth arithmetic either: **4 evenly-spaced
columns yield 3 groups, not 4**, because the gutter search is restricted to the inner 20–80% of each
region with a 5% minimum gap, so a level can decline to split well before the cap. Pinned in
`tests/blockers/layout-flatten.blockers.test.ts` at the boundary (3 works, 4 under-splits, words are
never lost — it degrades reading order, not content).

**The habit this should buy: re-measure a ceiling before citing it, and write the pin from the code
rather than from the prose.** Two documents agreed with each other and both were wrong, which is
exactly the failure a green test suite cannot catch. `C11` is the counter-case in the same pass — left
unpinned on purpose, because its only testable surface is an inline predicate in a private method and a
copied predicate pins nothing.

### Columns: the cut, the depth and the gutter floor — limits row 21 (2026-09-27)

Re-measuring C10 on the 408-page corpus found a defect the ceiling never named: **real two-column papers
exported with their columns interleaved line by line.** Their gutters are 12–17pt drawn (2–3% of the page)
and `detectColumnSplit` wanted 5% of the region — 30pt on a Letter page — so BERT's page 2 came out
`Unlike left-to- These approaches have been generalized to right language model …`. Three changes in
`src/utils/flowDoc.ts`, each pinned:

- **The cut is the gutter nearest the region's CENTRE**, ties to the left. The widest gutter cut a 4-column
  page 1|3 whenever the third column was ragged (so its gutter was widest), and the 3 half then ran out of
  depth. A central cut halves the column count at every level.
- **`COLUMN_MAX_DEPTH = 3`**: 4 columns take two levels, 5–8 take three. 9+ come out as 8 groups with no
  word lost — the remaining ceiling, pinned.
- **`MIN_GUTTER_PT = 10`**: a gap splits at `min(5% of the region, 10pt)`. The floor applies to the gap as
  measured on 2pt bins, which loses 2–4pt of the drawn gutter, so in DRAWN terms 14pt or more always splits,
  11pt or less never, and 12–13pt depends on where the gap falls on the grid (measured). 10, not 12: 12
  misses BERT p8 and Census p12. Not 8: 8 splits GPT-3's figure pages where a label column sits beside its
  content, which looks exactly like a gutter. Publication 17's 3-column body pages (~8pt gutters) therefore
  stay one column — a bound, logged as row 46, which needs a discriminator rather than a smaller number
  [superseded 2026-10-01: row 46 found it — § "A narrow gutter splits between body blocks only — limits row 46"].
- **A candidate gutter needs words on both sides BEFORE the choice** (row 21 follow-up). The empty strip
  between the text's right edge and the edge of the 20–80% search zone is also a gap; on a page whose text
  stops short of that edge it can lie nearer the centre than the real gutter. Choosing it and refusing
  afterwards (the old order — the widest rule had the same hole) left such a page one column. Found because the
  first browser fixture placed its columns on a nominal width: its "14pt" page really had a ~140pt gap, split
  under any floor, and so could not see the floor or this.

Corpus: 40 of 408 pages change (35 go 1→2 groups, 3 go 1→3, 1 goes 1→4, and Census p5 stays 2 but is cut elsewhere), plus Census p67 (the back-cover mailer, 2→3) with the follow-up — BERT,
the Census report, W-9, Publication 17's index. The probe ran `splitColumns` on every word, so three table
pages among the 40 (two lattice, one tagged) are an upper bound: the export removes lattice-table words
before splitting, and a tagged page takes the struct-tree path first. **Still interleaved:** a page whose
title, abstract or figure spans both columns (BERT p1, 3, 5, 6) — the vertical cut sees no clean gutter, so
it needs a horizontal cut first (row 44 — [superseded 2026-10-01: done for untagged pages, see § "A title, figure or caption spanning both columns now cuts the page into bands first"]); ResNet and the Japanese multi-column paper never split at any
floor measured, cause untraced (row 45).

Guards: `tests/utils/flowDocColumns.test.ts` "limits row 21" (4, 5, 6, 8 columns; 9 → 8; the ragged
centre cut; 14pt splits; 12pt on the grid splits; text filling half the page splits; 11pt does not) and
`tests/browser/columns-split.browser.test.ts` (3, real pdf.js through `reconstructPage`: a 14pt two-column
page, 4 and 5 prose columns). Each browser column starts exactly `gutter` points after the previous column's
WIDEST line, measured with the font, so the gap pdf.js reports is the gutter. The browser pages use five-word
lines on purpose: short aligned cells are what the borderless-table gate claims as a table since row 20.
Sabotage, predicted first and each restored with `cmp`, measured on the 15 + 3 cases: widest gutter instead of
centre → the ragged centre case, the 9-column case and the 5-column browser case (the even fixtures stay green —
the 20–80% zone clips the outer gutters, so widest and centre agree there; that is why the centre case is
ragged); depth 2 → 5, 6, 8, 9 columns + the 5-column browser case; no 10pt floor → the 14pt, 12pt and
half-page cases + all 3 browser cases; floor 8 → exactly the 11pt case; floor 12 → the 12pt case + the 14pt
browser case; choose-then-refuse (the pre-follow-up order) → the half-page case + the 14pt browser case.

### EH-E released for CSV — borderless tables, and the ONE rule that makes it safe (2026-08-04)

`src/utils/borderlessTable.ts` infers a table grid from text geometry when a page has no ruled lines,
closing **C13**. It is the only escape hatch that cost nothing structural — no dependency, no WASM, no
backend — which is why it was the one worth releasing.

**Design: synthesize pseudo-rules and reuse `buildTableGrid`.** Inferred row/column boundaries become
zero-height `RuleRect`s, so cell assignment, reading order, the empty-band pruning and every consumer
(CSV/DOCX/MD/TXT) are shared with the lattice path. One grid shape, one set of semantics — and the
boundary fix from `753c639` applies for free. Columns are **global whitespace bands** (an x-range no
text item crosses), which is stricter than per-line gap persistence and rejects prose by construction.

**The load-bearing rule is `MIN_SPANNING_RATIO`, and it is not obvious.** A two-column PAGE layout
produces exactly one clean global band, so band detection alone would call every two-column article a
two-column table. The discriminator: **in a table a single line spans multiple column bands; in a
multi-column page each line lives in exactly one.** Proven load-bearing — disabling that one check
makes the two-column-page test fail and *only* that test. Do not "simplify" it away.

**C9 (DOCX/MD/TXT) is WIRED since limits row 20 (2026-09-27) — read the two paragraphs below it as the history
that made the new discriminator necessary.** `inferBorderlessGridForFlow` is the geometric gate plus
`listLayoutGenre`, which reads what the cells SAY: an INDEX (≥30% of lettered cells shaped `term + page numbers` —
`Refunds 18`, `Tax 100 , 104`; measured 0.52–0.62 on all 9 index pages, ≤0.05 on every genuine table) and a table of
CONTENTS (≥20% of rows with a dot leader; 0.47 on the contents page, 0 on every other firing). Both are signatures of
the exact genre the corpus found, not smaller numbers on the old statistic. `reconstructPage` runs it only when no
ruled table was found; the grid is built from every word on the page, so the page becomes one table and no
paragraphs, and the DOCX writer draws it with NO borders (`FlowTable.borderless`). The CSV/XLSX gate is unchanged and
deliberately looser — see the harm asymmetry below. The corpus probe now drives `reconstructPage` itself (it records
`flowTables`): exactly the 5 genuine pages carry a table, 355 do not. It passes NO rules, so it measures the borderless
gate on every page and is an upper bound on its firings; which of the 5 take the lattice path in the real export (the
1099-MISC boxes are drawn) is unmeasured. A tagged page never reaches this branch — the struct-tree path returns
first. Bounds, in `KNOWN_ISSUES.md` C9: a
contents page with no leaders, a roster of short names with no page numbers, and a page of key-value pairs (which now
exports as a two-column table — the corpus test declines to score that shape) all still fire; a genuine table whose
label and value share one cell reads as an index and is refused (the safe direction). Guards: 4 pure cases in
`tests/utils/borderlessTable.test.ts`, and 7 in `tests/browser/borderless-corpus.browser.test.ts` — each list layout
FIRES the geometric gate and is refused by the genre (the pairing proves the refusal does the work), the invoice
exports as one borderless table, prose drawn as several runs per line exports with no table, prose/index/contents
controls, and one through the REAL `_extractFlowDoc` — the whitespace invoice is a borderless table and the same
invoice with drawn rules a lattice one. Sabotage, predicted first, each restored with `cmp` (jsdom + browser + corpus flow tables): genre check off
→ 0 + 3, corpus 15; index refusal off → 1 + 2, corpus 14; leader refusal off → 1 + 2, corpus 6; `width` dropped from
the flow's table input → **every tracked test green and the corpus at 114** until the several-runs-per-line case was
added, which now reds exactly it — one item per cell (every synthetic fixture) gives the same bands with or without
widths; borders always drawn → exactly the invoice case; borderless tried even when a ruled table was found → exactly
the real-export case.

**Until row 20: C9 (DOCX) stays UNWIRED — and as of 2026-08-05 that is a MEASURED decision, not a cautious one.**
A realistic corpus (`tests/browser/borderless-corpus.browser.test.ts`, real pdf.js extraction of 8 page
shapes) found the gate had **2 false positives out of 6 prose shapes**, both invisible to the unit tests:
a **side-by-side two-column article** (6×2) and a **bulleted list** (4×2). Both defeat
`MIN_SPANNING_RATIO` for the same reason — every line genuinely does span both bands — and the
two-column unit fixture had passed only because it stacked the columns sequentially, which no real layout
does. That fixture is now realistic and the gate has a second rule (`MAX_MEDIAN_CELL_WORDS`, measured:
tables median 1 word/cell, prose 4–5), after which the synthetic corpus is clean.

**The real-file corpus was collected and measured on 2026-09-04, and it REFUTES the "breadth is the
blocker" reading that stood here.** 15 public PDFs, 360 pages — IRS/GSA/USPTO forms, arXiv articles
in 1- and 2-column layouts, Census/Budget/Publication-17 reports. `scripts/c9-corpus-fetch.sh`
rebuilds it into gitignored `var/corpus/`; `tests/tools/c9Corpus.test.ts` runs the REAL gate over
every page (double-gated: it needs the corpus AND `C9_CORPUS=1`, so it is inert in CI and in the
pre-push hook — invoke it as `C9_CORPUS=1 npx vitest run tests/tools/c9Corpus.test.ts`) and writes
`var/claude/c9-corpus-report.json`. Result: **15 firings — 5 genuine data tables (1099-MISC box
grids ×3, the W-4 withholding tables, a Pub-17 rate schedule) and 10 multi-column LAYOUT**, being 9
pages of Publication 17's alphabetical INDEX and one paper's table of contents. C9 therefore stayed
unwired until row 20 found the discriminator above.

**The mechanism is the useful part, and it is measured rather than argued.** An alphabetical index
satisfies both discriminators HONESTLY: entries in different columns share baselines, so every line
spans all four bands and `MIN_SPANNING_RATIO` passes; and its entries are as short as a data table's
cells, so `MAX_MEDIAN_CELL_WORDS` passes too. The index pages score **median 3 words/cell — the
identical value as the 1099-MISC and W-4 tables, which are TRUE positives.** No threshold on that
statistic separates them, and tightening it to 2 would refuse the real forms. **So this is not a
tuning gap: the next attempt needs a different discriminator, not a smaller number.** Reading an
index row-wise (`Accounting periods | American Indians | Bequests | Certificates`) destroys its order
AND removes the words from the paragraph flow — the exact harm the gate exists to prevent.

Encouraging half: the 2-column ARTICLES fired **zero** times, so the existing rules do work on the
shape they were built for. The gap is indexes and contents pages, where short entries in aligned
columns are genuinely indistinguishable from a table by geometry alone.

(The first hypothesis — that empty cells deflate the median — was WRONG, and is recorded as such
rather than quietly dropped: the filter already excludes them with `.filter(Boolean)`. It was checked
before being written down, which is the only reason it is not in this file as fact.)

The harm asymmetry below is unchanged.

**The harm asymmetry, which is why the bar is this high for DOCX and not for CSV.**
`exportTableCsv` runs only when the user explicitly asked for a table, so a false positive costs them
one discardable CSV. The DOCX path is different: `reconstructPage` **removes in-region words from the
paragraph flow**, so a phantom table there would silently mangle ordinary prose. Same engine, so C9 is
a wiring change plus a stricter threshold — but it should follow evidence from real files.

Guards: `tests/utils/borderlessTable.test.ts` (11 — the two refusal cases come FIRST because a phantom
table is worse than a missed one) + `tests/browser/borderless-table.browser.test.ts` (3, real pdf.js:
the lattice detector must find nothing, the borderless one recovers a 4×3 grid, and real prose is
refused). `TableTextItem.width` is a new OPTIONAL field — the lattice path ignores it, so ruled-table
output is byte-identical; the detector cannot find a column without knowing where text ENDS.

### Two boundary-convention bugs in the lattice-table path (2026-07-31)

Found by READING the code while scoping EH-E, not by a failing test — both were invisible to 25
existing flow-path test files. Worth knowing because the first is a **silent data-loss** shape this
repo has been bitten by before.

**1. Inclusive region vs half-open cells.** `_itemInRegion` (`flowDoc.ts`) accepts the table region
bbox **inclusively on all four sides**, while `buildTableGrid`'s cell bands were **half-open**
(`>= lo && < hi`), tiling only `[left,right) × [bottom,top)`. `reconstructPage` (`flowDoc.ts:1542`)
then **removes every in-region word from the paragraph flow** — so a word sitting exactly on the top
or right boundary was deleted from the flow AND landed in no cell, vanishing from DOCX/MD/TXT/CSV with
no warning. **Measured worse than that:** when such a word was the only text, every cell came out
empty, the grid was rejected as phantom, and `buildTableGrid` returned `null` — the whole table
disappeared. Fixed by making the outermost upper bound inclusive (last column, top row); the lower
bounds were already inclusive, so all four outer edges now match the region and internal bands stay
half-open, which is what stops two adjacent cells claiming the same item.

**2. Rows were not pruned, columns were.** The empty-column prune existed with a comment explaining
exactly why (an over-segmented vertical rule — one logical line detected as two bounds >tol apart —
creates a thin text-free band that emits a spurious `,,`). **Rows have the identical failure mode** (a
2px line drawn as two 1px strokes) and were left in, producing a blank CSV record and an empty row in
the exported DOCX table. The asymmetry was the bug and the column comment was already its
specification. Now pruned on both axes, keyed on "this band caught no text at all" — so a deliberate
blank spacer row whose band does carry text elsewhere is still preserved (guarded).

**The transferable lesson: when one function tests a boundary inclusively and its collaborator tests
the same boundary half-open, the gap is silent by construction.** Neither side looks wrong alone.
Guard: `tests/utils/tableExtractEdges.test.ts` (7 cases; all 4 defect cases fail on the pre-fix code,
two of them with `expected null not to be null`).

### Table → CSV (#56)

`src/utils/tableExtract.ts` (`clusterPositions`/`buildTableGrid`/`gridToCsv`, pure) +
`ExportService.exportTableCsv`. `walkPageOps` now emits **`vRules`** (thin *vertical* line-like rects) alongside
the horizontal `rules` — the horizontal filter (underline/strike) is byte-unchanged; vertical is a new
additive branch. buildTableGrid clusters h-rule y's → rows, v-rule x's → cols, assigns text by center.
**Corrected 2026-08-04** — this paragraph carried three claims that later work made false: lattice-only
(borderless now works via EH-E, see the § above), "plain download, no FS-Access picker" (both table
exports call `pickSaveTarget`, which is why the picker must precede the async extraction), and "XLSX
deferred (#56b)" (shipped — see § XLSX table export).

### PDF→DOCX/MD export (beta)

> **[Re-checked 2026-09-28]** this section is long and dated; the statements it has outgrown carry dated markers in place, its line citations (`matchStandardFont`, `hasNonWinAnsi`) have drifted — cite by symbol — and the `clearFormatting` field count has grown (`formattingService.ts` is the authority).

`src/utils/flowDoc.ts` reconstructs a flow model
(lines→paragraphs→headings/styles/RTL/lists/2-column) from pdf.js text items;
`flowDocWriters.ts` emits DOCX (via `docx` npm, **dynamically imported** — keep it that
way, it's a ~395 KB lazy chunk) + Markdown + TXT. Source-PDF text only — overlay
annotations are NOT exported. Heuristic thresholds are font-size-relative.
**MD/TXT parity (2026-06-15):** the Markdown/TXT writers now carry ordered-list ordinals
(`orderedMarker` + `computeOrderedOrdinals`, sharing `orderedRefKey`'s instance logic with the
DOCX writer — letters/roman/decimal per `listFormat`), list nesting (`'  '.repeat(listDepth)`),
and images (data-URI `![]` in MD, `[image]` in TXT) — previously all three were dropped.
Phase 2 (2026-06-13): added 2-column XY-cut (`detectColumnSplit`) and list detection
(`detectListPrefix`).
Phase 3 (2026-06-13): native DOCX ordered-list numbering via `w:numPr` + instance-based
restart (separate lists separated by body text restart at 1). Tests now unpack the DOCX
ZIP with `fflate` and assert `w:numPr` presence and multi-instance `numId` divergence.
**Phase 4 (2026-06-13)**: images — `getOperatorList` OPS.paintImageXObject + CTM tracking
in `_extractFlowDoc` → `FlowImage` (x/y/w/h/base64/mimeType) on `FlowPage.images?` →
`ImageRun` in DOCX (appended after text per page; pt→px at 96 DPI). Canvas extraction
requires a real browser (`_extractFlowDoc` renders each image-bearing page off-screen first
to populate `page.objs` before iterating; pdfjs-dist v6 stores images as `{ width, height,
bitmap?: ImageBitmap }`, not HTMLCanvasElement — bitmap is drawn onto a temp canvas for
base64. Browser QA required to verify on unviewed/un-scrolled pages).
**ISSUE-3 fix (2026-06-14):** an image reused across ≥2 pages is promoted by pdf.js to
`page.commonObjs` with a `g_` name; extraction now resolves `g_`-prefixed names from `commonObjs`
(not just `page.objs`) — bitmap typed as `CanvasImageSource` (v6 bitmaps are `VideoFrame`). Guarded by
`tests/browser/issue3-docx-images.browser.test.ts`. **ISSUE-4 fix:** `exportAsDocx` emits a file when
there is text OR images (image-only PDFs export their images instead of a silent no-op). Also:
**export-path dedup** — extracted `_applyOverlaysToPage` + `_saveOrDownload` helpers
in `exportService.ts`, eliminating the triplicated 10-param `buildPageOverlays` block.
**Sprint 2 fidelity (2026-06-14):** (B-1) real font faces via 28-entry `WORD_FONT_ALLOWLIST` +
`resolveWordFont` (strips subset/style/foundry suffix; unknown → serif/sans/mono fallback) instead of
collapsing every face to 3 generics. **Superseded by limits row 18 (2026-09-27):** `wordFontFor` returns
`{name, passThrough}` — a known family maps to Word's name (spaceless lookup, plus vendor editions and clones), a
REAL unknown family passes through split at word boundaries (`MyriadPro` → `Myriad Pro`, `NotoSansCJKjp` →
`Noto Sans CJK JP`) into all four `w:rFonts` slots, eastAsia included, and a generated name (TeX CMR10, TT…o00,
bare ids, hashes; the charset rule catches pdf.js's `g_d0_f1`) keeps the generic. Passed-through names are listed in
`word/fontTable.xml` via `Packer.toBase64String`'s third argument (the `docx` package otherwise writes an empty
table), with `w:family`/`w:pitch` from the NAME when it states a class (`wordFamilyHint`) — pdf.js's own guess reads
FixedPitch and called NotoSerifCJKjp `monospace`. The hint is word-bounded: as first written it read 'Lucida Sans
Unicode', 'Arial Unicode MS' and 'Monotype Corsiva' as monospace (`code`, `mono` substrings; found at the 6C gate). Guards: `tests/utils/flowDocFidelity.test.ts` row-18 blocks and
`tests/browser/docx-font-names.browser.test.ts` (real extraction on `tests/fixtures/vertical/`). Sabotage, each
restored with `cmp`: allowlist keys keep spaces → 3; vendor-edition fallback dropped → 5; generated-name rule
dropped → 6 (predicted 7 — the `g_d` pattern was unreachable and was removed); fontTable override dropped → 2
jsdom + 2 browser; word split removed → 10 + 2; name hint ignored → exactly 1 + 1. (B-2) page margins from per-page text bbox (Q1/Q3, outlier-robust,
clamped to ≤40% page dim) → `w:pgMar`. (B-3) paragraph/line spacing from baseline gaps → `w:spacing`.
(B-4) images are **floating-anchored** at PDF coords (`wp:anchor`/`wp:posOffset`, Y-flipped EMU), no
longer centered-trailing — still via `word/media/` (ISSUE-3/4 guard). (B-5) justified detection
(`AlignmentType.JUSTIFIED`) + first-line/left `w:ind`; `isCentered` tightened so full-width justified
blocks aren't misread as centered. Verified by a real-Chrome DOCX export QA (margins/spacing/fonts/
floating-image XML all present, 0 console errors). New tests: `tests/utils/flowDocFidelity.test.ts`,
`flowDocExtraction.test.ts`.
**Sprint 3 (2026-06-15):** ordered-list markers widened — `detectListPrefix` now recognizes decimal
`(1)`/`1)`, and lower/upper-alpha **paren forms** `a)`/`(a)`/`A)`/`(A)` (NEVER bare-dot `a.`/`A.`/`I.`,
to dodge author-initials), each carrying a docx `LevelFormat` (decimal/lowerLetter/upperLetter). The
writer maps each distinct (format,text) to its own numbering reference — legacy decimal `%1.` keeps the
`ordered-list` id — and restarts instances per-reference. `flowDocWriters.ts` `refKeyOf`/`usedRefs`.
**Fidelity scorecards** (honest done/reachable/ceiling).
**Sprint 3 batch 2 (2026-06-14) — DONE:** (1) **DOCX hyperlinks** — `exportService` reads
`page.getAnnotations()` (Link+url), passes `FlowLinkRect[]` to `reconstructPage`, which bbox-tags words
(`FlowRun.linkUrl`, in the merge key); the writer wraps same-url runs in `ExternalHyperlink` (blue +
underline) and the MD writer emits `[text](url)`. (2) **DOCX JPEG re-encode** — `pickImageMime`
(`flowDoc.ts`): alpha→PNG, large opaque (≥200×200)→JPEG q0.85; extraction samples canvas alpha + picks
the mime (was hardcoded PNG → multi-MB scans). (3) **List nesting** — `para.listDepth` now derived from
item x0 indent vs `colLeft` in font-size units (was hardcoded 0). (4) **Headings H4–H6** — `heading`
type widened to `0..6`, `assignHeadings` `slice(0,6)`, writer `HEADINGS` extended. (5) **True-edit TJ
kerning preservation** (biggest-ROI) — `replaceShowOpInPlace`/`replaceShowOpHex` now DISTRIBUTE the new
text across the existing TJ string/hex segments by original char/byte counts (last segment absorbs the
length delta) instead of collapsing/jamming into one segment — kerning numbers survive, neighbour glyphs
stop shifting. New `decodeLiteralString` measures segment lengths. The A2 no-stale-glyph guarantee still
holds. Guards: `tests/utils/{flowDoc,flowDocWriters,flowDocHyperlinks,flowDocImageMime,contentStreamEditor}.test.ts`
+ `tests/browser/issue3-docx-images.browser.test.ts` (Gap 7 JPEG).
**Sprint 4 fidelity DONE (2026-06-15):** super/subscript + roman lists (50ac4d5); spot-color/Separation
black-collapse fixed via the v6 hex-string color path (d7879fb). **(b) underline/strikethrough** —
`classifyRuleAsUnderline(rule, run)` (pure, y-up PDF space) matches thin filled/stroked rules from the
export op-walk to text-run baselines; rules are collected by decoding v6 `constructPath` args
`[paintOp, pathData, minMax]` and transforming the path-local minMax bbox by the CTM into Word space
(`Word.x/y = it.transform[4]/[5]`, the same space) → `FlowRun.underline/strikethrough` → docx `w:u`/`w:strike`.
Thresholds: height ≤ 0.18×fontSize (rejects shading), width > 3×height (rejects vertical bars), ≥50%
x-overlap, baseline band dy∈[-0.35,0.10]×size (underline) / [0.18,0.62] (strike). **(d) rotated-image
sizing** — `decomposeImageCtm([a,b,c,d,e,f])` → {scaleX,scaleY,rotation}; image extraction uses scaleX/scaleY
for true on-page size and stores `FlowImage.rotation` → docx `transformation.rotation` (DEGREES; docx
converts to 60000ths — NOT EMU). Guards: `tests/utils/flowDocUnderlineStrike.test.ts` (9),
`flowDocImageRotation.test.ts` (7), writer XML tests, `tests/browser/underline-strike.browser.test.ts`
(real pdf.js op-list → reconstructPage → DOCX e2e).
**List continuation merge DONE (2026-06-15):** a wrapped list item whose continuation line split into a
separate marker-less paragraph used to reset the writer's numbering instance (next item restarted at 1).
`reconstructColumn` now re-absorbs a single-line, body-sized, hanging-INDENTED (right of the marker),
marker-less paragraph directly after a list item back into that item — genuine body paragraphs (start at
the column-left edge) and real list items (carry a marker) stay separate. Guard: `tests/utils/flowDoc.test.ts`
(`reconstructColumn — wrapped list-item continuation merge`).
**Number-tokenizer exponent already DONE (B-1):** `consumeNumberBody` keeps `1e-3`/`2.5E+2` as one token in
BOTH the main loop and `tokenizeOne` (array parser) — verified 2026-06-15.
**Path-3 fill-color canvas-sample DONE (`d7879fb`, e2e-guarded 2026-06-15):** `resolveRedrawColor`
(precedence: style override > parsed `rg`/`g`/`k` > canvas-sampled `fallbackColor` > black) +
`replaceTextAt(…, fallbackColor)`; `textEditHandler` passes `sampledFallback =
hexToRgb01(overlayContext.textColor)` (the glyph color sampled in `_buildOverlayContext`), so
Separation/spot (`scn`) text no longer redraws black. Guards: `tests/utils/contentStreamColor.test.ts`
(pure `resolveRedrawColor`, incl. the scn-fallback case) + `tests/browser/truedit-spot-color.browser.test.ts`
(real pdf.js render of a Separation colorspace → forces Path-3 via Helvetica `é` edit → asserts the
redrawn glyph stays chromatic, and a no-fallback control redraws black). **All three `02-trueedit-matrix.md`
"reachable gaps" are now done** (Gap 1 TJ-kerning distribute, Gap 2 this, Gap 3 exponent).
**Ceiling** (genuinely hard client-side): lattice/borderless tables, vector→raster, 9+ columns and
a horizontal-first XY-cut (see § "Columns: the cut, the depth and the gutter floor"), exact subset-font faces; true-edit IN-PLACE Arabic (subset CID fonts lack the glyphs — structural),
true-edit cm-rotation Path-3 redraw, Type3; mixed LTR+RTL single-line reorder. [superseded 2026-09-28: A1 (`6586c23`) redraws with the full text matrix, and mixed-direction lines are reordered — `drawBidiLine` in the overlay, `logicalItemOrder` in the DOCX flow] (Tashkeel GPOS positioning in the
overlay was fixed by limits row 25, C19.)
**Decoration + graphics-state fidelity (#text-decoration, 2026-06-18):** PDF has NO underline/strike TEXT
attribute — they're SEPARATE thin filled `re` rects whose width is decoupled from the text, so a true-edit
that changed text LENGTH used to leave the rule frozen (longer edit → un-underlined tail; the reported bug).
`replaceTextAt`/`deleteTextAt` take `opts.adjustDecorations` (wired from `isEnabled('textDecor')`, #28 seam,
default ON; PURE behavior gate — no UI button, so vite needs NO define, env-undefined→ON like every flag).
Pure helpers in `contentStreamEditor.ts`: `locateDecorationRects` (CTM-aware walk, USER space) collects BOTH
decoration encodings — filled `re`+fill-painter rects (`kind:'rect'`) AND horizontal stroked lines
`mx my m  lx ly l  S` (`kind:'line'`, the Word/LibreOffice underline form; `DecorationRule` is a discriminated
union) → `matchDecorationForText` (reuses the export `classifyRuleAsUnderline` baseline-band+≥50%-overlap
classifier — SINGLE candidate only, else refuse) → `adjustedRuleWidth` (scale by new/old text-width ratio
measured in the matched standard font → path- AND scale-invariant; the old rule already bakes in Tz/CTM and
we keep them, so the ratio cancels — no separate hScale math; div-by-0 guarded). Resize rewrites the rect's
width operand OR the line's `l` endpoint x (relative to the fixed `m` anchor, draw-direction-preserving) IN
the same `writeBack` → atomic + undoable via the existing `ReplaceSourcePdfBytesCmd` (NO new command, NO schema
bump). Delete neutralises the paint op to `n` (fill for rect, stroke `S` for line) + clears its operands.
**The stroked-LINE form is the real-file fix (2026-06-19):** the original 2026-06-18 ship handled ONLY filled
`re` rects, so Word/LibreOffice underlines (drawn as `m…l…S`) stayed frozen — the reported "still not
propagated" symptom = a successful in-place edit whose stroked rule was refused, NOT the overlay path.
**NEGATIVE-height bbox normalization (#bg-fill, 2026-06-20):** PDF `re` allows a NEGATIVE height — iText/
JasperReports draw filled background BANDS top-down as `x y w -h re f` (real-world: a Navigo/IDFM invoice's
blue header band = `0.553 0.702 0.886 rg 27 719 540 -66 re f`). `locateDecorationRects` stored the SIGNED height,
and `classifyRuleAsUnderline`'s "too tall to be a decoration" guard `rule.height > 0.18*fontSize` is DEFEATED by a
negative value (`-66 > 1.98` is false) — so a 66pt full-width background fill was misclassified as the subtitle's
strikethrough and its width resized 540→120pt, WIPING the band (the reported "background color changes" bug; only
fired for runs whose baseline fell in the mis-computed band, e.g. the size-11 subtitle, not the size-18 heading —
hence "sometimes"). Fix: `locateDecorationRects` normalizes every `re` to its true positive bbox (`y0 = h<0 ? y+h : y`,
`height = |h|`); a genuine thin top-down underline normalizes to a thin positive height and still matches. Width keeps
its sign (a negative-width rect is already rejected by the classifier, so the width-operand resize never touches it).
Guard: `tests/utils/contentStreamEditor.test.ts` ("REFUSES a tall background rect drawn with NEGATIVE height" + the
thin-underline no-regression case).
**Non-obvious REFUSE gates (each = leave PDF unchanged, never guess):** sheared/rotated CTM (b or c ≠ 0); >1
in-band rule (double underline); a SLANTED line (m/l y differ) or POLYLINE (≥2 `l`); `s` (closepath+stroke,
ambiguous closing segment) — only plain `S`; and a rect/line whose painter ALSO closes an `m/l/c/v/y/h`
subpath (neutralising it would erase that vector art), refused via `sawOtherPath` + the single-segment
counts. **F10 + F13 + F3 byte-splice DONE (2026-06-24):**
**F10** — `prepareDecorationResize` now refuses (returns the null mutator) when the target run is `tilted`
(sheared/rotated/non-uniformly-scaled `textMatrix×CTM`; reuses the existing flag — NOT a new `tmTilted` — that
`addDecorationAt` already gates on), beside the F6 text-rise gate; the text edit still proceeds, only the
decoration geometry is left untouched. **F13** — new pure `ctmStackUnderflows(ops)` (a `Q` popping an empty
graphics-state stack) gates the same function (stale CTM ⇒ decoration geometry unreliable). **F3 hybrid
byte-splice (the deferred rewrite, now SHIPPED):** the tokenizer stamps `byteStart`/`byteEnd` on every `CsToken`
and `groupOps` stamps the op span on every `CsOp`; `findTarget` snapshots `source` + `origSerialized` (per-op
`serializeOp`) onto `EditTarget` pre-mutation; new `buildStreamContent(found, appendedTail)` diffs mutated-vs-snapshot
ops — **exactly ONE op changed (valid span) → splice that op's bytes into the original `source`, every other byte
(incl. inline-image/binary) verbatim + append the tail; ZERO ops changed + a tail (addDecorationAt) → keep `source`
verbatim + append; else → today's `serializeOps` (zero regression)**. `writeBack` (delete/size/color/Path1/Path2),
Path 3 (`+redraw`), and `addDecorationAt` (`+block`) all route through it; `redraw`/`block` already start with `\n`
so the fallback is byte-identical to the old `serializeOps(ops)+tail`. The F12 multi-stream PRESERVATION bound is
unchanged (an XObject edit writes that one stream via the builder). Guards: `tests/utils/contentStreamEditor.test.ts`
(F10 tilted-refuse, F13 `ctmStackUnderflows`+gate, byte-offset slice-back, `serializeOp`, `buildStreamContent`
splice/fallback/inline-image) + `tests/browser/trueedit-bytesplice.browser.test.ts` (real Chrome: inline image
survives a one-word edit byte-identical AND pdf.js renders the spliced stream). **Edge-case hardening F5–F8 (2026-06-20 audit):** F5 — `locateDecorationRects` now also refuses a **mirror / negative-scale CTM** (`ctm[0]<0 ||
ctm[3]<0`; flip-X/flip-Y/180°) for BOTH rect and stroked line (the line path uses `abs()` so a mirror silently
flipped resize direction; the `re` path was safe-by-luck only). F6 — `prepareDecorationResize` refuses when the
target run carries a non-zero **text rise (`Ts`, super/subscript)**: its reported baseline (origin.y, no rise
applied) is low-confidence and could match an unrelated nearby rule (cm-only sizing without Tm scale remains a
documented ceiling). F7 — the inline-image tokenizer (`findInlineImageEnd`) now scans for a **whitespace-delimited
`EI`** (preceded by whitespace, followed by ws/delimiter/EOF) from after the `ID` marker, falling back to the
legacy first-`EI` — a bare `indexOf('EI')` matched the byte pair "EI" inside binary image data and truncated the
image, corrupting the whole page on re-serialize (the one concrete corruption vector F3 would also have closed).
F8 — `locateTextOps` captures the `"` show op's `aw ac` operands as persistent word/char spacing (spec: `"` ≡
`aw Tw ac Tc string '`) so a later Path-3 redraw of that run uses correct spacing. **F9 — Path-3 build-then-blank
ordering:** `replaceTextAt` used to `blankShowOp` the original BEFORE embedding/encoding the redraw font, so any
throw in `embedFont`/`encodeText` (a CP1252-high char `€`/`Œ` whose base-14 AFM lacks a width) destroyed the
original with no replacement (silent data loss). It now builds the redraw string + runs the decoration resize
inside a `try`, and only blanks once the redraw is guaranteed; on throw it `return false` → the caller's overlay
fallback, original untouched. Success-path byte-output is unchanged (still blank + appended redraw). Path-3 redraw re-emits captured `Tc`/`Tw`/`Tz`/`Ts` — and (F2, 2026-06-19) `Tr` render mode + stroke
color (`RG`/`G`/`K`/`SC`/`SCN`, reset on `CS`) + line width (`w`) so stroked/outline text keeps its outline —
via `buildPath3Redraw`; `locateTextOps` stamps them onto `TextOpInfo` only when non-default → byte-identical for
plain ops. **F1 restyle (2026-06-19):** `replaceTextAt` computes `wantsRestyle` (style carries
bold/italic/fontFamily/color/fontSize) and SKIPS Path 1 & Path 2 → forces the isolated Path-3 redraw (the only
path that applies `style`; its own `q…Q` block, no neighbour bleed) — previously Path 1/2 swapped bytes and
silently dropped the restyle. No `style` ⇒ Path 1/2 byte-identical; a restyle Path 3 refuses (Arabic/non-WinAnsi/
XObject) → handler overlay carries the style. P2 (documented): stroke `w` line-width is not q/Q-stack-restored,
so a stale `w` may feed a wrong `height` to classification — affects match acceptance only (never resize geometry),
and a false match still requires a thin horizontal baseline-band line >50% across the text (= an underline).
**Text-attribute inventory (#text-attr, 2026-06-19) — what a true-edit preserves:** Path 1 (literal byte-swap)
and Path 2 (subset hex) mutate ONLY the show-op operand, so they preserve EVERY surrounding attribute by
construction (font/size/fill/stroke/Tc/Tw/Tz/Ts/Tr/Tm/CTM/alpha/dash/clip). Path 3 (standard-font redraw) is the
ONLY lossy path — it is appended at **end-of-stream** in an isolated `q…Q`, so it inherits the DEFAULT graphics
state and must re-emit each attribute explicitly: it DOES re-emit fill/font/size/Tc/Tw/Tz/Ts/Tr/stroke/`w` and
applies `style`. **Path-3 ceilings (all rare, all documented, no real-file repro → not coded):** [superseded 2026-09-28 for (1), (3) and (4): A1 `6586c23`, A2 `14f5a55` (`lookupExtGStateAlpha`) and A6a `3b9a553` (`dashPattern`) capture them — documented further down this section] (1) Tm
rotation/skew + CTM scale/rotation flattened to an axis-aligned `1 0 0 1 x y Tm` (F3/F4, the same cm-rotation
ceiling above); (2) embedded font face → standard substitute (the core Path-3 tradeoff — glyph shapes/metrics
shift slightly); (3) **ExtGState alpha (`ca`/`CA`)** is NOT captured by `locateTextOps`, so semi-transparent
(watermark/faded) text redraws fully opaque; (4) **line dash / cap / join** on stroked/outline text are not
captured → a dashed outline redraws solid; (5) **text-clip render modes 4–6** keep their FILL (visible) but lose
the clip side-effect (the appended redraw is past all page content, so nothing downstream is clipped) — modes
3/7 (invisible/clip-only) are refused → overlay. F1/F2 (restyle + stroke/width/Tr) shipped `9d67b84`; common-case
edits (Path 1/2 + the Path-3 attrs above) are fully covered.
**Max-fidelity Sub-project A (2026-06-25):** five fidelity gains, all gated/additive →
byte-identical at defaults. **A2 (`14f5a55`) Path-3 alpha:** `locateTextOps` records the active ExtGState resource
name; a Path-3 redraw of semi-transparent (watermark/faded) text recovers its `ca`/`CA` via `lookupExtGStateAlpha`
and, when alpha<1, `addPageExtGStateResource` adds a fresh ExtGState that `buildPath3Redraw` re-emits via `/GSx gs`
(was redrawn opaque). **A3a (`a5bc8f3`) XObject Path-1/2 true-edit:** font introspection is now XObject-aware — a
shared `getFontResourceDict` + optional `xObjectName` on `getPageFontEntry`/`isByteSwapUnsafeFont`/
`getPageFontToUnicode`/`getPageFontBaseName`/`getPageFontDescriptor`, so an XObject target's REAL font is seen
(else the page lookup misses it and defaults byte-swap-SAFE → Path-1 would corrupt an XObject CID font — the key
trap). New `isPath3OnlyTarget` gates `getEditableTextAt` + the `textEditHandler` hit: a Path-1/2-safe XObject target
edits in place (`writeBack`→`setFormXObjectContent`), a Path-3-only one overlays. `TextOpInfo.xObjectName` is
stamped by `findTarget`. **A1 (`6586c23`) Path-3 full affine:** `locateTextOps` captures the text→user linear
matrix (`textMatrix×CTM`) when non-identity + the BASE `Tf` size; `buildPath3Redraw` emits that matrix as the Tm
(was hard-coded identity) using the base size (or the scale double-applies) → rotated/scaled/sheared text redraws
in place instead of upright. **A3b (`5d0cb2e`) XObject Path-3:** the Path-3-in-XObject refuse is lifted — the
target's origin/textMatrix are XObject-LOCAL (the `Do` re-applies the page CTM at render), so the redraw writes the
XObject's own stream via `setFormXObjectContent` with the substitute font/gs added to the XObject's `/Resources`
(`getResourcesDict`/`ensureResourceSubDict`, XObject-aware `addPageFontResource`/`addPageExtGStateResource`); an
unresolvable XObject dict refuses → overlay. **A6 (`3b9a553`) polish:** A6a re-emits stroke dash/cap/join (`d`/`J`/
`j`) on a Path-3 outline redraw; A6b measures the decoration resize's new width at the NEW font size on a
size-change edit; A6c is a guard test for the already-correct rotated-page inline-input placement (anchored at the
click point). **Audit dropped A4 (Path-3 bold/italic face — already wired via `matchStandardFont :2027`) and A5
(non-WinAnsi/ligature refuse — already `hasNonWinAnsi :2004`) as ALREADY SHIPPED** (stale scorecards; code is
truth). Guards: the A1/A2/A3a/A6 cases in `tests/utils/contentStreamEditor.test.ts` + the rotated/XObject cases in
`tests/handlers/textEditHandler.test.ts` + `tests/browser/{trueedit-alpha,trueedit-xobject,trueedit-transform}.browser.test.ts`.
**Embedded-advance width (#text-decoration-width, 2026-06-19, fixes the "underline trails past the added text"
overshoot):** the resize scales the old rule by `newTextWidth/oldTextWidth`. Path 1/2 keep the EMBEDDED font, but
the widths used to be measured in a base-14 PROXY whose per-glyph metrics differ (measured: a real invoice font's
tabular DIGITS are ~25% wider than Helvetica's — proxy/actual 0.80 for digits vs 0.99 for letters), so any edit
that shifted the digit/letter MIX drifted the rule (adding letters to a digit run → overshoot tail). Now
`prepareDecorationResize` measures with the font's OWN advances via `getPageFontGlyphWidths` (CID `/W`+`/DW`,
**Identity encodings only** — else show-code ≠ CID; or simple `/Widths`+`/FirstChar`) + pure `embeddedTextWidth`
(maps each char→code via the ToUnicode reverse map, sums advances; null if any char unmapped → proxy fallback).
The closure gained `forceProxy`: **Path 3 passes it `true`** (it redraws in the standard font, so the proxy IS the
render font there); Path 1/2 default false. **Scoped by `reverseMap.size > 0`** → a base-14 font with no ToUnicode
keeps the proxy (which is exact there), so the Helvetica decoration tests are byte-unchanged. As a bonus, the
proxy font is now embedded only on the fallback, so the prior "tiny orphan font dict on every match" is gone in
the common case. **Path-3 absolute-anchor (2026-06-19, fixes the real-file overshoot the embedded-advance fix did
NOT reach):** on a PDF whose every font is a CID/Identity-H subset with **no ToUnicode** (a real Word/LibreOffice
invoice), `getPageFontGlyphWidths` returns null AND the reverseMap is empty, so the embedded path can't engage and
the edit takes **Path 3** (standard-font redraw). There `forceProxy=true`, and scaling `R_old` by `proxyNew/proxyOld`
OVERSHOOTS because `R_old` came from the ORIGINAL embedded font (`R_old ≠ proxyWidth(oldText)`) — measured live:
167.6pt rule × 1.539 (HelveticaBold ratio) = 258pt vs the 212pt the redraw actually renders → a ~46pt tail. Fix:
when `forceProxy`, set the rule to the **absolute redrawn width** `newW × (Tz hScale/100)` (the proxy IS the render
font in Path 3, starting at the same left edge), NOT `R_old × ratio`. Verified on the real file via the live app +
canvas pixel scan: overshoot 66px → 1px. Path 1/2 keep the ratio (correct there, `R_old` = embedded oldW). Known
P2: a Path-3 edit that ALSO changes fontSize measures `newW` at `target.fontSize`, not the new size (rare). [superseded 2026-09-28: addressed in `3b9a553` ("size-change deco width") — see the A6 notes below] **Ceiling #text-decoration-b:** highlight/background-rect resize, `re`-drawn-as-stroke (`re S`)
underline, decorations inside Form XObjects, rotated-CTM rects/lines; non-Identity CID encodings + ligature
ToUnicode keys fall back to the (approximate) proxy. Guards: `tests/utils/contentStreamEditor.test.ts` (rect+line
locate/match/adjust/redraw/capture/resize/delete + slanted/polyline/sheared/co-painted refusals;
`getPageFontGlyphWidths`/`embeddedTextWidth` CID-`/W` read + non-Identity null; a CID-digit underline that resizes
to the embedded width 26.4pt, NOT the 38.4pt proxy overshoot), `tests/browser/trueedit-underline-resize.browser.test.ts`
(real pdf.js pixels: BOTH rect and stroked-line underline extend under the new tail; OFF controls leave it bare).
**Richer PDF text toolbar (2026-06-21) — three sub-items.** The formatting toolbar (`index.html`) gained
**Underline / Strikethrough / Align** buttons (`underlineBtn`/`strikeBtn`/`alignBtn`), wired in
`formattingBinder.ts` → `pdfTurboApp` delegators → `FormattingService.toggleUnderline`/`toggleStrikethrough`/
`cycleAlign` (each a `MoveResizeCmd`, early-returns without a selected TextElement). **(C) overlay TextElement**
carries `underline`/`strikethrough`/`align` (`textElement.ts` + `elementFactory.ts`, **no SCHEMA_VERSION bump** —
the three are optional, `toJSON` omits when unset); DOM render sets `text-decoration`/`text-align`, and the
export bake (`pdfElementRenderer.renderText`) draws the lines via `page.drawLine` + applies an alignment x-offset
(`font.widthOfTextAtSize`). Decorations are gated `if (!elemRot && …)` — the rotation signal is **`elemRot`**
(numeric, 0 = unrotated), NOT `pdfRotVal` (= `degrees(-0)`, truthy even at 0°); rotated-element decoration is the
ceiling. **(B1) dead Bold/Italic during a true edit FIXED:** the toolbar's B/I clicks route to
`FormattingService.toggle*` which early-return with no selected element, so `btn-active-fmt` (which `commit()`
reads) never flipped. `textEditHandler._openTrueEditInput` now attaches **session-local** click toggles on
bold/italic (and underline/strike) that flip the class directly, removed on close so they never leak to
element-formatting clicks. **(B2) NEW underline/strike on true-edited EXISTING text** — `addDecorationAt(doc,
pageIndex, point, kind, tol)` appends a **standalone stroked line** (`buildStandaloneDecoration` → `q w RG m l S Q`)
at the text baseline, KEEPING the original font (no Path-3 substitution). Width is measured in the font's OWN
advances (`getPageFontGlyphWidths`/`embeddedTextWidth`) with a standard-font proxy fallback, × the `Tz` hScale;
underline sits at `baseline − 0.1·size`, strike at `baseline + 0.28·size`. **Refuse gates (leave PDF unchanged):**
a new `TextOpInfo.tilted` flag (set in `locateTextOps` when the text→user transform `textMatrix × CTM` is
rotated / sheared / non-uniformly scaled beyond Tz) and invisible render mode 3/7 and undecodable text. Wired in
`commit()` as ADD-only toggles (start OFF): a decoration-only commit takes the in-stream fast path + a no-op-save
guard; bold/text edits run `replaceTextAt` first, then `applyDecorations` appends to the (already-edited) doc
before save — both undoable via the existing `ReplaceSourcePdfBytesCmd`. Gated by the `textDecor` seam (default
ON). Guards: `tests/utils/contentStreamEditor.test.ts` (buildStandaloneDecoration + addDecorationAt underline/
strike geometry + tilted/no-match refusals), `tests/handlers/textEditHandler.test.ts` (decoration-only commit
calls addDecorationAt; no-toggle = no add + no save), `tests/browser/trueedit-add-decoration.browser.test.ts`
(real pdf.js pixels: underline below baseline, strike through glyph body, none cross-contaminates). Verified
live (synthetic PDF, screenshots in `qa-shots/b2-session/`): bold + underline + bold-underline all apply
in-place, same font, no overlay.
**Rich text toolbar Slice 1 (2026-06-21)** — 8 Tier-1 controls on overlay `TextElement`s via inline buttons + a
new "Text ⋮" popover (`src/ui/textOptionsPopover.ts`, **app-owned**, mirrors `batesPanel`; Esc branch added to
`keyboardBinder.ts`). New OPTIONAL `TextElement` fields `backgroundColor`/`lineHeight`/`opacity` (**no
SCHEMA_VERSION bump**; `toJSON` omits when unset, `elementFactory.fromJSON` reads with `?? default` so legacy
blobs restore). All mutations route through `FormattingService`: `setAlign`, `setLineHeight` (clamp 1–3),
`setTextOpacity` (clamp 0–1), `setTextBackground`/`clearTextBackground`, `transformCase` (pure
`src/utils/textCase.ts`, title-case preserves whitespace via capture-group split), `clearFormatting` (resets 10
fmt fields in ONE `MoveResizeCmd`, NOT `text`), and the **format painter** (`copyTextStyle`→`pasteTextStyle`,
`painterArmed`/`cancelPainter`; paste-on-select hook in `pdfTurboApp.selectElement`, armed-state cleared on
document load via `resetDocumentModel` so it can't leak across PDFs). Color presets/recent = pure
`src/utils/recentColors.ts` (localStorage try/catch, cap 8) rendered as a swatch row in `main.ts` (swatch click
sets `colorInput.value` + applies). Bake (`pdfElementRenderer.renderText`): bg rect (gated `!elemRot`, anchored
via the shared highlight/redaction `anchorForCenter`) + `fontSize * (lineHeight ?? 1.2)` + `opacity ?? 1` threaded
to text/decoration/rect. Discrete **L/C/R align buttons** (the old cycle stays for back-compat); the active one
gets `btn-active-fmt`, synced in `uiController.updateFormattingToolbar`. **Non-obvious:** (1) the **raster export
path** (`exportPipeline.ts`, used for redaction-bearing pages + thumbnails) honors lineHeight/opacity/
backgroundColor because it calls the SAME `renderText` — **corrected 2026-07-31**: this used to claim
`globalAlpha` scoped inside `ctx.save()/restore()`, which describes code that does not exist (`globalAlpha`
appears nowhere in `src/`; the only `ctx.save()/restore()` pair in `exportPipeline.ts` is in the **ink stroke**
rasterizer). There is exactly ONE text renderer, and `rasterizePageWithRedactions` runs it via
`buildPageOverlays` BEFORE rasterizing, so the attrs ride the pixel-guarded vector code. What was genuinely
unguarded is their survival through the extra **rasterize → `embedPng` round-trip**, now covered by
`tests/browser/raster-text-attrs.browser.test.ts` (opacity 0.5 must read PINK, not red — injecting
`opacity: 1` on the bg rect fails that case and only that case); (2) the editor `<textarea>` preview now sets
`style.lineHeight` (`_applyInputFormatting`) for parity with the bake. No feature flag (additive core-toolbar
improvement). Guards:
`tests/core/formattingService.test.ts`, `tests/utils/{textCase,recentColors}.test.ts`,
`tests/ui/{textOptionsPopover,uiController}.test.ts`, `tests/browser/{text-toolbar,text-toolbar-bake}.browser.test.ts`.
**Backlog/ceiling (Slice 2+):** [superseded 2026-09-28: Tier-2, find & replace, links and lists shipped — Slice 2 and Features 2/3 below] Tier-2 (stroke/outline, char-spacing `Tc`, horizontal-scale `Tz`, justify,
whole-box sub/superscript), find&replace on overlay text, links, bullet/numbered lists, multi-run rich text
(ceiling); RTL direction-aware controls are gated behind the open Arabic-RTL P1 overflow defect.
**Rich text toolbar Slice 2 (Tier-2, 2026-06-21)** — 5 advanced controls on overlay `TextElement`s: text
**stroke/outline**, **character spacing** (`Tc`), **horizontal scale** (`Tz`), **justify** align, and whole-box
**super/subscript**. New OPTIONAL `TextElement` fields `strokeWidth`/`charSpacing`/`horizontalScale`/
`baselineShift:'super'|'sub'` + `TextAlign` widened to include `'justify'` (**no SCHEMA_VERSION bump**; `toJSON`
omits when unset, `elementFactory.fromJSON` rehydrates with type guards → legacy blobs restore). **The outline has
NO separate stroke color — it is painted in the element's OWN fill color** (the shared Slice-1 palette: presets +
recent + `#colorSwatchRow`); the Outline control is **width-only** (a standalone `<input type=color>` was removed as
a palette duplication, user call 2026-06-21). Mutations route
through `FormattingService`: `setTextStroke(width)`/`clearTextStroke`, `setCharSpacing` (clamp −5..20), `setHorizontalScale`
(clamp 50..200), `setBaselineShift('super'|'sub'|null)`, justify via the existing `setAlign('justify')` — each a
`MoveResizeCmd`, NaN-safe clamps (`Number.isFinite`, never `parseFloat(...)||x`), and `clearFormatting`/the format
painter carry all 5. **The core is the raw-operator bake** `src/export/styledText.ts` (`hasAdvancedText(te)`,
`effectiveLineWidth(font,line,size,charSpacing,horizontalScale)`, `drawStyledTextLine(page,opts)` via
`page.pushOperators` — the `arabicOverlay.ts` pattern): `renderText` takes the operator path **ONLY when
`hasAdvancedText(te) && !elemRot`** [superseded 2026-09-26 by A3-pre: a rotated element takes the operator path too — see the LIFTED note below], else the existing `page.drawText` runs UNCHANGED → **byte-identical export for
every element without an advanced attr** (real-Chrome-guarded). **Non-obvious:** (1) stroke = render mode 2 via
`TextRenderingMode.FillAndOutline` (NOT `FillThenStroke`, which does not exist in `@cantoo/pdf-lib`) + `RG`(= the
fill color)/`w`;
(2) `Tz` has no named helper → `PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(pct)])`;
(3) opacity reuses `page.maybeEmbedGraphicsState({opacity,borderOpacity})` (it's **private** → localized `(page as
any)` cast, gated `advanced && alpha<1`); (4) justify distributes `Tw = (boxW−lineW)/spaces` on NON-last lines only
(single/last line → normal alignment offset); (5) sub/super = 0.65× draw size + `Ts` rise (super +0.33×fontSize,
sub −0.15×fontSize); (6) the popover super/sub buttons **toggle** — re-clicking the active one clears to baseline
(reads `ctx.selectedText.baselineShift`); they stay mutually exclusive. UI: inline **J** button beside L/C/R
(`formattingBinder` → `app.setAlign`) + 4 popover rows wired in `textOptionsPopover.ts` (outline **width** (no
color — uses fill), letter-spacing, width%, x²/x₂); `uiController.updateFormattingToolbar` toggles `btn-active-fmt` + reflects values;
i18n `formatting.{justify,stroke,charSpacing,horizontalScale,baseline,superscript,subscript}` in en/fr/ar (ar
accepted by the 2026-09-13 WS3 closure ruling — see § i18n; the repo could never prove whether the
2026-07-30 pass covered these, and the developer closed the question by ruling rather than a re-read). No feature flag (additive). **Ceilings:** ~~rotated element + advanced attr → `drawText` fallback~~
LIFTED 2026-09-26 (A3-pre): the operator path's text matrix now carries the rotation, so a rotated
element keeps stroke/Tc/Tz/justify/sub-super (underline, strikethrough and the background fill are
still skipped on a rotated element); the Arabic overlay path NOW applies stroke/Tc/Tz
too (Feature 4, 2026-06-24 — see below); the **raster export path** (`exportPipeline.ts`, redaction pages +
thumbnails) applies these attrs through the same `renderText` and its rasterize round-trip is pixel-guarded
since 2026-07-31 by `tests/browser/raster-text-attrs.browser.test.ts` (see the correction in Slice 1 above —
`stroke`/`Tc`/`Tz` specifically are still vector-guarded only). Guards: `tests/export/styledText.test.ts`
(pure `hasAdvancedText`/`effectiveLineWidth`), `tests/core/formattingService.test.ts`, `tests/ui/{textOptionsPopover,
uiController}.test.ts`, `tests/browser/text-toolbar-slice2.browser.test.ts` (real Chrome: pdf.js OPS-38
`setTextRenderingMode` present in styled / ABSENT in plain → catches a silent regression to `drawText`).
**Backlog (Slice 3+):** RTL direction-aware controls, per-run/multi-run rich text (ceiling), true-edit of these
attrs. (find&replace on overlay text DONE `3b24c99`; bullet/numbered lists + overlay links + stroke/Tc/Tz on the
Arabic overlay DONE — see below.)
**Overlay bullet / numbered lists (Feature 2, 2026-06-24):** `TextElement.list?: 'bullet' | 'ordered'`
(OPTIONAL, **no `SCHEMA_VERSION` bump**; `toJSON` omits when unset, `elementFactory` reads with a type
guard → legacy blobs restore). One `\n`-line = one item (the overlay bake never auto-wraps). Pure
`src/utils/listMarkers.ts` (`listMarker(kind,ordinal)` → `'• '` / `'N. '`; `applyListMarkers(text,kind)`
prefixes each NON-EMPTY line, ordered ordinals count non-empty lines 1-based, blanks pass through). The
EXPORT is a single edit in `pdfElementRenderer.renderText` — `const lines = te.list ?
applyListMarkers(te.text, te.list) : te.text.split('\n')` — so markers ride through alignment/decoration/
the advanced-operator path AND the redaction-raster path (both go through `buildPageOverlays`→`renderText`);
**byte-identical when `list` unset**. The editor preview is a non-editable **marker gutter** (`.text-list-gutter`
in `editor.css`, built in `textElement.render()` with the input's font metrics, `pointer-events:none`, input
gets `padding-left`) — markers are kept OUT of `this.text` (no fragile prefix-and-strip that could eat a line
the user typed as "3. foo"). Mutations: `FormattingService.setListType(kind|null)`/`toggleList(kind)`
(`MoveResizeCmd`, undoable, in `clearFormatting` + format-painter set); UI = two toggle buttons in the Text ⋮
popover (`#bulletListBtn`/`#numberedListBtn`), `uiController.updateFormattingToolbar` reflects `te.list`.
i18n `formatting.{list,bulletList,numberedList}` (ar reviewed 2026-07-30). No feature flag (additive). **Ceiling
(v1):** nested/multi-level lists, custom marker styles (a/A/i, start-at-N), and DOCX export of
overlay-text markers (overlay annotations aren't in the PDF→DOCX path). Guards:
`tests/utils/listMarkers.test.ts`, `tests/elements/textElement.test.ts` (model + gutter),
`tests/core/formattingService.test.ts`, `tests/ui/{textOptionsPopover,uiController}.test.ts`,
`tests/browser/text-list.browser.test.ts` (real Chrome: bullet/ordered export → pdf.js text has `•`/`1.`/`2.`,
plain control has none).
**Overlay text links (Feature 3, 2026-06-24):** `TextElement.linkUrl?: string` (OPTIONAL, **no
`SCHEMA_VERSION` bump**; `toJSON` omits when unset, `elementFactory` reads `typeof === 'string'`). The whole
text box becomes a clickable hyperlink. **Security:** `src/utils/linkUrl.ts` `sanitizeLinkUrl(raw)` allows ONLY
`http:`/`https:`/`mailto:` (a bare domain → `https://`); `javascript:`/`data:`/`vbscript:`/`file:`/empty → null
(blocks `/URI`-action injection). Sanitised at BOTH the service (`FormattingService.setLinkUrl`) AND the bake
(defence-in-depth vs a crafted saved blob). EXPORT: `pdfElementRenderer.renderText` appends a borderless `/Link`
annotation (`/A << /S /URI /URI (url) >>`, the `incrementalSigner.ts` `/Annots` idiom via a static
`@cantoo/pdf-lib` `PDFName`/`PDFArray`/`PDFNumber`/`PDFString` import + `addUriLinkAnnotation`) over the box rect
(same rotation-safe `rectAnchor`+swap-dims AABB as the background fill). Survives BOTH export paths — on the raster path
only since 2026-09-25 (A4): the image page has no annotations, so `rasterizePageWithRedactions` re-creates the
safe links itself (`collectSafeUriLinks` + `mapLinkRectToRaster`, see § "Links on the redaction raster"); byte-identical when unset/invalid; `pdfSanitizer` preserves
`/URI` so a link survives sanitize-and-download. Editor: a 🔗 badge (`.text-link-badge`) + dotted-underline
(`.text-element--linked` in `editor.css`) + the URL as the box `title`; text is NOT auto-restyled (user controls
colour/underline). `setLinkUrl` is a `MoveResizeCmd` (undoable); it is **NOT** in the format painter or
`clearFormatting` (a URL is per-element data, like `text`) — cleared via the popover's empty input. UI = a URL
input (`#textLinkInput`) in the Text ⋮ popover; i18n `formatting.{linkLabel,linkPlaceholder}` (ar reviewed 2026-07-30).
No feature flag. **Ceiling (v1):** per-run/partial-text links (needs multi-run rich text), internal GoTo links,
rotated-element link rect is the axis-aligned bbox (PDF `/Link` rects can't rotate), and the lossy
"flatten-to-images" compress path drops the annotation (it drops text too). Guards: `tests/utils/linkUrl.test.ts`,
`tests/elements/textElement.test.ts` (model + badge/title), `tests/core/formattingService.test.ts`,
`tests/ui/textOptionsPopover.test.ts`, `tests/browser/text-link.browser.test.ts` (real Chrome: export → pdf.js
`getAnnotations` has a Link with the sanitized `url`; a `javascript:` URL set directly → no annotation).
**Stroke / Tc / Tz on the Arabic overlay (Feature 4, 2026-06-24):** the Slice-2 advanced attrs `strokeWidth`,
`charSpacing` (Tc), `horizontalScale` (Tz) — previously Latin/WinAnsi-only — now apply to shaped RTL Arabic text
in the export. `arabicOverlay.ts` gains a PURE `buildArabicRunOps(fontKey, hex, x, y, size, color, style)` that
builds the per-run operator list mirroring `styledText.drawStyledTextLine`'s ordering — `q · BT · rg · [RG · w ·
Tr(FillAndOutline)] · Tf · [Tc] · [Tz] · Tm · Tj · ET · Q` — so the **no-style path is byte-identical** to the
prior CID emission (stroke colour = fill colour, the Slice-2 rule). PURE `effectiveArabicWidth(baseWidth,
glyphCount, charSpacing, horizontalScale)` does RTL right-alignment from the shaped **glyph count**
(`cidHex.length / 4`, the real 2-byte CID units — NOT `text.length`). Both `drawArabicLine` (pure-Arabic) and the
RTL runs of `drawBidiLine` (mixed line) route through these; `renderText` passes `te.{charSpacing,horizontalScale,
strokeWidth}` into `drawArabicLine`. **Ceiling:** `baselineShift`(super/sub) + `justify` stay Latin-only for
Arabic; in a mixed line the **Latin runs** keep `page.drawText` (no Tc/Tz/stroke — documented partial, consistent
with the Noto-vs-Helvetica per-run split); Tc width is approximated from the glyph count. Guards:
`tests/export/arabicOverlay.test.ts` (jsdom: `buildArabicRunOps` op-sequence — no-style q/BT/rg/Tf/Tm/Tj/ET/Q,
stroke→RG+w+Tr, Tc, Tz; `effectiveArabicWidth` math), `tests/browser/arabic-overlay.browser.test.ts` (real Chrome:
stroke→pdf.js `setTextRenderingMode`, Tz→`setHScale`, Tc→`setCharSpacing` present, ABSENT for a plain control).

### Tagged-PDF struct-tree fast path (#B1, 2026-06-25)

A tagged PDF (`page.getStructTree()` with
children) exports to DOCX/MD/TXT straight from the tags instead of the layout heuristics. `flowDoc.ts`
`buildMarkedContentMap(items)` splits a `getTextContent({includeMarkedContent:true})` stream into
`MCID→RawTextItem[]` (each text item attributed to the INNERMOST enclosing MCID; a no-MCID marked region
— `Artifact`/untagged — pushes a `null` stack spacer so its text is DROPPED, which is correct: PDF/UA
artifacts are non-content). `structTreeToFlow(tree, mcMap, fonts, w, h, redactions?)` walks the role tree in
document reading order → `H1`–`H6`→heading / `P`/`Note`/`Caption`/`Quote`→body / `L`+`LI`→list (depth from
nesting, ordered/bullet from the Lbl/inline marker via `detectListPrefix`) / `Table`+`TR`+`TH`/`TD`→`FlowTable`
grid (`THead`/`TBody`/`TFoot` row-groups recursed); `Figure` skipped (the raster image path handles it). It
**returns null** when the tree is absent or resolves ZERO text → caller falls through to the heuristic →
**byte-identical for untagged PDFs (~85% of files)**. Run quality is shared: `buildRunsFromLines` was
EXTRACTED from `buildParagraph` (same color/super-sub/underline/gap-space/coalesce logic) and is reused by
both paths. `reconstructPage` gained an optional `struct?: {tree, markedItems}` param: when set and the flow
resolves, it returns `{paragraphs, tables, tagged:true}` (margins still computed from `words`) and SKIPS the
column/heading heuristic; `assignHeadings` skips `page.tagged` pages (all 3 loops) so tag levels aren't
clobbered. `exportService._extractFlowDoc` fetches `getStructTree()` first, and ONLY when it has children
requests the marked-content text variant (filtering markers out for the heuristic/font path via `!('type' in
it)`) — an untagged page keeps the plain `getTextContent()` call (byte-identical extraction). **Non-obvious:**
(1) struct-tree leaves `{type:'content', id}` and `beginMarkedContentProps {id}` share the SAME id string
(verified 100% on the w3c fixture) — direct map lookup, no fuzzy correlation; (2) text items have NO `type`
key, markers do — that's the discriminator; (3) `FlowDoc`/`FlowPage` are export-transient (never persisted to
IndexedDB) so `tagged` needs no SCHEMA bump. **Ceiling:** a partially-tagged page drops its untagged
(artifact-classed) text by design (exact-replace contract); alignment/indent/spacing are NOT tag-derived
(left, or right for RTL); a multi-column tagged page's reading order rides the writer's y-sort (monotonic for
normal top-down docs). Gated purely by struct-tree PRESENCE (no feature flag). Guards:
`tests/utils/flowDocStructTree.test.ts` (10: map attribution/nesting, heading/body/list/ordered/table/null/
redaction, assignHeadings tagged-skip) + `tests/browser/docx-structtree.browser.test.ts` (2: real tagged PDF →
H1 + `<w:tbl>`; untagged → `reconstructPage` byte-identical with vs without the struct arg).

### A uniformly leaded paragraph stays one paragraph — limits row 52 (2026-10-01)

Chrome prints a paragraph at `line-height: 1.6`, so every wrap gap is 22.5pt on a 14pt line — 1.608 sizes, **just past**
`PARA_GAP` (1.6) — and each line exported as its own paragraph (`arabic-allcases.pdf` p2, the English control paragraph:
three lines → three paragraphs). Row 41's `typicalLineGaps` counts only gaps up to the threshold, so a page whose every wrap sits
just past it has no typical gap to compare with. `groupLinesIntoParagraphs(lines, pageWidth)` now has a second, separate
source of evidence: `uniformLineGaps` — for a size with NO typical gap, **two CONSECUTIVE** same-size gaps (three lines in a
row) in (`PARA_GAP`, 1.75] sizes that agree within 1% are that page's leading. It is honoured only where ALL of these hold:
the page width is known (the rule is OFF without it), the widest line spans ≥ 30% of the page (else "fills the measure"
means nothing — in a column of equal-width single-line items those lines ARE the widest), the line above fills the measure
(≥ 85% of the widest line — a line that ran out of room continues below), the gap is within 2% of the leading (not row 41's
10% `WRAP_SLACK`: a 1.70-size break on a 1.608 page stays a break), neither line has a column-sized gap inside it
(> 1 size: a table row), and the line does not open a list marker. One just-past gap, unequal ones, or two equal gaps that
are not adjacent are not evidence: row 41's "one in-paragraph gap is not enough" case still breaks.

**Two review rounds changed the rule, both found by reading it, not by the census.** The first version's fullness test was
relative to the widest line of the input, so equal-width single-line items satisfied it by construction (fixed by the page
share); and uniformity was established at 1% but accepted at 10%, with the comment saying "consecutive" while the code did not
require it (fixed: consecutive in the code, 2% on acceptance). The first version also merged equal-spaced table rows of
`sample-tables-lattice.pdf` on 5 pages (15→8, 16→13, 32→22, 29→16, 20→9 paragraphs); the column-gap test removed them.

**What the census does and does not show** (real `reconstructPage`, one PDF per process, before vs after, 23 files / 5,107
paragraphs: exactly ONE boundary changes, the target). The new branch runs only for a size with NO gap ≤ 1.6 sizes, which the
LaTeX and IRS files never are — so the census proves the rule stays OFF elsewhere, not that it is safe where it is ON. About one
file in the corpus (the Chrome `arabic-allcases`) is a document where it can fire at all. The probe has no content-stream rules,
so it also over-counts table pages.

Guards: 12 unit cases in `tests/utils/flowDocColumn.test.ts` (the 4-line paragraph; controls for short lines with and without a
wider line, unequal short widths, a short last line, a 2.3-size gap, a 1.70-size break, a list marker, table rows, one gap,
non-consecutive gaps, and no page width) and one real-Chrome case in `docx-mixed-bidi.browser.test.ts` (the page-2 paragraph
exports as ONE paragraph equal to the typed text). Sabotage, each restored byte-exact: uniform evidence off → the defect case + 3
controls; fullness off → 2; column-gap off → 1; list-marker off → 1; page-width floor off → 2; consecutive off → 1; loose
acceptance → 1; page width ignored → 1; the browser case red with the uniform evidence off. **Bounds.** A wrapped paragraph
whose lines are under 85% of the widest line in its column (a narrow column beside a wide figure caption) still splits; a list
of single-line, full-width, column-gap-free items at a uniform 1.6–1.75 leading on a wide page would join (none in the corpus — a
table of contents with dot leaders is the concrete instance: its lines fill the measure and have no column gap);
the constants come from one measured target and the false-positive classes above, not a wider corpus; a page-level fixture
for the class (a Chrome page at `line-height: 1.6` with a short list, an address block and a date column) was not built.

### A page number in the gutter no longer blocks the column split — limits row 45 (2026-10-01)

ResNet (`article-resnet-2col.pdf`) never split into columns, on any of its 12 pages, so every page interleaved the two columns
line by line (census-income p23 read `…poverty rate in ENDNOTES the United St…`). **Traced, then fixed at the origin.** The
columns end at 286.4 and start at 308.9 — a 22.5pt gutter — but the page number `2` is drawn at x 295.1–300.1, y 51, centred
IN the gutter: one item of 175 left a clean gap of ~9pt (4pt on the 2pt bins), under `MIN_GUTTER_PT` (10). `detectColumnSplit`
now looks for the gutter without the page's BOTTOM edge band (`FOOTER_BAND`, the lowest 5% of the text's own baseline span —
where a page number or a footer lives); those words still go to a column by their centre and none is dropped. The TOP band is
deliberately NOT excluded: a title block lives there (row 44), and dropping it would put a centred title in whichever column
its centre falls in. Skipped when it would leave fewer than two baselines.

**`arxiv-multicol-japanese.pdf` needed no fix** — the row listed it with ResNet, but it is a single-column layout: on all 17
pages the body lines span 134.8–480.6 and no word lies left of x = 132, so the one gap in the 20–80% zone is the left margin
and `detectColumnSplit` is right to refuse (the `sides` test: no words on both sides). The filename names its subject, not its
layout.

**Measured blast (real `reconstructPage`, 23 files / 5,105 → 5,231 paragraphs, 24 pages change in 5 files):** ResNet 8 of 12
pages (2, 3, 4, 6, 7, 9, 10, 12), census-income 12, pub17 2, 1099-MISC 1, sample-tables-lattice 1. Every changed page read was
INTERLEAVING two columns before (`for 2025 ted tax payments on time. for Form`) and reads column by column after; character
totals move by at most 1.4% (joins and spacing), so no text is lost. The 1099-MISC form moves from merged label rows
(`PAYER'S name 1 Rents OMB No. 1545-0115`) to separate fields — a change a form-fidelity reviewer may weigh. The four ResNet pages
that still do not split (1, 5, 8, 11) are blocked by SPANNING items — the title and authors, a spanning table or figure caption —
which is row 44's horizontal-cut problem, not this one.

Guards: 5 unit cases in `tests/utils/flowDocColumns.test.ts` (the ResNet shape; controls: the same item mid-body still blocks, a
top-band title still blocks, no folio splits as before; `splitColumns` keeps every word) and `tests/browser/flow-gutter-folio.browser.test.ts`
(a pdf-lib two-column page of JUSTIFIED lines read back through real pdf.js, with and without the folio). Sabotage, each restored
byte-exact: exclusion off → the 2 defect cases and the browser with-folio case; the band also covering the top → the title
control; the band covering 90% → the mid-body control. **The first version of the browser fixture stayed green with the fix
removed** — its lines were a third of the column width, so the gutter was ~100pt and no page number could block it; real columns
are justified, so the fixture now fills the measure from the font's own widths (the fixture-mirrors-detector trap, caught by
sabotage). **Bounds.** A page number is only the commonest intruder: a centred footer WORD, or a figure label placed in the gutter
away from the bottom edge, still blocks; and the footer band is a fraction of the text's own span, so a page whose body is
only a few lines at the bottom is unchanged by the two-baseline guard.

### A narrow gutter splits between body blocks only — limits row 46 (2026-10-01)

Publication 17's three-column body pages (and its four-column index pages) leave ~8pt gutters — 6pt measured on the 2pt
bins — under the 10pt floor, so `detectColumnSplit` left them as ONE column and a reconstruction that reaches it interleaves
the columns line by line. **The product never showed it on this corpus: Publication 17 is TAGGED (141 of its 142 pages take
the struct-tree path in the real `_extractFlowDoc`, measured), and so are 28 of Census-income's 67 pages — a tagged page never
reaches the column splitter.** The defect is real for UNTAGGED multi-column PDFs (about 85% of files), of which the corpus holds
no three-column example; row 46 is therefore certified on synthetic and real-pdf.js fixtures and on the splitter measured
over a real file whose tags the probe ignores, not on a real untagged one. Lowering the floor for everyone
is refused for the reason row 21 gave (8pt splits GPT-3's prompt examples, where a narrow LABEL column sits beside its
content, gap 4–8pt), so the question was a discriminator, and the measurement is what found it (a throwaway probe over
every sub-10pt gutter of Pub 17 and GPT-3: lines, words and extent on each side). A body column and a label column differ in
size, not in gap: Pub 17's sides carry 53–70+ baselines and are 168pt wide (27% of the page; a half of a 4-column page is
40%); GPT-3's label columns carry 6–16 baselines and are 94pt (15%).

`detectColumnSplit` now accepts a gap measured at 6–10pt (`NARROW_GUTTER_PT`) when BOTH sides are body blocks — at least
`MIN_BODY_LINES` (20) baselines and at least `MIN_BODY_WIDTH` (a quarter) of the REGION's width, the extent of the words on
that side of the candidate. Gaps of 10pt or more split exactly as before; gaps under 6pt never do. The test is evaluated
per candidate BEFORE the choice (row 21's lesson), and against the region, not the page: a 4-column page's first cut halves
it (each half is 40% of the page), the next cut tests 124pt against a 306pt half (40%), whereas against the page it would be
20% and the page would stay one column.

**Measured, and what it does and does not say.** The census drives `reconstructPage` WITHOUT a struct tree (one PDF per process,
before vs after, 15 files / 360 pages): 108 pages change — Publication 17 107, Census p8 1 — and none elsewhere (GPT-3, BERT, ResNet,
Attention, the budget and every form 0). **In the product that is ZERO pages**: every one of the 108 is tagged and takes the
struct-tree path (the probe, re-run with the struct arguments exactly as `_extractFlowDoc` passes them). So the census is the
splitter's effect on a layout, not the export's effect on a file, and it was first written up as the latter.

**Read, not counted** (reconstructed paragraphs of Pub 17 p3, 52, 66, 130 and Census p8 after the change, no rules passed): the
three-column body prose reads column by column, each paragraph one column's; the lists and numbered worksheet lines stay inside
their column. Two bounds showed up. **A footer is cut by the same column assignment as the body:** `128`, `64 Chapter 7` and
`Publication 17 (2025)` land at the end of the column their centre falls in, so a running footer can sit between two columns
(p66: after the first column's last paragraph) — the same thing a two-column page has done since row 21; it is not new, and the
running-header hoist is what removes a footer that recurs. **Census p8 is only partly fixed**: it splits 1 → 2 groups at the
right-hand column, but its first paragraph still interleaves the two left columns (`INTRODUCTION 2022: … The official poverty
The U.S. Census Bureau pro-`) — their gutter is not wide enough or not clean enough for the new rule; cause not traced. An
earlier version of this entry called that page a real layout, read before and after; it had only the candidate statistics.
Pages that keep 2 groups where 3 columns may exist (Pub 17 p11, p13, p26, p60) were not read [Unverified]. A worksheet or
table page without ruled lines but with 20+ rows and a quarter-width block on each side of a narrow gap would now read
column by column; Pub 17 p52 (a worksheet) did so and read acceptably, but the probe passes no rules, so a page the real
export turns into a lattice table first was not exercised.

Guards: 7 cases in `tests/utils/flowDocColumns.test.ts` (three columns 9pt apart split in reading order; four narrow
columns split — the region-relative width; controls: a short label, a tall but narrow label, wide blocks of few lines, a 6pt
gutter between body columns, and the 14pt rule unchanged) and `tests/browser/flow-narrow-gutter.browser.test.ts` (real
pdf.js: three justified columns 9pt apart read A, then B, then C with no mixed paragraph; a justified label column beside
justified content reads across). Sabotage, predicted first and each restored with `cmp`: body test always true → 4 unit cases
(the three controls and row 21's 11pt case) + the browser label control; line criterion off → the few-lines control + the 11pt
case; width criterion off → exactly the tall-narrow-label control; floor 4 → the 6pt control + row 45's mid-body-item control
(its gap is 4pt measured); width taken against the page → exactly the four-column case; rule off → the three- and
four-column cases + the browser three-column case. **The first browser label fixture was vacuous**: its label was a bare
`A-01`, ~20pt wide, leaving an ~80pt gap that splits under any floor — it failed against the unchanged detector too. A label
fixture must RUN to its column edge, like GPT-3's. **Bounds.** The two thresholds come from two populations (Pub 17 and GPT-3),
not a wider corpus; a label column of 20+ lines wider than a quarter of the region would split (none measured); a
body block with fewer than 20 lines (a short last column, a sidebar) beside a narrow gutter stays unsplit; the count is of
distinct baselines, so a two-column page of few long lines needs the 10pt gutter as before.

### A title, figure or caption spanning both columns now cuts the page into bands first — limits row 44 (2026-10-01)

A full-width block (a centred title, a figure with its caption, a wide table) crosses the gutter, so no vertical cut existed
for the WHOLE page and the page read as one interleaved column. `splitColumns` now falls back to the horizontal half of an
XY-cut when the vertical cut finds nothing at depth 0: **`splitBySlabs`** finds full-width white bands (no word's extent
`[y − 0.25 em, y + em]` in them, at least 1.5 median-em tall), cuts the page into slabs, and tries the existing vertical
split inside each, on the PAGE's footer cut (`pageFooterCut`, computed once — a slab judged by its own bottom edge would drop
its last, possibly spanning, line from the gutter search; M5 reds on exactly that). Slabs are used only if one of them is a
real column band — every group at least 6 baselines and 15% of the page wide, and the slab under 50% numeric tokens — and
neighbouring slabs that did not split are merged back (a title and its authors stay together). Otherwise the function
returns what it always did, so a page that does not benefit is byte-identical. Reading order is top to bottom, left to right
inside each slab. A second, separate change rides with it: a word turned past 45° (`rotated`, from `transform`) is skipped
when the gutter is looked for, because every geometry here projects pdf.js's `width` along x and the arXiv margin stamp
(`x 32–385`, 20pt wide on the page) read as a bar across the gutter — BERT p1 and ResNet p1 stayed null even with the title
cut until it was skipped. A slanted (italic) run is not rotated: `transform[2]` alone is not the test.

**Scope, measured — and this time read, not counted.** The product reads a TAGGED page through the struct tree and never
reaches this splitter (see § row 46), so the evidence is the four UNTAGGED corpus papers only (inventory, 2026-10-01:
attention 0/15, bert 0/16, gpt3 0/75, resnet 0/12 tagged; every form, census, Pub 17 and the budget report are tagged).
Census before/after, one PDF per process, words carrying `size`, `text` and `rotated`: attention 0 of 15 pages changed;
BERT 6 of 16 (p1, 3, 5, 6, 13, 15); GPT-3 1 of 75 (p49); ResNet 4 of 12 (p1, 5, 8, 11). **Read:** BERT p1, 3, 6, 13, 15 —
title, authors, abstract, then figure and caption, then the left column in full and the right after it, footnotes at the
foot of their column; ResNet p1, 5, 8, 11 — tables stay row by row, text columns separate; GPT-3 p49 — two columns of poems,
which the old output had interleaved ("Generated Poem 1 … Generated Poem 3" in one paragraph), now poems 1, 2, 3, 4. **BERT
p5 was counted, not read.** **The census caught a regression the fixtures did not:** GPT-3 Table H.1 (four wide blocks of
tight numeric columns) was split block by block on the first cut — rows broken apart, 16 paragraphs → 54 — and the width
rule did not catch it (each block is 20–28% of the page). The numeric-token rule did; both fixtures that pin it carry the
measured shape. **Not changed by the census, by design:** every page the vertical cut already split.

**Bounds, stated.** (1) Horizontal cuts only at depth 0 and only across the whole page width: a figure in ONE column of a
two-column page is not cut. (2) A number-heavy two-column TEXT page (a statistics appendix of prose) is refused as a table
and keeps the old reading. (3) The 1.5 em band height is margin, not measurement — no fixture is sensitive to it (a lower
value changes nothing on the corpus), so it is unpinned. (4) The stamp glued to a body line that shares its baseline
("…24 May 2019be effective for…") is PRE-EXISTING — the old code produced the same string — and still there; it is more
visible now that the page reads in order. (5) A rotated item is still assigned to a column by its projected centre. (6) The
census probe passes no rules, no vRules and no struct tree: it measures the splitter, not the full export.

Guards: `tests/utils/flowDocColumns.test.ts` (10 cases in the row 44 block — title + two columns; caption between two column
bands; one-column control returned as the same array; a 3-row alignment with 23%-wide cells, so only the line count refuses
it; a 6-column number table, so only the width refuses it; the four-block Table H.1 shape; a rotated stamp and its unrotated
control; the footer control; a 14pt page unchanged) and `tests/browser/flow-bands.browser.test.ts` (2, a pdf-lib page read
back through real pdf.js, oracle = the typed `T-`/`A-`/`B-`/`CAP-`/`C-`/`D-` markers). Sabotage, each landing checked and the
file restored byte-exact: slabs off → 3 unit + both browser cases; numeric rule off → exactly the Table H.1 case; width rule
off → exactly the number-table case; line rule off → exactly the alignment case (it first stayed green: the 60pt cells
failed the width rule too, so the control could not see the line rule — widened to 140pt); footer per slab → exactly the
footer control; rotated kept in coverage → exactly the stamp case.

