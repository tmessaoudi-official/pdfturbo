# True-Text-Editing Engine — Edge-Case Static Audit

**Date:** 2026-06-20
**Scope:** `src/utils/contentStreamEditor.ts`, `src/utils/flowDoc.ts` (classifier/font helpers), `src/handlers/textEditHandler.ts`
**Method:** Read-only static audit. Each heuristic / numeric threshold / sign assumption / refusal gate enumerated, an input that violates it hypothesized, symptom + severity + likelihood + root-cause fix direction assigned.
**Trigger:** The confirmed iText/JasperReports **negative-height `re`** bug (`x y w -h re f` → `classifyRuleAsUnderline`'s `rule.height > 0.18*size` guard fails for `-h`, full-width background band mistaken for a strikethrough and resized → background wiped). That bug is **CLASSED below as FIXED** (normalization at `locateDecorationRects:591`); this audit finds the rest of that class.

Evidence grade: every finding is **[Inferred]** from direct reading of the cited lines (no live PDF repro was run in this read-only pass) unless marked otherwise. The negative-height case is **[Verified: fixed]** per the in-code comment + normalization at line 591.

---

## Executive recommendation (read this first)

**Yes — the "match a pre-existing rect/line to a text run and RESIZE page geometry" approach is too aggressive for arbitrary real PDFs, and one additional global guard is warranted.**

The decoration-resize feature mutates page geometry that the engine *did not draw*. Its only safety net is `classifyRuleAsUnderline` + the "exactly one candidate" rule in `matchDecorationForText`. That classifier was written for the **export** path (read-only: tag a run `underline:true`), where a false positive is cosmetic. Reusing it as the **gate for destructively resizing/deleting a vector object** raises the cost of every false positive from "a spurious underline in a DOCX" to "a resized/erased graphic in the user's source PDF." The CLAUDE.md gotcha already says decorations are "decoupled from the text" — that decoupling is exactly why matching them by proximity is fragile.

**Recommended global guard (would have caught the band AND the border-line risk, independent of the height-sign bug):**
> Reject any decoration match where `rule.width > K · textWidth` (e.g. `K = 1.6`) **or** `rule.x` / `rule.x+rule.width` extends more than ~0.5·textWidth beyond the run's own x-extent. A genuine underline is ~text-width and starts at the run's left edge; a table border, page separator, or full-width fill is much wider and/or offset. This is a width-RATIO and x-EXTENT sanity check on top of the existing baseline-band test — it is the missing piece the height-sign normalization does not provide.

The `>50%-overlap` test in `classifyRuleAsUnderline` is **one-directional**: it requires the rule to cover ≥50% of the *run*, but places **no cap on how far the rule extends beyond the run**. A 400-pt full-width rule sitting at a 30-pt word's baseline passes (overlap = 30 = 100% of the run) and gets resized to ~text width — silently truncating a real ruled line / table border / footer separator. See F2 below.

Secondary structural recommendation: make decoration-resize **opt-in per-edit with a visible diff/undo affordance**, or gate it to rules whose width is already within tolerance of the measured text width *before* the edit (i.e. confirm "this really was an underline of THIS text" by pre-edit geometry, not just baseline band).

---

## Ranked findings (severity × likelihood)

| # | Sev | Likelihood | Location | One-line |
|---|-----|-----------|----------|----------|
| F1 | P0 | Med | `flowDoc.ts:83-87` + `contentStreamEditor.ts:635-647` | Over-wide rule (table border / page separator / full-width fill at a baseline) passes the one-directional ≥50% overlap test and gets resized/deleted — same class as the fixed band bug, NOT covered by the height-sign fix |
| F2 | P0 | Med | `flowDoc.ts:86-87` | Overlap test caps coverage of the RUN but not how far the rule extends past it; no width-ratio guard |
| F3 | P1 | Med | `contentStreamEditor.ts:843` / `2207` (`String.fromCharCode`) | Content stream read as Latin-1 char-by-char; a binary/compressed inline image or a stream byte ≥0x80 corrupts on round-trip write-back (lossy re-encode of the whole page) |
| F4 | P1 | Med | `contentStreamEditor.ts:850-857` (`setPageContent`) | Write-back emits a SINGLE uncompressed stream and `& 0xff`-truncates every char; if any preserved op carried a multi-byte/binary payload it is mangled; also silently drops the page if Contents was an array referenced elsewhere |
| F5 | P1 | Low-Med | `contentStreamEditor.ts:557` (`w: lw*ctm[0], h: lh*ctm[3]`) | Decoration rect maps width via `ctm[0]` and height via `ctm[3]` only — a 180°-flip CTM (`-1 0 0 -1`) or negative-scale CTM yields negative width/height that the classifier then mis-handles for the rect path (height sign is normalized, WIDTH sign is not) |
| F6 | P1 | Med | `flowDoc.ts:89-91` (baseline band dy) | Superscript/subscript or a run whose `fontSize` is read from `Tf` not `Tm` scale → wrong baseline band → a real strike classed as underline (or vice-versa), resizing the wrong rule |
| F7 | P1 | Low-Med | `contentStreamEditor.ts:212-216` (BI/ID/EI tokenizer) | Inline-image scan does `indexOf('EI')` — matches the bytes "EI" appearing inside binary image data → truncates the image early, corrupting everything after it in the stream on write-back |
| F8 | P1 | Med | `textEditHandler.ts:168` + `contentStreamEditor.ts:466-469` (`'`/`"` ops) | The `'` and `"` show ops advance the line BEFORE showing; origin tracking assumes leading was set via `TL`. A `"` op (aw ac string) sets word/char spacing as operands that are never consumed → origin still computed but spacing state desync vs a later Path-3 redraw |
| F9 | P2 | Med | `contentStreamEditor.ts:1751` (`font.encodeText` for accented Latin) | Path-3 WinAnsi redraw silently maps Latin-1 chars the base-14 metrics differ on; `hasNonWinAnsi` lets through e.g. `€`/`Š` (CP1252 high range) but the base-14 AFM may lack widths → wrong advance, decoration overshoot, or pdf-lib throw caught nowhere |
| F10 | P2 | Low | `contentStreamEditor.ts:470` (`vScale = hypot(textMatrix[2],textMatrix[3])`) | Font size derived from text-matrix vertical scale; a shear or rotation in `Tm` inflates `vScale`, so `fontSize` is wrong → baseline band + decoration measurement wrong; rotated text edits silently misplace |
| F11 | P2 | Med | `contentStreamEditor.ts:1008` / `1632` (`showOpPayload` ghost-skip + shadow dedup) | Two DISTINCT words with identical glyph payload at sub-0.5pt origins (e.g. repeated table cell "0.00", tight kerning) → `blankAllNearby` erases the neighbour, or the ghost-skip picks the wrong op on re-edit |
| F12 | P2 | Low-Med | `contentStreamEditor.ts:824-846` (multi-stream concat) | Multiple content streams concatenated with `\n`; an op split ACROSS a stream boundary (number in stream A, operator in stream B — legal per spec) tokenizes wrong; write-back collapses N streams into 1, breaking any external `/Contents` array ref |
| F13 | P2 | Low | `contentStreamEditor.ts:361-364` (Q with empty stack) | `Q` with empty ctmStack silently no-ops (unbalanced q/Q from a malformed or partial stream) → CTM drifts → every subsequent origin and decoration coord is offset |
| F14 | P2 | Low | `contentStreamEditor.ts:1676` (Path-1 gate `!byteSwapUnsafe`) | A simple TrueType font with NO FontFile (relies on a system font) and a non-standard `/Encoding` (Differences) passes `byteSwapUnsafe=false`, so Path-1 swaps bytes assuming byte==ASCII → wrong glyphs for remapped codes |
| F15 | P3 | Low | `flowDoc.ts:84` (`rule.width <= 2`) | Absolute 2-pt minimum width rejects legitimately narrow decorations under tiny fonts (4-5pt legal text) and accepts nothing useful; magic constant not font-relative |
| F16 | P3 | Low | `contentStreamEditor.ts:1907` (`fmtNum` rounds to 3 dp) | Coordinates/widths rounded to 1e-3; on a large-media or high-zoom PDF (e.g. CAD plan at 1:1000) 0.001 user-unit rounding visibly shifts the redraw / resized rule |

---

## Detailed rows

### F1 — Over-wide rule passes one-directional overlap → resized/deleted (the band bug's surviving sibling) — **P0**
- **Location:** `flowDoc.ts:83-87` (`classifyRuleAsUnderline`), consumed destructively at `contentStreamEditor.ts:1867` (`matchDecorationForText` in `prepareDecorationResize`) and `1215-1226` (`removeDecorationForText`).
- **Rule / assumption:** A thin rule whose vertical band sits near the run baseline and which covers ≥50% of the *run's* width IS this run's underline/strike. Assumes the rule's horizontal extent is ~the text extent.
- **Violating input:** A real invoice/report (the audit's own example confirms this) draws a **top and bottom table-cell border line** or a **full-width footer/header separator** at almost exactly a text run's baseline. These are thin (passes height), horizontal (passes `width>3·height`), and span the whole page (overlap of the 30-pt word = 100% of the word → passes ≥50%). `matchDecorationForText` then finds exactly ONE such candidate (the others are at different baselines) → it is treated as the underline and **resized to ~text width** (truncating the border) or **neutralised to `n`** on delete (erasing the border).
- **Symptom:** A table/cell border line shrinks to one word's width, or vanishes, on the first true-edit of any cell text that happens to sit on that border's y. Silent graphic corruption. This is the SAME failure mode as the fixed negative-height band, reached via a *different* geometry (positive-height, over-wide) that the height-sign fix does NOT address.
- **Severity:** P0 — destructive, silent, on common documents.
- **Likelihood:** Med-High — ruled tables and footer rules are ubiquitous; the negative-height case was just one encoding of it.
- **Fix direction (root cause):** Add the width-RATIO + x-EXTENT guard (Executive recommendation). Concretely, in `matchDecorationForText` reject any candidate where `rule.width > 1.6 * textWidth` OR `rule.x < run.x - 0.5*textWidth` OR `rule.x + rule.width > run.x + run.width + 0.5*textWidth`. A true underline starts at the run's left edge and ends near its right edge; a border does not. This is the single highest-ROI guard and supersedes per-encoding patching.

### F2 — Overlap test is one-directional (no extent cap) — **P0** (root cause of F1)
- **Location:** `flowDoc.ts:86-87`.
- **Rule:** `overlap = min(ruleRight, runRight) - max(ruleLeft, runLeft); if (overlap < 0.5*run.width) return null;`
- **Assumption:** "covers ≥50% of the run" ⇒ "belongs to the run." False: a rule 100× wider than the run trivially covers 100% of it.
- **Violating input:** Any rule wider than the run (table border, separator, full-page underline-of-a-heading reused under body text).
- **Symptom:** As F1.
- **Severity:** P0 (it is the mechanism behind F1).
- **Likelihood:** Med.
- **Fix:** Symmetric overlap — also require `overlap >= 0.5*rule.width` (rule must be mostly-covered BY the run too), and/or the width-ratio cap. Cheap, pure, unit-testable in the existing `classifyRuleAsUnderline` test file.

### F3 / F4 — Latin-1 stream I/O + single-stream lossy write-back — **P1**
- **Location:** read `getPageContent` `:843` (`String.fromCharCode(bytes[i])`) and `:2207`; write `setPageContent` `:850-857` (`bytes[i] = content.charCodeAt(i) & 0xff`).
- **Assumption:** A decoded content stream is safely representable as a JS string of code units 0-255 and re-encodable byte-for-byte.
- **Violating input:** Content streams legally contain binary: **inline image data** (`BI…ID <binary> EI`), and after `decodePDFRawStream` any byte 0x00-0xFF. The round-trip is *mostly* lossless for 0-255 because `& 0xff` inverts `fromCharCode` — BUT serialization (`serializeOps`) **re-spaces and newline-joins ops** (`:286 join('\n')`), and inline images are passed through as one opaque `raw` token whose internal bytes survive only if the `indexOf('EI')` boundary (F7) was correct. The deeper risk: `setPageContent` writes a SINGLE uncompressed stream and **drops the original `/Filter`** — fine functionally, but it rewrites the WHOLE page content even for a one-word edit, so ANY tokenizer imperfection (F7, F12, comments inside strings) corrupts the entire page, not just the edit site.
- **Symptom:** Whole-page rendering breakage after editing one word on a page containing an inline image or unusual binary op.
- **Severity:** P1.
- **Likelihood:** Med (inline images are common in scanned/mixed PDFs).
- **Fix:** Don't re-serialize the entire stream. Prefer a **byte-splice** edit (locate the exact byte range of the target show op in the ORIGINAL decoded bytes and replace only that slice), leaving all other bytes — including inline images — untouched. This is the root-cause fix for F3/F4/F7/F12 simultaneously.

### F5 — Decoration rect width via `ctm[0]`, height via `ctm[3]`; width sign not normalized — **P1**
- **Location:** `contentStreamEditor.ts:557` then `591-596`.
- **Rule:** `w: lw*ctm[0], h: lh*ctm[3]`; on push, `y0 = r.h<0 ? r.y+r.h : r.y; height: Math.abs(r.h)` — height sign fixed, **width sign kept** ("a negative-width rect is already rejected by the classifier").
- **Assumption:** A negative width is always rejected downstream. Check: `classifyRuleAsUnderline:84` does `rule.width <= rule.height*3 || rule.width <= 2` → a negative width is `<=2` → rejected. OK for the rect path. BUT: a **180° page CTM** (`-1 0 0 -1 W H cm`, used by some imposition / N-up tools) makes BOTH `ctm[0]` and `ctm[3]` negative, so `w<0` (rejected — safe) — **however** `skewed()` only checks `ctm[1]/ctm[2]`, so a pure-negative-scale CTM is NOT refused; the rect is collected with negative w/h, height normalized, width negative → rejected. Net: safe-by-luck, not by design. The real exposure is a **mirror flip** (`-1 0 0 1`, ctm[0]<0, ctm[3]>0): `w<0` (rejected), but the LINE path (`:609 strokeUser = lineWidth*abs(ctm[3])`, `width: abs(l.userX-m.userX)`) uses `abs()` and would NOT reject a mirrored stroked line → a mirrored underline resizes in the wrong direction.
- **Symptom:** On mirrored/flipped pages, stroked-line decorations resize in the wrong direction or by the wrong amount.
- **Severity:** P1.
- **Likelihood:** Low-Med (flip CTMs appear in imposed/booklet PDFs).
- **Fix:** Refuse any decoration when `ctm[0] < 0` or `ctm[3] < 0` (negative scale) in `locateDecorationRects`, alongside the existing `skewed()` shear refusal. Mirrored geometry can't be width-resized by a scalar.

### F6 — Baseline band assumes `fontSize` is the glyph EM and origin is the true baseline — **P1**
- **Location:** classifier `flowDoc.ts:89-91`; `fontSize` source `contentStreamEditor.ts:470,476` (`fontSize*vScale`).
- **Assumption:** `dy = (rule.center.y - run.y)/run.size` lands in `[-0.35,0.1]` for underline, `[0.18,0.62]` for strike, where `run.y` is the baseline and `run.size` the EM.
- **Violating input:** (a) **Superscript/subscript** runs have a baseline offset by `Ts` (text rise) or a `Tm` shift; the rule under the BODY text then lands outside the band relative to the super/subscript's `run.y`. (b) When `Tf` size differs from the effective rendered size (size set by `Tm` scale with `Tf 1`), `fontSize = Tf*vScale` may be correct via `vScale` — but a font set as `/F1 1 Tf` then scaled by `Tz`/`cm` (not `Tm`) is NOT captured (`vScale` only reads `Tm`), so `run.size` is ~1 → `dy` explodes → mis-classification.
- **Symptom:** A real strikethrough classed as underline (resizes/deletes the wrong rule), or a decoration missed entirely. Combined with F1 this can resize an unrelated nearby rule.
- **Severity:** P1.
- **Likelihood:** Med (`1 Tf` + `Tz`/`cm` scaling is a known idiom in some generators).
- **Fix:** Fold the full effective text-rendering matrix (Tm × CTM × Tz) into the reported size and baseline, not just `Tm`'s vertical scale; OR refuse decoration-resize when `target.hScale != 100` or a non-`Tm` scale path produced the size (low confidence in geometry → don't mutate).

### F7 — Inline-image `indexOf('EI')` false boundary — **P1**
- **Location:** `contentStreamEditor.ts:212-216`.
- **Rule:** On `BI`, `src.indexOf('EI', i)` and pass everything through to `EI+2` as one token.
- **Assumption:** The first "EI" after `BI` is the image terminator.
- **Violating input:** Image binary data legitimately contains the byte pair `0x45 0x49` ("EI") mid-stream. The spec terminator is `EI` preceded by whitespace AND followed by whitespace/delimiter; a bare `indexOf` ignores that.
- **Symptom:** Inline image truncated early → tokenizer resumes mid-binary, mis-parses the remainder of the page → whole-page corruption on write-back.
- **Severity:** P1.
- **Likelihood:** Low-Med (inline images are less common than XObject images but appear in older/scanned PDFs).
- **Fix (root cause):** Require the `EI` to be whitespace-delimited (`\sEI\s`), and ideally use the `/L` length hint when present; better yet, the byte-splice approach (F3/F4 fix) avoids re-tokenizing inline-image bytes at all.

### F8 — `'` and `"` show ops: line-advance + spacing operands — **P1**
- **Location:** `contentStreamEditor.ts:466-469`; replace/blank handling treats `'`/`"` in `SHOW_OPS`.
- **Assumption:** `'` = `T* string`; `"` = `aw ac string '`. The code advances the line (`:467`) but for `"` does NOT consume `aw`/`ac` into `wordSpacing`/`charSpacing` state.
- **Violating input:** A PDF using `"` ops (rare but legal, common in some typesetters) — the spacing operands `aw ac` are positional operands, so `op.operands[op.operands.length-1]` IS the string (correct for blank/replace), but the captured `charSpacing`/`wordSpacing` for a subsequent Path-3 redraw are STALE (the `"` op's own `aw/ac` were ignored). Also `blankShowOp` for `"` leaves `aw ac ()` — harmless visually but the `aw/ac` numbers now apply to an empty string.
- **Symptom:** Path-3 redraw of a `"`-shown run uses wrong word/char spacing; minor visual drift, possible decoration overshoot.
- **Severity:** P1 (correctness of a rare path).
- **Likelihood:** Med among affected docs, Low overall.
- **Fix:** Parse `"`'s leading two operands into `wordSpacing`/`charSpacing` in `locateTextOps` before emitting the TextOpInfo.

### F9 — CP1252 high-range chars through base-14 redraw — **P2**
- **Location:** `contentStreamEditor.ts:1728` (`hasNonWinAnsi` lets CP1252 high range pass) → `1751` (`font.encodeText`).
- **Assumption:** Any WinAnsi-encodable char renders correctly in a base-14 standard font.
- **Violating input:** `€` (0x80), `Š`, `Ž`, `Œ` etc. — encodable in WinAnsi, but the base-14 AFM width tables and glyph coverage for these are incomplete in some pdf-lib StandardFonts; `encodeText`/`widthOfTextAtSize` may throw or return a fallback width.
- **Symptom:** Path-3 redraw throws (uncaught at `:1746-1751` — `replaceTextAt` is `async`; an `embedFont`/`encodeText` throw rejects the promise; `textEditHandler` `commit` awaits it inside no try/catch around the replace → unhandled rejection, edit silently lost) OR wrong advance → decoration overshoot.
- **Severity:** P2.
- **Likelihood:** Low-Med (Euro sign is common in EU invoices — the project's own domain).
- **Fix:** Wrap the Path-3 `embedFont`/`encodeText`/`widthOfText` in try/catch → return false → overlay fallback (the honest-fallback path already exists in the handler). Add `€` to the explicit smoke tests.

### F10 — Font size from `Tm` vertical scale conflates rotation/shear — **P2**
- **Location:** `contentStreamEditor.ts:470` (`vScale = hypot(textMatrix[2],textMatrix[3])`).
- **Assumption:** `hypot(c,d)` of the text matrix == font EM scale.
- **Violating input:** Rotated text (`Tm` with rotation) — `hypot(c,d)` still ≈ size for a pure rotation, but a SHEAR (`Tm = [1 0 0.5 1 …]`) inflates it; also a non-uniform scale.
- **Symptom:** Wrong `fontSize` → baseline band (F6) and decoration width measurement wrong → wrong/over-resized rule.
- **Severity:** P2.
- **Likelihood:** Low.
- **Fix:** Decompose the text matrix properly (as `decomposeImageCtm` already does for images) and refuse decoration-resize on rotated/sheared text (consistent with the documented cm-rotation ceiling).

### F11 — Shadow-dedup / ghost-skip collide on identical-payload neighbours — **P2**
- **Location:** `blankAllNearby:946-965` (SHADOW_RADIUS 0.5, payload+font+size match) and `findTarget:1008` (skip empty-payload ops).
- **Assumption:** Two ops within 0.5pt with identical payload+font+size are the SAME logical glyph (a shadow). And: an empty-payload op is always a blanked ghost.
- **Violating input:** (a) A table with two adjacent cells both showing `"0.00"` in the same font, positioned <0.5pt apart by a generator quirk → editing one blanks the other. (b) A legitimately empty show op `()Tj` authored by a generator (some emit empty positioning ops) → `findTarget` skips it, fine; but if the page's ONLY match is such an op the click finds nothing → overlay (acceptable). The real risk is (a).
- **Symptom:** Editing one cell silently erases an identical adjacent cell value.
- **Severity:** P2.
- **Likelihood:** Low-Med (0.5pt is tight, but dense financial tables exist).
- **Fix:** SHADOW_RADIUS is already conservative; additionally require the duplicate to share the SAME `tfOpIndex`/`colorOpIndex` lineage, or only dedup when the duplicate is within the same `BT…ET` block as the target.

### F12 — Multi-stream concat + single-stream write-back — **P2**
- **Location:** `getPageContent:839-846` (concat with `\n`), `setPageContent:850-857` (one stream).
- **Assumption:** Concatenating streams with `\n` is equivalent to the page's logical content, and replacing all with one stream is safe.
- **Violating input:** Per spec a token may be split across the stream-array boundary (`12` ending stream A, `Tf` opening stream B). The `\n` join saves most cases, but a number split mid-digits (`1` | `2.5`) tokenizes as two numbers. Also: if `/Contents` is an array whose member streams are SHARED/referenced elsewhere (unusual but legal), collapsing to one new stream orphans the shared refs.
- **Symptom:** Rare mis-tokenization; or a shared-stream page losing content.
- **Severity:** P2.
- **Likelihood:** Low-Med.
- **Fix:** Join streams with a space (safer than `\n` only for the split-token case it doesn't fully solve) — real fix is the byte-splice approach which operates per-stream.

### F13 — Unbalanced `q`/`Q` drifts CTM — **P2**
- **Location:** `locateTextOps:361-364` and `locateDecorationRects:535-538` (`Q` pops; empty stack → no-op).
- **Assumption:** q/Q are balanced.
- **Violating input:** A malformed or truncated stream (or one where the page-level CTM is established by an enclosing context the engine doesn't see) with more `Q` than `q`.
- **Symptom:** After the unmatched `Q`, `ctm` keeps its last value instead of restoring → every subsequent origin and decoration coordinate is offset → clicks miss text, decorations match the wrong run.
- **Severity:** P2.
- **Likelihood:** Low.
- **Fix:** Track imbalance; if `Q` underflows, abort decoration-resize for the page (geometry is untrustworthy) rather than silently proceeding.

### F14 — Path-1 byte-swap on simple TrueType with Differences encoding — **P2/P1**
- **Location:** `replaceTextAt:1676` gated by `isByteSwapUnsafeFont` (`:2055`).
- **Assumption:** A font with no FontFile and not Type0/subset uses byte==ASCII.
- **Violating input:** A simple `/TrueType` or `/Type1` font with NO embedded FontFile (system font) but a custom `/Encoding << /Differences [...] >>` remapping byte codes to non-ASCII glyph names. `isByteSwapUnsafeFont` returns false (no FontFile, not subset, not Type0) → Path-1 swaps bytes treating them as ASCII → the remapped codes now show WRONG glyphs.
- **Symptom:** Garbled text after editing, for non-embedded fonts with Differences arrays.
- **Severity:** P2 (P1 if such fonts are common in the target corpus).
- **Likelihood:** Low-Med.
- **Fix:** In `isByteSwapUnsafeFont`, also return true when the font carries a `/Encoding` dict with a `/Differences` array (the byte→glyph map is non-standard).

### F15 — Absolute 2-pt min width — **P3**
- **Location:** `flowDoc.ts:84` (`rule.width <= 2`).
- **Assumption:** Decorations are ≥2pt wide.
- **Violating input:** Underline under a single narrow glyph in tiny (4-5pt) legal/footnote text.
- **Symptom:** Decoration not detected (export misses underline; resize no-ops — benign).
- **Severity:** P3 (fails safe — misses, doesn't corrupt).
- **Fix:** Make the floor font-relative (`max(2, 0.2*run.size)` is already implied by `width>3·height`; the absolute `<=2` is redundant noise).

### F16 — `fmtNum` 3-dp rounding on large media — **P3**
- **Location:** `contentStreamEditor.ts:1907`.
- **Assumption:** 1e-3 user-unit precision is invisible.
- **Violating input:** Large-format / scaled media (engineering drawings) where 1 user unit maps to a large physical distance.
- **Symptom:** Sub-visible-to-visible shift of redrawn text / resized rule.
- **Severity:** P3.
- **Fix:** Scale precision to page media box, or use more digits.

---

## Cross-cutting note on the FIXED negative-height bug

The fix at `locateDecorationRects:591` normalizes the **rect** height sign. It does NOT:
1. normalize the **width** sign for the line path (F5),
2. cap the rule's horizontal EXTENT relative to the text (F1/F2 — the same "a big fill looks like a decoration" class, reached via positive-height over-wide rules),
3. handle the rule arriving via a flip/mirror CTM (F5).

So the class is **partially** closed. The width-ratio/extent guard (F1/F2 fix) is the generalization that closes the rest of the class in one move and should be prioritized over per-encoding patches.

## Suggested test additions (TDD, pure/jsdom where possible)
- `classifyRuleAsUnderline`: a 400-pt rule at a 30-pt run's baseline must return null (currently returns 'underline'). Add symmetric-overlap + width-ratio assertions.
- `locateDecorationRects`: mirrored CTM (`-1 0 0 1`) stroked line must be refused.
- `matchDecorationForText`: a table-border-width rule must NOT match a short run.
- tokenizer: `BI … <bytes containing 'EI'> EI` must terminate at the whitespace-delimited `EI`.
- `replaceTextAt`: `€`-containing Path-3 edit must not reject the promise (try/catch → false → overlay).
- A real-browser guard on a ruled-table PDF: edit a cell, assert the cell border line is byte-unchanged.

---

## Disposition (updated 2026-06-20, after the F5–F9 + F14 work)

| # | Status | Note |
|---|--------|------|
| F1 | **DONE** (`130f5c0`) | Symmetric-overlap guard lives in `matchDecorationForText` (the destructive consumer), NOT the shared export classifier — require the TEXT to cover ≥50% of the RULE too, so an over-wide border/separator/band is rejected. The audit predated this classification. |
| F2 | **DONE** (`130f5c0`) | Same fix as F1 (symmetric overlap is the mechanism). |
| F3 | **DEFERRED** | Byte-splice rewrite. Round-trip is lossless for bytes 0–255 (`String.fromCharCode`⇄`& 0xff` is identity), so this is blast-radius hardening, not active corruption. The one concrete corruption vector was F7 (now fixed). Tracked as its own designed effort. |
| F4 | **DEFERRED with F3** | Single-stream write-back; subsumed by the byte-splice approach. |
| F5 | **DONE** (`5438e29`) | `locateDecorationRects` refuses mirror/negative-scale CTM for rect AND stroked line. |
| F6 | **DONE** (`5438e29`) | `prepareDecorationResize` refuses runs with non-zero `textRise`. |
| F7 | **DONE** (`5438e29`) | `findInlineImageEnd` requires a whitespace-delimited `EI`. The real corruption vector. |
| F8 | **DONE** (`5438e29`) | `locateTextOps` captures the `"` op's `aw ac` as persistent spacing. |
| F9 | **DONE** (`5438e29`) | Path-3 build-then-blank ordering (CP1252 encode throw no longer destroys the original). |
| F14 | **DONE** (this commit) | `isByteSwapUnsafeFont` now refuses a simple font with `/Encoding << /Differences >>` (non-standard byte→glyph map) → Path 1 no longer paints wrong glyphs for remapped codes. Guards: `isByteSwapUnsafeFont — /Differences encoding (F14)` (2 tests). |
| F11 | **WON'T FIX (investigated, rejected)** | Confining shadow-dedup to the same `BT…ET` block was implemented then REVERTED: a legitimate drop-shadow is commonly drawn in a SEPARATE `BT…ET` block (pdf-lib's `drawText` emits one BT per call — see the existing A4 `makeOverlappingTextPdf` fixture), so block-scoping would stop blanking real shadows (regression at the line-508 test). A shadow and a <0.5pt-apart distinct cell with identical payload are geometrically indistinguishable; the existing `SHADOW_RADIUS = 0.5` is already the tightest safe heuristic. Accepted limitation. |
| F10 | **OPEN (Low)** | Sheared/rotated `Tm` inflates the derived font size. Defensive; pairs with the documented cm-rotation ceiling. Would need a Tm-shear flag on `TextOpInfo` + a refusal in `prepareDecorationResize` (mirrors the F6 textRise gate). |
| F12 | **DEFERRED with F3** | Multi-stream split-token; the byte-splice approach is the real fix. |
| F13 | **OPEN (Low)** | `Q` stack underflow drifts CTM. Would abort decoration-resize for the page on imbalance. Low likelihood (malformed streams only). |
| F15 | **ACCEPTED (P3)** | Absolute 2-pt min width fails SAFE (misses a decoration, never corrupts). Not worth a font-relative rewrite. |
| F16 | **ACCEPTED (P3)** | 3-dp `fmtNum` rounding only visible on large-media/CAD PDFs; changing precision risks regressing normal output. |
