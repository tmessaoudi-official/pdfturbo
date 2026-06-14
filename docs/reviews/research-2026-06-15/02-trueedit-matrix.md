# True PDF Text-Edit Engine — Path-Routing Matrix Re-Verification (2026-06-15)

Re-verified against current `src/utils/contentStreamEditor.ts` (1499 lines),
`src/handlers/textEditHandler.ts` (527 lines), `src/types/contentStream.ts`. Builds on
`docs/reviews/research-2026-06-14/01-true-edit.md` (bugs B1–B8). **Material changes since
that audit:** `SHADOW_RADIUS` was lowered 4 → **0.5** (`contentStreamEditor.ts:41`);
`blankAllNearby` now gates on fontKey+size+payload (`:625-644`); `replaceShowOpHex` blanks
trailing TJ items (`:869-891`); `cmapHexToUnicodeStr` is strict UTF-16BE + surrogates
(`:765-786`); A5 refusals (Type3 / invisible-Tr / vertical) wired in `replaceTextAt`
(`:1127-1133`). Several B1–B8 bugs are therefore **already fixed**; the matrix below reflects
current behaviour, not the 06-14 snapshot.

All line numbers verified by direct read this session [Verified].

---

## Path Routing Matrix

Outcome legend — **visible?** the edited glyphs render; **extractable?** pdf.js
`getTextContent` returns the new text; **correct?** fidelity (font/size/color/position) matches
the original. Routing decision = the file:line that selects the path.

| Scenario | Path taken | Routing decision (file:line) | visible? | extractable? | correct? |
|---|---|---|---|---|---|
| Standard 14 font, ASCII | Path-1 literal byte-swap | `:1141` byteSwapUnsafe=false → `:1145` replaceShowOpInPlace true | yes | yes | **yes** |
| Standard font, accented `é` | Path-3 redraw | `:1145` isAsciiSafe false (`:459`) → `:1206` `font.encodeText` (WinAnsi) | yes | yes | degraded (std face) |
| Standard font, Euro `€` | Path-3 redraw | same; `€` IS in WinAnsi (0x80) so encodes | yes | yes | degraded face, glyph OK |
| Standard font, ligature `ﬁ` | Path-3 redraw | `€`-class; `ﬁ` U+FB01 NOT in WinAnsi → `encodeText` substitutes/drops | partial | partial | **WRONG glyph** |
| Subset `ABCDEF+`, char in subset | Path-2 ToUnicode reuse | `:1141` byteSwapUnsafe=true (`:1262`) → `:1159` encodeWithSubset+hex OK | yes | yes | **yes** |
| Subset, NEW char not in subset | Path-3 redraw | `:1158` encodeWithSubset null (`:852`) → Path-3 | yes | yes | degraded (std face) |
| CID/Type0, char in ToUnicode | Path-2 | `:1266` Type0→unsafe; `:1155` bytesPerCode=2; `:1159` OK | yes | yes | yes (if ToUnicode round-trips) |
| CID/Type0, char not in subset | Path-3 redraw | encodeWithSubset null → Path-3 std font | yes | yes | degraded |
| Type3 font | **REFUSE → overlay** | `:1128` isType3Font (`:1287`) → `return false` → handler `:496` `_emitOverlay` | overlay | overlay (overlay is real text) | acceptable (no garbage) |
| Embedded TrueType/Type1 (full, non-subset) | Path-2 if ToUnicode else Path-3 | `:1269` descriptorHasFontFile→unsafe; `:1153` cmap gate | yes | yes | yes / degraded |
| Plain `Tj` ASCII | Path-1 | `:1145` operand is literal string (`:492-497`) | yes | yes | yes |
| `TJ` with kerning, ASCII std font | Path-1 — **kerning lost** | `:480-489` collapses whole array to one literal string | yes | yes | **PARTIAL** — neighbors shift (Gap 1) |
| `TJ` with kerning, subset font | Path-2 — kerning kept, **glyphs flattened** | `:869-891` full payload→first hex, others `<>` | yes | yes | spacing kept, per-segment widths lost |
| cm-transformed text block | Path-1/2 inherit CTM (correct); **Path-3 redraw WRONG** | location via `:314-322` cm tracking; redraw `:1210` emits `1 0 0 1 x y Tm` (identity) | yes | yes | P1/2 **yes**; P3 wrong scale/rot |
| Tm-scaled text | Path-1/2 correct; Path-3 scale-only via `fontSize*vScale` | `vScale` at `:389`; redraw uses `target.fontSize` (already ×vScale) | yes | yes | P3 size OK, skew/rot lost |
| Form-XObject text | **REFUSE → overlay** | handler `:136` `!hit.inXObject` MISS → overlay; engine guard `:1173-1180` | overlay | overlay | acceptable (A1 fixed) |
| Nested XObject (Do in Do) | not located by edit path → **no match → overlay** | `findTarget` `:688-707` recurses **one** level only | overlay | overlay | acceptable |
| Rotated page `/Rotate` | Path-1/2 in unrotated space (render applies rotate); inline-input placement approximate | location ignores /Rotate; input `:406-409` screen-coord branch | yes | yes | edit correct, **input misplaced** |
| RTL / Arabic | Path-2 in-subset; else Path-3 = notdef | `:1141` unsafe→P2; P3 std fonts have no Arabic | P2 yes / P3 blank | P2 yes | shaping lost; P3 unusable |
| Vertical / WMode `-V` | **REFUSE → overlay** | `:1130` isVerticalWritingFont (`:1300`, named `-V` CMap) | overlay | overlay | acceptable |
| Invisible `Tr` 3/7 (OCR layer) | **REFUSE → overlay** | `:1129` renderMode 3\|7 (`:399`, `:53`) | overlay | overlay | acceptable (no paint-over-scan) |
| Encrypted PDF | overlay (load throws) | handler `:110` `PDFDocument.load` → catch `:159` | overlay | overlay | acceptable |
| Scanned / image-only | **add new box** (not edit) | handler `:103` `!best` → `addTextAtPosition` | new overlay | new overlay | n/a (no source text) |
| Multiple distinct ops sharing baseline | only target edited; neighbors **survive** | `blankAllNearby` `:639-641` requires same fontKey+size+payload | yes | yes | **yes** (B5 FIXED) |
| Genuine shadow/outline duplicate | target + identical dupes blanked | `:636` dist≤0.5 AND `:641` payload match | yes | yes | yes |

