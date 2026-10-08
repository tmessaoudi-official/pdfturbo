---
paths:
  - "src/utils/contentStreamEditor.ts"
  - "src/utils/glyphNames.ts"
  - "src/handlers/textEditHandler.ts"
  - "tests/utils/contentStreamEditor*"
---

# pdfturbo gotchas — true-edit

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: true text editing in the content stream: Path 2/3, fonts, nested cm. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### Path 2 keeps an embedded font written as literal strings — limits row 38 (2026-09-27)

Path 2 (reuse the embedded font's own glyphs through its ToUnicode) rewrote HEX operands only, so a font whose text is
written as literal strings — pdfTeX's shape, and the corpus's — went to the Path-3 base-14 redraw. A hex token is a
legal replacement for a literal one, so `replaceShowOpHex` now rewrites every string segment as hex: its `type` as
well as its `raw`, and a literal segment is measured in BYTES with its escapes decoded (`(\(\))` is two codes, not
four), so a kerned TJ keeps each segment its own code count. Two defects came out with it. **A mixed TJ
(`[("#) -100 <2425>]`) wrote the whole payload into the hex segment and left the literal one stale** — the A2 shape,
live for a hex-plus-literal array. And **a simple font's code size was read from its ToUnicode**, which wrote two-byte
codes whenever the CMap declared a wide codespace or none (`detectCMapBytesPerCode` returns 2 without one): a simple
font is single-byte (PDF 32000 §9.6.6), so only a Type0 font takes its code size from the CMap, and `encodeWithSubset`
refuses a code wider than the code size.

Corpus (the 729 row-17 records, each run's own decoded text reversed, one file per process): the editor pre-fills
146; before, 48 edited in place, 97 substituted and 1 refused; after, all 146 in place, 79 of them with spaces. The
other 583 are not pre-filled — no ToUnicode, or not located at tolerance 3; the probe did not record which, so that
split is unmeasured (row 39 measures it). An edit needing a character the ToUnicode does not map still falls through
to Path 3 (pinned). The font type is read through `lookup`: an indirect `/Subtype` read with `get` is a PDFRef, and a
Type0 font then took one-byte codes (found at the 6C review, after 5b6aab4 shipped; pinned).

Guards: 9 cases in `tests/utils/contentStreamEditor.test.ts` (Tj, a second edit, the escaped TJ, the mixed TJ, the
`"` operator, wide and no codespace, the Path-3 control, the code-width refusal) plus the `replaceShowOpHex` contract
case, and `tests/browser/trueedit-literal-path2.browser.test.ts` (6, real pdf.js: every run edited reads the new
digits in the same font as an untouched run of the same file; the control is redrawn in another font). The fixture
(`tests/utils/_literalSubsetFixture.ts`) is a simple TrueType built from the vendored Noto Naskh TTF with
/Differences mapping 0x21..0x2A to the digits, so `(` and `)` are codes and need escapes. Sabotage, predicted first,
each restored with `cmp`: literals refused → 8 jsdom + 4 browser; raw length → exactly the escaped TJ; `type` not
updated → exactly the contract case (a second edit re-reads the saved stream, so the type matters only within one
call); codespace trusted on a simple font → the wide and none cases; no code-width guard → exactly that case; TJ
hex-only → the escaped and mixed TJ in both suites; `/Subtype` read with `get` → exactly the indirect case. A literal operand in a Type0 font (the
G8 prefill fixture's shape) — now pinned by two jsdom cases on a real LiberationSans Type0 subset, one with an
indirect `/Subtype`.

**Path 1 had the same mixed-array hole (limits row 49, found at the row-38 review).** `replaceShowOpInPlace` rewrote
only the literal segments of a TJ, so `[(He) -50 <6C6C6F>]` edited to "World" drew `Worldllo`. Hex segments are now
rewritten too, as literals (byte == character on a standard font), a hex segment counting half its digits; an
all-hex array still goes to Path 2/3. Guards: two cases (hex last, hex first — only hex first can see the length,
because the last segment absorbs the remainder). Sabotage: literal segments only → both; hex counted by digits →
exactly the hex-first case.

**The READ side had the same codespace trap (limits row 50, found measuring row 39).** Row 38 made the WRITE side
single-byte for a simple font, but the editor's pre-fill, `addDecorationAt` and the decoration resize still took the
code size from the ToUnicode codespace, so a simple font whose CMap declares `<0000> <FFFF>` (or none — then 2 was
assumed) decoded pairs of codes and the editor never opened. On the corpus that is 75 runs — the budget (50) and
census (25) reports, Type1C with a `<0000> <FFFF>` ToUnicode — and all 75 now pre-fill [measured: row-39 probe,
before 0/75, after 75/75]. One helper, `showCodeSize`, now answers for all four sites: a simple font → 1, a Type0
font → its CMap, or 2 without one (the order changed at row 39, which gave the reader maps with no CMap at all). Guards: pre-fill of all four literal runs with a wide and with no codespace, and an
underline added on the wide one. Sabotage: the helper trusting the CMap → 5 red (write wide/none, pre-fill wide/none,
underline; re-measured on the row-39 order, still 5). The decoration-resize site shares the helper and is not pinned separately.

### An embedded simple font without ToUnicode is read through its /Encoding — limits row 39 (2026-09-27)

459 of row 17's 729 corpus runs are an embedded simple font with NO ToUnicode: 248 Type1C and 71 TrueType on a bare
`/WinAnsiEncoding`, 140 pdfTeX Type1 on `/Differences` with no base. The editor could not read them (no pre-fill) and
every edit substituted a base-14 font. `getPageFontCodeMap` now answers "code → text" for every reader: the ToUnicode
when there is one, else `simpleEncodingMap` — `/WinAnsiEncoding` as the base, then `/Differences`, each glyph name
read by `glyphNameToUnicode` (`src/utils/glyphNames.ts`).

- **The name table is small on purpose**: the 361 names pdf-lib's standard-fonts WinAnsi and Symbol encodings use
  (generated; `glyphNames.test.ts` re-derives it from the package), 10 extras the corpus draws (dotlessi, L-slash,
  the spacing accents), the ligatures (`fi` reads as `fi`), and the AGL rules (`one.tab` → `1`, `f_f_i` → `ffi`,
  `uniXXXX`, `uXXXX`). Anything else is unknown — ZapfDingbats `a39`, `.notdef` — and the READER FAILS CLOSED: a run
  with one unknown code pre-fills nothing, because a partial read would be written back without the missing glyph.
- **WinAnsi is Annex D, not cp1252**: 0xA0 is `space`, 0xAD is `hyphen`, and the six undefined codes are unmapped
  (pdf.js draws them as bullets; no producer writes them to mean text). Pinned one by one.
- **Refused shapes**, each a fail-closed branch: Type3 and Type0; a symbolic TrueType (drawn through its (3,0)
  cmap); a symbolic Type1 WITH a base encoding (only Differences-over-built-in, the pdfTeX shape, is read); no
  `/Encoding`; a base other than WinAnsi (MacRoman and Standard: 0 corpus runs).
- **The write side reuses only codes the edited stream already DRAWS with that font.** An encoding names codes whose
  glyph the subset dropped, and nothing in the file says which; a drawn code proves the glyph is there, for every
  font-program type, without parsing the program. Any other character goes to the Path-3 redraw, exactly as today —
  C1's floor, stated for this shape. A ligature code (`fi`) reads as letters but is never reused for them.

Measured on all 459 runs (probes not committed; results in gitignored `var/claude/row39w/`): 459 pre-fill; 438 equal
the row-17 reference text and the other 21 differ only where PDFium reports an end-of-line hyphen as `\x02`; the
reversed text of every run goes in place (459/459 — by construction, it uses only drawn codes); pdf.js read-back
confirms the text in the SAME font for 458 (one sideways label the probe cannot locate). A realistic edit — the first
letter replaced by `Q` — goes in place on 147 and falls back to Path 3 on 312: the bound, measured.

Guards: `tests/utils/glyphNames.test.ts` (28), 15 cases in `contentStreamEditor.test.ts` on three fixture shapes
(`_literalSubsetFixture.ts` gained `toUnicode: false`, `encoding: 'winansi'`, `baseEncoding: false`; the runs draw
every digit but 6, the presence probe), and `tests/browser/trueedit-encoding-path2.browser.test.ts` (12, real pdf.js:
pdf.js reads the fixtures through its OWN glyph list, the edited run comes back in the same font with ink in its
band, and a 6 comes back substituted). The Noto fixture font is FULL, so no fixture shows what an absent subset glyph
looks like — the presence rule is pinned by outcome. Sabotage, predicted first, each restored with `cmp`: no encoding
fallback → 9 jsdom + 8 browser; presence rule removed → exactly the 3 digit-6 cases + the 2 browser controls; reader
not strict → the 2 unknown-name cases; the symbolic-TrueType rule removed → exactly its case (green until that case
moved to the no-base shape — on `/WinAnsiEncoding` the symbolic-with-base rule refused it first); any base accepted →
the 2 base cases; `map.delete` dropped → exactly the over-WinAnsi unknown-name case; no suffix strip → the 2 `.tab`
cases; `showCodeSize` in its row-50 order → green, equivalent: it is now only called with a CMap in hand.

### True-edit composed nested `cm` backwards, and forgot the CTM at a form's `Do` — limits rows 47–48 (2026-09-27)

PDF's `cm` sets CTM' = M × CTM: the NEW matrix applies to a point first. `multiplyMatrix(A, B)` applies A first,
and `locateTextOps` and `locateDecorationRects` passed `(ctm, m)`, so a translation followed by a scale scaled the
translation too — `1 0 0 1 100 200 cm 2 0 0 2 0 0 cm` put a run at Td (10,10) at (220,420) instead of (120,220).
Its own doc comment stated the wrong order, which is how two sites agreed with it. Nothing caught it because every
test composed a single `cm`, or translations only, whose orders agree.

**Measured before fixing, against pdf.js's own item origins** (throwaway probe over the 15-file corpus): all 50,243
runs of Publication 17 moved, on all 142 pages; the correct order landed on a pdf.js item origin 47,174 times, the
old one 482. ResNet: 476 runs on 4 pages. BERT: 1. The other 11 files: none (the census report was not measured —
the probe ran out of memory). So on such a file a click on text either missed (the edit fell back to an overlay)
or — the 482 — found a DIFFERENT run whose wrongly placed origin sat under the pointer, and **edited text the user
did not click**: undoable, but reported as success. Paths 1/2 wrote the right bytes wherever they landed; Path 3
places its redraw from the origin, so it would have drawn in the wrong place [by reading — the browser case reds at
the hit test, before any redraw runs]. For a translate/scale pair only the origin differs (the linear parts
commute), so `tilted`, the A1 redraw matrix and a decoration's `scaleX` were unchanged there; a rotation inside an
uneven scale changes the matrix too. `translateMatrix` (Td/T*) and `trm = textMatrix × ctm` were already in PDF
order.

**Row 48, the same class one level down (fixed the same day):** text inside a Form XObject was mapped to the page
through the form's `/Matrix` alone — the page CTM at the `Do` was never applied — so a form placed with
`q … cm /Fm Do Q` hit-tested at its unplaced position. Measured the same way: 687 form runs of BERT (4 pages), 308
of ResNet (6), 363 of Publication 17 (69); the placed position met a pdf.js item origin 501 / 290 / 288 times
against 2 / 0 / 0. `formPlacements` now records the CTM at every `Do` OCCURRENCE (q/Q/cm in PDF order), and a
form's text maps through its `/Matrix` FIRST, then that CTM (`locatePageTextOps` also composes nested forms).
**An edit writes the form's one stream, so it changes every place the form is drawn** — Publication 17's 114
page-level form references resolve to 14 streams, one of them named by 47 pages. So a form drawn twice on the page,
or DRAWN by any other page, is no longer a true-edit target and falls back to an overlay (SESSION-CHOSEN: never
change text the user did not click). This NARROWS A3a/A3b: a shared form placed at identity was editable before.
**Drawn, not named, and counted by stream, not by name** (follow-up the same day): pdf-lib's `Resources()` follows
`/Parent`, so with `/Resources` inherited from the Pages node every page NAMES every form, and a name-based check made
form text uneditable in the whole file; two names for one stream slipped the same-page count. `formStreamKey` keys a
placement by its object reference, and `formDrawnByAnotherPage` reads another page's content only when its resources
hold that reference, stopping at the first page that draws it; a page it cannot read (resources or content that
fail to decode) counts as drawing it, so the edit falls back to an overlay — the content half is pinned (a bogus
`/Filter`: the lookup threw before), the resources half is not. Cost measured on Publication 17 at load 27: 10–67 ms
per click, so the check stays ahead of the hit test. The corpus has neither shape (no inherited
`/Resources`, no XObject dictionary shared between pages — measured on all 15 files), so there it changes nothing.
Bound: a nested form's name is resolved in the page's resources, not the enclosing form's.
Guards: eight cases in `tests/utils/contentStreamEditor.test.ts` (placed point found; unplaced and wrong-order points
not; `locatePageTextOps`; drawn twice; drawn by another page; the three follow-up cases) over the shared `tests/utils/_xobjectFixture.ts`, and
`tests/browser/trueedit-form-placement.browser.test.ts` (2, real pdf.js origin). Sabotage, predicted, each restored
with `cmp`: CTM dropped or applied before the `/Matrix` → 2 unit + the browser edit case; the drawn-twice guard
dropped → exactly its case; the other-page guard dropped → exactly its case; `locatePageTextOps` without the CTM →
exactly its case; the other-page check always true → every form hit, the A1/A3a/A3b cases included (tsc rejected
that mutant — [Inferred] the unreachable code — and vitest executed it). A first M6 (`return true` only for a
non-reference entry) stayed green — vacuous, since the fixture's entry is a reference. The follow-up adds three cases
(named but not drawn through inherited `/Resources`: editable; drawn through them: not; two names for one stream:
not); keying by name again → the alias case and both drawn-by-another-page cases; "named" counted as "drawn" →
exactly the inherited-names case.

Row-47 guards: three cases in `tests/utils/contentStreamEditor.test.ts` (text and rule origin under translate-then-scale,
and the R × S matrix) and `tests/browser/trueedit-nested-cm.browser.test.ts` (5, real pdf.js origins; the fixture
puts the old order's origin of run A exactly on run B, so the old code edited A on a click at B). Sabotage,
predicted first, each restored with `cmp`: the text site reverted → 2 unit + 4 browser; the rule site reverted →
exactly its unit case. The doc comment has no guard.

### A failed form write was reported as a successful edit — TEST-2 (review 2026-10-07, fixed 2026-10-08)

An edit whose target lives inside a Form XObject is written by `setFormXObjectContent`, which ended in
`catch { /* silently ignore — falls through to overlay */ }` and returned nothing — and none of its seven call
sites (`deleteTextAt`, `changeSizeAt`, `changeColorAt`, `addDecorationAt`, Path 1, Path 2, Path 3 of
`replaceTextAt`) could fall through to anything: each returned `true` after it. So a write that threw left the
file unchanged while the editor saved it as a new revision and toasted "edited". The comment described the
intended contract and nothing implemented it. It now returns whether the stream was written (its early returns
included); `writeBack` passes that through, and every site returns it. `setPageContent` was left as it is: it
does not swallow, so a page-stream failure already propagates.

**How it can fail is narrow, and that is stated rather than inflated:** the stream is resolved the way
`findTarget` resolved it, and `stringToContentBytes` does not throw, so only pdf-lib itself throwing reaches the
`false` [Inferred: by reading; no real file was found that does it]. The guard injects it at the one call that
replaces the stream, `doc.context.assign`, and restores it before reading back, because pdf-lib's own save goes
through `assign` too. **A Path-3 `false` leaves one harmless residue:** the redraw's font was already added to the
form's `/Resources`, so it stays there unused; the stream itself is unchanged.

**The handler's delete branch had a proof that `false` was unreachable** (§ "The hide-vs-remove audit" records why
a toast there was once reverted). That proof covered `findTarget` only; with a second source of `false` the branch
now warns `toast.trueEditFailed` (an existing key, all three locales) and persists nothing. It still takes no
overlay fallback: a cover over text that is still in the file would hide it, not remove it, and delete is graded
removal-grade in `SECURITY.md`. The replace and style paths already routed `false` to the overlay.

Guards: `tests/utils/formWriteFailure.test.ts` (14: each of the seven sites returns `false` with the stream
untouched, and a control that each returns exactly `true` and writes the stream — `true`, not truthy, so the
Path-2 case cannot pass as a Path-3 `'substituted'`), and a pair in `tests/handlers/textEditHandler.test.ts`
(the delete warns and persists nothing; its control toasts the delete). `_xobjectFixture.ts` gained `fill`, an
`rg` before the text, so a colour edit has an operator to change; the Path-2 case builds its own form with a
subset LiberationSans. Red first: the seven cases `expected true to be false`, the handler case `expected [] to
include 'toast.trueEditFailed'`. Sabotage, each landed, red on exactly its cases, restored with `cmp`: the swallow
answering `true` → the 7 failure cases; each site alone reverted to `return true` → exactly its own case (7
mutants, Path 1 and Path 2 separately); a successful write answering `false` → exactly the 7 controls; the handler
branch back to a bare `return` → exactly its case.

### True text editing engine

`src/utils/contentStreamEditor.ts` can genuinely delete/
replace existing PDF text via content-stream surgery (position-matched, not index-matched).
Wired into the edit-text tool (2026-06-11): `textEditHandler` tries a true edit first
(inline floating input; Enter applies, empty deletes, Esc cancels) and falls back to the
overlay approach when no content-stream match is found. The edit swaps `SourcePdf.bytes`
+ pdfjs doc via `ReplaceSourcePdfBytesCmd` (undoable; old pdfjs docs stay alive on the
history stack by design). See the design doc (recoverable — see the note opening this section) for
remaining limitations (cm transforms, XObjects, Helvetica fallback font — Phase B/C). [superseded 2026-09-28: XObject text editing landed in A3a (`a5bc8f3`) and nested `cm` composition in limits rows 47–48 — § "True-edit composed nested `cm` backwards"]
**ISSUE-2 fix (2026-06-14):** `replaceTextAt` has 3 paths — (1) literal byte-swap, now GATED by
`isByteSwapUnsafeFont()` so it NEVER runs for subset/CID/embedded fonts (byte≠glyph there → was the
heading "data-loss" bug); (2) subset glyph reuse via ToUnicode — or, since limits row 39, a simple font's /Encoding, reusing only codes the
stream already draws (keeps original font for in-subset edits); (3) standard-font redraw emitted as in-stream text operators in ONE `writeBack` (do NOT use
pdf-lib `page.drawText` after `setPageContent` — it orphans the redraw). XObject-embedded targets
refuse before blanking (no delete-without-replacement). [superseded 2026-09-28: since A3a only a Path-3-only XObject target refuses (`isPath3OnlyTarget`)] Guarded by
`tests/browser/issue2-true-edit.browser.test.ts`. **Honest restyle font-substitution (Slice B,
2026-06-20):** `replaceTextAt` returns `false | true | 'substituted'` (was `boolean`). Path 1/2 →
`true` (original font KEPT); refuse → `false`; Path 3 → `'substituted'` **only when the original was a
non-standard embedded font** (`byteSwapUnsafe` = subset/CID/FontFile/Differences) — a Path-3 redraw of
an ALREADY-standard base-14 font (e.g. a Helvetica that couldn't byte-swap in place, or a bold/italic
restyle of one) returns plain `true`, since it's redrawn in the SAME family with no real loss (no false
alarm). `textEditHandler.commit()` surfaces `toast.trueEditFontSubstituted` only on `'substituted'`;
the delete and size/color-only in-stream paths (font kept) keep `toast.trueTextDeleted`/`trueTextEdited`.
The base-14 substitution CEILING is unchanged — this LABELS it. Guards:
`tests/browser/trueedit-restyle.browser.test.ts` + the engine/handler jsdom tests. **Sequential-edit ghost fix (2026-06-19):** Path 3
BLANKS the original show op IN PLACE (`()Tj` / `[]TJ`) and APPENDS the redraw at end-of-stream, so two
ops share the origin. `findTarget` used to pick the blanked ghost (lower opIndex wins the distance tie)
on the NEXT edit → the live redraw lingered and the new text overlaid it (the reported "second edit
resets / text on top of each other / underline frozen" bug — manifests on ANY Path-3 edit: CID/subset
fonts always, and standard fonts when a restyle forces Path 3). Fix: `findTarget` now SKIPS empty-payload
ops (`showOpPayload(...).trim()===''`) in both the page-stream and XObject loops, so delete/replace/the
decoration-resize all target the live redraw. An empty op shows nothing, so it is never a valid edit
target anyway. Guards: `tests/utils/contentStreamSequentialEdit.test.ts` (jsdom: visible-payload count)
+ `tests/browser/trueedit-sequential.browser.test.ts` (real Chrome pixels: wide→short far-zone bare,
delete clears, 3× edits latest-only, underline tracks the 2nd edit). **Honest fallback (#1, 2026-06-17):** maximal
in-place coverage ("Option 2") is structurally bounded — Path 1 (standard fonts) + Path 2 (reuse
glyphs ALREADY in the embedded subset) ARE the ceiling. A NEW character absent from a subset/CID font
has no glyph outline in the PDF, so it cannot be drawn in the original font client-side (→ Path 3
base-14 substitute, or refuse → overlay). So `_emitOverlay` now surfaces `toast.trueEditOverlay`
("couldn't edit in place — added an editable overlay") on EVERY fallback (Arabic / subset-new-glyph /
Form XObject / encrypted source) — no more silent surprise; the Arabic overlay itself renders
correctly via the #3/#3b bidi path. Guarded by the overlay-fallback case in
`tests/handlers/textEditHandler.test.ts`. **Text modes are SEPARATE (Sprint 3, reverted the
ISSUE-5 unification):** `editText` edits EXISTING source text only — a blank-canvas click drops NO box
(it re-shows the editText hint). New text is created with the draw-to-place `addText` tool (the
split-button default), which sizes by drag and auto-switches to `select`. The old blank-drop trapped
the user in `editText` where elements are `pointer-events:none` (`toolModeManager.setMode`), so the box
was unselectable and every further click spawned another. Guarded by `issue5-unified-text.browser.test.ts`.
**Sprint 2 fixes (2026-06-14):** (A-1) a refused edit at commit time is **no longer a silent no-op** —
the handler captures overlay context (bbox + sampled bg/fg) when the inline input opens and falls back
to the redact+text overlay via shared `_emitOverlay` when `replaceTextAt` returns false. (A-2)
`replaceShowOpHex` now replaces the full payload in the first `TJ` hexstring AND blanks every other hex
item (no stale glyphs). (A-3) `cmapHexToUnicodeStr` decodes ToUnicode as UTF-16BE code units +
surrogate pairs (the old length-parity guess was wrong for ligatures/non-BMP). (A-4) `blankAllNearby`
only blanks true shadow duplicates (same fontKey+size+payload, captured pre-mutation). (A-5) Type3 /
vertical (`-V`) / invisible-`Tr` (mode 3/7) text now **refuse** true-edit (→ overlay) via `isType3Font`/
`isVerticalWritingFont` + `renderMode` on `TextOpInfo`. **(B-3, 2026-06-15)** non-WinAnsi new text
(CJK/Cyrillic/emoji) also refuses the Path-3 standard-font redraw via `hasNonWinAnsi()` (the WinAnsi
base-14 fallback would paint '?') → overlay; joins the Arabic refusal. **(B-1, 2026-06-15)** the
content-stream tokenizer (`consumeNumberBody`) now keeps `1e-3`/`2.5E+2` as ONE number token (the old
`[0-9.]` class split the exponent, corrupting round-trips) — guarded so a lone `e` stays an operator.
