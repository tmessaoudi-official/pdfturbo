# True PDF Text Editing — Engine Audit (research, 2026-06-14)

Scope: why true text editing succeeds vs falls back to "redact + overlay". All claims confirmed
against `src/utils/contentStreamEditor.ts`, `src/handlers/textEditHandler.ts`,
`src/types/contentStream.ts`, and the two test files. No code modified.

---

## 1. Decision tree: click → true-edit vs overlay fallback

Entry point: `TextEditHandler.handleCanvasClick` (textEditHandler.ts:35).

1. **Resolve page + source PDF** (`textEditHandler.ts:36-39`). If no `currentPage` or no
   `SourcePdf`, return silently — nothing happens (not even overlay).
2. **Canvas → PDF coords** (`:41-52`). `pdfY = pageH - canvasY` (bottom-left origin).
3. **pdf.js hit-test** (`:54-76`): `page.getTextContent()` items, AABB test with `TOLERANCE = 12`,
   pick nearest by center distance → `best`.
4. **No `best`** (`:81-84`): click landed on blank area → `app.addTextAtPosition(e)` drops a NEW
   overlay text box (ISSUE-5 unified mode). **This is not a fidelity fallback — it is "add new text".**
5. **True-edit attempt** (`:87-134`), wrapped in `try/catch`:
   - `PDFDocument.load(src.bytes.slice(0))` — **catch here = encrypted/unparseable PDF → overlay fallback**
     (`:132-134`, comment "Encrypted or unparseable source PDF").
   - **Multi-candidate matching** (`:95-111`): pdf.js splits one `Tj` at word boundaries, so the
     clicked item's `transform[4,5]` may not equal the content-stream `Tm`/`Td` origin. It tries
     `best` first, then `fallbackCandidates` (other items within `FALLBACK_RADIUS = 50` pts, sorted by
     distance), calling `findTextOpAt(libDoc, pageIndex, origin, TRUE_EDIT_TOLERANCE=3)` for each.
   - **`target` set** → `_openTrueEditInput(...)` opens the inline floating input → true edit. **return.**
   - **`target` null for every candidate** → falls through to overlay block (`:136-245`):
     `RedactionElement` cover (sampled bg color) + `TextElement` (sampled fg color) via `MacroCmd`.

### The functions that return null/false → trigger overlay

| Function | file:line | Returns null/false when… | Result |
|---|---|---|---|
| `findTextOpAt` | contentStreamEditor.ts:675 | `findTarget(...)?.target` is null | candidate loop exhausts → overlay |
| `findTarget` | :627 | (a) `getPageContent` empty (`:633`); (b) no direct text op within `tolerance` (`:640-644`) AND no Form-XObject text op within tolerance (`:648-666`) | `findTextOpAt` null |
| `PDFDocument.load` throw | textEditHandler.ts:88 | encrypted / corrupt PDF | catch → overlay |

`findTarget` tolerance is the **only positional gate**. `TRUE_EDIT_TOLERANCE = 3` pts
(textEditHandler.ts:12) is tight; the multi-candidate scan (radius 50) exists precisely because a
single clicked origin frequently misses by >3 pts.

**Key point:** `findTextOpAt` does NOT inspect the font. It only asks "is there a show op whose
CTM-transformed baseline origin lies within 3 pts?" So the *handler-level* fallback is purely
geometric (no match) or load-failure (encrypted). The *font*-driven fallback happens **later**,
inside `replaceTextAt` (Section 2, Path 3 / XObject refusal), AFTER the inline input is already open.

> Consequence: a click can pass `findTextOpAt`, open the inline editor, the user types, and only then
> does `replaceTextAt` return `false` (XObject case, `:1116`) → `commit()` silently returns
> (`:415 if (!ok) return;`). The original text is preserved but **no overlay is offered** in that
> path — the edit just no-ops. See Bug B4.

---

## 2. The three paths inside `replaceTextAt` (contentStreamEditor.ts:1059-1152)