### Cells that are WRONG / silently degraded (current code)

1. **`ﬁ` / non-WinAnsi ligature on a standard or Path-3 font** — `font.encodeText` (`:1206`)
   silently substitutes or drops the glyph. No refusal, no warning. Visible but wrong. [Verified: WinAnsi has no U+FB01; `encodeText` substitutes]
2. **TJ kerning collapse, Path-1** (`:480-489`) — whole kerned array → one literal; same-line
   spacing/justification changes. Visible but layout shifts. (Gap 1) [Verified: code collapses array]
3. **Path-3 redraw under a scaling/rotating `cm`** (`:1210` identity Tm) — wrong size/orientation.
   (Ceiling A6) [Verified: redraw Tm hardcodes `1 0 0 1`]
4. **Path-3 fill color from `scn`/`Separation`/`cs`** — `parseFillColorToRgb` (`:421-439`) reads
   only rg/g/k; `cs` *resets* fillColor to undefined (`:375-378`) so Separation text redraws as
   **black**. (Gap 2 / B7-B8) [Verified: parser regex set + cs reset]

### Cells now correctly HANDLED (regressions from 06-14 audit closed)

- **B4 XObject silent no-op** → now overlay fallback (handler `:136` + `:496-503`). [Verified]
- **B5 over-blanking** → SHADOW_RADIUS 0.5 + fontKey/size/payload gate (`:636-641`). [Verified]
- **B3 TJ Path-2 first-hex-only** → trailing hex items blanked `<>` (`:869-891`). [Verified]
- **B2 cmap chunk-size heuristic** → strict UTF-16BE + surrogate pairs (`:765-786`). [Verified]
- **B6 empty-slice `|| '0'`** → gone; new loop emits nothing for empty (`:765-786`). [Verified]
- **Type3 / vertical / invisible-Tr** → refuse→overlay (`:1127-1133`). [Verified]

---

## Sprint-2 fixes verified

