---
paths:
  - "src/utils/bidi.ts"
  - "src/utils/rtlClipboard.ts"
  - "src/export/arabicOverlay.ts"
  - "locales/ar.json"
  - "tests/**/*bidi*"
  - "tests/**/*arabic*"
---

# pdfturbo gotchas — arabic-rtl

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: Arabic and RTL: bidi, the Arabic overlay, tashkeel, RTL selection and copy. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### Arabic support (Sprint Arabic, 2026-06-15)

— three parts:
- **DOCX export — CORRECTED by limits row 19 (2026-09-27).** This bullet used to say pdf.js returns RTL text in
  VISUAL order and that `reverseRtlText` restores logical order. **That was false for every multi-character item**:
  pdf.js's `runBidiTransform` runs UAX#9 L2 on each text chunk before returning it (`pdf.worker.mjs`, the
  `reverseValues` loop in `bidi()`), so an RTL item arrives LOGICAL, and reversing it again wrote every Arabic word
  backwards into DOCX, Markdown and text. Measured on a LibreOffice file (`tests/fixtures/bidi/mixed-bidi.pdf`) and on
  the app's own Arabic bake. It survived because every Arabic export test was synthetic, built in the shape the
  belief predicted — the same trap as the copy/search fix below, which had already found that multi-char items are
  logical and never carried the finding here. Now `orderLineWords` decides only the ORDER of items: base direction by
  LETTER count (`letterDirection` — an item count read `النص (RTL) هنا` as English), neutral items (brackets, dots,
  digits) take their strong neighbours' direction or the line's (UAX#9 N1/N2 at item granularity), and
  `logicalItemOrder` applies L2 for either base (an Arabic phrase split across two items inside an English line
  reads right to left). Item text is only NFKC-folded (presentation forms → base letters, U+FEFB → ل+ا). The space
  between two words is the gap between their boxes whichever side each is on — and at a direction change, between
  the two direction RUNS' boxes, because the logical neighbour is at the run's far end (Chrome draws `نظام` one
  glyph per item; the gap from its last glyph `م` to `.pdf` spans the whole word). `reverseRtlText` survives only as
  the text search's fallback.
  **A second producer, measured, needed three more rules** (`tests/fixtures/corpus-public/arabic-allcases.pdf`,
  Chrome print-to-PDF, typed text in `scripts/gen-arabic-fixture.mjs`). (1) **Producers disagree on what a mirrored
  bracket glyph means**: LibreOffice's ToUnicode maps it to the logical character, Chrome's to its SHAPE, and pdf.js
  mirrors nothing — so `(RTL)` came out `)RTL(`. `mirrorShapeBrackets` mirrors the RTL-placed bracket-only items of a
  line only when its bracket order closes before it opens AND mirroring balances it; a balanced line is left alone,
  which is what keeps LibreOffice right. (2) **W7 at item granularity**: a digit item touching a Latin item is Latin
  (`v` + `2.0.0` → `v2.0.0`, not `2.0.0v`). (3) **Direction is a paragraph property** (UAX#9 P2) but lines are
  ordered before grouping: a line whose letters are 35–65% right-to-left takes its paragraph's direction, or the side
  it is flush with when the paragraph is near even too (`settleAmbiguousLines` — the wrapped `support@example.com …`
  line of an Arabic paragraph has 18 Latin letters against 17 Arabic). A letter-less item is neutral whatever its
  flag, so that second pass does not read resolved neutrals back as strong.
  Bounds, each per producer measured: a LIGATURE glyph whose ToUnicode spans several characters extracts reordered
  because pdf.js reverses it with the chunk — LibreOffice's lam-alef (`كلام` → `كالم`, pdftotext reads it the same),
  Chrome's `الله` (→ `اهلل`) and the lam-alef in `والإصدار`; Chrome's `2026.` is ONE item drawn `.` first, returned
  as drawn, and comes out `.2026`; tashkeel lines come apart at the marks (a READ-side bound — C19 fixed the overlay's
  DRAWING of marks, not how pdf.js splits a source PDF's items at them); a producer that draws RTL glyphs in
  logical order is read reversed (pdf.js's own copy is wrong the same way). **UNCERTIFIED-BY-EXECUTION: the
  tagged (struct-tree) path** — it now takes `letterDirection` but no tagged Arabic fixture exists, [superseded 2026-09-28: `tests/fixtures/bidi/arabic-table.pdf` is tagged and `tests/browser/table-arabic.browser.test.ts` runs it (`6ea75e2`, row 42)] and it does not
  run `settleAmbiguousLines`. Guards: `tests/browser/docx-mixed-bidi.browser.test.ts` (14: the typed text of seven
  LibreOffice lines is the oracle, the app's bake, and four Chrome cases), `tests/utils/flowDocArabic.test.ts` and
  `tests/blockers/arabic.blockers.test.ts` (28 together). [2026-09-28: `6ea75e2` added two cases since — the files are the authority] Sabotage, predicted first, each restored with `cmp`, jsdom
  + browser: per-item reversal back → 10 + 10; item-count direction → 6 + 3; letter-less items not neutral → 2 + 3;
  L2 for an LTR base off → 2 + 3; direction-keyed gap → 3 + 4; bracket mirroring off → exactly the Chrome bracket
  case in each (1 + 1, LibreOffice green); the paragraph tiebreak off → 1 + 0; only its flush-right arm off → 1 + 0; both off → 1 + 1 (re-measured after
  row 41: the email line now sits in its Arabic paragraph, whose letters decide it, and the flushness arm reads it
  too, so the browser needs both gone to red); the run-box gap off →
  1 + 1 (`نظام.pdf`); W7 off → 1 + 1 (the Arabic paragraph, via `v2.0.0`). The Markdown case aggregates every
  LibreOffice line, so it reds with any of them. The writer emits complex-script attrs (`font.cs=Arial`,
  `bold/italics/sizeComplexScript`). All in `flowDoc.ts`/`flowDocWriters.ts`.
- **A wrap is measured against its own column (limits row 41, 2026-09-27)**: `groupLinesIntoParagraphs` split at
  `PARA_GAP` (1.6 sizes) alone, and Chrome's Arabic line box grows with a Latin fallback font inside it — the
  `support@example.com` line sat 22.50pt under its predecessor against a 22.38pt threshold and became its own
  paragraph. No single threshold works: LaTeX papers break paragraphs 1.613 sizes apart on 1.2-size lines. A gap past
  `PARA_GAP` is now a wrap when it is within `WRAP_SLACK` (1.1) of the column's typical in-paragraph gap AT THAT SIZE
  (lower median of the gaps under `PARA_GAP`, keyed per half point, at least two of them), unless the next line opens
  with a list marker. Measured on 22 PDFs: 6 boundaries change — 4 wraps rejoin (the Arabic line, a Schedule C
  sentence, two table captions) and 2 IRS 1040 form rows join the row below (a bound; the list guard kept a Pub 17
  bullet apart). Not reached: a Chrome LTR paragraph whose EVERY line gap is past `PARA_GAP` (arabic-allcases p2, all
  1.608) has no in-paragraph gap to compare with (row 52). Guards: five cases in `tests/utils/flowDocColumn.test.ts`
  and the merged two-line paragraph case in `docx-mixed-bidi.browser.test.ts`. Sabotage, each restored with `cmp`:
  rule off → 1 + 1; list guard off → exactly the list case; typical gap pooled across sizes → exactly the per-size
  case (whose first fixture was vacuous — a tighter 10pt column only pulls a pooled median DOWN; it now pools a looser
  18pt column); two samples not required → 2 jsdom.
- **Arabic table cells (limits row 42, 2026-09-27)**: a cell was its items sorted left to right and joined with spaces,
  in the CSV/XLSX grid and the Word/Markdown/text tables alike. Chrome draws Arabic one glyph per item, so `الطول` came out
  `ل و ط ل ا` in presentation forms; LibreOffice's `النص (RTL) هنا` came out `هنا ) RTL ( النص`. `buildTableGrid` now
  takes an injected cell text (`bidiCellText` in flowDoc — injected because flowDoc imports tableExtract), used only
  when the grid's items hold a right-to-left one: the cell is built like a paragraph (`clusterWordsIntoLines`,
  `settleAmbiguousLines` against the cell's item extent, gap spacing). A grid with no right-to-left item keeps the old
  join byte for byte — including `A 4` for a Latin `A4` drawn as two items, which is pre-existing and out of scope.
  `TableTextItem` gained `rtl` and `size` (the flow's size formula). The tagged path's cells get the same settle.
  `settleAmbiguousLines` gained one rule for paragraphs too: a near-even line flush on BOTH sides takes the side the
  paragraph's other lines are flush with when those flush on one side agree, else keeps its own reading (a wrapped
  `برنامج PDFturbo` above a flush-right `الجديد`). Fixture `tests/fixtures/bidi/arabic-table.fodt/.pdf` (LibreOffice).
  Every cell of both fixtures now reads as typed. Column ORDER still differs for a right-to-left table — drawn order in
  the lattice grid, tag order in the tagged path (row 53). Guards: `tests/browser/table-arabic.browser.test.ts` (5),
  3 cases in `tableExtract.test.ts`, 2 in `flowDocArabic.test.ts`. Sabotage, each restored with `cmp` (jsdom +
  browser): gate removed → exactly the LTR control; bidi path never used → 1 + 4; full-line rule off → 2 + 2 (the
  paragraph and cell cases, both LibreOffice cases); abstain taking any side → exactly the abstain case; no settle in
  cells → 1 + 2; exportService `rtl` dropped → the 3 CSV cases; flowDoc `rtl` dropped → exactly the Chrome flow case;
  exportService `size` forced to 12 → green (equivalent on these fixtures, not pinned).
- **Edit-text prefill (limits row 40, 2026-09-27)**: the edit-text tool's Arabic overlay takes its text from
  `clusterBaselineRun`, which joined the clicked run's items by ascending x — the same reversal as the DOCX export's,
  one step earlier: measured on the Chrome fixture, 19 of 157 runs read as typed and 70 came out reversed; on the
  LibreOffice one a split line's items came out in page order (`اليوم2.5النسخة`). A run holding a `dir: 'rtl'` item
  is now ordered by `orderLineWords` (folding and bracket mirroring included); a run with none is joined exactly as
  before. After: 109 of 157 and 9 of 10, and every remaining miss is an extraction bound above (marks, `الله`, the
  lam-alef line, punctuation inside a Chrome item) — none reversed. The run's box is unchanged. Bound: the text keeps
  no space between two items pdf.js did not put one in (row 51). Guards: four cases in
  `tests/handlers/textEditHandler.test.ts`, whose `flowDoc` mock now passes the REAL `orderLineWords` (the old
  Arabic case asserted the ascending-x join on glyphs drawn in logical order, a shape pdf.js never produces), and
  `tests/browser/edittext-arabic-prefill.browser.test.ts` (2, real pdf.js items against the typed text of both
  fixtures, the bounds excluded by name). Sabotage, each restored with `cmp`: the page-order join → 3 + 2; order
  kept but folding dropped → 1 + 1 (predicted 1 + 0 — the Chrome case reds too, cause not traced). The gate forced
  always-true → green: "a run with no RTL item is joined exactly as before" holds by reading, not by a test (the
  LTR control only shows LTR text is not scrambled). The browser file hands real pdf.js items to the function; the
  handler passes pdf.js's own item objects (a cast, `dir` rides along), certified by reading.
- **True-edit**: `replaceTextAt` REFUSES Arabic new-text before the Latin Path-3 redraw (it would emit '?')
  → routes to the overlay (mirrors the Type3/vertical refusals). Faithful Path-2 subset-glyph reuse still
  runs first for in-subset edits. Guard: `isArabicText()` (defined in `flowDoc.ts`, imported by `contentStreamEditor.ts`).
- **Overlay rendering** (`src/export/arabicOverlay.ts`): pdf-lib `drawText` CANNOT place shaped glyphs RTL
  (fontkit shapes logical-only; drawText paints LTR → mirrored). Fix: `font.encodeText(logical)` shapes
  (fontkit GSUB) + emits 2-byte subset CIDs **already in VISUAL order → do NOT reverse the CID pairs** →
  raw `Tj` via `page.pushOperators` against **Noto Naskh Arabic** (vendored **`src/assets/fonts/NotoNaskhArabic-Regular.ttf`**,
  OFL — `src/assets/fonts/OFL.txt`, lazy `?url`-fetched, embedded Type0/CID via `@pdf-lib/fontkit`; the embedded
  W-array advances glyphs). **MUST be a TTF/OTF, NEVER a `.woff`/`.woff2`** — fontkit/@cantoo-pdf-lib mis-embeds
  the WOFF1 of this font: the subset keeps only the `ا` glyph outline, every other glyph renders blank + a
  spurious 6th glyph + broken ToUnicode (`U+0002`). Root-caused live 2026-06-17 (pdf-lib's own `drawText` fails
  identically → font container, not RTL code); the prior `@fontsource/noto-naskh-arabic` woff dep is REMOVED.
  The TTF embeds cleanly (5 glyphs, full word renders, correct logical ToUnicode). Deps: `@pdf-lib/fontkit`
  (0 vulns; a single RTL run needs no bidi lib — `encodeText` is already visual; mixed LTR+RTL line reorder
  is a documented ceiling). [superseded 2026-09-28: `drawBidiLine` reorders mixed lines (`c394b1a`)] `getArabicFont` is shared by the searchable-OCR Arabic layer, so this fix covers both.
  Browser-only (font fetch); wired in `pdfElementRenderer.ts` text branch, guarded by `isArabicText`,
  right-aligned. Guards: `tests/utils/flowDocArabic.test.ts`, `tests/export/arabicOverlay.test.ts`,
  `tests/browser/arabic-overlay.browser.test.ts` (rasterized: now asserts multi-glyph ink **width**, not just
  presence — catches the single-alef WOFF regression).

### Cornerstone QA 2026-06-17 — RTL text-layer selection/copy/search + multi-language DOCX

> **[Re-checked 2026-09-28]** the `tests/utils/bidi.test.ts` case count below has grown (`4808f0d` added the `mirrorForDisplay` cases), and `src/utils/bidi.ts` exports more than the four functions named — the files are the authority.

:
- **Text-layer selection / copy / search (RTL)**: pdf.js v6 builds the selection layer as one PER-GLYPH
  span, visual order, PRESENTATION FORMS, no spaces. (#6 `a293639`) a `copy` listener (`textLayer.ts._onCopy`)
  rebuilds logical, spaced, base-letter text from selected-span geometry via `reconstructLogicalText`
  (`rtlClipboard.ts`). (#6b `6e35874`) `TextSearchHandler.search` adds a normalized fallback — on a raw miss
  it matches the NFKC'd query against `reverseRtlText(str)` (visual→logical) + a plain NFKC fold (single
  glyphs / Latin ligatures like ﬁ), with an item-box highlight; LTR matching is byte-unchanged. (#6c
  `df21a26`) `alignSpanOrderToVisual` (in `textLayer.ts`, called at the end of `render`) re-appends spans in
  visual (top, then left) order so an Arabic drag-selection highlights without holes — DOM order was
  non-monotonic in x (measured 17/72 backward on one real-PDF line → ~45% of the band was gaps); after,
  72/0 monotonic, gaps 114px→21px. Spans are absolutely positioned (reorder is visually invisible); copy
  re-sorts by geometry (unaffected); the app's own search/highlight don't use pdf.js's findController. Gated
  to RTL/Arabic-DOMINANT pages (LTR multi-column reading order preserved). Ceilings: sub-character RTL
  highlight position is item-level; mixed LTR+RTL single-line bidi; SR reading order becomes visual L→R.
  Guards: `tests/utils/rtlClipboard.test.ts`, `tests/handlers/textSearchHandler.test.ts` (Arabic #6b),
  `tests/browser/arabic-selection.browser.test.ts` (#6c, real layout — jsdom can't lay out spans).
  **Cross-item Arabic search + multi-char copy fix (2026-06-21, `9b6fa35`+`2cfbb0f`):** the #6b
  per-item fallback found ZERO real Arabic matches — pdf.js splits a word across MANY per-glyph items, so a
  multi-glyph query never fits one `item.str`. KEY (verified live): pdf.js emits SINGLE glyphs in VISUAL
  position order but MULTI-char items/spans in NATIVE (LOGICAL) char order (the trailing "لام" of "السلام"
  is one logical-order item). So correct reconstruction orders tokens by READING POSITION (RTL → x-descending)
  and folds each NFKC-ONLY — NEVER reverses a token's internal chars (the old blanket `reverseRtlText(visual)`
  scrambled multi-char tokens: "السلام"→"السمال"). `TextSearchHandler.buildLogicalLines` (pure, exported) does
  this per-line with an item→offset token map → match maps to the covering items' union box; the Arabic line
  pass is gated to `isArabicText(query)` (Latin stays per-item, no double-count). `reconstructLogicalText`
  (copy) got the SAME no-internal-reverse fix → embedded LTR words/numbers ("PDFturbo"/"100%") now stay intact.
  This OVERTURNS the original #6b assumption (visual-order multi-char items) — its synthetic single-item
  fixture was unrealistic and was corrected to logical order. Selection ordering was already correct
  (`alignSpanOrderToVisual`); residual striped highlight at large fonts = inherent per-glyph-span SEAMS
  (cosmetic, not fixed). Ceilings: neutral bracket mirroring "(RTL)"→")RTL(" (UAX#9 L4) [fixed for copy and the Arabic search line by limits row 43 — § "Brackets in the text-layer copy"], "الله" ligature
  reorder, multi-token LTR run order. Guards: `tests/handlers/textSearchHandler.test.ts` (per-glyph spanning),
  `tests/utils/rtlClipboard.test.ts` (multi-char span + embedded-LTR), `tests/browser/arabic-search.browser.test.ts`
  + `tests/browser/arabic-copy.browser.test.ts` (real pdf.js items). Fixture+gen: `scripts/gen-arabic-fixture.mjs`.
- **Shared char-level bidi engine (Feature 3 Slice 1, `11a3253`)**: `src/utils/bidi.ts` adopts
  **bidi-js (MIT, full UAX#9; 1.0.3 then, 1.1.0 since 2026-09-13)** — promoted transitive(jsdom)→**direct prod dep**; `src/types/bidi-js.d.ts`
  supplies the named types `bidi.ts` imports (1.1.0 ships its own `src/bidi.d.ts`, but default-export-shaped —
  without our file `tsc` fails TS2614 on `BidiApi`). FOUR functions: `logicalToVisual(text,base)` (typed/user text → display order,
  brackets mirrored via `getReorderedString`); `visualToLogical(text,base)` (pdf.js visual order → logical;
  BOUNDED inverse: reverse line + re-reverse maximal LTR-type runs *trimming boundary WHITESPACE* + un-mirror
  RTL-context brackets — LTR-base input is identity); `visualRuns(text,base)` (logical → runs in visual L→R
  order, each run's text LOGICAL so fontkit shapes Arabic / Helvetica draws Latin); `logicalItemOrder<T>(itemsLToR,
  isRtl)` (item-level UAX#9 L2 — RTL-item runs reversed, embedded LTR-item runs forward, item internals untouched).
  **All four Arabic surfaces now route through it:** overlay `drawBidiLine`→`visualRuns` (the OLD hand-rolled
  `segmentBidiRuns`/`baseIsRtl` are DELETED — do not reintroduce); copy `reconstructLogicalText`→`logicalItemOrder`
  (SPAN-level); search `buildLogicalLines`→`logicalItemOrder` (ITEM-level, token→item map preserved); DOCX
  `orderLineWords`→`logicalItemOrder` (ITEM-level for either base since limits row 19, which removed the DOCX
  path's per-item char reversal: pdf.js items are already logical — see the DOCX export bullet above). **Non-obvious (TDD-discovered):** (1) bidi-js is
  logical→visual ONLY — the 3 read surfaces need the inverse, which is an APPROXIMATION (perfect inversion from
  visual order alone is impossible). (2) a char-level reorder SCRAMBLES pdf.js multi-char tokens (`لام`/`PDF` arrive
  as ONE logical-order span) and breaks search's char offsets → copy/search MUST reorder at ITEM granularity, never
  char. (3) boundary whitespace must stay put when re-reversing an LTR run (else an inter-word space migrates →
  `مرحباWorld `). Every engine call falls back to the raw string on a bidi-js throw (never regress below prior
  behavior). **Ceiling:** shaped-ligature reorder (overlay bracket mirroring and tashkeel GPOS: fixed by limits
  row 25 — § "RTL brackets and list markers in the Arabic overlay" and § "Tashkeel placed by GPOS"). Guards:
  `tests/utils/bidi.test.ts` (17) + the per-surface guards (`rtlClipboard`/`flowDocArabic`/`textSearchHandler`) +
  the extended `tests/browser/arabic-overlay.browser.test.ts`.
- **RTL-aware text toolbar (Feature 3 Slice 2, `ebae519`)**: `TextElement.direction?: 'auto'|'rtl'|'ltr'`
  (default `'auto'`, OPTIONAL, **no `SCHEMA_VERSION` bump** — `toJSON` omits when auto, `elementFactory`
  reads `?? 'auto'`). `resolveDirection(direction, text)` (in `textElement.ts`) = `'auto'` → `baseDirection(text)`
  (first-strong UAX#9, exported from `utils/bidi`). The editor `<input>.dir` is set from the resolved
  direction in `_applyInputFormatting` (fixes Arabic typing/caret). Toolbar `⇋ rtlBtn` (in the align group) →
  `app.toggleDirection` → `FormattingService.toggleDirection` (overrides the resolved direction to the
  opposite explicit value) / `setDirection` — each a `MoveResizeCmd` whose `before` carries BOTH
  `{direction, align}`, and which defaults a still-`'left'` align to `'right'` when the result resolves RTL
  (so undo restores both). `uiController.updateFormattingToolbar` reflects `rtlBtn` active via
  `resolveDirection(te.direction, te.text) === 'rtl'`. **Export is UNCHANGED** — `pdfElementRenderer.renderText`
  already auto-RTLs `isArabicText` lines via `drawArabicLine`; `direction` is editor + alignment only in v1
  (forcing the Arabic font path on non-Arabic text mis-renders — declined). **Gotcha:** any test that builds
  the uiController refs from a partial DOM must seed `'rtlBtn'` (else `getElementById` → null →
  `r.rtlBtn.disabled` throws). i18n `formatting.rtlTitle` (ar reviewed 2026-07-30).
- **Multi-language DOCX (#2 `9cfc38a`)**: Cyrillic + CJK source text is preserved verbatim through
  PDF→DOCX/MD/TXT — they're LTR like Latin, so they take the same reconstructPage + writer path and the only
  script branch (`isArabicText` RTL reorder) must not fire. CONTENT is intact (verified, no prod change).
  CJK font-FACE: no CJK face is FORCED (Han unification), but since limits row 18 the PDF's own family is written
  as the `w:eastAsia` font when it is a real name — see § Sprint 2 fidelity's row-18 note. Guards:
  `tests/utils/flowDocCjkCyrillic.test.ts` (jsdom writer/reconstruct), `tests/browser/cyrillic-docx.browser.test.ts`
  (real pdf.js extract embedded-font Cyrillic → DOCX).
- **Test-infra**: jsdom `testTimeout` 5s→30s (`a214076`) — node-forge RSA-2048 keygen tests flaked under
  full-suite CPU contention; mirrors the browser config (`87180d1`). **`hookTimeout: 60_000` was added
  beside it 2026-08-22** — that bump was applied to tests only, leaving hooks doing the identical keygen
  on vitest's 10s default; see § "A raised `testTimeout` does not raise `hookTimeout`".

### RTL brackets and list markers in the Arabic overlay — limits row 25, D17 (2026-09-27)

Two defects, one line of code apart. **Noto Naskh Arabic has no glyph for `( ) [ ] •`** (nor `-`, `%`), so an
Arabic export line drew them as `.notdef` boxes and they extracted as U+0000 — a bullet list in Arabic showed a box
per item. And **fontkit draws a glyph as given**: nothing applied UAX#9 rule L4, so a bracket at an RTL level faced
the wrong way (`«»` pointing outwards). Measured against a `dir=rtl` Chrome render of the same strings
(`var/claude/qa-shots/row25/`).

`mirrorForDisplay` (`utils/bidi.ts`) mirrors at odd levels before `visualRuns`; mirrored pairs share their bidi class,
so the levels — and the runs — do not move. `measureBidiRuns` then splits each RTL run by the Noto character set:
what Noto lacks and WinAnsi has goes to Helvetica. Inside an RTL run those pieces are laid out right to left, so their
ORDER is reversed and so are the CHARACTERS of a Helvetica piece (`[(` must draw as `[(` at the left end, not `([`); a
Noto piece is not reversed, because fontkit already emits visual order. A line needing neither keeps its old emission —
measured byte-identical on 16 of 20 plain strings, the other 4 being `%`/`-` lines that were boxes. Note that a `%` in
`نص 100%` lands LEFT of the number: digits after Arabic letters are AN, not EN (rule W2), exactly as in Chrome.
**`bidi-js`'s `getMirroredCharactersMap` takes the LEVELS ARRAY**, not the `getEmbeddingLevels` result — the ambient
type said otherwise, and the wrong call returns an EMPTY map with no error. The editor's list gutter follows the
resolved direction (right side for RTL text, CSS `text-align: end`).

Traps: pdf.js re-orders the text INSIDE an RTL item, so the oracle orders ITEMS by x and cannot place a character
that rides inside the Noto item (the `.` of `1.` — the control asserts only that the digit is rightmost); and the
subset CIDs are renumbered in order of use, so a content-stream compare cannot see a Noto glyph change (`«»` compared
"identical" while being mirrored) — the guillemet case reads the pixels. Bounds, in `KNOWN_ISSUES.md`: a mirrored
guillemet extracts as its mirror, and the export right-aligns Arabic lines and takes each line's base from its first
strong letter while the editor honours align and the RTL toggle.

Guards: `tests/browser/arabic-mirror-markers.browser.test.ts` (7), four `mirrorForDisplay` cases in
`tests/utils/bidi.test.ts`, two gutter cases in `tests/elements/textElement.test.ts`, and a bracket/bullet config in
`text-extent-ink.browser.test.ts`. Sabotage, predicted first, each restored and checked by hash: mirroring off → the
parenthesis, double-bracket, `[PDF]` and guillemet cases + 2 unit; coverage split off → parenthesis, double, bullet
and `[PDF]`, guillemet green; Helvetica piece not reversed → exactly the double bracket; segmentation gate off → the
four pure-Arabic cases, `[PDF]` (mixed path) green; measure gate unlike the draw gate → exactly the width case; gutter
never RTL → exactly its jsdom case.

### Tashkeel placed by GPOS in the Arabic overlay — limits row 25, C19 (2026-09-27)

pdf-lib's custom-font embedder keeps only each glyph's advance width (`/W`), so fontkit's GPOS offsets were
dropped: a vowel mark (advance 0) drew at the pen with no offset — off its base letter and on the baseline. Measured
against Chrome shaping the same string with the same TTF (HarfBuzz; row 17 measured fontkit identical to it): ink
overlap 0.737 / 0.820 / 0.823 on three vowelled strings, 1.000 on an unvowelled one. `shapeOf` re-runs
`font.layout(text, fontFeatures)` — the call pdf-lib's `encodeText` itself makes, so glyphs line up 1:1 with the CIDs
(checked by count; a mismatch falls back to the old output) — and `shapedShowOps` emits each moved glyph with a TJ
adjustment `-Δ·1000/upem` and each vertical offset as a text rise (`Ts`, in text-space units, NOT scaled by the font
size). After: 0.964 / 1.000 / 0.974. The run's width is Σ xAdvance when a glyph moves — equal to Σ advance width on
every string measured, so that half is pinned against Chrome's `measureText` but its sabotage is equivalent.

**A run in which nothing moves is emitted exactly as before**: 24 unvowelled strings × {upright, rotated 30°} compared
byte-identical, and only the two vowelled strings of the baseline changed. **pdf.js extracts the same code points
before and after** on four strings, the mixed-line one included — the TJ/Ts split does not fragment items further.
The embedder is a pdf-lib INTERNAL (`font.embedder.font`); absent, the old unpositioned output is kept.
**Bound: letter spacing (`Tc`) still splits a mark from its base by one `Tc`** [Inferred from the pen arithmetic,
not measured]: `Tc` accrues after every glyph, a zero-advance mark included, while the TJ adjustments are computed
without it — the Feature-4 approximation (`Tc` counted per glyph, not per cluster). Before C19 the mark was off by
its whole offset plus that `Tc`.

Guards: `tests/browser/arabic-tashkeel.browser.test.ts` (6: three vowelled strings against Chrome's ink, all carrying
marks with a NON-ZERO yOffset so a sideways-only fix still fails; an unvowelled control that also reads the operators —
a plain `Tj`, no TJ array, no rise — because pixels cannot tell `Tj` from `TJ`; the bidi path emits TJ and Ts; the
measured width equals Chrome's), plus a tashkeel config in `text-extent-ink.browser.test.ts` (footprint
containment — green before and after). Sabotage, predicted first, restored and checked by hash: TJ adjustment dropped
→ the 3 vowelled cases; `Ts` dropped → those 3 + the bidi case; bidi path not passed the positions → exactly the bidi
case; width from advance widths → green (equivalent, above); positioning off entirely (the pre-fix output) → 4; both
"did anything move" checks dropped (every run as TJ) → exactly the control.

### Brackets in the text-layer copy and the Arabic search line — limits row 43 (2026-09-29)

Row 43 suspected copy ("does not mirror") and the search fallback ("un-mirrors every RTL bracket"). Measured on real
pdf.js items, the copy was wrong for **two different reasons, one per producer**:

- **LibreOffice** (`tests/fixtures/bidi/mixed-bidi.pdf`) stores the LOGICAL bracket, so the brackets were fine. The row
  was read left to right (`هنا )RTL(النص`) because the direction vote, `rtlVotes * 2 > byX.length`, counted `(`, `)` and
  `RTL` against the two Arabic words — the item-count mistake row 19 fixed in the export, still live in copy and in
  `buildLogicalLines` (the search's Arabic line pass).
- **Chrome** (`arabic-allcases.pdf`) stores the mirrored SHAPE, so a correctly ordered row read `)RTL(` — the producer
  disagreement row 19 solved with `mirrorShapeBrackets`, which copy never used.
- **The search fallback needed no change (measured).** `visualToLogical` un-mirrors only a bracket standing ALONE
  between Arabic letters, `reverseRtlText` reaches it only for an item mixing Arabic with ASCII, and it runs only for a
  non-Arabic query. pdf.js emits each bracket as its own item on both producers, so no real item reaches it.

`rowIsRtl` (`flowDoc.ts`) is the vote now: a span with no letter abstains, an Arabic span votes RTL, any other lettered
span votes LTR. It is a SPAN count, not a letter count — pdf.js emits Arabic one glyph per span, so a letter count lets
one long Latin word outvote an Arabic line. `reconstructLogicalText` and `buildLogicalLines` use it and run their
ordered spans through the now-exported `mirrorShapeBrackets` (mirrors bracket-only RTL spans only when the row closes
before it opens AND mirroring balances it). One character for one, so the search token offsets hold. Search was outside
the row's Files cell; it shares the cause (logged `ASSUMED` in the plan).

Guards: 4 unit cases in `tests/utils/rtlClipboard.test.ts` and 3 in `tests/handlers/textSearchHandler.test.ts`
(LibreOffice, Chrome, LTR control; copy adds a selection that stops inside the brackets), 3 in
`tests/browser/arabic-copy.browser.test.ts` (Chrome headings, LibreOffice line, LTR control) and 1 in
`arabic-search.browser.test.ts` that asserts BOTH producers, so it cannot show one of them green. Sabotage, predicted
first, each restored by hash: old vote → 5 of 7 unit (both LibreOffice, both synthetic Chrome, the partial selection) +
browser LibreOffice copy + the search case, real Chrome copy green; mirroring off → the 2 Chrome unit cases + browser
Chrome copy + the search case; mirroring unconditional → 3 unit (both LibreOffice, the partial selection) + browser
LibreOffice copy + the search case. One browser run printed `Tests no tests` under mutation and was re-run (noise).

**Bounds.** The LibreOffice line copies as `النص(RTL) هنا`, one space short: word-level items make the median span width
large, so a real 3.6pt space falls under the `0.4 × median` threshold (row 54; the browser case tolerates exactly that
space). The vote is still a span count. **UNCERTIFIED-BY-EXECUTION:** the live text layer's own span geometry — the
browser cases synthesise `SpanGeom` from `getTextContent`, as the existing copy test does.