Pre-step: `found = findTarget(...)` (`:1067`); if null → `return false`.
Then `byteSwapUnsafe = isByteSwapUnsafeFont(doc, pageIndex, target.fontKey)` (`:1078`).

### `isByteSwapUnsafeFont` (`:1198-1216`) — the master gate for Path 1

Returns **true** (byte-swap forbidden) when ANY of:
- `isSubsetFontName(baseName)` — BaseFont matches `/^[A-Z]{6}\+/` (`:1160-1162`, e.g. `ABCDEF+Arial`).
- Font `Subtype` contains `Type0` (`:1203`) — CID fonts never use plain byte=ASCII.
- Top-level `FontDescriptor` has `FontFile`/`FontFile2`/`FontFile3` (`:1186-1188, :1206`) — embedded program.
- DescendantFonts[0] `FontDescriptor` has an embedded FontFile (`:1208-1214`).

Returns **false** (byte-swap allowed) only for non-subset, non-Type0, non-embedded fonts — i.e.
the 14 standard fonts or simple fonts whose byte code == ASCII/WinAnsi.

### Path 1 — ASCII literal byte-swap (in-stream) — `:1082-1086`
Guard: `!byteSwapUnsafe && replaceShowOpInPlace(op, newText)`.
`replaceShowOpInPlace` (`:465-486`) additionally requires:
- `isAsciiSafe(newText)` — every char 32..126 (`:447-453`); non-ASCII → false.
- For `Tj`/`'`/`"`: last operand is a **literal `string`**, not `hexstring` (`:480-484`).
- For `TJ`: array must contain at least one `string` item (`:468-476`); collapses whole array to one literal.

Produces: **visible, full-fidelity** — original font/size/color preserved; text genuinely changed in
stream. Blanks shadow ops within 4 pts (`:1083`). This is the only path that keeps the *real* font.

### Path 2 — subset glyph reuse via ToUnicode — `:1088-1101`
Runs when Path 1 skipped/failed. Reads `ToUnicode` CMap (`getPageFontToUnicode :926`), builds
forward map (`parseToUnicodeCMap :762`), inverts to unicode→code, encodes `newText`
(`encodeWithSubset :813`), writes hex (`replaceShowOpHex :832`).
Succeeds only when **every char of newText exists in the subset's ToUnicode** (`:822 return null`
on any miss) AND the op actually has a hexstring operand.
Produces: **visible, full-fidelity** (original embedded font reused) — but only for chars already in
the document's subset. Typing a brand-new glyph (e.g. an accent the doc never used) → returns null →
Path 3.

### Path 3 — standard-font redraw (fallback) — `:1110-1151`
- **XObject refusal** (`:1110-1117`): if `found.xObjectName` set, `return false` WITHOUT blanking —
  preserves original, no replacement. Handler then no-ops (Bug B4). Comment: "Never delete without a
  visible replacement."
- Otherwise: `blankShowOp` + `blankAllNearby` (`:1119-1120`), then redraw. Color from
  `style.color` else parsed `target.fillColor` else black (`:1122-1129`). Font via
  `matchStandardFont(effectiveName, effectiveFlags)` (`:1137`) — serif/sans/mono + bold/italic
  heuristic. Embeds a standard font, adds page resource (`addPageFontResource :1222`), encodes via
  `font.encodeText` (WinAnsi, handles accented Latin), emits explicit `BT…Tm…Tj…ET` appended to the
  same serialized stream in ONE `setPageContent` (`:1144-1149`).
  - **Critical correctness note (already learned):** must NOT use pdf-lib `page.drawText` after
    `setPageContent`, or the redraw is orphaned (`:1103-1109` comment). Current code is correct.
Produces: **visible but LOWER fidelity** — standard font substitutes the real one; glyph
shapes/metrics differ. Original text is gone. This is "true edit" in the sense the old text is
removed, but the new text looks like Helvetica/Times/Courier, not the original face.