| Fix | Present? | Evidence (file:line) |
|---|---|---|
| **A-1** XObject/refused → overlay (not silent no-op) | **YES** | handler treats `hit.inXObject` as MISS `:136`; `replaceTextAt` false → `_emitOverlay(...,text:newText)` `:496-503`; engine refuses XObject without blanking `:1173-1180`; overlay context captured at editor-open `:362-373` |
| **A-2** `replaceShowOpHex` full payload to first TJ hex AND blank every other hex item | **YES** | `:874-882` — first hexstring ← `newHex`, every subsequent hexstring ← `<>` |
| **A-3** `cmapHexToUnicodeStr` UTF-16BE code units + surrogate pairs | **YES** | `:765-786` — 4-hex stride, high-surrogate 0xD800-DBFF pairs with low 0xDC00-DFFF → `0x10000+...`, lone surrogate skipped |
| **A-4** `blankAllNearby` only same fontKey+size+payload | **YES** | `:639` fontKey, `:640` |size|≤0.01, `:641` `showOpPayload` equality; payload captured pre-mutation `:1118` |
| **A-5** Type3 / vertical (`-V`) / invisible-`Tr` (mode 3/7) refuse → overlay | **YES** | `:1127-1133` OR of `isType3Font` (`:1287`), `renderMode===3\|\|7`, `isVerticalWritingFont` (`:1300`); `renderMode` tracked at `Tr` `:335-337` and stamped on op `:399` |

All five Sprint-2 fixes hold in current code. [Verified by direct read]

---

## Reachable Gaps

### Gap 1 — TJ kerning preservation (biggest-ROI)

- **file:line / current behavior:**
  - Path-1 (`replaceShowOpInPlace` `:480-489`): a kerned `[(Wor) -30 (d) ...] TJ` is collapsed to
    `[(newtext)]` — every kerning number is discarded. On justified or tightly-kerned body text the
    edited run re-flows and downstream same-line glyphs visually shift.
  - Path-2 (`replaceShowOpHex` `:874-882`): kerning **numbers are kept** (good) but all text is jammed
    into the first hex segment and the rest blanked — per-segment advance widths no longer match, so
    inter-glyph spacing within the run is wrong even though the line as a whole holds position.
  - Confirmed NOT done (roadmap A5). [Verified: both functions read this session]
- **fix sketch:** Distribute `newText` across the existing array structure instead of collapsing.
  Minimal viable: replace only the **text** items, leave kerning numbers in place, and split `newText`
  proportionally across the original string segments by character count (length-preserving edits keep
  exact kerning; length-changing edits append/trim from the last segment). Better: recompute kerning
  from glyph advance widths (requires reading font `/Widths` — larger). Start with the segment-preserving
  split — it fixes the common "fix one word in a kerned line" case without width math.
- **effort:** M (segment-preserving split ~1d; full width-aware re-kern is L).
- **test approach:** jsdom unit on `replaceShowOpInPlace`/`replaceShowOpHex` — feed a 3-segment kerned
  TJ op, assert kerning numbers survive and per-segment text length is preserved for equal-length edits.
  Add a browser pixel test (`tests/browser/`) asserting neighbor x-position stability after editing a
  middle word in a justified line.

### Gap 2 — fill-color in Path-3 redraw (sc/scn/Separation + render-mode color)

- **file:line / current behavior:**
  - Color tracked in `locateTextOps`: rg/g/k stored as raw string (`:358-369`); `sc`/`scn` stored raw
    (`:370-374`); `cs` **resets fillColor to undefined** (`:375-378`).
  - Path-3 redraw reads color via `parseFillColorToRgb(target.fillColor)` (`:1190`), whose regexes
    (`:421-439`) match **only** `rg`/`g`/`k`. An `scn`/`Separation`/`Lab` string → null → redraw
    defaults to **black** (`:1186` `cr=cg=cb=0`). Separation-tint or spot-color text silently recolors.
  - Render-mode color: stroke-only text (`Tr 1`/`2`) uses stroke color (`RG`/`G`/`K`/`SCN`), which is
    not tracked at all — redraw always fills, ignoring stroke paint. [Verified: no stroke-color case in switch]
- **fix sketch:** (a) For DeviceN/Separation `scn` with 1 tint component over a known alternate, approximate
  as gray `1−tint` (or resolve the Separation `/AlternateSpace` + tint transform — larger). (b) Stop the
  blanket `cs`-reset: remember the colorspace and keep the subsequent `scn` operands so a tint can be read.
  (c) When color can't be resolved, fall back to **sampling the canvas pixel at the origin** (the handler
  already samples bg/fg for overlays `:202-242`) instead of hardcoding black. Option (c) is the highest
  value-for-cost and removes the silent-black failure for *all* unparseable colorspaces.