| Path | Guard | Fidelity | Original font kept? |
|---|---|---|---|
| 1 literal | non-subset/non-embedded + ASCII + literal-string operand | full | yes |
| 2 subset reuse | ToUnicode present + all glyphs in subset + hex operand | full | yes |
| 3 redraw (page) | not XObject | degraded (std font) | no |
| 3 XObject | `found.xObjectName` set | none — refuses, no-op | n/a (preserved) |

---

## 3. Edge-case matrix

T = true-edit works (visible, fidelity per path); P = partial/degraded; F = falls back to overlay
(handler) or no-ops (engine). Cite = code path.

| Input | Outcome | Why (code path) |
|---|---|---|
| **Standard 14 font, ASCII edit** | T (Path 1, full) | `isByteSwapUnsafeFont` false, `replaceShowOpInPlace` true (:1082) |
| **Standard font, non-ASCII (é, €)** | P (Path 3 redraw) | `isAsciiSafe` false (:447) → Path 1 skip; no ToUnicode usually → Path 3 via `font.encodeText` WinAnsi (:1143). € outside WinAnsi → wrong glyph |
| **Subset font (ABCDEF+), char in subset** | T (Path 2, full) | byteSwapUnsafe true (:1199) → Path 2 encodeWithSubset succeeds (:1095) |
| **Subset font, NEW char not in subset** | P (Path 3 redraw, std font) | encodeWithSubset null (:822) → Path 3 |
| **CID / Type0 font, char in ToUnicode** | T/P (Path 2) | byteSwapUnsafe true (:1203); Path 2 works IF ToUnicode round-trips. Multi-byte handled by `bytesPerCode` (:823). But CMap parser misses combined/CID nuances (see Bug B2) |
| **CID Type0, char not in subset** | P (Path 3 redraw) | encodeWithSubset null → Path 3 |
| **Type3 font (glyph procs)** | P (Path 3 redraw) — wrong | No Type3 detection; `isByteSwapUnsafeFont` may be false (no FontFile, not Type0) → Path 1 byte-swap into a Type3 = garbage; or Path 3 std font ignores the Type3 design. Geometry/CTM of Type3 also not honored |
| **Embedded FontFile (full, non-subset)** | P (Path 3) | byteSwapUnsafe true via descriptorHasFontFile (:1206). Path 2 only if ToUnicode present, else Path 3 |
| **cm-transformed text block** | T for location; P/F for redraw | `locateTextOps` tracks `cm`/`q`/`Q` (:298-314) so origin is correct (tested :82-117). BUT Path 3 redraw emits `1 0 0 1 x y Tm` in page space ignoring scale/skew/rotation of CTM (:1147) → wrong size/orientation if CTM had scale/rotation. Path 1/2 edit in place so they inherit the CTM correctly |
| **Form XObject text** | F (engine refuses) | `findTarget` locates it (:648-666) so inline input OPENS, but `replaceTextAt` returns false at :1116 without overlay → silent no-op (Bug B4). `deleteTextAt` DOES work on XObjects (writeBack handles xObjectName :618-625) |
| **Nested XObject (Do inside Do)** | F | `findTarget` only recurses one level (`:649` iterates page ops only); `locatePageTextOps` recurses depth 5 (:1383) but is diagnostic-only, not used by edit path |
| **Rotated page (/Rotate 90/180/270)** | P | `getPageRotation` exists (:1281) but `findTarget`/`locateTextOps` ignore /Rotate — they work in unrotated page space. Handler converts click via pdf.js viewport WITH rotation (:47) but passes raw `transform[4,5]` (unrotated) to `findTextOpAt` (:108). Match can still succeed (both unrotated), but inline input placement uses `rotated` branch with screen coords (:325-328) — approximate. Path 3 redraw Tm is in unrotated space; visually correct because /Rotate applies at render |
| **RTL / Arabic** | P/F | pdf.js reorders to visual; content stream is logical order. Path 1 needs ASCII → fails for Arabic. Path 2 needs Arabic glyphs in ToUnicode subset → often works for in-subset chars but ligature/shaping is lost (one code ≠ one display glyph). Path 3 std fonts (Helvetica/Times/Courier) have NO Arabic glyphs → blank/notdef. Effectively unusable for Arabic |
| **Vertical text (WMode 1)** | P/F | No WMode tracking; `vScale = hypot(textMatrix[2],[3])` (:378) misreads vertical writing; origin/advance wrong. Redraw is horizontal |
| **Multiple show-ops sharing one baseline origin** | P (data loss) | `blankAllNearby` blanks ALL show ops within `SHADOW_RADIUS=4` pts of target origin (:594-605). Intended for shadow/outline duplicates, but legitimately-overlapping distinct text within 4 pts is also wiped. `findTarget` picks nearest single op; the others within 4pt are collateral |
| **Encrypted PDF** | F (overlay) | `PDFDocument.load` throws → catch (:132). Overlay path runs |
| **Ligatures / kerning TJ arrays** | P | Path 1 on TJ collapses the whole array (incl. kerning numbers) into one literal string (:472-476) — kerning lost, neighbor spacing changes. Path 2 `replaceShowOpHex` replaces only the FIRST hexstring item (:835-840), leaving other array items → partial/garbled for multi-segment TJ |
| **Multi-byte CID text** | P | `detectCMapBytesPerCode` + `encodeWithSubset` handle 2-byte (:804,:823). Works if ToUnicode is clean and op is a single hexstring. TJ multi-segment still only first item replaced |
| **Scanned / image-only PDF** | F (overlay) | pdf.js `getTextContent` returns no items → `best` null → `addTextAtPosition` (new box), not edit |
| **Tagged/structured PDF (StructTree)** | T but breaks tags | Edits content stream only; `/MCID` marked-content + StructTree not updated → accessibility tree desyncs |
| **Text via inline image / shading** | F | Not text ops; no show op matched |

---

## 4. Fix directions (ordered by value)

References Phase B/C roadmap (verdict §Roadmap). **Phase A shipped; Phase B largely done**
(ToUnicode reuse, font-matching fallback present); **Phase C partial** (cm tracking + XObject
*location* done; XObject *edit*, rotation, RTL remaining).

1. **B4 — XObject replace no-op leaks (P0 bug-fix).** When `replaceTextAt` refuses an XObject
   (`:1116`), the handler `commit()` `return`s with no user feedback (`:415`). Either (a) make the
   handler fall back to the overlay path when `replaceTextAt` returns false, or (b) implement
   XObject redraw (delete already works). **Effort: (a) ~2h, (b) ~1d. Risk: low / medium.** Highest
   value — silent data-loss-of-intent.

2. **TJ kerning preservation (Phase B "width-compensating TJ").** Path 1 collapses TJ arrays losing
   kerning (:472); Path 2 replaces only first hex item (:835). Re-distribute new text across the
   array or replace per-segment. **Effort: 1–2d. Risk: medium** (advance-width math). High value:
   editing justified/kerned body text currently shifts neighbors.

3. **`blankAllNearby` over-blanking (P1 bug).** 4pt radius wipes distinct overlapping text, not just
   shadows (:594). Restrict to ops with identical/near-identical string OR same font+size, or make
   radius opt-in. **Effort: ~4h. Risk: low.**

4. **cm scale/rotation in Path 3 redraw.** Redraw emits identity-rotation `Tm` (:1147) ignoring CTM
   scale/skew/rotation. Compose the inverse CTM into the emitted Tm, or wrap redraw in the same
   `q cm … Q`. **Effort: ~1d. Risk: medium.** Matters for logo/letterhead transformed text.

5. **Rotated-page support (Phase C).** Honor `/Rotate` in location + inline-input placement
   (:325 currently approximate). **Effort: 1–2d. Risk: medium.**

6. **RTL / Arabic (Phase C).** Needs shaped-glyph-aware encoding + an embedded Arabic fallback font
   (standard 14 have none). Large; likely out of scope for client-only. **Effort: 1–2wk. Risk: high.**