- **effort:** S for (c) canvas-sample fallback; M for (a)+(b) Separation handling.
- **test approach:** unit-test `parseFillColorToRgb` returns null for an `scn` string (documents the gap),
  then assert the new fallback path is taken. Browser pixel test: edit red Separation/spot text, assert
  redrawn glyph is not `#000000`.

### Gap 3 — number-tokenizer hardening (signed / leading-`+` / `.5` / `-.5` / exponent)

- **file:line / current behavior:** Two tokenizers. Main loop opens a number on `/[0-9+\-.]/` (`:152`)
  but the **continuation** class is `/[0-9.]/` (`:155`) — same in `tokenizeOne` (`:192-195`).
  Consequences:
  - Leading `+`/`-`/`.` is consumed as the first char → `+12`, `-.5`, `.5` tokenize correctly (first
    char is in the open class, rest are digits/dot). [Verified: traced]
  - A sign that appears mid-token is NOT a continuation char, so `1-2` (no space, illegal in PDF but seen
    in malformed streams) splits into `1` and `-2` — acceptable.
  - **Exponent** `1e-3` → tokenizes as number `1`, operator `e`, number `-3` → `serializeOps` reinserts a
    space → stream meaning changes. PDF real-number syntax forbids exponents (ISO 32000 §7.3.3) so this is
    low-frequency, but a non-conforming producer can emit it.
  - **Double-dot** `1.2.3` → single number token `"1.2.3"`, `parseFloat`→`1.2`, but `.value` is only used
    for matrix math (`locateTextOps`); `.raw` is what's re-serialized, so the malformed literal round-trips
    unchanged — safe.
  - The real latent risk: any number where the **whole token** must be preserved byte-exact (it is, via
    `.raw`) — so tokenizer mis-splitting only bites when a split inserts/removes a space that changes
    operator grouping (the exponent case). [Verified by reading both tokenizers]
- **fix sketch:** Make the continuation class accept a trailing `e`/`E` + optional sign + digits only when
  immediately following digits (a tiny exponent sub-scan), OR — simpler and safer — leave the lexer alone
  and add a guard in `serializeOps`/`serializeTokens` is unnecessary since `.raw` round-trips. The minimal
  correct fix: extend continuation to consume a single `e`/`E[+-]?digits` suffix so `1e-3` stays one token.
  Keep it conservative (only after at least one digit) to avoid swallowing the `Tj`-adjacent `e`.
- **effort:** S (one regex/sub-scan in two places + unit tests).
- **test approach:** unit `tokenizeContentStream('1e-3 1.5 -.5 +2 .25 Tm')` → assert exactly the expected
  token count/values and that `serializeTokens` round-trips byte-identically for each.

**Biggest-ROI: Gap 1 (TJ kerning)** — it is the only gap that degrades a *common, fully-supported* edit
(editing a word in normal kerned/justified body text), is reachable on every Path-1 and Path-2 edit, and
the segment-preserving variant is ~1 day. Gap 2's silent-black is real but narrower (Separation/spot color);
Gap 3 is a hardening nicety (exponents are non-conformant and rare).

---

## Ceiling (hard limits — confirmed)

- **A6 — cm scale/rotation in Path-3 redraw:** hard limit. Redraw emits `1 0 0 1 x y Tm` (`:1210`),
  ignoring any scaling/rotating/skewing CTM; transformed (letterhead/logo) text redraws upright at wrong
  size. Path-1/2 are immune (edit in place). [Verified: `:1210`]
- **Rotated-page placement:** hard limit for the inline editor only. Edit itself is correct (render applies
  `/Rotate`); the floating `<input>` uses raw screen coords on rotated pages (`:406-409`), so the box is
  approximately placed, not glyph-aligned. [Verified: `:403-409`]
- **RTL / Arabic shaped glyphs + embedded fallback:** hard limit. Content stream is logical-order; shaping/
  ligature is a font feature lost on re-encode. Path-3 standard fonts (Helvetica/Times/Courier) carry no
  Arabic glyphs → notdef/blank. No embedded Arabic fallback exists. Effectively unsupported. [Verified:
  matchStandardFont returns only Latin std fonts `:903-927`]
- **Type3 true-edit:** hard limit by design — glyphs are CharProc content streams, not byte→glyph; engine
  refuses → overlay (`:1128`). Correct call; true-edit is not achievable client-side. [Verified: `:1287`]
- **PDFium-WASM moonshot (`FPDFText_SetText`):** out of scope; would replace the whole content-stream
  surgery layer with a WASM engine (~several MB, large integration). Noted only. [Speculative]