7. **Type3 / vertical / WMode detection → force overlay.** Detect these and refuse true-edit cleanly
   (route to overlay) instead of producing garbage (Type3 byte-swap, vertical mis-origin).
   **Effort: ~4h. Risk: low.** Defensive, high value-for-cost.

8. **PDFium-WASM moonshot (Phase C optional).** `FPDFText_SetText`. Out of scope; noted only.

---

## 5. Correctness bugs found (not just gaps)

- **B1 — Number tokenizer drops signs/decimals mid-token.** `tokenizeContentStream` opens a number on
  `[0-9+\-.]` (`:145`) but the continuation class is only `[0-9.]` (`:148`) — same in `tokenizeOne`
  (`:185-189`). A leading `+`/`-` is consumed as the first char (ok), but a number like `1e-3` or a
  malformed `1.2.3` aside, the real issue: a sign appearing as continuation is NOT consumed, and more
  importantly **two adjacent numbers with no space but a sign** (rare) or scientific notation are
  mis-tokenized. PDF forbids exponents so low impact, but `serializeTokens` join-with-space relies on
  correct splitting. **Severity P2** (PDFs rarely hit it; flag for hardening).

- **B2 — `cmapHexToUnicodeStr` chunk-size heuristic is wrong for multi-code-point dst.** `:748-756`
  picks chunkSize 4 only when `length % 4 === 0 && >=4`, else 2. A bfchar dst like `<00660069>` (fi
  ligature → "fi", two BMP code points = 8 hex chars) is correctly split into 2×4. But `<006601>`
  (6 chars) → chunkSize 2 → decodes as 3 single bytes `00 66 01` = wrong. ToUnicode dsts are UTF-16BE;
  the correct rule is "always 4-hex (UTF-16BE code units), handle surrogate pairs", not a length
  parity guess. **Severity P1** for Path 2 fidelity on ligatures/non-BMP.

- **B3 — `replaceShowOpHex` on TJ replaces only the first hexstring** (`:835-840`), silently dropping
  the rest of a multi-segment kerned array's text content (the other items stay as old glyphs). Path 2
  on real kerned text → garbled. **Severity P1.**

- **B4 — XObject replace silent no-op** (see fix #1): `replaceTextAt` returns false for XObject
  targets (:1116) but the handler already opened the inline editor and on false just `return`s
  (`:415`) with no overlay fallback and no toast. User's typed change vanishes. **Severity P1.**

- **B5 — `blankAllNearby` collateral blanking** (see fix #3): blanks unrelated text within 4pt.
  **Severity P1** on dense layouts.

- **B6 — `cmapHexToUnicodeStr` empty-slice fallback to '0'** (`:753` `|| '0'`) can inject a spurious
  U+0000 into the forward map; that NUL then becomes a reverse-map key. Low real-world impact but a
  latent corruption seam. **Severity P3.**

- **B7 — Path 3 fillColor parse ignores `sc/scn` and `cs` colorspaces.** `parseFillColorToRgb`
  (`:409-428`) handles only rg/g/k; `target.fillColor` may be a `scn`/`Separation` string → parse
  null → redraw defaults to **black** (:1123), silently recoloring text. **Severity P2.**

- **B8 — `locateTextOps` color tracking: `cs` resets color but `scn` after `cs` stores raw operands**
  that `parseFillColorToRgb` can't read (B7). Also `Tr` (text render mode, e.g. invisible mode 3 used
  by OCR layers) is NOT tracked — an invisible OCR text op can be matched and "edited", drawing
  visible Path-3 text over a scanned image. **Severity P2** (OCR'd scans).

---

## Verification basis
All file:line refs read directly from the listed files this session. Path/guard claims cross-checked
against `tests/utils/contentStreamEditor.test.ts` (Path-1/2 helpers, CTM, color, subset detection)
and `tests/handlers/textEditHandler.test.ts` (mock surface confirms handler calls findTextOpAt then
replace/delete/changeSize/changeColor). Bugs B1–B8 are inferred from code reading, not all reproduced
with a crafted PDF — grade [Inferred] except B4/B5 which are [Verified] from explicit code flow.
